const { resolveView, getTransition } = require('../../libx/_runtime/common/utils/resolveView')
const cds = require('../../lib')

const PERSISTENCE_TABLE = '@cds.persistence.table'
const _isPersistenceTable = target =>
  Object.prototype.hasOwnProperty.call(target, PERSISTENCE_TABLE) && target[PERSISTENCE_TABLE]

// REVISIT revert after cds-dbs pr
// REVISIT: Remove once we get rid of old db
const _abortDB = resolve.abortDB = target => !!(_isPersistenceTable(target)|| !target.query?._target)
const _defaultAbort = tx => e => e._service?.name === tx.definition?.name

function resolve(query, tx, abortCondition) {
  const ctx = cds.context
  const abort = abortCondition ?? (typeof tx === 'function' ? tx : undefined)
  const _tx = typeof tx === 'function' ? ctx?.tx : tx
  const model = ctx?.model ?? _tx.model

  return resolveView(query, model, _tx, abort || _defaultAbort(_tx))
}

resolve.resolve4db = (query, tx) => resolve(query, tx, _abortDB)

// REVISIT: Remove once we get rid of composition tree
resolve.table = target => {
  if (target.query?._target && !_isPersistenceTable(target)) {
    return resolve.table(target.query._target)
  }
  return target
}

// REVISIT: Remove argument `skipForbiddenViewCheck` once we get rid of composition tree
resolve.transitions = (query, tx, abortCondition, skipForbiddenViewCheck) => {
  const target = query && typeof query === 'object' ? cds.infer.target(query) || query?._target : undefined
  const abort = abortCondition ?? (typeof tx === 'function' ? tx : undefined)
  const _tx = typeof tx === 'function' ? cds.context?.tx : tx
  return getTransition(target, _tx, skipForbiddenViewCheck, undefined, {
    abort: abort ?? (tx.isDatabaseService ? _abortDB : _defaultAbort(tx))
  })
}

resolve.transitions4db = (query, tx, skipForbiddenViewCheck) => resolve.transitions(query, tx, _abortDB, skipForbiddenViewCheck)

module.exports = resolve
