const cds = require('../../_runtime/cds')
const { SELECT } = cds.ql

const { DRAFT_COLUMNS_MAP } = require('../../_runtime/common/constants/draft')

const _keysOf = (row, target) => {
  const keyElements = Object.values(target.keys || {}).filter(v => !v.virtual)
  // > singleton
  if (!keyElements.length) return
  const keys = {}
  for (const key of keyElements) {
    if (key._isAssociationStrict) continue
    if (row[key.name] === undefined) continue // key is not in data, so ignore it
    keys[key.name] = key.elements ? { val: JSON.stringify(row[key.name]) } : row[key.name]
  }
  return keys
}

const _getSimpleSelectCQN = (target, data, subject) => {
  let cqn

  const keys = _keysOf(data, target)
  if (subject?.ref.length > 1) {
    cqn = SELECT.one(subject)
    if (keys) cqn.where(keys)
  } else if (!keys) {
    //> singleton
    cqn = SELECT.one(target)
  } else {
    cqn = SELECT.one(target, keys)
  }

  if (target.query && target.query.SELECT && target.query.SELECT.orderBy) {
    cqn.SELECT.orderBy = target.query.SELECT.orderBy
  }

  return cqn
}

const _mergeExpandCQNs = cqns => {
  const cols = cqns[0].SELECT.columns
  for (const cqn of cqns.slice(1)) {
    for (const col of cqn.SELECT.columns) {
      if (!col.expand) continue
      const idx = cols.findIndex(ele => {
        if (!col.ref) return
        if (ele.ref) return ele.ref[0] === col.ref[0]
        if (ele.as) return ele.as === col.ref[0]
      })
      if (idx === -1) {
        cols.push(col)
      } else {
        const colExists = cols[idx]
        if (colExists.as && colExists.val === null) {
          cols[idx] = col
          continue
        }
        if (col.as && col.val === null) continue
        const mergedExpandCQN = _mergeExpandCQNs([
          { SELECT: { columns: colExists.expand } },
          { SELECT: { columns: col.expand } }
        ])
        colExists.expand = mergedExpandCQN.SELECT.columns
      }
    }
  }
  return cqns[0]
}

const _getExpandColumn = (data, element) => {
  const key = element.name
  if (!(key in data)) return
  data = data[key]
  if ((Array.isArray(data) && data.length === 0) || data == null) {
    // performance tweak, keep in mind it is only for compositions
    return { val: null, as: key }
  }
  const cqn = Array.isArray(data)
    ? _mergeExpandCQNs(data.map(data => _getSelect({ target: element._target, data }, true)))
    : _getSelect({ target: element._target, data }, true)
  return { ref: [key], expand: cqn.SELECT.columns }
}

const _getColumns = (target, data, prefix = []) => {
  const columns = []
  for (const each in target.elements) {
    if (target.elements[each]['@cds.api.ignore']) continue
    if (each in DRAFT_COLUMNS_MAP) continue
    if (target.elements[each].type === 'cds.LargeBinary') continue
    const element = target.elements[each]
    if (element.elements && data[each] && element.type !== 'cds.Map') {
      prefix.push(element.name)
      columns.push(..._getColumns(element, data[each], prefix))
      prefix.pop()
    } else if (element.isComposition && !prefix.length) {
      const col = _getExpandColumn(data, element, prefix)
      if (col) columns.push(col)
    } else if (!element.isAssociation) {
      columns.push({ ref: [...prefix, each] })
    }
  }
  return columns
}

/*
 * recursively builds a select cqn (depth determined by req.data)
 */
const _getSelect = (cdsReq, deep = false) => {
  const { target, data, subject } = cdsReq
  const cqn = _getSimpleSelectCQN(target, data, subject)
  if (deep) cqn.columns(..._getColumns(target, data))
  return cqn
}

module.exports = (adapter, middleware) => {
  const { service } = adapter

  const _getQuery =
    middleware === 'create'
      ? cdsReq => _getSelect(cdsReq, cdsReq.event === 'CREATE')
      : cdsReq => SELECT.one(cdsReq.subject)

  return async function readAfterWrite(cdsReq) {
    try {
      const query = _getQuery(cdsReq)
      const result = await service.dispatch(adapter.request4({ query, params: cdsReq.params }))

      // REVISIT: really needed? -> disable and run odata v2 tests
      // NEW/PATCH must not include DraftAdministrativeData_DraftUUID for plain v4 usage, however required for odata-v2
      if (result && cdsReq.target._isDraftEnabled && cdsReq.headers?.['x-cds-odata-version'] !== 'v2') {
        delete result.DraftAdministrativeData_DraftUUID
      }

      return result
    } catch (e) {
      // if read was not possible because of access restrictions then ignore else throw
      if (!(Number(e.code) in { 401: 1, 403: 1, 404: 1, 405: 1 })) throw e
    }
  }
}
