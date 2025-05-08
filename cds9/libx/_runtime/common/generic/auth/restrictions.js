const cds = require('../../../cds')

const WRITE_EVENTS = { CREATE: 1, NEW: 1, UPDATE: 1, PATCH: 1, DELETE: 1, CANCEL: 1, EDIT: 1 }
const CRUD = Object.assign({ READ: 1 }, WRITE_EVENTS)
const ACTION_TYPES = { action: 1, function: 1 }
/**
 * Returns the applicable restrictions for the current request as follows:
 * - null: unrestricted access
 * - []: no access
 * - [{ grant: '...', to: ['...'], where: '...' }, ...]: applicable restrictions with grant normalized to strings,
 *     i.e., grant: ['CREATE', 'UPDATE'] in model becomes [{ grant: 'CREATE' }, { grant: 'UPDATE' }]
 * - Promise resovling to any of the above (needed for CAS overrides)
 *
 * @param {object} definition - then csn definition of an entity or an (un)bound action or function
 * @param {string} event - the event name
 * @param {import('../../../../lib/req/user')} user - the current user
 * @returns {Promise | Array | null}
 */
function getRestrictions(definition, event, user) {
  let restrictions = getNormalizedRestrictions(definition)
  if (!restrictions) return null
  if (event in CRUD && restrictions.length && restrictions.every(r => r.grant !== '*' && !(r.grant in CRUD))) {
    // > only bounds are restricted
    return null
  }
  // return the applicable restrictions (grant and to fit to request and user)
  return getApplicableRestrictions(restrictions, event, user)
}

const _getLocalName = definition => {
  return definition._service ? definition.name.replace(`${definition._service.name}.`, '') : definition.name
}

const _isStaticWhere = where => {
  if (typeof where === 'string') where = cds.parse.expr(where)
  return (
    where?.xpr?.length === 3 && where.xpr.every(ele => typeof ele !== 'object' || ele.val || ele.ref?.[0] === '$user')
  )
}

const _getRestrictWithEventRewrite = (grant, to, where, target) => {
  // REVISIT: req.event should be 'SAVE' and 'PREPARE'
  if (grant === 'SAVE') grant = 'draftActivate'
  else if (grant === 'PREPARE') grant = 'draftPrepare'
  return { grant, to, where, target }
}

const WRITE = ['CREATE', 'UPDATE', 'DELETE']

const _addNormalizedRestrictPerGrant = (grant, where, restrict, restricts, definition) => {
  const to = restrict.to ? (Array.isArray(restrict.to) ? restrict.to : [restrict.to]) : ['any']

  if (definition.kind === 'entity') {
    if (grant === 'WRITE') {
      WRITE.forEach(g => {
        restricts.push(_getRestrictWithEventRewrite(g, to, where, definition))
      })
    } else {
      restricts.push(_getRestrictWithEventRewrite(grant, to, where, definition))
    }
  } else {
    restricts.push({ grant: _getLocalName(definition), to, where, target: definition.parent })
  }
}

const _addNormalizedRestrict = (restrict, restricts, definition) => {
  const where = restrict.where?.xpr ?? restrict.where
  restrict.grant = Array.isArray(restrict.grant) ? restrict.grant : [restrict.grant || '*']
  restrict.grant.forEach(grant => _addNormalizedRestrictPerGrant(grant, where, restrict, restricts, definition))
}

const getNormalizedRestrictions = definition => {
  const restricts = []
  let isRestricted = false

  // own
  if (definition['@restrict']) {
    isRestricted = true
    definition['@restrict'].forEach(restrict => {
      if (definition.kind in ACTION_TYPES) {
        const to = restrict.to ? (Array.isArray(restrict.to) ? restrict.to : [restrict.to]) : ['any']
        if (definition.parent?.kind === 'entity') {
          restrict = { grant: definition.name, to }
        } else {
          const where = _isStaticWhere(restrict.where) && restrict.where
          restrict = { grant: _getLocalName(definition), to, where }
        }
      }
      _addNormalizedRestrict(restrict, restricts, definition)
    })
  }

  // parent - in case of bound actions/functions
  if (definition.kind in ACTION_TYPES && definition.parent && definition.parent['@restrict']) {
    isRestricted = true
    definition.parent['@restrict'].forEach(restrict => _addNormalizedRestrict(restrict, restricts, definition.parent))
  }

  return isRestricted ? restricts : null
}

const _isGrantAccessAllowed = (eventName, restrict) =>
  restrict.grant === '*' || (eventName === 'EDIT' && restrict.grant === 'UPDATE') || restrict.grant === eventName

const _isToAccessAllowed = (user, restrict) => restrict.to.some(role => user.is(role))

const getApplicableRestrictions = (restrictions, event, user) => {
  return restrictions.filter(restrict => {
    return _isGrantAccessAllowed(event, restrict) && _isToAccessAllowed(user, restrict)
  })
}

const getNormalizedPlainRestrictions = (restrictions, definition) => {
  const result = []
  for (const restriction of restrictions) _addNormalizedRestrict(restriction, result, definition)
  return result
}

module.exports = {
  getRestrictions,
  getNormalizedRestrictions,
  getApplicableRestrictions,
  getNormalizedPlainRestrictions
}
