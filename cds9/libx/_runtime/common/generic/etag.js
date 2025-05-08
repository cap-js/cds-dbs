const cds = require('../../cds')
const { SELECT } = cds.ql

const { addEtagColumns } = require('../utils/etag')

const _getMatchHeaders = req => {
  return {
    ifMatch: req.headers['if-match']?.replace(/^"\*"$/, '*'),
    ifNoneMatch: req.headers['if-none-match']?.replace(/^"\*"$/, '*')
  }
}

const _parseHeaderEtagValue = value => {
  return value.split(',').map(str => {
    let result = str.trim()
    if (result === '*') return result
    if (result.startsWith('W/')) result = result.substring(2)
    return result.startsWith('"') && result.endsWith('"') ? result.substring(1, result.length - 1) : null
  })
}

const _getValidationStmt = (ifMatchEtags, ifNoneMatchEtags, req) => {
  const etagElement = req.target.elements[req.target._etag.name]

  const select = SELECT.from(req.subject).columns(1)
  // tell resolveView to leave this select alone
  select._doNotResolve = true
  // tell db layer that this is a subselect for etag validation
  // hacky solution for gap in @sap/hana-client
  select._etagValidation = true

  const cond = []
  if (ifMatchEtags) {
    if (ifMatchEtags.includes('*')) return true
    // HANA does not allow malformed time values in prepared statements
    if (etagElement.type === 'cds.Timestamp' || etagElement.type === 'cds.DateTime') {
      ifMatchEtags = ifMatchEtags.filter(val => new Date(val).toString() !== 'Invalid Date')
      if (!ifMatchEtags.length) return false
    }

    cond.push({ ref: [etagElement.name] })
    if (ifMatchEtags.length === 1) cond.push('=', { val: ifMatchEtags[0] })
    else cond.push('in', { list: ifMatchEtags.map(val => ({ val })) })
  } else {
    if (req.event !== 'READ' && ifNoneMatchEtags.includes('*')) return false
    // if a malformed time value is present, it cannot match -> precondition true
    if (
      (etagElement.type === 'cds.Timestamp' || etagElement.type === 'cds.DateTime') &&
      ifNoneMatchEtags.some(val => new Date(val).toString() === 'Invalid Date')
    ) {
      return true
    }

    if (req.event !== 'READ') {
      cond.push({ ref: [etagElement.name] })
      if (ifNoneMatchEtags.length === 1) cond.push('!=', { val: ifNoneMatchEtags[0] })
      else cond.push('not', 'in', { list: ifNoneMatchEtags.map(val => ({ val })) })
    }
  }
  if (!cond.length) return true

  return select.where(cond)
}

/**
 * Generic handler for @odata.etag-enabled entities
 *
 * @param req
 */
const validate_etag = async function (req) {
  /*
   * currently, etag is only supported for OData requests
   * REST requests should be added later -> REVISIT!!!
   * other protocols, such as graphql, need to be checked
   */
  if (req.protocol !== 'odata') return

  // automatically add etag columns if not already there
  if (req.query.SELECT) addEtagColumns(req.query.SELECT.columns, req.target)

  // querying a collection?
  if (req.event === 'READ' && !req.query.SELECT.one) return

  // etag provided?
  const { ifMatch, ifNoneMatch } = _getMatchHeaders(req)
  if (!ifMatch && !ifNoneMatch) {
    if (req.event === 'READ') return // > ok and nothing more to do
    req.reject(428) // > on writes, an etag must be provided
  }

  // normalize
  const ifMatchEtags = ifMatch && _parseHeaderEtagValue(ifMatch)
  const ifNoneMatchEtags = ifNoneMatch && _parseHeaderEtagValue(ifNoneMatch)

  // get select for validation
  const validationStmt = _getValidationStmt(ifMatchEtags, ifNoneMatchEtags, req, this.model)

  // shortcuts
  if (validationStmt === true) {
    // wildcard -> nothing to do
    return
  } else if (validationStmt === false) {
    // never true -> reject
    req.reject(412)
  }

  // bound action or CRUD?
  if (req.event === 'EDIT' || (req.target.actions && req.event in req.target.actions)) {
    await cds.db?.run(validationStmt).then(result => result.length || req.reject(412))
  } else if (validationStmt) {
    // add where clause for validation
    const validationClause = ['exists', validationStmt]
    req.query.where(validationClause)
    // HACK for current draft impl // REVISIT: which is really bad
    req._etagValidationClause = validationClause
    req._etagValidationType = ifMatchEtags ? 'if-match' : 'if-none-match'
  }
}

/**
 * adds a new uuid for the etag element to the request payload
 *
 * @param req
 */
const add_etag = function (req) {
  const etagElement = req.target.elements[req.target._etag.name]
  req.data[etagElement.name] = cds.utils.uuid()
}

/**
 * handler registration
 */
/* istanbul ignore next */
module.exports = cds.service.impl(function () {
  validate_etag._initial = true
  add_etag._initial = true

  for (const k in this.entities) {
    const entity = this.entities[k]

    if (!entity._etag) continue

    if (entity._isDraftEnabled) {
      this.before(['READ', 'DELETE'], entity, validate_etag)
      // if draft compat is on, the read handler is automatically registered for <entity> and <entity>.drafts
      const events = ['READ', 'UPDATE', 'CANCEL']
      this.before(events, entity.drafts, validate_etag)
    } else {
      this.before(['READ', 'UPDATE', 'DELETE'], entity, validate_etag)
    }

    for (const action in entity.actions) {
      // etag not applicable to functions and unbound actions
      if (entity.actions[action].kind !== 'action') continue
      if (entity._isDraftEnabled) {
        const _entity = action === 'draftEdit' ? entity : entity.drafts
        this.before(action === 'draftEdit' ? 'EDIT' : action, _entity, validate_etag)
      } else {
        this.before(action, entity, validate_etag)
      }
    }

    // for backwards compatibility w.r.t. ETag generation if type UUID
    const etagElement = entity.elements[entity._etag.name]
    if (etagElement.isUUID) this.before(['CREATE', 'UPDATE', 'NEW'], entity, add_etag)
  }
})
