'use strict'

const { computeColumnsToBeSearched } = require('../search')
const { shell, and } = require('./syntax')

function search(scope) {
  if (!scope.clause.search || scope.sources.size !== 1) return
  const source = scope.sources.values().next().value
  const entity = source.query ? { ...shell(source.syntax), SELECT: source.query.clause, elements: source.query.elements } : source.definition
  const query = { SELECT: scope.clause, elements: scope.elements, _target: entity }
  const columns = computeColumnsToBeSearched(query, entity)
  if (!columns.length) return
  const term = scope.clause.search
  const predicate = { func: 'search', args: [columns.length === 1 ? columns[0] : { list: columns },
    term.length === 1 && 'val' in term[0] ? term[0] : { xpr: term }] }
  const keys = scope.model.primaryKeys(source.definition)
  const deep = keys.length && !scope.clause.groupBy && !source.query && columns.some(column => column.ref?.length > 1)
  const clause = scope.clause = shell(scope.clause)
  const aggregated = clause.groupBy && columns.some(column => column.func || column.xpr)
  const prop = aggregated ? 'having' : 'where'
  let condition
  if (deep) {
    const refs = keys.map(key => ({ ref: key.ref }))
    condition = [refs.length === 1 ? refs[0] : { list: refs }, 'in', { SELECT: {
      from: { ref: [source.definition.name] }, columns: refs, where: [predicate],
    } }]
  } else condition = [predicate]
  clause[prop] = and(clause[prop], condition)
  const countOnly = clause.columns?.length === 1 && (clause.columns[0].func === 'count' || Object.hasOwn(clause.columns[0], 'val'))
  if (!scope.compiler.options.rankedSearch || countOnly || clause.orderBy?.some(column => !column.implicit)) return
  const score = { func: 'search', args: [...predicate.args, { val: true }] }
  let rank = { ...score, sort: 'desc' }
  if (deep) {
    const where = keys.flatMap((key, i) => [...(i ? ['and'] : []), { ref: key.ref }, '=', { ref: [source.alias, ...key.ref] }])
    rank = { SELECT: { from: { ref: [source.definition.name] }, columns: [{ func: 'max', args: [score] }], where }, sort: 'desc' }
  }
  clause.orderBy = [rank, ...(clause.orderBy || []).map(column => shell(column, ['implicit']))]
}

module.exports = search
