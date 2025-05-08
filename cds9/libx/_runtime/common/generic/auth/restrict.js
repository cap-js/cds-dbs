const cds = require('../../../cds'),
  LOG = cds.log('auth')

const { reject, getRejectReason, resolveUserAttrs, getAuthRelevantEntity } = require('./utils')
const { DRAFT_EVENTS, MOD_EVENTS } = require('../../constants/events')
const { getNormalizedPlainRestrictions, getRestrictions } = require('./restrictions')

const _hasRef = xpr => {
  for (const each of xpr) if (each.ref || (each.xpr && _hasRef(each.xpr))) return true
}

const _getResolvedApplicables = (applicables, req) => {
  const resolvedApplicables = []

  // REVISIT: the static portion of "mixed wheres" could already grant access -> optimization potential
  for (const restrict of applicables) {
    let resolved
    if (restrict.where) {
      let xpr
      if (typeof restrict.where === 'string') {
        xpr = cds.parse.expr(restrict.where).xpr
        if (!xpr)
          req.reject(400, `Exists predicate is missing in the association path "${restrict.where}" in @restrict.where`)
      } else {
        xpr = JSON.parse(JSON.stringify(restrict.where))
      }

      resolved = {
        grant: restrict.grant,
        target: restrict.target,
        where: restrict.where,
        // replace $user.x with respective values
        _xpr: resolveUserAttrs(xpr, req),
        _hasRef: _hasRef(xpr)
      }
    }

    resolvedApplicables.push(resolved || restrict)
  }

  return resolvedApplicables
}

const _getStaticAuthRestrictions = resolvedApplicables => {
  return resolvedApplicables.filter(
    resolved =>
      resolved &&
      !resolved._hasRef &&
      resolved._xpr.length === 3 &&
      resolved._xpr.every(ele => typeof ele !== 'object' || ele.val)
  )
}

const _evalStatic = (op, vals) => {
  vals[0] = Number.isNaN(Number(vals[0])) ? vals[0] : Number(vals[0])
  vals[1] = Number.isNaN(Number(vals[1])) ? vals[1] : Number(vals[1])

  switch (op) {
    case '=':
      return vals[0] === vals[1]
    case '!=':
    case '<>':
      return vals[0] !== vals[1]
    case '<':
      return vals[0] < vals[1]
    case '<=':
      return vals[0] <= vals[1]
    case '>':
      return vals[0] > vals[1]
    case '>=':
      return vals[0] >= vals[1]
    default:
      throw new Error(`Operator "${op}" is not supported in @restrict.where`)
  }
}

const _handleStaticAuthRestrictions = (resolvedApplicables, req) => {
  const isAllowed = resolvedApplicables.some(restriction => {
    const op = restriction._xpr.find(ele => typeof ele === 'string')
    const vals = restriction._xpr.filter(ele => typeof ele === 'object' && ele.val).map(ele => ele.val)
    return _evalStatic(op, vals)
  })

  // static clause grants access => done
  if (isAllowed) return

  // static clause forbids access => forbidden
  return reject(req)
}

const _getMergedWhere = restricts => {
  const xprs = []
  restricts.forEach(ele => {
    if (xprs.length) {
      xprs.push('or')
    }
    xprs.push({ xpr: [...ele._xpr] })
  })
  return restricts.length > 1 ? [{ xpr: [...xprs] }] : xprs
}

const _addWheresToRef = (ref, model, resolvedApplicables) => {
  const newRef = []
  let lastEntity = model.definitions[ref[0].id || ref[0]]

  ref.forEach((identifier, idx) => {
    if (idx === ref.length - 1) {
      newRef.push(identifier)
      return // determine last one separately
    }

    const entity = idx === 0 ? lastEntity : lastEntity.elements[identifier.id || identifier]._target
    lastEntity = entity
    const applicablesForEntity = resolvedApplicables.filter(
      restrict => restrict.target && restrict.target.name === entity.name
    )

    let newIdentifier = identifier

    if (applicablesForEntity.length) {
      if (typeof newIdentifier === 'string') {
        newIdentifier = { id: identifier, where: [] }
      }

      if (!newIdentifier.where) newIdentifier.where = []

      if (newIdentifier.where && newIdentifier.where.length) {
        newIdentifier.where = [{ xpr: newIdentifier.where }, 'and']
      }

      for (const val of _getMergedWhere(applicablesForEntity)) newIdentifier.where.push(val)
    }

    newRef.push(newIdentifier)
  })

  return newRef
}

const _getRestrictionForTarget = (resolvedApplicables, target) => {
  const reqTarget = target && (target._isDraftEnabled ? target.name.replace(/_drafts$/, '') : target.name)
  const applicablesForTarget = resolvedApplicables.filter(
    restrict => restrict.target && restrict.target.name === reqTarget
  )

  if (applicablesForTarget.length) {
    return _getMergedWhere(applicablesForTarget)
  }
}

const _addRestrictionsToRead = async (req, model, resolvedApplicables) => {
  // in case of $apply take a query from sub SELECT
  let query = req.query
  while (query.SELECT.from.SELECT) {
    query = query.SELECT.from
  }

  query.SELECT.from.ref = _addWheresToRef(query.SELECT.from.ref, model, resolvedApplicables)

  const restrictionForTarget = _getRestrictionForTarget(resolvedApplicables, req.target)
  if (!restrictionForTarget) return

  query.where(restrictionForTarget)
}

const _getUnrestrictedCount = async req => {
  const target =
    (req.query.UPDATE && req.query.UPDATE.entity) ||
    (req.query.DELETE && req.query.DELETE.from) ||
    (req.query.SELECT && req.query.SELECT.from)

  // Because of side effects, the statements have to be fired sequentially.
  const { n } = await cds.run(SELECT.one(['count(*) as n']).from(target))
  return n
}

const _getRestrictedCount = async (req, model, resolvedApplicables) => {
  const target =
    (req.query.UPDATE && req.query.UPDATE.entity) ||
    (req.query.DELETE && req.query.DELETE.from) ||
    (req.query.SELECT && req.query.SELECT.from)
  const selectRestricted = SELECT.one(['count(*) as n']).from(target)

  if (typeof selectRestricted.SELECT === 'object') {
    selectRestricted.SELECT.from.ref = _addWheresToRef(selectRestricted.SELECT.from.ref, model, resolvedApplicables)
  }

  const restrictionForTarget = _getRestrictionForTarget(resolvedApplicables, req.target)
  if (restrictionForTarget) selectRestricted.where(restrictionForTarget)

  const { n } = await cds.run(selectRestricted)
  return n
}

async function enforce_auth(req) {
  if (req.user._is_privileged || DRAFT_EVENTS[req.event]) {
    // > skip checks (events in DRAFT_EVENTS are checked in draft handlers via InProcessByUser)
    return
  }

  const authRelevantEntity = getAuthRelevantEntity(req, this.model, ['@requires', '@restrict'])
  const definition =
    authRelevantEntity ||
    (req.target && req.target.actions && req.target.actions[req.event]) ||
    (this.operations && this.operations[req.event])

  if (!definition) {
    // > nothing to restrict
    return
  }

  // READ UPDATE DELETE on draft enabled entities are unrestricted, because only the owner can access them
  const draftUnRestrictedEvents = ['READ', 'UPDATE', 'DELETE', 'CREATE']
  if (definition.isDraft && draftUnRestrictedEvents.includes(req.event)) {
    return
  }

  // REVISIT: that (this.getRestrictions||getRestrictions) thing below is for a bad test only!
  let restrictions = (this.getRestrictions || getRestrictions)(definition, req.event, req.user)
  if (restrictions instanceof Promise) restrictions = await restrictions

  if (!restrictions) {
    // > unrestricted
    return
  }

  if (!restrictions.length) {
    // > no applicable restrictions -> 403
    reject(req, getRejectReason(req, '@restrict', definition))
  }
  // normalize
  restrictions = getNormalizedPlainRestrictions(restrictions, definition)
  // at least one if the user's roles grants unrestricted access => done
  if (restrictions.some(restrict => !restrict.where)) return

  const resolvedApplicables = _getResolvedApplicables(restrictions, req)

  // REVISIT with cds^9
  // - remove compat_static_auth
  // - make check on CREATE/ NEW and unbound a compat opt-in
  if (cds.env.features.compat_static_auth || req.event in { CREATE: 1, NEW: 1 } || this.operations[req.event]) {
    const staticAuthRestriction = _getStaticAuthRestrictions(resolvedApplicables)
    if (staticAuthRestriction.length > 0) {
      return _handleStaticAuthRestrictions(staticAuthRestriction, req)
    }
  }

  if (req.event === 'READ') {
    _addRestrictionsToRead(req, this.model, resolvedApplicables)
    return
  }

  // Instance based authorization for bound actions /functions
  await restrictBoundActionFunctions(req, resolvedApplicables, definition)

  // no modification -> nothing more to do
  if (!MOD_EVENTS[req.event]) return

  /*
   * Here we check if UPDATE/DELETE requests add additional restrictions
   * Note: Needs to happen sequentially because of side effects
   */
  // REVISIT: Do we really need to do that? Always?
  const unrestrictedCount = await _getUnrestrictedCount(req)
  if (unrestrictedCount === 0) req.reject(404)

  // REVISIT: selected data could be used for etag check, diff, etc.

  const restrictedCount = await _getRestrictedCount(req, this.model, resolvedApplicables)
  if (restrictedCount < unrestrictedCount) {
    reject(req, getRejectReason(req, '@restrict', definition, restrictedCount, unrestrictedCount))
  }
}

const isBoundToCollection = action =>
  action['@cds.odata.bindingparameter.collection'] ||
  (action.params && Object.values(action.params).some(param => param?.items?.type === '$self'))

const restrictBoundActionFunctions = async (req, resolvedApplicables, definition) => {
  if (req.target?.actions?.[req.event] && !isBoundToCollection(req.target.actions[req.event])) {
    // Clone to avoid target modification, which would cause a different query
    const query = req.query ? cds.ql.clone(req.query) : SELECT.one.from(req.subject)
    _addRestrictionsToRead({ query: query, target: req.target }, cds.model, resolvedApplicables)
    const result = await cds.db.run(query)
    if (!result || result.length === 0) {
      // If we got a result, we don't need to check for the existence, hence only in this special case we must determine if `404` or `403`.
      const unrestrictedCount = await _getUnrestrictedCount(req)
      if (unrestrictedCount === 0) req.reject(404)
      if (LOG._debug) LOG.debug(`Restricted access on action ${req.event}`)
      reject(req, getRejectReason(req, '@restrict', definition))
    }
    req._auth_query_result = result
  }
}

enforce_auth._initial = true

module.exports = enforce_auth
