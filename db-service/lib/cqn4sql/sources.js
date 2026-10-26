'use strict'

module.exports = {
  getTransformedFrom,
  ensureValidForeignKeys,
  whereExistsSubqueries,
  getNextAvailableTableAlias,
  getWhereExistsSubquery,
  getTableAlias,
  transformSubquery,
}

const { elementSources } = require('./resolve/sources')

const transformOwned = require('./transform')
const { bindingFor } = require('./binding')

const expressionsModule = require('./expressions')
const joinsModule = require('./joins')

const { keysOf } = require('./model')

const cds = require('@sap/cds')
const { prettyPrintRef, defineProperty } = require('../utils')
const { hasLogicalOr, asXpr, assignQueryModifiers, isStructured } = require('./helpers')

/**
 * Recursively walks over all `from` args. Association steps in the `ref`s
 * are transformed into `WHERE exists` subqueries. The given `from.ref`s
 * are always of length == 1 after processing.
 *
 * The steps in a `ref` are processed in reversed order. This is the main difference
 * to the `WHERE exists` expansion in the @function getTransformedTokenStream().
 *
 * @param {object} from
 * @param {object[]?} existingWhere custom where condition which is appended to the filter
 *                                  conditions of the resulting `WHERE exists` subquery
 */
function getTransformedFrom(ctx, from, existingWhere = []) {
  const transformedWhere = []
  let transformedFrom = { ...from }
  if (from.$refLinks) defineProperty(transformedFrom, '$refLinks', [...from.$refLinks])
  if (from.args) {
    transformedFrom.args = []
    from.args.forEach(arg => {
      if (arg.SELECT) {
        const { whereExists: e, transformedFrom: f } = getTransformedFrom(ctx, arg.SELECT.from, arg.SELECT.where)
        const transformedArg = { SELECT: { from: f, where: e } }
        transformedFrom.args.push(transformedArg)
      } else {
        const { transformedFrom: f } = getTransformedFrom(ctx, arg)
        transformedFrom.args.push(f)
      }
    })
    return { transformedFrom, transformedWhere: existingWhere }
  } else if (from.SELECT) {
    transformedFrom = transformSubquery(ctx, from)
    if (from.as) {
      // preserve explicit TA
      transformedFrom.as = from.as
    } else {
      // select from anonymous query, use artificial alias
      transformedFrom.as = Object.keys(ctx.query.sources)[0]
    }
    return { transformedFrom, transformedWhere: existingWhere }
  } else {
    return _transformFrom()
  }
  function _transformFrom() {
    if (typeof from === 'string') {
      // normalize to `ref`, i.e. for `UPDATE.entity('bookshop.Books')`
      return { transformedFrom: { ref: [from], as: ctx.getImplicitAlias(from) } }
    }
    transformedFrom.as =
      from.uniqueSubqueryAlias ||
      from.as ||
      ctx.getImplicitAlias(transformedFrom.$refLinks[transformedFrom.$refLinks.length - 1].definition.name)
    const whereExistsSubSelects = []
    const filterConditions = []
    const refReverse = [...from.ref].reverse()
    const $refLinksReverse = [...transformedFrom.$refLinks].reverse()
    for (let i = 0; i < refReverse.length; i += 1) {
      const current = $refLinksReverse[i]

      let next = $refLinksReverse[i + 1]
      const nextStep = refReverse[i + 1] // only because we want the filter condition

      if (current.definition.target && next) {
        const { where, ...args } = nextStep
        if (isStructured(next.definition)) {
          // find next association / entity in the ref because this is actually our real nextStep
          const nextStepIndex =
            2 +
            $refLinksReverse
              .slice(i + 2)
              .findIndex(rl => rl.definition.isAssociation || rl.definition.kind === 'entity')
          next = $refLinksReverse[nextStepIndex]
        }
        let as = ctx.getImplicitAlias(next.alias)
        /**
         * for an `expand` subquery, we do not need to add
         * the table alias of the `expand` host to the join tree
         * --> This is an artificial query, which will later be correlated
         * with the main query alias. see @function expandColumn()
         * There is one exception:
         * - if current and next have the same alias, we need to assign a new alias to the next
         *
         */
        if (!(ctx.query.SELECT?.expand === true && current.alias.toLowerCase() !== as.toLowerCase())) {
          as = getNextAvailableTableAlias(ctx, as)
        }
        next.alias = as
        const { definition: fkSource } = current
        ensureValidForeignKeys(ctx, fkSource, from.ref)
        whereExistsSubSelects.push(getWhereExistsSubquery(ctx, current, next, where, false, args))
      }
    }

    // OData variant w/o mentioning key
    if (refReverse[0].where?.length === 1 && refReverse[0].where[0].val) {
      filterConditions.push(
        expressionsModule.getTransformedTokenStream(ctx, refReverse[0].where, { $baseLink: $refLinksReverse[0] }),
      )
    }

    if (existingWhere.length > 0) filterConditions.push(existingWhere)
    if (whereExistsSubSelects.length > 0) {
      const { definition: leafAssoc, alias } = transformedFrom.$refLinks[transformedFrom.$refLinks.length - 1]
      Object.assign(transformedFrom, {
        ref: [leafAssoc.target],
        as: alias,
      })
      transformedWhere.push(...['exists', { SELECT: whereExistsSubqueries(ctx, whereExistsSubSelects) }])
      filterConditions.forEach(f => {
        transformedWhere.push('and')
        if (filterConditions.length > 1) transformedWhere.push(asXpr(f))
        else if (f.length > 3 || f.includes('or') || f.includes('and') || f.includes('in'))
          transformedWhere.push(asXpr(f))
        else transformedWhere.push(...f)
      })
    } else {
      if (filterConditions.length > 0) {
        filterConditions.reverse().forEach((f, index) => {
          if (filterConditions.length > 1) transformedWhere.push(asXpr(f))
          else transformedWhere.push(...f)
          if (filterConditions[index + 1] !== undefined) transformedWhere.push('and')
        })
      }
    }

    // adjust ref & $refLinks after associations have turned into where exists subqueries
    transformedFrom.$refLinks.splice(0, transformedFrom.$refLinks.length - 1)

    const subquerySource =
      ctx.getDefinition(transformedFrom.$refLinks[0].definition.target) || transformedFrom.$refLinks[0].target
    const id = ctx.getLocalizedName(subquerySource)
    transformedFrom.ref = [subquerySource.params ? { id, args: from.ref.at(-1).args || {} } : id]

    return { transformedWhere, transformedFrom }
  }
}

function ensureValidForeignKeys(ctx, fkSource, ref, kind = null) {
  if (keysOf(fkSource, ctx.state.metadata) && keysOf(fkSource, ctx.state.metadata).length === 0) {
    const path = prettyPrintRef(ref, ctx.model)
    if (kind === 'expand') throw new Error(`Can't expand “${fkSource.name}” as it has no foreign keys`)
    throw new Error(`Path step “${fkSource.name}” of “${path}” has no foreign keys`)
  }
}

function whereExistsSubqueries(ctx, whereExistsSubSelects) {
  if (whereExistsSubSelects.length === 1) return whereExistsSubSelects[0]
  whereExistsSubSelects.reduce((prev, cur) => {
    if (prev.where) {
      prev.where.push('and', 'exists', { SELECT: cur })
      return cur
    } else {
      prev = cur
    }
    return prev
  }, {})
  return whereExistsSubSelects[0]
}

function getNextAvailableTableAlias(ctx, id) {
  return ctx.query.joinTree.addNextAvailableTableAlias(id, ctx.query.outerQueries)
}

/**
 * Constructs a where exists subquery for a given association - i.e. calculates foreign key / parent key
 * relations for the association.
 *
 * @param {$refLink} current step of the association path
 * @param {$refLink} next step of the association path
 * @param {object[]} customWhere infix filter which must be part of the where exists subquery on condition
 * @param {boolean} inWhere whether or not the path is part of the queries where clause
 *                    -> if it is, target and source side are flipped in the where exists subquery
 * @param {object} queryModifier optional query modifiers: group by, order by, limit, offset
 *
 * @returns {CQN.SELECT}
 */
function getWhereExistsSubquery(ctx, current, next, customWhere = null, inWhere = false, queryModifier = null) {
  const { definition: nextDefinition } = next
  const condition = joinsModule.onCondFor(ctx, inWhere ? next : current, inWhere ? current : next, inWhere)
  const on = customWhere && hasLogicalOr(condition) ? [asXpr(condition)] : condition

  const subquerySource = ctx.getDefinition(nextDefinition.target) || nextDefinition
  const id = ctx.getLocalizedName(subquerySource)
  const SELECT = {
    from: {
      ref: [subquerySource.params ? { id, args: queryModifier.args || {} } : id],
      as: next.alias,
    },
    columns: [
      {
        val: 1,
        // as: 'dummy'
      },
    ],
    where: on,
  }
  // this requires sub-sequent transformation of the subquery
  if (
    next.pathExpressionInsideFilter ||
    (queryModifier && ['orderBy', 'groupBy', 'having', 'limit', 'offset'].some(key => key in queryModifier))
  ) {
    SELECT.where = customWhere || []
    if (queryModifier) assignQueryModifiers(SELECT, queryModifier)

    const transformedExists = transformSubquery(ctx, { SELECT })
    if (transformedExists.SELECT.where?.length) {
      const wrappedWhere = hasLogicalOr(transformedExists.SELECT.where)
        ? [asXpr(transformedExists.SELECT.where)]
        : transformedExists.SELECT.where

      on.push('and', ...wrappedWhere)
    }
    transformedExists.SELECT.where = on
    return transformedExists.SELECT
  }

  if (customWhere) {
    const filter = expressionsModule.getTransformedTokenStream(ctx, customWhere, { $baseLink: next })
    const wrappedFilter = hasLogicalOr(filter) ? [asXpr(filter)] : filter
    on.push('and', ...wrappedFilter)
  }
  return SELECT
}

/**
 * Calculates the name of the source which can be used to address the given node.
 *
 * @param {object} node a csn object with a `ref` and `$refLinks`
 * @param {object} $baseLink optional base `$refLink`, e.g. for infix filters.
 *                           For an infix filter, we must explicitly pass the TA name
 *                           because the first step of the ref might not be part of
 *                           the combined elements of the query
 * @returns the source name which can be used to address the node
 */
function getTableAlias(ctx, node, $baseLink = null) {
  if (!node || !node.$refLinks || !node.ref) {
    throw new Error('Invalid node')
  }
  if (node.$refLinks[0].$main) {
    if (node.isJoinRelevant) {
      return getJoinRelevantAlias(node)
    }
    return node.$refLinks[0].alias
  }
  if ($baseLink) {
    return getBaseLinkAlias($baseLink)
  }
  if (node.isJoinRelevant) {
    return getJoinRelevantAlias(node)
  }
  return getSelectOrEntityAlias(node) || getCombinedElementAlias(node)
  function getBaseLinkAlias($baseLink) {
    return $baseLink.alias
  }

  function getJoinRelevantAlias(node) {
    return bindingFor(ctx, node).join.alias
  }

  function getSelectOrEntityAlias(node) {
    let firstRefLink = node.$refLinks[0].definition
    if (firstRefLink.SELECT || firstRefLink.kind === 'entity') {
      const firstStep = node.ref[0]
      /**
       * If the node.ref refers to an implicit alias which is later on changed by cqn4sql,
       * we need to replace the usage of the implicit alias, with the correct, auto-generated table alias.
       *
       * This is the case if the following holds true:
       * - the original query has NO explicit alias
       * - ref[0] equals the implicit alias of the query (i.e. from.ref[ from.length - 1 ].split('.').pop())
       * - but differs from the explicit alias, assigned by cqn4sql (i.e. <subquery>.from.uniqueSubqueryAlias)
       */
      if (
        ctx.query.SELECT?.from.uniqueSubqueryAlias &&
        !ctx.query.SELECT?.from.as &&
        ctx.getImplicitAlias(firstStep) === ctx.getImplicitAlias(ctx.transformedQuery.SELECT.from.ref[0])
      ) {
        return ctx.query.SELECT?.from.uniqueSubqueryAlias
      }
      return node.ref[0]
    }
  }

  function getCombinedElementAlias(node) {
    return elementSources(ctx.query, node.ref[0].id || node.ref[0])?.[0].index
  }
}

/**
 * Transforms a subquery.
 *
 * If the current query contains outer queries (is itself a subquery),
 * it appends the current inferred query.
 * Otherwise, it initializes the `outerQueries` array and adds the inferred query.
 * The `outerQueries` property makes sure
 * that the table aliases of the outer queries are accessible within the scope of the subquery.
 * Lastly, it recursively calls cqn4sql on the subquery.
 *
 * @param {object} q - The query to be transformed. This should be a subquery object.
 * @returns {object} - The cqn4sql transformed subquery.
 */
function transformSubquery(ctx, q) {
  defineProperty(q, 'outerQueries', [...(q.outerQueries || ctx.query.outerQueries || []), ctx.query])

  // A source can itself be a SELECT. Resolve its entity target on our owned
  // query so association expands have a concrete base entity for correlation.
  const target = cds.infer.target(ctx.query, ctx.model)
  if (ctx.isLocalized(target)) q.SELECT.localized = true
  if (q.SELECT.from.ref && !q.SELECT.from.as) assignUniqueSubqueryAlias()
  if (cds.env.features.runtime_views) q._with = ctx.transformedQuery._with
  const _q = transformOwned(q, ctx.model, ctx.useTechnicalAlias, ctx.state)
  if (cds.env.features.runtime_views && _q._with) {
    ctx.transformedQuery._with = _q._with
    delete _q._with
  }
  return _q

  function assignUniqueSubqueryAlias() {
    if (q.SELECT.from.uniqueSubqueryAlias) return
    const last = q.SELECT.from.ref.at(-1)
    const uniqueSubqueryAlias = ctx.query.joinTree.addNextAvailableTableAlias(
      ctx.getImplicitAlias(last.id || last),
      ctx.query.outerQueries,
    )
    defineProperty(q.SELECT.from, 'uniqueSubqueryAlias', uniqueSubqueryAlias)
  }
}
