const cds = require('../cds')
const LOG = cds.log('fiori|drafts')

const { Object_keys } = cds.utils

const { Readable, PassThrough } = require('stream')

const { getPageSize, commonGenericPaging } = require('../common/generic/paging')
const { handler: commonGenericSorting } = require('../common/generic/sorting')
const { addEtagColumns } = require('../common/utils/etag')
const { handleStreamProperties } = require('../common/utils/streamProp')

const location4 = require('../../http/location')

const $original = Symbol('original')
const $draftParams = Symbol('draftParams')

const AGGREGATION_FUNCTIONS = ['sum', 'min', 'max', 'avg', 'average', 'count']

const _calcTimeMs = timeout => {
  const match = timeout.match(/^([0-9]+)(w|d|h|hrs|min)$/)
  if (!match) return

  const [, val, t] = match
  switch (t) {
    case 'w':
      return val * 1000 * 3600 * 24 * 7
    case 'd':
      return val * 1000 * 3600 * 24
    case 'h':
    case 'hrs':
      return val * 1000 * 3600
    case 'min':
      return val * 1000 * 60
    default:
      return val
  }
}

const _config_to_ms = (config, _default) => {
  const timeout = cds.env.fiori?.[config]
  let timeout_ms
  if (timeout === true) {
    timeout_ms = _calcTimeMs(_default)
  } else if (typeof timeout === 'string') {
    timeout_ms = _calcTimeMs(timeout)
    if (!timeout_ms)
      throw new Error(`
${timeout} is an invalid value for \`cds.fiori.${config}\`.
Please provide a value in format /^([0-9]+)(w|d|h|hrs|min)$/.
`)
  } else {
    timeout_ms = timeout
  }

  return timeout_ms
}

const DEL_TIMEOUT = {
  get value() {
    const timeout_ms = _config_to_ms('draft_deletion_timeout', '30d')
    Object.defineProperty(DEL_TIMEOUT, 'value', { value: timeout_ms })
    return timeout_ms
  }
}

const LOCK_TIMEOUT = {
  get value() {
    let timeout_ms = _config_to_ms('draft_lock_timeout', '15min')

    Object.defineProperty(LOCK_TIMEOUT, 'value', { value: timeout_ms })
    return timeout_ms
  }
}

const reject_bypassed_draft = req => {
  const message =
    !cds.profiles?.includes('production') &&
    '`cds.env.fiori.bypass_draft` must be enabled or the entity must be annotated with `@odata.draft.bypass` to support direct modifications of active instances.'
  return req.reject({ code: 501, statusCode: 501, message })
}

const DRAFT_ELEMENTS = new Set([
  'IsActiveEntity',
  'HasDraftEntity',
  'HasActiveEntity',
  'DraftAdministrativeData',
  'DraftAdministrativeData_DraftUUID',
  'SiblingEntity'
])
const DRAFT_ELEMENTS_WITHOUT_HASACTIVE = new Set(DRAFT_ELEMENTS)
DRAFT_ELEMENTS_WITHOUT_HASACTIVE.delete('HasActiveEntity')
const REDUCED_DRAFT_ELEMENTS = new Set(['IsActiveEntity', 'HasDraftEntity', 'SiblingEntity'])
const DRAFT_ADMIN_ELEMENTS = [
  'DraftUUID',
  'LastChangedByUser',
  'LastChangeDateTime',
  'CreatedByUser',
  'CreationDateTime',
  'InProcessByUser',
  'DraftIsCreatedByMe',
  'DraftIsProcessedByMe'
]

const numericCollator = { numeric: true }
const emptyObject = {}

const _isKeyValue = (i, keys, where) => {
  if (!where[i].ref || !keys.includes(where[i].ref[0])) {
    return false
  }

  return where[i + 1] === '=' && 'val' in where[i + 2]
}

const _getKeyData = (keys, where) => {
  if (!where) {
    return {}
  }

  const data = {}
  let i = 0

  while (where[i]) {
    if (_isKeyValue(i, keys, where)) {
      data[where[i].ref[0]] = where[i + 2].val
      i = i + 3
    } else {
      i++
    }
  }

  return data
}

const _fillIsActiveEntity = (row, IsActiveEntity, target) => {
  if (target.drafts) row.IsActiveEntity = IsActiveEntity
  for (const key in target.associations) {
    const prop = row[key]
    if (!prop) continue
    const el = target.elements[key]
    const childIsActiveEntity = el._target.isDraft ? IsActiveEntity : true
    const propArray = Array.isArray(prop) ? prop : [prop]
    propArray.forEach(r => _fillIsActiveEntity(r, childIsActiveEntity, el._target))
  }
}

const _filterResultSet = (resultSet, limit, offset) => {
  const pageResultSet = []

  for (let i = 0; i < resultSet.length; i++) {
    if (i < offset) continue
    pageResultSet.push(resultSet[i])
    if (pageResultSet.length === limit) break
  }

  return pageResultSet
}

// It's important to wait for the completion of all promises, otherwise a rollback might happen too soon
const _promiseAll = async array => {
  const results = await Promise.allSettled(array)
  const firstRejected = results.find(response => response.status === 'rejected')
  if (firstRejected) throw firstRejected.reason
  return results.map(result => result.value)
}

const _isCount = query => query.SELECT.columns?.length === 1 && query.SELECT.columns[0].func === 'count'
const _entityKeys = entity =>
  Object_keys(entity.keys).filter(key => key !== 'IsActiveEntity' && !entity.keys[key].isAssociation)

const _inProcessByUserXpr = lockShiftedNow => ({
  xpr: [
    'case',
    'when',
    { ref: ['LastChangeDateTime'] },
    '<',
    { val: lockShiftedNow },
    'then',
    { val: '' },
    'else',
    { ref: ['InProcessByUser'] },
    'end'
  ],
  as: 'InProcessByUser',
  cast: { type: 'cds.String' }
})

const _lock = {
  get shiftedNow() {
    return new Date(Math.max(0, Date.now() - LOCK_TIMEOUT.value)).toISOString()
  }
}

const _redirectRefToDrafts = (ref, model) => {
  const [root, ...tail] = ref
  const target = model.definitions[root.id || root]
  const draft = target.drafts || target
  return [root.id ? { ...root, id: draft.name } : draft.name, ...tail]
}

const _redirectRefToActives = (ref, model) => {
  const [root, ...tail] = ref
  const target = model.definitions[root.id || root]
  const active = target.actives || target
  return [root.id ? { ...root, id: active.name } : active.name, ...tail]
}

const lastCheckMap = new Map()
const _cleanUpOldDrafts = (service, tenant) => {
  if (!DEL_TIMEOUT.value) return

  const expiryDate = new Date(Date.now() - DEL_TIMEOUT.value).toISOString()
  const interval = DEL_TIMEOUT.value / 2
  const lastCheck = lastCheckMap.get(tenant)

  if (lastCheck && Date.now() - lastCheck < Number(interval)) return

  cds.spawn({ tenant, user: cds.User.privileged }, async () => {
    const expiredDrafts = await SELECT.from('DRAFT.DraftAdministrativeData', ['DraftUUID']).where(
      `LastChangeDateTime <`,
      expiryDate
    )

    if (!expiredDrafts.length) return

    const expiredDraftsIds = expiredDrafts.map(el => el.DraftUUID)
    const promises = []

    const draftRoots = []

    for (const name in service.model.definitions) {
      const target = service.model.definitions[name]
      if (target.drafts && target['@Common.DraftRoot.ActivationAction']) {
        draftRoots.push(target.drafts)
      }
    }

    const draftRootIds = await Promise.all(
      draftRoots.map(draftRoot =>
        SELECT.from(draftRoot, _entityKeys(draftRoot)).where(`DraftAdministrativeData_DraftUUID IN`, expiredDraftsIds)
      )
    )

    for (let i = 0; i < draftRoots.length; i++) {
      const ids = draftRootIds[i]
      if (!ids.length) continue
      const srv = await cds.connect.to(draftRoots[i]._service.name).catch(() => {})
      if (!srv) continue // srv might not be loaded
      for (const idObj of ids) {
        promises.push(srv.send({ event: 'CANCEL', query: DELETE.from(draftRoots[i], idObj), data: idObj }))
      }
    }

    await Promise.allSettled(promises)
  })

  lastCheckMap.set(tenant, Date.now())
}

const _hasStreaming = (cols, target, deep) => {
  return cols?.some(col => {
    const name = col.as || col.ref?.at(-1)
    if (!target.elements[name]) return
    return (
      target.elements[name]._type === 'cds.LargeBinary' ||
      (deep && col.expand && _hasStreaming(col.expand, target.elements[name]._target, deep))
    )
  })
}

const _waitForReadable = readable => {
  return new Promise((resolve, reject) => {
    readable.once('readable', resolve)
    readable.once('error', reject)
  })
}

const _removeEmptyStreams = async result => {
  if (!result) return

  const res = Array.isArray(result) ? result : [result]
  for (let r of res) {
    for (let key in r) {
      const el = r[key]
      if (el instanceof Readable) {
        // In case hana-client Readable may not be ready
        if (cds.db?.constructor?.name === 'HANAService') await _waitForReadable(el)
        const chunk0 = el.read()
        if (chunk0 === null) delete r[key]
        else el.unshift(chunk0)
      } else if (typeof el === 'object') {
        const res = Array.isArray(el) ? el : [el]
        for (let r of res) {
          await _removeEmptyStreams(r)
        }
      }
    }
  }
}

// REVISIT: Can be replaced with SQL WHEN statement (see commented code in expandStarStar) in the new HANA db layer - doesn't work with old db layer
const _replaceStreams = result => {
  if (!result) return

  const res = Array.isArray(result) ? result : [result]
  for (let r of res) {
    for (let key in r) {
      const el = r[key]
      if (el instanceof Readable) {
        const stream = new Readable()
        stream.push(null)
        r[key] = stream
      } else if (typeof el === 'object') {
        const res = Array.isArray(el) ? el : [el]
        res.forEach(_replaceStreams)
      }
    }
  }
}

// REVISIT: Can we do a regular handler function instead of monky patching?
const h = cds.ApplicationService.prototype.handle

cds.ApplicationService.prototype.handle = async function (req) {
  if (req.event === 'DISCARD') req.event = 'CANCEL'
  else if (req.event === 'SAVE') {
    req.event = 'draftActivate'
    req.query ??= SELECT.from(req.target, req.data) //> support simple srv.send('SAVE',entity,...)
  }

  // Fast exit for non-draft requests
  // REVISIT: should also start with else, but then this test fails: cds/tests/_runtime/odata/__tests__/integration/draft-custom-handlers.test.js
  if (!req.query) return h.call(this, req)
  else if ($draftParams in req.query) return h.call(this, req)
  /* prettier-ignore */ else if (!(
    // Note: we skip UPSERTs as these might have an additional INSERT
    'SELECT' in req.query ||
    'INSERT' in req.query ||
    'UPDATE' in req.query ||
    'DELETE' in req.query
  )) return h.call(this, req)
  // TODO: also skip quickly if no draft-enabled entities are involved ?!?
  // TODO: also skip quickly if no isActiveEntity is part of the query ?!?
  // TODO: also skip quickly for CREATE request not from Fiori clients ???

  // rewrite event if necessary
  if (req.protocol && req.target.drafts && req.event in { CREATE: 1, DELETE: 1 }) {
    if (req.event === 'CREATE' && req.data.IsActiveEntity !== true) req.event = 'NEW'
    if (req.event === 'DELETE' && req.data.IsActiveEntity === false) req.event = 'CANCEL'
  }

  const query = _cleansed(req.query, this.model)
  _cleanseParams(req.params, req.target)
  if (req.data) _cleanseParams(req.data, req.target)
  const draftParams = query[$draftParams]

  const _newReq = (req, query, draftParams, { event, headers }) => {
    // REVISIT: This is a bit hacky -> better way?
    query._target = undefined
    query[$draftParams] = draftParams

    // REVISIT: This is extremely bad. We should be able to just create a copy without such hacks.
    const _req = cds.Request.for(req._) // REVISIT: this causes req._.data of WRITE reqs copied to READ reqs

    if (headers) {
      _req.headers = Object.create(req.headers)
      Object.assign(_req.headers, headers)
    }

    // If we create a `READ` event based on a modifying request, we delete data
    if (event === 'READ' && req.event !== 'READ') delete _req.data // which we fix here -> but this is an ugly workaround

    _req.target = cds.infer.target(query)
    _req.query = query
    _req.event =
      event ||
      (query.SELECT && 'READ') ||
      (query.INSERT && 'CREATE') ||
      (query.UPDATE && 'UPDATE') ||
      (query.DELETE && 'DELETE') ||
      req.event
    _req.params = req.params
    if (req.protocol) _req.protocol = req.protocol
    _req._ = req._
    if (!_req._.event) _req._.event = req.event
    const cqnData = _req.query.UPDATE?.data || _req.query.INSERT?.entries?.[0]
    if (cqnData) _req.data = cqnData // must point to the same object
    Object.defineProperty(_req, '_messages', {
      get: function () {
        return req._messages
      }
    })
    if (req.tx && !_req.tx) _req.tx = req.tx

    return _req
  }

  const run = (query, options = {}) => {
    const _req = _newReq(req, query, draftParams, options)
    return h.call(this, _req)
  }

  if (req.event === 'READ') {
    if (
      !Object.keys(draftParams).length &&
      !req.query._target.name?.endsWith('DraftAdministrativeData') &&
      !req.query._target.drafts
    ) {
      req.query = query
      return h.call(this, req)
    }

    // apply paging and sorting on original query for protocol adapters relying on it
    commonGenericPaging(req)
    commonGenericSorting(req)

    const read =
      draftParams.IsActiveEntity === false &&
      _hasStreaming(query.SELECT.columns, query._target) &&
      !cds.env.features.binary_draft_compat
        ? Read.draftStream
        : req.query._target.name.endsWith('.drafts')
          ? Read.ownDrafts
          : draftParams.IsActiveEntity === false && draftParams.SiblingEntity_IsActiveEntity === null
            ? Read.all
            : draftParams.IsActiveEntity === true &&
                draftParams.SiblingEntity_IsActiveEntity === null &&
                (draftParams.DraftAdministrativeData_InProcessByUser === 'not null' ||
                  draftParams.DraftAdministrativeData_InProcessByUser === 'not ')
              ? Read.lockedByAnotherUser
              : draftParams.IsActiveEntity === true &&
                  draftParams.SiblingEntity_IsActiveEntity === null &&
                  draftParams.DraftAdministrativeData_InProcessByUser === ''
                ? Read.unsavedChangesByAnotherUser
                : draftParams.IsActiveEntity === true && draftParams.HasDraftEntity === false
                  ? Read.unchanged
                  : draftParams.IsActiveEntity === true
                    ? Read.onlyActives
                    : draftParams.IsActiveEntity === false
                      ? Read.ownDrafts
                      : Read.onlyActives
    const result = await read(run, query)
    return result
  }

  if (req.event === 'draftEdit') req.event = 'EDIT'
  if (req.event === 'draftPrepare' && draftParams.IsActiveEntity) req.reject({ code: 400, statusCode: 400 })

  // Create active instance of draft-enabled entity
  // Careful: New OData adapter only sets `NEW` for drafts... how to distinguish programmatic modifications?
  if (
    (req.event === 'NEW' && req.data.IsActiveEntity === true) || // old OData adapter changes CREATE to NEW also for actives
    (req.event === 'CREATE' && req.target.drafts && req.data?.IsActiveEntity !== false && !req.target.isDraft)
  ) {
    if (req.protocol === 'odata' && !cds.env.fiori.bypass_draft && !req.target['@odata.draft.bypass'])
      return reject_bypassed_draft(req)
    const containsDraftRoot =
      this.model.definitions[query.INSERT.into?.ref?.[0]?.id || query.INSERT.into?.ref?.[0] || query.INSERT.into][
        '@Common.DraftRoot.ActivationAction'
      ]

    if (!containsDraftRoot) req.reject({ code: 403, statusCode: 403, message: 'DRAFT_MODIFICATION_ONLY_VIA_ROOT' })

    const isDirectAccess = typeof req.query.INSERT.into === 'string' || req.query.INSERT.into.ref?.length === 1
    const data = Object.assign({}, req.data) // IsActiveEntity is not enumerable
    const draftsRootRef =
      typeof query.INSERT.into === 'string'
        ? [req.target.drafts.name]
        : _redirectRefToDrafts([query.INSERT.into.ref[0]], this.model)
    let rootHasDraft

    // children: check root entity has no draft
    if (!isDirectAccess) {
      rootHasDraft = await SELECT.one([1]).from({ ref: draftsRootRef })
    }

    // direct access and req.data contains keys: check if root has no draft with that keys
    if (isDirectAccess && _entityKeys(query._target).every(k => k in data)) {
      const keyData = _entityKeys(query._target).reduce((res, k) => {
        res[k] = req.data[k]
        return res
      }, {})
      rootHasDraft = await SELECT.one([1]).from({ ref: draftsRootRef }).where(keyData)
    }

    if (rootHasDraft) req.reject({ code: 409, statusCode: 409, message: 'DRAFT_ALREADY_EXISTS' })

    const cqn = INSERT.into(query.INSERT.into).entries(data)
    await run(cqn, { event: 'CREATE' })
    const result = { ...data, IsActiveEntity: true }
    req.data = result //> make keys available via req.data (as with normal crud)
    return result
  }

  // It needs to be redirected to drafts
  if (req.event === 'NEW' || req.event === 'CANCEL' || req.event === 'draftPrepare') {
    if (!req.target.isDraft) req.target = req.target.drafts // COMPAT: also support these events for actives

    if (query.INSERT) {
      if (typeof query.INSERT.into === 'string') query.INSERT.into = req.target.name
      else if (query.INSERT.into.ref) query.INSERT.into.ref = _redirectRefToDrafts(query.INSERT.into.ref, this.model)
    } else if (query.DELETE) {
      query.DELETE.from.ref = _redirectRefToDrafts(query.DELETE.from.ref, this.model)
    } else if (query.SELECT) {
      query.SELECT.from.ref = _redirectRefToDrafts(query.SELECT.from.ref, this.model)
    }

    const _req = _newReq(req, query, draftParams, { event: req.event })

    // Do not allow to create active instances via drafts
    if (
      (req.event === 'NEW' || req.event === 'CREATE') &&
      draftParams.IsActiveEntity === false &&
      !_req.target.isDraft
    ) {
      req.reject({ code: 403, statusCode: 403, message: 'ACTIVE_MODIFICATION_VIA_DRAFT' })
    }

    const result = await h.call(this, _req)
    req.data = result //> make keys available via req.data (as with normal crud)
    return result
  }

  // Delete active instance of draft-enabled entity
  if (req.target.drafts && !req.target.isDraft && req.event === 'DELETE' && draftParams.IsActiveEntity !== false) {
    const draftsRef = _redirectRefToDrafts(query.DELETE.from.ref, this.model)
    const draftQuery = SELECT.one.from({ ref: draftsRef }).columns([
      { ref: ['DraftAdministrativeData_DraftUUID'] },
      {
        ref: ['DraftAdministrativeData'],
        expand: [_inProcessByUserXpr(_lock.shiftedNow)]
      }
    ])
    if (query.DELETE.where) draftQuery.where(query.DELETE.where)

    // Deletion of active instance outside draft tree, no need to check for draft
    const target = cds.infer.target(draftQuery) // FIXME: this should not be neccessary, does it?
    if (!target?.isDraft) {
      await run(query)
      return req.data
    }

    // Deletion of active instance inside draft tree, need to check that no draft exists
    const draft = await draftQuery
    const inProcessByUser = draft?.DraftAdministrativeData?.InProcessByUser
    if (!cds.context.user._is_privileged && inProcessByUser && inProcessByUser !== cds.context.user.id)
      req.reject({ code: 403, statusCode: 403, message: 'DRAFT_LOCKED_BY_ANOTHER_USER', args: [inProcessByUser] })
    if (draft) req.reject({ code: 403, statusCode: 403, message: 'DRAFT_ACTIVE_DELETE_FORBIDDEN_DRAFT_EXISTS' })
    await run(query)
    return req.data
  }

  if (req.event === 'draftActivate') {
    LOG.debug('activate draft')

    // It would be great if we'd have a SELECT ** to deeply expand the entity (along compositions), that should
    // be implemented in expand implementation.
    if (req.query.SELECT.from.ref.length > 1 || draftParams.IsActiveEntity === true) {
      req.reject({
        code: 400,
        statusCode: 400,
        message: 'Action "draftActivate" can only be called on the root draft entity'
      })
    }

    if (req.target._etag && !req.headers['if-match'] && !req.headers['if-none-match']) {
      req.reject({ code: 428, statusCode: 428 })
    }

    const cols = expandStarStar(req.target.drafts, true)

    // Use `run` (since also etags might need to be checked)
    // REVISIT: Find a better approach (`etag` as part of CQN?)
    const draftRef = _redirectRefToDrafts(query.SELECT.from.ref, this.model)
    const draftQuery = SELECT.one
      .from({ ref: draftRef })
      .columns(cols)
      .columns([
        'HasActiveEntity',
        'DraftAdministrativeData_DraftUUID',
        { ref: ['DraftAdministrativeData'], expand: [{ ref: ['InProcessByUser'] }] }
      ])
      .where(query.SELECT.where)
    const res = await run(draftQuery)
    if (!res) {
      const _etagValidationType = req.headers['if-match']
        ? 'if-match'
        : req.headers['if-none-match']
          ? 'if-none-match'
          : undefined
      req.reject(_etagValidationType ? { code: 412, statusCode: 412 } : { code: 'DRAFT_NOT_EXISTING', statusCode: 404 })
    }
    if (!cds.context.user._is_privileged && res.DraftAdministrativeData?.InProcessByUser !== cds.context.user.id) {
      req.reject({
        code: 403,
        statusCode: 403,
        message: 'DRAFT_LOCKED_BY_ANOTHER_USER',
        args: [res.DraftAdministrativeData?.InProcessByUser]
      })
    }

    const DraftAdministrativeData_DraftUUID = res.DraftAdministrativeData_DraftUUID
    delete res.DraftAdministrativeData_DraftUUID
    delete res.DraftAdministrativeData
    const HasActiveEntity = res.HasActiveEntity
    delete res.HasActiveEntity

    if (_hasStreaming(draftQuery.SELECT.columns, draftQuery._target, true) && !cds.env.features.binary_draft_compat)
      await _removeEmptyStreams(res)

    // First run the handlers as they might need access to DraftAdministrativeData or the draft entities
    const activesRef = _redirectRefToActives(query.SELECT.from.ref, this.model)
    const result = await run(
      HasActiveEntity
        ? UPDATE({ ref: activesRef }).data(res).where(query.SELECT.where)
        : INSERT.into({ ref: activesRef }).entries(res),
      { headers: Object.assign({}, req.headers, { 'if-match': '*' }) }
    )
    await _promiseAll([
      DELETE.from({ ref: draftRef }).where(query.SELECT.where),
      DELETE.from('DRAFT.DraftAdministrativeData').where({ DraftUUID: DraftAdministrativeData_DraftUUID })
    ])

    if (req.res) {
      // status code must be set in handler to allow overriding for FE V2
      // REVISIT: needs reworking for new adapter, especially re $batch
      if (!HasActiveEntity) req.res.status(201)

      const read_result = await _readAfterDraftAction.bind(this)({
        req,
        payload: res,
        action: 'draftActivate'
      })
      req.res.set('location', '../' + location4(req.target, this, read_result || { ...res, IsActiveEntity: true }))

      if (read_result == null) req.res.status(204)

      return read_result
    }

    return Object.assign(result, { IsActiveEntity: true })
  }

  if (req.target.actions?.[req.event] && draftParams.IsActiveEntity === false) {
    if (query.SELECT?.from?.ref) query.SELECT.from.ref = _redirectRefToDrafts(query.SELECT.from.ref, this.model)
    const rootQuery = query.clone()
    rootQuery.SELECT.columns = [{ ref: ['DraftAdministrativeData'], expand: [{ ref: ['InProcessByUser'] }] }]
    rootQuery.SELECT.one = true
    rootQuery.SELECT.from = { ref: [query.SELECT.from.ref[0]] }
    const root = await cds.run(rootQuery)
    if (!root) req.reject({ code: 404, statusCode: 404 })
    if (root.DraftAdministrativeData?.InProcessByUser !== cds.context.user.id) {
      req.reject({ code: 403, statusCode: 403 })
    }
    const _req = _newReq(req, query, draftParams, { event: req.event })
    const result = await h.call(this, _req)
    return result
  }

  if (req.event === 'PATCH' || (req.event === 'UPDATE' && req.target.drafts)) {
    // also delete `IsActiveEntity` for references
    const _rmIsActiveEntity = (data, target) => {
      delete data.IsActiveEntity
      for (const assoc in target.associations) {
        const val = data[assoc]
        if (val && typeof val === 'object') {
          const _target = req.target.associations[assoc]._target
          if (Array.isArray(val)) {
            val.forEach(v => _rmIsActiveEntity(v, _target))
          } else {
            _rmIsActiveEntity(val, _target)
          }
        }
      }
    }
    _rmIsActiveEntity(req.data, req.target)
    if (draftParams.IsActiveEntity === false) {
      LOG.debug('patch draft')

      if (req.target?.name.endsWith('DraftAdministrativeData')) req.reject({ code: 405, statusCode: 405 })
      const draftsRef = _redirectRefToDrafts(query.UPDATE.entity.ref, this.model)
      const res = await SELECT.one.from({ ref: draftsRef }).columns('DraftAdministrativeData_DraftUUID', {
        ref: ['DraftAdministrativeData'],
        expand: [{ ref: ['InProcessByUser'] }]
      })
      if (!res) req.reject({ code: 404, statusCode: 404 })
      if (!cds.context.user._is_privileged && res.DraftAdministrativeData?.InProcessByUser !== cds.context.user.id) {
        req.reject({
          code: 403,
          statusCode: 403,
          message: 'DRAFT_LOCKED_BY_ANOTHER_USER',
          args: [res.DraftAdministrativeData?.InProcessByUser]
        })
      }
      await UPDATE('DRAFT.DraftAdministrativeData')
        .data({
          InProcessByUser: req.user.id,
          LastChangedByUser: req.user.id,
          LastChangeDateTime: new Date()
        })
        .where({ DraftUUID: res.DraftAdministrativeData_DraftUUID })

      await run(UPDATE({ ref: draftsRef }).data(req.data))
      req.data.IsActiveEntity = false
      return req.data
    }

    LOG.debug('patch active')

    if (req.protocol === 'odata' && !cds.env.fiori.bypass_draft && !req.target['@odata.draft.bypass'])
      return reject_bypassed_draft(req)

    const entityRef = query.UPDATE.entity.ref

    if (!this.model.definitions[entityRef[0].id || entityRef[0]]['@Common.DraftRoot.ActivationAction']) {
      req.reject({ code: 403, statusCode: 403, message: 'DRAFT_MODIFICATION_ONLY_VIA_ROOT' })
    }

    const draftsRef = _redirectRefToDrafts(entityRef, this.model)
    const draftsQuery = SELECT.one([1]).from({ ref: [draftsRef[0]] })
    if (query.UPDATE.where) draftsQuery.where(query.UPDATE.where)
    const hasDraft = !!(await draftsQuery)
    if (hasDraft) req.reject({ code: 409, statusCode: 409, message: 'DRAFT_ALREADY_EXISTS' })

    await run(query)
    return req.data
  }

  if (req.event === 'CREATE' && draftParams.IsActiveEntity === false && !req.target.isDraft) {
    req.reject({ code: 403, statusCode: 403, message: 'ACTIVE_MODIFICATION_VIA_DRAFT' })
  }

  req.query = query

  return h.call(this, req)
}

// REVISIT: It's not optimal to first calculate the whole result array and only later
//          delete unrequested properties. However, as a first step, we do it that way,
//          especially since the current db driver always adds those fields.
//          Once we switch to the new driver, we'll adapt it.
const _requested = (result, query) => {
  const originalQuery = query[$original]
  if (!result || !originalQuery) return result
  const all = ['HasActiveEntity', 'HasDraftEntity']

  const ignoredCols = new Set(all.concat('DraftAdministrativeData'))
  const _isODataV2 = cds.context?.http?.req?.headers?.['x-cds-odata-version'] === 'v2'
  if (!_isODataV2) ignoredCols.add('DraftAdministrativeData_DraftUUID')
  for (const col of originalQuery.SELECT.columns || ['*']) {
    const name = col.as || col.ref?.[0] || col
    if (all.includes(name) || name === 'DraftAdministrativeData' || name === 'DraftAdministrativeData_DraftUUID')
      ignoredCols.delete(name)
    if (name === '*') all.forEach(c => ignoredCols.delete(c))
  }
  if (!ignoredCols.size) return result
  const resArray = Array.isArray(result) ? result : [result]
  for (const row of resArray) {
    for (const ignoredCol of ignoredCols) delete row[ignoredCol]
  }
  return result
}

const _readDraftStream = (draftStream, activeCQN, property) =>
  Readable.from(
    (async function* () {
      let isActive = true
      this._stream = draftStream
      for await (const chunk of draftStream) {
        isActive = false
        yield chunk
      }

      if (isActive) {
        const active = (await activeCQN)?.[property]
        if (active) {
          for await (const chunk of active) {
            yield chunk
          }
        }
      }
    })()
  )

// REVISIT: HanaLobStream of @sap/hana-client cannot read chunks with "for await" - hangs
const _readDraftStreamHanaClient = async (draftStream, activeCQN, property) =>
  Readable.from(
    (async function* () {
      let isActive = true
      const pth = new PassThrough()
      draftStream.pipe(pth)
      for await (const chunk of pth) {
        isActive = false
        yield chunk
      }

      if (isActive) {
        const active = (await activeCQN)?.[property]
        if (active) {
          const pth = new PassThrough()
          active.pipe(pth)
          for await (const chunk of pth) {
            yield chunk
          }
        }
      }
    })()
  )

const Read = {
  onlyActives: async function (run, query, { ignoreDrafts } = {}) {
    LOG.debug('List Editing Status: Only Active')

    // DraftAdministrativeData is only accessible via drafts
    if (_isCount(query)) return run(query)
    if (query._target.name.endsWith('.DraftAdministrativeData')) {
      if (query.SELECT.from.ref?.length === 1) throw cds.error('INVALID_DRAFT_REQUEST', { statusCode: 400 }) // only via drafts
      return run(query._drafts)
    }
    if (!query._target._isDraftEnabled) return run(query)
    if (
      !query.SELECT.groupBy &&
      query.SELECT.columns &&
      !query.SELECT.columns.some(c => c === '*') &&
      !query.SELECT.columns.some(c => c.func && AGGREGATION_FUNCTIONS.includes(c.func))
    ) {
      const keys = _entityKeys(query._target)
      for (const key of keys) {
        if (!query.SELECT.columns.some(c => c.ref?.[0] === key)) query.SELECT.columns.push({ ref: [key] })
      }
    }
    const actives = await run(query)
    if (!actives || (Array.isArray(actives) && !actives.length) || !query._target.drafts) return actives
    let drafts
    if (ignoreDrafts) drafts = []
    else {
      try {
        drafts = await Read.complementaryDrafts(query, actives)
      } catch {
        drafts = []
      }
    }
    Read.merge(query._target, actives, drafts, (row, other) => {
      if (other) {
        if ('DraftAdministrativeData' in other) row.DraftAdministrativeData = other.DraftAdministrativeData
        if ('DraftAdministrativeData_DraftUUID' in other)
          row.DraftAdministrativeData_DraftUUID = other.DraftAdministrativeData_DraftUUID
        Object.assign(row, { HasActiveEntity: false, HasDraftEntity: true })
      } else
        Object.assign(row, {
          HasActiveEntity: false,
          HasDraftEntity: false,
          DraftAdministrativeData: null,
          DraftAdministrativeData_DraftUUID: null
        })
      _fillIsActiveEntity(row, true, query._target)
    })
    return _requested(actives, query)
  },

  unchanged: async function (run, query) {
    LOG.debug('List Editing Status: Unchanged')

    const draftsQuery = query._drafts
    if (!draftsQuery) throw cds.error('INVALID_DRAFT_REQUEST', { statusCode: 400 }) // only via drafts
    draftsQuery.SELECT.count = undefined
    draftsQuery.SELECT.orderBy = undefined
    draftsQuery.SELECT.limit = null
    draftsQuery.SELECT.columns = _entityKeys(query._target).map(k => ({ ref: [k] }))

    const drafts = await draftsQuery.where({ HasActiveEntity: true })
    const res = await Read.onlyActives(run, query.where(Read.whereNotIn(query._target, drafts)), {
      ignoreDrafts: true
    })
    return _requested(res, query)
  },

  ownDrafts: async function (run, query) {
    LOG.debug('List Editing Status: Own Draft')

    if (!query._drafts) throw cds.error('INVALID_DRAFT_REQUEST', { statusCode: 400 }) // only via drafts

    // read active from draft
    if (!query._drafts._target?.name.endsWith('.drafts')) {
      const result = await run(query._drafts)

      // active entity is draft enabled, draft columns have to be removed
      if (query._drafts._target?.drafts) {
        Read.merge(query._drafts._target, result, [], row => {
          delete row.IsActiveEntity
          delete row.HasDraftEntity
          delete row.HasActiveEntity
          delete row.DraftAdministrativeData_DraftUUID
        })
      }
      return result
    }
    const draftsQuery = query._drafts.where(
      { ref: ['DraftAdministrativeData', 'InProcessByUser'] },
      '=',
      cds.context.user.id
    )

    const drafts = await run(draftsQuery)
    Read.merge(query._target, drafts, [], row => {
      Object.assign(row, {
        HasDraftEntity: false
      })
      _fillIsActiveEntity(row, false, query._drafts._target)
    })
    return _requested(drafts, query)
  },

  all: async function (run, query) {
    LOG.debug('List Editing Status: All')

    if (!query._drafts) return []

    query._drafts.SELECT.count = false
    query._drafts.SELECT.limit = null // we need all entries for the keys to properly select actives (count)
    const isCount = _isCount(query._drafts)
    if (isCount) {
      query._drafts.SELECT.columns = _entityKeys(query._target).map(k => ({ ref: [k] }))
    }
    if (!query._drafts.SELECT.columns) query._drafts.SELECT.columns = ['*']
    if (!query._drafts.SELECT.columns.some(c => c.ref?.[0] === 'HasActiveEntity')) {
      query._drafts.SELECT.columns.push({ ref: ['HasActiveEntity'] })
    }

    const orderByExpr = query.SELECT.orderBy
    const getOrderByColumns = columns => {
      const selectAll = columns === undefined || columns.includes('*')
      const queryColumns = !selectAll && columns && columns.map(column => column.as || column?.ref?.[0]).filter(c => c)
      const newColumns = []

      for (const column of orderByExpr) {
        if (selectAll || !queryColumns.includes(column.ref.join('_'))) {
          if (column.ref.length === 1 && selectAll) continue
          const columnClone = { ...column }
          delete columnClone.sort
          columnClone.as = columnClone.ref.join('_')
          newColumns.push(columnClone)
        }
      }

      return newColumns
    }

    let orderByDraftColumns
    if (orderByExpr) {
      orderByDraftColumns = getOrderByColumns(query._drafts.SELECT.columns)
      if (orderByDraftColumns.length) query._drafts.SELECT.columns.push(...orderByDraftColumns)
    }

    const ownDrafts = await run(
      query._drafts.where({ ref: ['DraftAdministrativeData', 'InProcessByUser'] }, '=', cds.context.user.id)
    )
    const draftLength = ownDrafts.length
    const limit = query.SELECT.limit?.rows?.val ?? getPageSize(query._target).max
    const offset = query.SELECT.limit?.offset?.val ?? 0
    query.SELECT.limit = {
      rows: { val: limit + draftLength }, // virtual limit
      offset: { val: Math.max(0, offset - draftLength) } // virtual offset
    }

    let orderByColumns
    if (orderByExpr) {
      orderByColumns = getOrderByColumns(query.SELECT.columns)
      if (orderByColumns.length) {
        query.SELECT.columns = query.SELECT.columns ?? ['*']
        query.SELECT.columns.push(...orderByColumns)
      }
    }

    const queryElements = query.elements
    const actives = await run(query.where(Read.whereNotIn(query._target, ownDrafts)))
    const removeColumns = (columns, toRemoveCols) => {
      if (!toRemoveCols) return
      for (const c of toRemoveCols) columns.forEach((column, index) => c.as === column.as && columns.splice(index, 1))
    }
    removeColumns(query._drafts.SELECT.columns, orderByDraftColumns)
    removeColumns(query.SELECT.columns, orderByColumns)

    const ownNewDrafts = []
    const ownEditDrafts = []
    for (const draft of ownDrafts) {
      if (draft.HasActiveEntity) ownEditDrafts.push(draft)
      else ownNewDrafts.push(draft)
    }

    const $count = ownDrafts.length + (isCount ? actives[0]?.$count : (actives.$count ?? 0))
    if (isCount) return { $count }

    Read.merge(query._target, ownDrafts, [], row => {
      Object.assign(row, { HasDraftEntity: false })
      _fillIsActiveEntity(row, false, query._drafts._target)
    })
    const otherEditDrafts = await Read.complementaryDrafts(query, actives)
    Read.merge(query._target, actives, otherEditDrafts, (row, other) => {
      if (other) {
        Object.assign(row, {
          HasDraftEntity: true,
          HasActiveEntity: false,
          DraftAdministrativeData_DraftUUID: other.DraftAdministrativeData_DraftUUID,
          DraftAdministrativeData: other.DraftAdministrativeData
        })
      } else {
        Object.assign(row, {
          HasDraftEntity: false,
          HasActiveEntity: false,
          DraftAdministrativeData_DraftUUID: null,
          DraftAdministrativeData: null
        })
      }
      _fillIsActiveEntity(row, true, query._target)
    })
    const resultSet =
      actives.length > 0 && ownDrafts.length === 0
        ? actives
        : ownDrafts.length > 0 && actives.length === 0
          ? ownDrafts
          : [...ownDrafts, ...actives]

    // runtime sort required
    if (orderByExpr && ownDrafts.length > 0 && actives.length > 0) {
      const locale = cds.context.locale?.replaceAll('_', '-')
      const collatorMap = new Map()
      const elementNamesToSort = orderByExpr.map(orderByExp => orderByExp.ref.join('_'))

      for (const elementName of elementNamesToSort) {
        const element = queryElements[elementName] ?? query._target.elements[elementName] // The latter is needed for CDS orderBy statements
        if (!element) continue

        let collatorOptions

        switch (element.type) {
          case 'cds.Integer':
          case 'cds.UInt8':
          case 'cds.Int16':
          case 'cds.Int32':
          case 'cds.Integer64':
          case 'cds.Int64':
          case 'cds.Decimal':
          case 'cds.DecimalFloat':
          case 'cds.Double':
            collatorOptions = numericCollator
            break

          default:
            collatorOptions = emptyObject
        }

        const collator = Intl.Collator(locale, collatorOptions)
        collatorMap.set(elementName, collator)
      }

      const getSortFn =
        (index = 0) =>
        (entityA, entityB) => {
          const orderBy = orderByExpr[index]
          const elementName = elementNamesToSort[index]
          const collator = collatorMap.get(elementName)
          const diff = collator.compare(entityA[elementName], entityB[elementName])

          if (diff === 0 && index + 1 < orderByExpr.length) return getSortFn(index + 1)(entityA, entityB)
          if (orderBy.sort === 'desc') return diff * -1
          return diff
        }

      resultSet.sort(getSortFn())
    }

    let virtualOffset = offset - draftLength
    virtualOffset = virtualOffset > 0 ? draftLength : draftLength + virtualOffset
    const pageResultSet = _filterResultSet(resultSet, limit, virtualOffset)
    if (query.SELECT.count) pageResultSet.$count = ownDrafts.$count ?? 0 + $count
    return _requested(pageResultSet, query)
  },

  activesFromDrafts: async function (run, query, { isLocked = true }) {
    const draftsQuery = query._drafts
    if (!draftsQuery) throw cds.error('INVALID_DRAFT_REQUEST', { statusCode: 400 }) // only via drafts

    const additionalCols = draftsQuery.SELECT.columns
      ? draftsQuery.SELECT.columns.filter(
          c => c.ref && ['DraftAdministrativeData', 'DraftAdministrativeData_DraftUUID'].includes(c.ref[0])
        )
      : [{ ref: ['DraftAdministrativeData_DraftUUID'] }]
    draftsQuery.SELECT.columns = _entityKeys(query._target)
      .map(k => ({ ref: [k] }))
      .concat(additionalCols)
    draftsQuery.where({
      HasActiveEntity: true,
      'DraftAdministrativeData.InProcessByUser': { '!=': cds.context.user.id },
      'DraftAdministrativeData.LastChangeDateTime': {
        [isLocked ? '>' : '<']: _lock.shiftedNow
      }
    })
    const drafts = await draftsQuery
    const actives = drafts.length
      ? await run(query.where(Read.whereIn(query._target, drafts)))
      : Object.assign([], { $count: 0 })
    Read.merge(query._target, actives, drafts, (row, other) => {
      if (other) Object.assign(row, other, { HasDraftEntity: true, HasActiveEntity: false })
      else Object.assign({ HasDraftEntity: false, HasActiveEntity: false })
      _fillIsActiveEntity(row, true, query._target)
    })
    return _requested(actives, query)
  },

  unsavedChangesByAnotherUser: async function (run, query) {
    LOG.debug('List Editing Status: Unsaved Changes by Another User')

    return Read.activesFromDrafts(run, query, { isLocked: false })
  },

  lockedByAnotherUser: async function (run, query) {
    LOG.debug('List Editing Status: Locked by Another User')

    return Read.activesFromDrafts(run, query, { isLocked: true })
  },

  whereNotIn: (target, data) => Read.whereIn(target, data, true),

  whereIn: (target, data, not = false) => {
    const keys = _entityKeys(target)
    const dataArray = data ? (Array.isArray(data) ? data : [data]) : []
    if (not && !dataArray.length) return []
    if (keys.length === 1) {
      // For single keys, make it nicer (without unnecessary lists)
      const key = keys[0]
      const left = { ref: [key] }
      const op = not ? ['not', 'in'] : ['in']
      const right = { list: dataArray.map(r => ({ val: r[key] })) }
      return [left, ...op, right]
    } else {
      const left = { list: keys.map(k => ({ ref: [k] })) }
      const op = not ? ['not', 'in'] : ['in']
      const right = { list: dataArray.map(r => ({ list: keys.map(k => ({ val: r[k] })) })) }
      return [left, ...op, right]
    }
  },

  complementaryDrafts: (query, _actives) => {
    const actives = Array.isArray(_actives) ? _actives : [_actives]
    if (!actives.length) return []
    const drafts = cds.ql.clone(query._drafts)
    drafts.SELECT.where = Read.whereIn(query._target, actives)
    const newColumns = _entityKeys(query._target).map(k => ({ ref: [k] }))
    if (
      !drafts.SELECT.columns ||
      drafts.SELECT.columns.some(c => c === '*' || c.ref?.[0] === 'DraftAdministrativeData_DraftUUID')
    )
      newColumns.push({ ref: ['DraftAdministrativeData_DraftUUID'] })
    const draftAdmin = drafts.SELECT.columns?.find(c => c.ref?.[0] === 'DraftAdministrativeData')
    if (draftAdmin) newColumns.push(draftAdmin)
    drafts.SELECT.columns = newColumns
    drafts.SELECT.count = undefined
    drafts.SELECT.search = undefined
    drafts.SELECT.one = undefined
    drafts.SELECT.recurse = undefined
    return drafts
  },

  draftStream: async (run, query) => {
    // read from draft
    const result = await Read.ownDrafts(run, query)
    if (!Array.isArray(result)) {
      for (let key in result) {
        if (result[key] instanceof Readable) {
          result[key] =
            result[key].constructor.name === 'HanaLobStream'
              ? await _readDraftStreamHanaClient(result[key], query, key)
              : _readDraftStream(result[key], query, key)
        }
      }
    }

    return result
  },

  _makeArray: data => (Array.isArray(data) ? data : data ? [data] : []),

  _index: (target, data) => {
    // Indexes the data for fast key access
    const dataArray = Read._makeArray(data)
    if (!dataArray.length) return
    const hash = row =>
      _entityKeys(target)
        .map(k => row[k])
        .reduce((res, curr) => res + '|$|' + curr, '')
    const hashMap = new Map()
    for (const row of dataArray) hashMap.set(hash(row), row)
    return { hashMap, hash }
  },

  // Calls `cb` for each entry of data with a potential counterpart in otherData
  merge: (target, data, otherData, cb) => {
    const dataArray = Read._makeArray(data)
    if (!dataArray.length) return

    const index = Read._index(target, otherData)
    for (const row of dataArray) {
      const other = index?.hashMap.get(index.hash(row))
      cb(row, other)
    }
  },

  // Deletes entries of data with a counterpart in otherData
  delete: (target, data, otherData) => {
    if (!Array.isArray(data) || !data.length) return

    const index = Read._index(target, otherData)
    let i = data.length
    while (i--) {
      if (index?.hashMap.get(index.hash(data[i]))) data.splice(i, 1)
    }
  }
}

function _cleanseParams(params, target) {
  if (!target?.drafts) return
  if (Array.isArray(params)) {
    for (const param of params) _cleanseParams(param, target)
    return
  }
  if (typeof params === 'object') {
    for (const key in params) {
      if (key === 'IsActiveEntity') {
        const value = params[key]
        delete params[key]
        Object.defineProperty(params, key, { value, enumerable: false, writeable: true, configurable: true })
      }
    }
  }
}

function _cleanseCols(columns, elements, target) {
  // TODO: sometimes target is undefined
  if (!target || typeof columns?.filter !== 'function') return columns
  const filtered = target?.drafts ? columns.filter(c => !elements.has(c.ref?.[0])) : columns
  return filtered.map(c => {
    if (c.expand && c.ref) {
      return { ...c, expand: _cleanseCols(c.expand, elements, target.elements[c.ref[0]]?._target) }
    }
    return c
  })
}

/**
 * Creates a clone of the query, cleanses and collects all draft parameters into DRAFT_PARAMS.
 */
function _cleansed(query, model) {
  const draftParams = {} //> used to collect draft filter criteria
  const q = _cleanseQuery(query, draftParams, model)
  if (query.SELECT) {
    const getDrafts = () => {
      // could just clone `query` but the latter is ruined by database layer
      const draftsQuery = _cleanseQuery(query, {}, model)

      // set the target to null to ensure cds.infer(...) correctly infer the
      // target after query modifications
      draftsQuery._target = null
      let draftSelect = draftsQuery.SELECT
      let querySelect = query.SELECT

      // in the $apply scenario, only the most inner nested SELECT data structure must be cleansed
      while (draftSelect.from.SELECT) {
        draftSelect = draftSelect.from.SELECT
        querySelect = querySelect.from.SELECT
      }

      if (!draftSelect.from.ref) return // invalid draft request

      const [root, ...tail] = draftSelect.from.ref
      const draft = model.definitions[root.id || root].drafts
      if (!draft) return
      draftSelect.from = {
        ref: [root.id ? { ...root, id: draft.name } : draft.name, ...tail]
      }
      cds.infer.target(draftsQuery)

      // draftsQuery._target = draftsQuery._target?.drafts || draftsQuery._target
      if (querySelect.columns && query._target.drafts) {
        if (draftsQuery._target.isDraft)
          draftSelect.columns = _cleanseCols(querySelect.columns, REDUCED_DRAFT_ELEMENTS, draft)
        else draftSelect.columns = _cleanseCols(querySelect.columns, DRAFT_ELEMENTS, draft)
      }

      if (querySelect.where && query._target.drafts) {
        if (draftsQuery._target.isDraft)
          draftSelect.where = _cleanseWhere(querySelect.where, {}, DRAFT_ELEMENTS_WITHOUT_HASACTIVE)
        else draftSelect.where = _cleanseWhere(querySelect.where, {}, DRAFT_ELEMENTS)
      }

      if (querySelect.orderBy && query._target.drafts) {
        if (draftsQuery._target.isDraft)
          draftSelect.orderBy = _cleanseWhere(querySelect.orderBy, {}, REDUCED_DRAFT_ELEMENTS)
        else draftSelect.orderBy = _cleanseWhere(querySelect.orderBy, {}, DRAFT_ELEMENTS)
      }

      if (draftsQuery._target.name.endsWith('.DraftAdministrativeData')) {
        draftSelect.columns = _tweakAdminCols(draftSelect.columns)
      } else if (draftsQuery._target?.name.endsWith('.drafts')) {
        draftSelect.columns = _tweakAdminExpand(draftSelect.columns)
      }

      draftsQuery[$draftParams] = draftParams
      Object.defineProperty(q, '_drafts', { value: draftsQuery })
      return draftsQuery
    }

    Object.defineProperty(q, '_drafts', {
      configurable: true,
      get() {
        return getDrafts()
      }
    })
  }

  q[$draftParams] = draftParams
  q[$original] = query
  return q

  function _cleanseQuery(query, draftParams, model) {
    const target = query._target
    const q = cds.ql.clone(query)

    if (q.SELECT?.from.SELECT) q.SELECT.from = _cleanseQuery(q.SELECT?.from, draftParams, model)
    const ref =
      q.SELECT?.from.SELECT?.from.ref ||
      q.SELECT?.from.ref ||
      q.UPDATE?.entity.ref ||
      q.INSERT?.into.ref ||
      q.DELETE?.from.ref
    const cqn = q.SELECT || q.UPDATE || q.INSERT || q.DELETE

    if (ref) {
      let entity
      const cleansedRef = ref.map(r => {
        entity = (entity && entity.elements[r.id || r]._target) || model.definitions[r.id || r]
        if (!entity?.drafts) return r
        return r.where ? { ...r, where: _cleanseWhere(r.where, draftParams, DRAFT_ELEMENTS) } : r
      })
      if (q.SELECT) q.SELECT.from = q.SELECT.from.SELECT ? q.SELECT.from : { ...q.SELECT.from, ref: cleansedRef }
      else if (q.DELETE) q.DELETE.from = { ...q.DELETE.from, ref: cleansedRef }
      else if (q.UPDATE) q.UPDATE.entity = { ...q.UPDATE.entity, ref: cleansedRef }
      else if (q.INSERT) q.INSERT.into = { ...q.INSERT.into, ref: cleansedRef }

      // This only works for simple cases of `SiblingEntity`, e.g. `root(ID=1,IsActiveEntity=false)/SiblingEntity`
      // , check if there are more complicated use cases
      const siblingIdx = cleansedRef.findIndex(r => r === 'SiblingEntity')
      if (siblingIdx !== -1) {
        cleansedRef.splice(siblingIdx, 1)
        draftParams.IsActiveEntity = !draftParams.IsActiveEntity
      }
    }

    if (target.drafts && cqn.where) cqn.where = _cleanseWhere(cqn.where, draftParams, DRAFT_ELEMENTS)
    if (target.drafts && cqn.orderBy) cqn.orderBy = _cleanseCols(cqn.orderBy, DRAFT_ELEMENTS, target) // allowed to reuse
    if (cqn.columns) cqn.columns = _cleanseCols(cqn.columns, DRAFT_ELEMENTS, target)
    return q
  }

  function _tweakAdminExpand(columns) {
    if (!columns) return columns
    return columns.map(col => {
      if (col.ref?.[0] === 'DraftAdministrativeData') {
        return { ...col, expand: _tweakAdminCols(col.expand) }
      }
      return col
    })
  }

  function _tweakAdminCols(columns) {
    if (!columns || columns.some(c => c === '*')) columns = DRAFT_ADMIN_ELEMENTS.map(k => ({ ref: [k] }))
    return columns.map(col => {
      const name = col.ref?.[0]
      if (!name) return col
      switch (name) {
        case 'DraftAdministrativeData':
          return { ...col, expand: _tweakAdminCols(col.expand) }
        case 'DraftIsCreatedByMe':
          return {
            xpr: [
              'case',
              'when',
              { ref: ['CreatedByUser'] },
              '=',
              { val: cds.context.user.id },
              'then',
              'true',
              'else',
              'false',
              'end'
            ],
            as: 'DraftIsCreatedByMe',
            cast: { type: 'cds.Boolean' }
          }
        case 'InProcessByUser':
          return _inProcessByUserXpr(_lock.shiftedNow)
        case 'DraftIsProcessedByMe':
          return {
            xpr: [
              'case',
              'when',
              { ref: ['InProcessByUser'] },
              '=',
              { val: cds.context.user.id },
              'and',
              { ref: ['LastChangeDateTime'] },
              '>',
              { val: _lock.shiftedNow },
              'then',
              'true',
              'else',
              'false',
              'end'
            ],
            as: 'DraftIsProcessedByMe',
            cast: { type: 'cds.Boolean' }
          }
        default:
          return col
      }
    })
  }

  function _cleanseWhere(xpr, draftParams, ignoredElements) {
    const cleansed = []
    for (let i = 0; i < xpr.length; ++i) {
      let x = xpr[i]
      const e = x.ref?.[0]
      if (ignoredElements.has(e) && !xpr[i + 2]) {
        continue
      }
      if (ignoredElements.has(e) && xpr[i + 2]) {
        let { val } = xpr[i + 2]
        const param = x.ref.join('_')
        // outer-most parameters win
        if (draftParams[param] === undefined)
          draftParams[param] = xpr[i + 1] === '!=' ? (typeof val === 'boolean' ? !val : 'not ' + val) : val
        i += 2
        const last = cleansed[cleansed.length - 1]
        if (last === 'and' || last === 'or') cleansed.pop()
        continue
      }
      if (x.xpr) {
        x = { xpr: _cleanseWhere(x.xpr, draftParams, ignoredElements) }
        if (!x.xpr) {
          i += 1
          continue
        }
      }
      cleansed.push(x)
    }
    const first = cleansed[0]
    if (first === 'and' || first === 'or') cleansed.shift()
    const last = cleansed[cleansed.length - 1]
    if (last === 'and' || last === 'or') cleansed.pop()
    if (cleansed.length) return cleansed
  }
}

// This function is better defined on DB layer
function expandStarStar(target, draftActivate, recursion = new Map()) {
  const MAX_RECURSION_DEPTH = (cds.env.features.recursion_depth && Number(cds.env.features.recursion_depth)) || 4
  const columns = []
  for (const el in target.elements) {
    const element = target.elements[el]

    // no need to read calculated elements
    if (draftActivate && element.value) continue

    // REVISIT: This does not work with old HANA db layer.
    // Use it after removing old db layer.
    /*
    if (element._type === 'cds.LargeBinary') {
      if (!draftActivate) {
        columns.push({
          xpr: [
            'case',
            'when',
            { ref: [el] },
            'IS',
            'NULL',
            'then',
            { val: null },
            'else',
            { val: '' },
            'end'
          ],
          as: el,
          // cast: 'cds.LargeBinary'  <-- This should be fixed for new HANA db layer
        })
        continue
      }
    }*/

    const skip_managed = draftActivate && (element['@cds.on.insert'] || element['@cds.on.update'])
    if (!skip_managed && !element.isAssociation && !DRAFT_ELEMENTS.has(el) && !element['@odata.draft.skip'])
      columns.push({ ref: [el] })

    if (!element.isComposition || element._target['@odata.draft.enabled'] === false) continue // happens for texts if not @fiori.draft.enabled
    const _key = target.name + ':' + el
    let cache = recursion.get(_key)
    if (!cache) {
      cache = 1
      recursion.set(_key, cache)
    } else {
      cache++
      recursion.set(_key, cache)
    }
    if (cache >= MAX_RECURSION_DEPTH) return
    const expand = expandStarStar(element._target, draftActivate, recursion)
    if (expand) columns.push({ ref: [el], expand })
  }
  return columns
}

async function onNew(req) {
  LOG.debug('new draft')

  if (req.target.actives['@Capabilities.InsertRestrictions.Insertable'] === false || req.target.actives['@readonly'])
    req.reject({ code: 405, statusCode: 405 })
  req.query ??= INSERT.into(req.subject).entries(req.data || {}) //> support simple srv.send('NEW',entity,...)
  const isDirectAccess = typeof req.query.INSERT.into === 'string' || req.query.INSERT.into.ref?.length === 1
  // Only allowed for pseudo draft roots (entities with this action)
  if (isDirectAccess && !req.target.actives['@Common.DraftRoot.ActivationAction'])
    req.reject({ code: 403, statusCode: 403, message: 'DRAFT_MODIFICATION_ONLY_VIA_ROOT' })

  _cleanUpOldDrafts(this, req.tenant)

  let DraftUUID
  if (isDirectAccess) DraftUUID = cds.utils.uuid()
  else {
    const rootData = await SELECT.one(req.query.INSERT.into.ref[0].id)
      .columns([
        { ref: ['DraftAdministrativeData_DraftUUID'] },
        { ref: ['DraftAdministrativeData'], expand: [{ ref: ['InProcessByUser'] }] }
      ])
      .where(req.query.INSERT.into.ref[0].where)
    if (!rootData) req.reject({ code: 404, statusCode: 404 })
    if (!cds.context.user._is_privileged && rootData.DraftAdministrativeData?.InProcessByUser !== req.user.id)
      req.reject({
        code: 403,
        statusCode: 403,
        message: 'DRAFT_LOCKED_BY_ANOTHER_USER',
        args: [rootData.DraftAdministrativeData.InProcessByUser]
      })
    DraftUUID = rootData.DraftAdministrativeData_DraftUUID
  }
  const timestamp = cds.context.timestamp.toISOString() // REVISIT: toISOString should be done on db layer
  const adminDataCQN = isDirectAccess
    ? INSERT.into('DRAFT.DraftAdministrativeData').entries({
        DraftUUID,
        CreationDateTime: timestamp,
        CreatedByUser: req.user.id,
        LastChangeDateTime: timestamp,
        LastChangedByUser: req.user.id,
        DraftIsCreatedByMe: true, // Dummy values
        DraftIsProcessedByMe: true, // Dummy values
        InProcessByUser: req.user.id
      })
    : UPDATE('DRAFT.DraftAdministrativeData')
        .data({
          InProcessByUser: req.user.id,
          LastChangedByUser: req.user.id,
          LastChangeDateTime: timestamp
        })
        .where({ DraftUUID })

  const _setDraftColumns = (obj, target) => {
    const newObj = Object.assign({}, obj, { DraftAdministrativeData_DraftUUID: DraftUUID, HasActiveEntity: false })
    delete newObj.IsActiveEntity
    if (!target) return newObj

    // Also support deep insertions
    for (const key in newObj) {
      if (newObj[key] && target.elements[key].isAssociation) delete newObj[key].IsActiveEntity
      if (!target.elements[key]?.isComposition) continue
      // do array trick
      if (Array.isArray(newObj[key]))
        newObj[key] = newObj[key].map(v => _setDraftColumns(v, target.elements[key]._target))
      else if (typeof newObj[key] === 'object') {
        newObj[key] = _setDraftColumns(newObj[key], target.elements[key]._target)
      }
    }

    return newObj
  }

  const draftData = _setDraftColumns(req.query.INSERT.entries[0], req.target)

  const draftCQN = INSERT.into(req.subject).entries(draftData)

  await _promiseAll([adminDataCQN, this.run(draftCQN)])

  // flag to trigger read after write in legacy odata adapter
  if (req.constructor.name in { ODataRequest: 1 }) req._.readAfterWrite = true
  if (req.protocol?.match(/odata/)) req._.readAfterWrite = true //> REVISIT for noah

  return { ...draftData, IsActiveEntity: false }
}

async function onEdit(req) {
  LOG.debug('edit active')

  req.query ??= SELECT.from(req.target, req.data).where({ IsActiveEntity: true }) //> support simple srv.send('EDIT',entity,...)

  // use symbol for _draftParams
  const draftParams = req.query[$draftParams] || { IsActiveEntity: true } // REVISIT: can draftParams in the edit caser ever be undefined or other than IsActiveEntity=true ?
  if (req.query.SELECT.from.ref.length > 1 || draftParams.IsActiveEntity !== true) {
    req.reject({
      code: 400,
      statusCode: 400,
      message: 'Action "draftEdit" can only be called on the root active entity'
    })
  }

  if (
    req.target['@Capabilities.UpdateRestrictions.Updatable'] === false ||
    req.target['@insertonly'] ||
    req.target['@readonly']
  ) {
    req.reject({ code: 405, statusCode: 405 })
  }

  if (draftParams.IsActiveEntity !== true) req.reject({ code: 400, statusCode: 400 })

  _cleanUpOldDrafts(this, req.tenant)

  const DraftUUID = cds.utils.uuid()

  // REVISIT: Later optimization if datasource === db: INSERT FROM SELECT
  const cols = expandStarStar(req.target, false)
  const _addDraftColumns = (target, columns) => {
    if (target.drafts) {
      columns.push({ val: true, as: 'HasActiveEntity' })
      columns.push({ val: DraftUUID, as: 'DraftAdministrativeData_DraftUUID' })
    }
    for (const col of columns) {
      if (col.expand) {
        const el = target.elements[col.ref[0]]
        _addDraftColumns(el._target, col.expand)
      }
    }
  }
  _addDraftColumns(req.target, cols)

  const draftsRef = _redirectRefToDrafts(req.query.SELECT.from.ref, this.model)
  const existingDraft = SELECT.one({ ref: draftsRef }).columns({
    ref: ['DraftAdministrativeData'],
    expand: [_inProcessByUserXpr(_lock.shiftedNow)]
  })

  // prevent service to check for own user
  existingDraft[$draftParams] = draftParams

  const selectActiveCQN = SELECT.one.from({ ref: req.query.SELECT.from.ref }).columns(cols)
  selectActiveCQN.SELECT.localized = false

  let res, draft

  // Ensure exclusive access to the record of the active entity by applying a lock,
  // which effectively prevents the creation or overwriting of duplicate draft entities.
  // This lock mechanism enforces a strict processing order for active entities,
  // allowing only one entity to be worked on at any given time.
  // By using .forUpdate() with a wait value of 0, we immediately lock the record,
  // ensuring there is no waiting time for other users attempting to edit the same record
  // concurrently.
  if (this._datasource === cds.db) {
    const keys = _entityKeys(req.target)
    const keyData = _getKeyData(keys, req.query.SELECT.from.ref[0].where)
    const rootWhere = keys.reduce((res, key) => {
      res[key] = keyData[key]
      return res
    }, {})
    const transition = cds.ql.resolve.transitions(req.query, cds.db)

    // gets the underlying target entity, as record locking can't be
    // applied to localized views
    const lockTarget = transition.target
    const lockWhere =
      transition.mapping.size === 0
        ? rootWhere
        : (() => {
            const whereKeys = Object.keys(rootWhere)
            const w = {}
            whereKeys.forEach(key => {
              const mappedKey = transition.mapping.get(key)
              const lockKey = mappedKey ? mappedKey.ref[0] : key
              w[lockKey] = rootWhere[key]
            })
            return w
          })()
    const activeLockCQN = SELECT.from(lockTarget, [1]).where(lockWhere).forUpdate({ wait: 0 })
    activeLockCQN.SELECT.localized = false
    activeLockCQN[$draftParams] = draftParams

    try {
      await activeLockCQN
    } catch (error) {
      LOG._debug && LOG.debug('Failed to acquire database lock:', error)
      const draft = await existingDraft
      if (draft) req.reject({ code: 409, statusCode: 409, message: 'DRAFT_ALREADY_EXISTS' })
      req.reject({ code: 409, statusCode: 409, message: 'ENTITY_LOCKED' })
    }

    const cqns = [
      cds.env.fiori.read_actives_from_db ? cds.db.run(selectActiveCQN) : this.run(selectActiveCQN),
      existingDraft
    ]

    ;[res, draft] = await _promiseAll(cqns)
  } else {
    const activeLockCQN = SELECT.from({ ref: req.query.SELECT.from.ref }, [1]).forUpdate({ wait: 0 })
    activeLockCQN.SELECT.localized = false
    activeLockCQN[$draftParams] = draftParams

    // Locking the underlying database table is effective only when the database is not
    // hosted on an external service. This is because the active data might be stored in
    // a separate system.
    try {
      await activeLockCQN
    } catch (error) {
      LOG._debug && LOG.debug('Failed to acquire database lock:', error)
    }

    ;[res, draft] = await _promiseAll([
      // REVISIT: inofficial compat flag just in case it breaks something -> do not document
      cds.env.fiori.read_actives_from_db ? cds.db.run(selectActiveCQN) : this.run(selectActiveCQN),
      // no user check must be done here...
      existingDraft
    ])
  }

  if (!res) req.reject({ code: 404, statusCode: 404 })

  const preserveChanges = req.data?.PreserveChanges
  const inProcessByUser = draft?.DraftAdministrativeData?.InProcessByUser

  if (draft) {
    if (inProcessByUser || preserveChanges) req.reject({ code: 409, statusCode: 409, message: 'DRAFT_ALREADY_EXISTS' })
    const keys = {}
    for (const key in req.target.drafts.keys) keys[key] = res[key]
    await _promiseAll([
      DELETE.from('DRAFT.DraftAdministrativeData').where({ DraftUUID }),
      DELETE.from(req.target.drafts).where(keys)
    ])
  }

  if (!cds.env.features.binary_draft_compat) _replaceStreams(res)

  const timestamp = cds.context.timestamp.toISOString() // REVISIT: toISOString should be done on db layer
  await INSERT.into('DRAFT.DraftAdministrativeData').entries({
    DraftUUID,
    CreationDateTime: timestamp,
    CreatedByUser: req.user.id,
    LastChangeDateTime: timestamp,
    LastChangedByUser: req.user.id,
    DraftIsCreatedByMe: true, // Dummy values
    DraftIsProcessedByMe: true, // Dummy values
    InProcessByUser: req.user.id
  })

  // is set to `null` on srv layer
  res.DraftAdministrativeData_DraftUUID = DraftUUID
  res.HasActiveEntity = true
  delete res.DraftAdministrativeData
  // change to db run
  await INSERT.into(req.target.drafts).entries(res)

  // REVISIT: we need to use okra API here because it must be set in the batched request
  //          status code must be set in handler to allow overriding for FE V2
  // REVISIT: needs reworking for new adapter, especially re $batch
  if (req._?.odataRes) {
    req._?.odataRes?.setStatusCode(201, { overwrite: true })
  } else if (req.res) {
    req.res.status(201)
  }

  if (cds.env.features.odata_new_adapter && req.res) {
    const read_result = await _readAfterDraftAction.bind(this)({
      req,
      payload: res,
      action: 'draftEdit'
    })
    req.res.set('location', '../' + location4(req.target, this, read_result || { ...res, IsActiveEntity: false }))

    if (read_result == null) req.res.status(204)

    return read_result
  } else {
    return { ...res, IsActiveEntity: false } // REVISIT: Flatten?
  }
}

async function onCancel(req) {
  LOG.debug('delete draft')

  req.query ??= DELETE(req.target, req.data) //> support simple srv.send('CANCEL',entity,...)
  const activeRef = _redirectRefToActives(req.query.DELETE.from.ref, this.model)
  const draftParams = req.query[$draftParams] || { IsActiveEntity: false } // REVISIT: can draftParams in the cancel case ever be undefined or other than IsActiveEntity=false ?

  const draftQuery = SELECT.one
    .from({ ref: req.query.DELETE.from.ref })
    .columns([
      'DraftAdministrativeData_DraftUUID',
      { ref: ['DraftAdministrativeData'], expand: [_inProcessByUserXpr(_lock.shiftedNow)] }
    ])
  if (req._etagValidationClause && draftParams.IsActiveEntity === false) draftQuery.where(req._etagValidationClause)
  // do not add InProcessByUser restriction
  const draft = await draftQuery
  if (draftParams.IsActiveEntity === false && !draft) req.reject(req._etagValidationType ? 412 : 404)
  if (draft) {
    const processByUser = draft.DraftAdministrativeData?.InProcessByUser
    if (!cds.context.user._is_privileged && processByUser && processByUser !== cds.context.user.id)
      req.reject({ code: 403, statusCode: 403, message: 'DRAFT_LOCKED_BY_ANOTHER_USER', args: [processByUser] })
  }
  const draftDeleteQuery = DELETE.from({ ref: req.query.DELETE.from.ref }) // REVISIT: Isn't that == req.query ?
  const queries = !draft
    ? []
    : [draftParams.IsActiveEntity === false ? this.run(draftDeleteQuery, req.data) : draftDeleteQuery]
  if (draft && req.target['@Common.DraftRoot.ActivationAction'])
    // only for draft root
    queries.push(
      DELETE.from('DRAFT.DraftAdministrativeData').where({ DraftUUID: draft.DraftAdministrativeData_DraftUUID })
    )
  else
    queries.push(
      UPDATE('DRAFT.DraftAdministrativeData')
        .data({
          InProcessByUser: cds.context.user.id,
          LastChangedByUser: cds.context.user.id,
          LastChangeDateTime: cds.context.timestamp.toISOString()
        })
        .where({ DraftUUID: draft.DraftAdministrativeData_DraftUUID })
    )
  if (draftParams.IsActiveEntity !== false && !req.target.isDraft)
    queries.push(this.run(DELETE.from({ ref: activeRef })))
  await _promiseAll(queries)
  return req.data
}

async function onPrepare(req) {
  LOG.debug('prepare draft')

  const draftParams = req.query[$draftParams]
  if (req.query.SELECT.from.ref.length > 1 || draftParams.IsActiveEntity !== false) {
    req.reject({
      code: 400,
      statusCode: 400,
      message: 'Action "draftPrepare" can only be called on the root draft entity'
    })
  }
  const where = req.query.SELECT.from.ref[0].where

  const draftQuery = SELECT.one
    .from(req.target, d => {
      d`.*`, d.DraftAdministrativeData(a => a.InProcessByUser)
    })
    .where(where)
  draftQuery[$draftParams] = draftParams
  const data = await draftQuery
  if (!data) req.reject({ code: 404, statusCode: 404 })
  if (!cds.context.user._is_privileged && data.DraftAdministrativeData?.InProcessByUser !== req.user.id)
    req.reject({
      code: 403,
      statusCode: 403,
      message: 'DRAFT_LOCKED_BY_ANOTHER_USER',
      args: [data.DraftAdministrativeData?.InProcessByUser]
    })
  delete data.DraftAdministrativeData
  // result must not include DraftAdministrativeData_DraftUUID for plain v4 usage, however required for odata-v2
  if (data && req.headers?.['x-cds-odata-version'] !== 'v2') {
    delete data.DraftAdministrativeData_DraftUUID
  }
  return { ...data, IsActiveEntity: false, HasDraftEntity: false, HasActiveEntity: data.HasActiveEntity || false }
}

const _readAfterDraftAction = async function ({ req, payload, action }) {
  const entity = action === 'draftActivate' ? req.target : req.target.drafts

  // read after write with query options
  const keys = {}
  for (let key of entity.keys) {
    if (key.name === 'IsActiveEntity' || key.isAssociation || key.virtual) continue
    keys[key.name] = payload[key.name]
  }
  const read = SELECT.one.from(entity, keys)
  if (req.req?.query.$select || req.req?.query.$expand) {
    const queryOptions = []
    if (req.req.query.$select) queryOptions.push(`$select=${req.req.query.$select}`)
    if (req.req.query.$expand) queryOptions.push(`$expand=${req.req.query.$expand}`)
    read.columns(cds.odata.parse(`/X?${queryOptions.join('&')}`).SELECT.columns)
    // ensure keys are always selected
    Object.keys(keys).forEach(key => {
      if (!read.SELECT.columns.some(c => c.ref?.[0] === key)) read.SELECT.columns.push({ ref: [key] })
    })
    // also ensure selection of etag columns
    addEtagColumns(read.SELECT.columns, entity)
    handleStreamProperties(entity, read.SELECT.columns, this.model)
  }

  try {
    const read_result = await this.run(read)
    // result must not include DraftAdministrativeData_DraftUUID for plain v4 usage, however required for odata-v2
    if (read_result && req.headers?.['x-cds-odata-version'] !== 'v2') {
      delete read_result.DraftAdministrativeData_DraftUUID
    }
    return read_result
  } catch (err) {
    if (!(Number(err.code) in { 401: 1, 403: 1, 404: 1, 405: 1 })) throw err
    // it's important to return null if one of the above accepted errors occurs
    return null
  }
}

// REVISIT: Looking at the simplified impls, I wonder if there's really much added convenience.
// Even more as these events are very rarely sent from programmatic clients, if at all, but rather from Fiori clients only.
cds.extend(cds.ApplicationService).with(
  class {
    new(draft, key) {
      return {
        then: (r, e) => this.send('NEW', draft, key).then(r, e),
        for: key => this.send('EDIT', typeof draft === 'string' ? draft.replace(/\.drafts$/, '') : draft.actives, key)
      }
    }
    edit(active, key) {
      return this.send('EDIT', active, key)
    }
    save(draft, key) {
      return this.send('SAVE', draft, key)
    }
    cancel(draft, key) {
      return this.send('CANCEL', draft, key)
    }
    discard(draft, key) {
      return this.send('DISCARD', draft, key)
    }
  }
)

module.exports = cds.service.impl(function () {
  // REVISIT: don't pollute services... -> do we really need this?
  Object.defineProperty(this, '_datasource', { value: cds.db })

  function _wrapped(handler, isActiveEntity) {
    const fn = function handle_draft_requests(req, next) {
      if (!req.target?.drafts || (isActiveEntity && req.target.isDraft) || (!isActiveEntity && !req.target.isDraft))
        return next?.()
      return handler.call(this, req, next)
    }
    if (handler._initial) fn._initial = true
    return fn
  }

  // Also runs those handlers if they're annotated with @odata.draft.enabled through extensibility
  this.on('NEW', '*', _wrapped(onNew, false))
  this.on('EDIT', '*', _wrapped(onEdit, true))
  this.on('CANCEL', '*', _wrapped(onCancel, false))
  this.on('draftPrepare', '*', _wrapped(onPrepare, false))
})
