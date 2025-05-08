const cds = require('../../../cds')
const LOG = cds.log('app')

const { CRUD_EVENTS } = require('../../constants/events')

const { getDraftTreeRoot } = require('../../utils/csn')

const reject = (req, reason = null) => {
  // unauthorized or forbidden?
  if (req.user._is_anonymous) {
    // REVISIT: challenges handling should be done in protocol adapter (i.e., express error middleware)
    // REVISIT: improve `req.http.req` check if this is an HTTP request
    if (req.http?.res && req.user._challenges && req.user._challenges.length > 0) {
      req.http.res.set('www-authenticate', req.user._challenges.join(';'))
    }

    return req.reject(401)
  }

  return req.reject({
    code: 403,
    internal: reason
  })
}

// REVISIT: Do we really need that? -> if not, let's eliminate it
const getRejectReason = (req, annotation, definition, restrictedCount, unrestrictedCount) => {
  if (!LOG._debug) return
  // it is not possible to specify the reason further than the source as there are multiple factors
  const appendix = unrestrictedCount
    ? ` (${unrestrictedCount - restrictedCount} out of ${unrestrictedCount} instances are restricted)`
    : ''
  return {
    reason: `Access denied to user "${req.user.id}" for event "${req.event}"${appendix}`,
    source: `${annotation} of "${definition.name}"`
  }
}

const _isNull = element => element.val === null || element.list?.length === 0
const _isNotNull = element => element.val !== null && element.list?.length > 0

const _processNullAttr = where => {
  if (!where) return

  for (let i = where.length - 1; i >= 0; i--) {
    if (where[i] === 'null') {
      if (where[i - 2] === 'is' && where[i - 1] === 'not' && _isNull(where[i - 3])) {
        where.splice(i - 3, 4, { val: '1' }, '=', { val: '2' })
        i = i - 3
      } else if (where[i - 2] === 'is' && where[i - 1] === 'not' && _isNotNull(where[i - 3])) {
        where.splice(i - 3, 4, { val: '1' }, '=', { val: '1' })
        i = i - 3
      } else if (where[i - 1] === 'is' && _isNull(where[i - 2])) {
        where.splice(i - 2, 3, { val: '1' }, '=', { val: '1' })
        i = i - 2
      } else if (where[i - 1] === 'is' && _isNotNull(where[i - 2])) {
        where.splice(i - 2, 3, { val: '1' }, '=', { val: '2' })
        i = i - 2
      }
    }
  }
}

// NOTE: arrayed attr with "=" as operator is a valid expression (see authorization guide)
const _arrayComparison = (arr, where, index) => {
  if (arr.length === 0) where[index] = { val: null }
  else if (arr.length === 1) where[index] = { val: arr[0] }
  else {
    let start, element
    if (where[index - 1] === '=' && where[index - 2]) {
      start = index - 2
      element = where[index - 2]
    } else if (where[index + 1] === '=' && where[index + 2]) {
      start = index
      element = where[index + 2]
    }
    if (start !== undefined) {
      const expr = []
      arr.forEach(el => {
        if (expr.length) expr.push('or')
        expr.push(element, '=', { val: el })
      })
      where.splice(start, 3, { xpr: expr })
    } else {
      if (where[index + 1] !== 'is')
        throw new Error('user attribute array must be used with operator "=", "in", "is null", or "is not null"')
      where[index] = {
        list: arr.map(v => {
          return { val: v }
        })
      }
    }
  }
}

const _handleArray = (arr, where, index) => {
  if (where[index - 1] === 'in') {
    if (arr.length === 0) where[index] = { list: [{ val: '__dummy__' }] }
    else
      where[index] = {
        list: arr.map(v => {
          return { val: v }
        })
      }
  } else _arrayComparison(arr, where, index)
}

const $nonexistent = Symbol('nonexistent')
const operators = new Set(['=', '!=', '<>', '<', '<=', '>', '>=', 'in'])

const resolveUserAttrs = (where, req) => {
  for (let i = 0; i < where.length; i++) {
    const r = where[i]
    if (r.xpr) r.xpr = resolveUserAttrs(r.xpr, req)
    else if (r.SELECT?.where) r.SELECT.where = resolveUserAttrs(r.SELECT.where, req)
    else if (r?.ref?.[0] === '$user') {
      if (r.ref.length === 1 || r.ref[1] === 'id') r.val = req.user.id
      else {
        let val = req.user.attr
        for (let j = 1; j < r.ref.length; j++) {
          const attr = r.ref[j]
          if (!Object.prototype.hasOwnProperty.call(val, attr)) {
            val = $nonexistent
            if (where[i - 2] && operators.has(where[i - 1])) {
              where.splice(i - 2, 3, { val: '1' }, '=', { val: '2' })
            } else if (where[i + 2] && operators.has(where[i + 1])) {
              where.splice(i, 3, { val: '1' }, '=', { val: '2' })
            } else if (where[i + 1] === 'is') {
              val = null
              break
            }
          } else val = val?.[attr]
        }
        if (val === $nonexistent) continue
        if (val === undefined) val = null
        if (val === null && where[i - 1] === 'in') where[i] = { list: [{ val: '__dummy__' }] }
        else if (Array.isArray(val)) _handleArray(val, where, i)
        else r.val = val
      }
      delete r.ref
    } else if (r.ref) {
      r.ref.forEach(el => {
        if (el.where) el.where = resolveUserAttrs(el.where, req)
      })
    } else if (r.func) {
      r.args = resolveUserAttrs(r.args, req)
    } else if (r.val) {
      if (typeof r.val === 'number') r.param = false
    }
  }

  _processNullAttr(where)

  return where
}

const _authDependsOnAncestor = (entity, annotations) => {
  // @cds.autoexposed and not @cds.autoexpose -> not explicitly exposed by modeling
  return (
    entity._auth_depends_on ||
    entity.name.match(/\.DraftAdministrativeData$/) ||
    (entity['@cds.autoexposed'] && !entity['@cds.autoexpose'] && !annotations.some(a => a in entity))
  )
}

const getAuthRelevantEntity = (req, model, annotations) => {
  if (!req.target || !(req.event in CRUD_EVENTS)) return

  const it = _authDependsOnAncestor(req.target, annotations)
  if (!it) return req.target
  if (it?.kind === 'entity' && req.subject.ref?.length === 1) return it

  let cqn = req.subject

  // REVISIT: needed in draft for some reason
  if (typeof cqn === 'string') cqn = { ref: [cqn] }

  if (cqn.ref.length === 1 && req.target._isDraftEnabled) {
    // > direct access to children in draft
    const root = getDraftTreeRoot(req.target, model)
    if (!root)
      reject(
        req,
        LOG._debug ? { reason: `Unable to determine single draft tree root for entity "${req.target.name}"` } : null
      )
    return root
  }

  // find and return the restrictions (may be none!) of the right-most entity that is non-autoexposed or explicitly restricted
  const segments = []
  let current = { elements: model.definitions }
  for (let i = 0; i < cqn.ref.length; i++) {
    current = current.elements[cqn.ref[i].id || cqn.ref[i]]
    if (current && current.target) current = model.definitions[current.target]
    segments.push(current)
  }
  let authRelevantEntity
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment.kind === 'entity' && !_authDependsOnAncestor(segment, annotations)) {
      authRelevantEntity = segment
      break
    }
  }
  return authRelevantEntity
}

module.exports = {
  reject,
  getRejectReason,
  resolveUserAttrs,
  getAuthRelevantEntity
}
