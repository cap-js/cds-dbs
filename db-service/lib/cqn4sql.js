'use strict'

const cds = require('@sap/cds')
cds.infer.target ??= q => q._target || q.target // instanceof cds.entity ? q._target : q.target

const infer = require('./infer')
const { computeColumnsToBeSearched } = require('./search')
const {
  prettyPrintRef,
  isCalculatedOnRead,
  isCalculatedElement,
  getImplicitAlias,
  defineProperty,
  getModelUtils,
} = require('./utils')

/**
 * For operators of <eqOps>, this is replaced by comparing all leaf elements with null, combined with and.
 * If there are at least two leaf elements and if there are tokens before or after the recognized pattern, we enclose the resulting condition in parens (...)
 */
const eqOps = [['is'], ['='] /* ['=='] */]
/**
 * For operators of <notEqOps>, do the same but use or instead of and.
 * This ensures that not struct == <value> is the same as struct != <value>.
 */
const notEqOps = [['is', 'not'], ['<>'], ['!=']]
/**
 * not supported in comparison w/ struct because of unclear semantics
 */
const notSupportedOps = [['>'], ['<'], ['>='], ['<=']]

const allOps = eqOps.concat(eqOps).concat(notEqOps).concat(notSupportedOps)

const { pseudos } = require('./infer/pseudos')
/**
 * Transforms a CDL style query into SQL-Like CQN:
 *  - transform association paths in `from` to `WHERE exists` subqueries
 *  - transforms columns into their flat representation.
 *      1. Flatten managed associations to their foreign
 *      2. Flatten structures to their leafs
 *      3. Replace join-relevant ref paths (i.e. non-fk accesses in association paths) with the correct join alias
 *  - transforms `expand` columns into special, normalized subqueries
 *  - transform `where` clause.
 *      That is the flattening of all `ref`s and the expansion of `where exists` predicates
 *  - rewrites `from` clause:
 *      Each join relevant association path traversal is translated to a join condition.
 *
 * `cqn4sql` is applied recursively to all queries found in `from`, `columns` and `where`
 *  of a query.
 *
 * @param {object} originalQuery
 * @param {object} model
 * @returns {object} transformedQuery the transformed query
 */
function cqn4sql(originalQuery, model) {
  let inferred = typeof originalQuery === 'string' ? cds.parse.cql(originalQuery) : cds.ql.clone(originalQuery)
  const hasCustomJoins =
    originalQuery.SELECT?.from.args && (!originalQuery.joinTree || originalQuery.joinTree.isInitial)

  if (!hasCustomJoins && inferred.SELECT?.search) {
    // we need an instance of query because the elements of the query are needed for the calculation of the search columns
    if (!inferred.SELECT.elements) Object.setPrototypeOf(inferred, SELECT.class.prototype)
    const searchTerm = getSearchTerm(inferred.SELECT.search, inferred)
    if (searchTerm) {
      // Search target can be a navigation, in that case use _target to get the correct entity
      const { where, having } = transformSearch(searchTerm)
      if (where) inferred.SELECT.where = where
      else if (having) inferred.SELECT.having = having
    }
  }
  // query modifiers can also be defined in from ref leaf infix filter
  // > SELECT from bookshop.Books[order by price] {ID}
  if (inferred.SELECT?.from.ref?.at(-1).id) {
    assignQueryModifiers(inferred.SELECT, inferred.SELECT.from.ref.at(-1))
  }
  inferred = infer(inferred, model)
  const { getLocalizedName, isLocalized, getDefinition } = getModelUtils(model, originalQuery) // TODO: pass model to getModelUtils
  // if the query has custom joins we don't want to transform it
  // TODO: move all the way to the top of this function once cds.infer supports joins as well
  //       we need to infer the query even if no transformation will happen because cds.infer can't calculate the target
  if (hasCustomJoins) return originalQuery

  let transformedQuery = cds.ql.clone(inferred)
  const kind = inferred.kind || Object.keys(inferred)[0]

  if (inferred.INSERT || inferred.UPSERT) {
    transformedQuery = transformQueryForInsertUpsert(kind)
  } else {
    const queryProp = inferred[kind]
    const { entity, where } = queryProp
    const from = queryProp.from

    const transformedProp = { __proto__: queryProp } // IMPORTANT: don't lose anything you might not know of
    const queryNeedsJoins = inferred.joinTree && !inferred.joinTree.isInitial

    // Transform the existing where, prepend table aliases, and so on...
    if (where) {
      transformedProp.where = getTransformedTokenStream(where)
    }

    // Transform the from clause: association path steps turn into `WHERE EXISTS` subqueries.
    // The already transformed `where` clause is then glued together with the resulting subqueries.
    const { transformedWhere, transformedFrom } = getTransformedFrom(from || entity, transformedProp.where)

    // build a subquery for DELETE / UPDATE queries with path expressions and match the primary keys
    if (queryNeedsJoins && (inferred.UPDATE || inferred.DELETE)) {
      const prop = inferred.UPDATE ? 'UPDATE' : 'DELETE'
      const subquery = {
        SELECT: {
          from: { ...(from || entity) },
          columns: [], // primary keys of the query target will be added later
          where: [...where],
        },
      }
      // The alias of the original query is now the alias for the subquery
      // so that potential references in the where clause to the alias match.
      // Hence, replace the alias of the original query with the next
      // available alias, so that each alias is unique.
      const uniqueSubqueryAlias = getNextAvailableTableAlias(transformedFrom.as)
      transformedFrom.as = uniqueSubqueryAlias

      // calculate the primary keys of the target entity, there is always exactly
      // one query source for UPDATE / DELETE
      const queryTarget = Object.values(inferred.sources)[0].definition
      const primaryKey = { list: [] }
      for (const k of Object.keys(queryTarget.elements)) {
        const e = queryTarget.elements[k]
        if (e.key === true && !e.virtual && e.isAssociation !== true) {
          subquery.SELECT.columns.push({ ref: [e.name] })
          primaryKey.list.push({ ref: [transformedFrom.as, e.name] })
        }
      }

      const transformedSubquery = cqn4sql(subquery, model)

      // replace where condition of original query with the transformed subquery
      // correlate UPDATE / DELETE query with subquery by primary key matches
      transformedQuery[prop].where = [primaryKey, 'in', transformedSubquery]

      if (prop === 'UPDATE') transformedQuery.UPDATE.entity = transformedFrom
      else transformedQuery.DELETE.from = transformedFrom

      return transformedQuery
    }

    if (inferred.SELECT) {
      transformedQuery = transformSelectQuery(queryProp, transformedFrom, transformedWhere, transformedQuery)
    } else {
      if (from) {
        transformedProp.from = transformedFrom
      } else if (!queryNeedsJoins) {
        transformedProp.entity = transformedFrom
      }

      if (transformedWhere?.length > 0) {
        transformedProp.where = transformedWhere
      }

      transformedQuery[kind] = transformedProp

      if (inferred.UPDATE?.with) {
        Object.entries(inferred.UPDATE.with).forEach(([key, val]) => {
          const transformed = getTransformedTokenStream([val])
          inferred.UPDATE.with[key] = transformed[0]
        })
      }
    }

    if (queryNeedsJoins) {
      transformedQuery[kind].from = translateAssocsToJoins(transformedQuery[kind].from)
    }
  }

  return transformedQuery

  function transformSelectQuery(queryProp, transformedFrom, transformedWhere, transformedQuery) {
    const { columns, having, groupBy, orderBy, limit } = queryProp

    // Trivial replacement -> no transformations needed
    if (limit) {
      transformedQuery.SELECT.limit = limit
    }

    transformedQuery.SELECT.from = transformedFrom

    if (transformedWhere?.length > 0) {
      transformedQuery.SELECT.where = transformedWhere
    }

    if (columns) {
      transformedQuery.SELECT.columns = getTransformedColumns(columns)
    } else {
      transformedQuery.SELECT.columns = getColumnsForWildcard(inferred.SELECT?.excluding)
    }

    // Like the WHERE clause, aliases from the SELECT list are not accessible for `group by`/`having` (in most DB's)
    if (having) {
      transformedQuery.SELECT.having = getTransformedTokenStream(having)
    }

    if (groupBy) {
      const transformedGroupBy = getTransformedOrderByGroupBy(groupBy)
      if (transformedGroupBy.length) {
        transformedQuery.SELECT.groupBy = transformedGroupBy
      }
    }

    // Since all the expressions in the SELECT part of the query have been computed,
    // one can reference aliases of the queries columns in the orderBy clause.
    if (orderBy) {
      const transformedOrderBy = getTransformedOrderByGroupBy(orderBy, true)
      if (transformedOrderBy.length) {
        transformedQuery.SELECT.orderBy = transformedOrderBy
      }
    }
    return transformedQuery
  }

  /**
   * Transforms a query object for INSERT or UPSERT operations by modifying the `into` clause.
   *
   * @param {string} kind - The type of operation: "INSERT" or "UPSERT".
   *
   * @returns {object} - The transformed query with updated `into` clause.
   */
  function transformQueryForInsertUpsert(kind) {
    const { as } = transformedQuery[kind].into
    const target = cds.infer.target(inferred) // REVISIT: we should reliably use inferred._target instead
    transformedQuery[kind].into = { ref: [target.name] }
    if (as) transformedQuery[kind].into.as = as
    return transformedQuery
  }

  /**
   * Transforms a search expression into a WHERE or HAVING clause for a SELECT operation, depending on the context of the query.
   * The function decides whether to use a WHERE or HAVING clause based on the presence of aggregated columns in the search criteria.
   *
   * @param {object} searchTerm - The search expression to be applied to the searchable columns within the query source.
   * @param {object} from - The FROM clause of the CQN statement.
   *
   * @returns {Object} - The function returns an object representing the WHERE or HAVING clause of the query.
   *
   * Note: The WHERE clause is used for filtering individual rows before any aggregation occurs.
   * The HAVING clause is utilized for conditions on aggregated data, applied after grouping operations.
   */
  function transformSearch(searchTerm) {
    let prop = 'where'

    // if the query is grouped and the queries columns contain an aggregate function,
    // we must put the search term into the `having` clause, as the search expression
    // is defined on the aggregated result, not on the individual rows
    const usesAggregation =
      inferred.SELECT.groupBy &&
      (searchTerm.args[0].func || searchTerm.args[0].xpr || searchTerm.args[0].list?.some(c => c.func || c.xpr))

    if (usesAggregation) prop = 'having'
    if (inferred.SELECT[prop]) {
      return { [prop]: [asXpr(inferred.SELECT.where), 'and', searchTerm] }
    } else {
      return { [prop]: [searchTerm] }
    }
  }

  /**
   * Rewrites the from clause based on the `query.joinTree`.
   *
   * For each join relevant node in the join tree, the respective join is generated.
   * Each join relevant node in the join tree has an unique table alias which is the query source for the respective
   * path traversals. Hence, all join relevant `ref`s must be rewritten to point to the generated join aliases. However,
   * this is done in the @function getFlatColumnsFor().
   *
   * @returns {CQN.from}
   */
  function translateAssocsToJoins() {
    let from
    /**
     * remember already seen aliases, do not create a join for them again
     */
    const alreadySeen = new Map()
    inferred.joinTree._roots.forEach(r => {
      const args = []
      if (r.queryArtifact.SELECT) args.push({ SELECT: transformSubquery(r.queryArtifact).SELECT, as: r.alias })
      else {
        const id = getLocalizedName(r.queryArtifact)
        args.push({ ref: [r.args ? { id, args: r.args } : id], as: r.alias })
      }
      from = { join: r.join || 'left', args, on: [] }
      r.children.forEach(c => {
        from = joinForBranch(from, c)
        from = { join: c.join || 'left', args: [from], on: [] }
      })
    })
    return from.args.length > 1 ? from : from.args[0]

    function joinForBranch(lhs, node) {
      const nextAssoc = inferred.joinTree.findNextAssoc(node)
      if (!nextAssoc || alreadySeen.has(nextAssoc.$refLink.alias)) return lhs.args.length > 1 ? lhs : lhs.args[0]

      lhs.on.push(
        ...onCondFor(
          nextAssoc.$refLink,
          node.parent.$refLink || /** tree roots do not have $refLink */ {
            alias: node.parent.alias,
            definition: node.parent.queryArtifact,
            target: node.parent.queryArtifact,
          },
          /** flip source and target in on condition */ true,
        ),
      )

      const id = getDefinition(nextAssoc.$refLink.definition.target).name
      const { args } = nextAssoc
      const arg = {
        ref: [args ? { id, args } : id],
        as: nextAssoc.$refLink.alias,
      }

      lhs.args.push(arg)
      alreadySeen.set(nextAssoc.$refLink.alias, true)
      if (nextAssoc.where) {
        const filter = getTransformedTokenStream(nextAssoc.where, nextAssoc.$refLink)
        lhs.on = [
          ...(hasLogicalOr(lhs.on) ? [asXpr(lhs.on)] : lhs.on),
          'and',
          ...(hasLogicalOr(filter) ? [asXpr(filter)] : filter),
        ]
      }
      if (node.children) {
        node.children.forEach(c => {
          lhs = { join: c.join || 'left', args: [lhs], on: [] }
          lhs = joinForBranch(lhs, c)
        })
      }
      return lhs.args.length > 1 ? lhs : lhs.args[0]
    }
  }

  /**
   * Walks over a list of columns (ref's, xpr, subqueries, val), applies flattening on structured types and expands wildcards.
   *
   * @param {object[]} columns
   * @returns {object[]} the transformed representation of the input. Expanded and flattened.
   */
  function getTransformedColumns(columns) {
    const transformedColumns = []
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]

      if (isCalculatedOnRead(col.$refLinks?.[col.$refLinks.length - 1].definition)) {
        const name = getName(col)
        if (!transformedColumns.some(inserted => getName(inserted) === name)) {
          const calcElement = resolveCalculatedElement(col)
          transformedColumns.push(calcElement)
        }
      } else if (col.expand) {
        if (col.ref?.length > 1 && col.ref[0] === '$self' && !col.$refLinks[0].definition.kind) {
          const dollarSelfReplacement = calculateDollarSelfColumn(col)
          transformedColumns.push(...getTransformedColumns([dollarSelfReplacement]))
          continue
        }
        transformedColumns.push(() => {
          const expandResult = handleExpand(col)
          if (expandResult.length > 1) {
            return expandResult
          } else {
            return expandResult[0]
          }
        })
      } else if (col.inline) {
        handleInline(col)
      } else if (col.ref) {
        if (col.ref.length > 1 && col.ref[0] === '$self' && !col.$refLinks[0].definition.kind) {
          const dollarSelfReplacement = calculateDollarSelfColumn(col)
          transformedColumns.push(...getTransformedColumns([dollarSelfReplacement]))
          continue
        }
        handleRef(col)
      } else if (col === '*') {
        handleWildcard(columns)
      } else if (col.SELECT) {
        handleSubquery(col)
      } else {
        handleDefault(col)
      }
    }
    // subqueries are processed in the end
    for (let i = 0; i < transformedColumns.length; i++) {
      const c = transformedColumns[i]
      if (typeof c === 'function') {
        const res = c() || [] // target of expand / subquery could also be skipped -> no result
        if (res.length !== undefined) {
          transformedColumns.splice(i, 1, ...res)
          i += res.length - 1
        } else {
          const replaceWith = res.as
            ? transformedColumns.findIndex(t => (t.as || t.ref?.[t.ref.length - 1]) === res.as)
            : -1
          if (replaceWith === -1) transformedColumns.splice(i, 1, res)
          else {
            transformedColumns.splice(replaceWith, 1, res)
            transformedColumns.splice(i, 1)
            // When removing an element, the next element moves to the current index
            i--
          }
        }
      }
    }

    if (transformedColumns.length === 0 && columns.length) {
      handleEmptyColumns(columns)
    }

    return transformedColumns

    function handleSubquery(col) {
      transformedColumns.push(() => {
        const res = transformSubquery(col)
        if (col.as) res.as = col.as
        return res
      })
    }

    function handleExpand(col) {
      const { $refLinks } = col
      const res = []
      const last = $refLinks?.[$refLinks.length - 1]
      if (last && !last.skipExpand && last.definition.isAssociation) {
        const expandedSubqueryColumn = expandColumn(col)
        if (!expandedSubqueryColumn) return []
        setElementOnColumns(expandedSubqueryColumn, col.element)
        res.push(expandedSubqueryColumn)
      } else if (!last?.skipExpand) {
        const expandCols = nestedProjectionOnStructure(col, 'expand')
        res.push(...expandCols)
      }
      return res
    }

    function handleInline(col) {
      const inlineCols = nestedProjectionOnStructure(col)
      transformedColumns.push(...inlineCols)
    }

    function handleRef(col) {
      if (pseudos.elements[col.ref[0]] || col.param) {
        transformedColumns.push({ ...col })
        return
      }

      const tableAlias = getTableAlias(col)
      // re-adjust usage of implicit alias in subquery
      if (col.$refLinks[0].definition.kind === 'entity' && col.ref[0] !== tableAlias) {
        col.ref[0] = tableAlias
      }
      const leaf = col.$refLinks[col.$refLinks.length - 1].definition
      if (leaf.virtual === true) return

      let baseName
      if (col.ref.length >= 2) {
        baseName = col.ref
          .map(idOnly)
          .slice(col.ref[0] === tableAlias ? 1 : 0, col.ref.length - 1)
          .join('_')
      }

      let columnAlias = col.as || (col.isJoinRelevant ? col.flatName : null)
      const refNavigation = col.ref.slice(col.$refLinks[0].definition.kind !== 'element' ? 1 : 0).join('_')
      if (!columnAlias && col.flatName && col.flatName !== refNavigation) columnAlias = refNavigation

      if (col.$refLinks.some(link => getDefinition(link.definition.target)?.['@cds.persistence.skip'] === true)) return

      const flatColumns = getFlatColumnsFor(col, { baseName, columnAlias, tableAlias })
      flatColumns.forEach(flatColumn => {
        const name = getName(flatColumn)
        if (!transformedColumns.some(inserted => getName(inserted) === name)) transformedColumns.push(flatColumn)
      })
    }

    function handleWildcard(columns) {
      const wildcardIndex = columns.indexOf('*')
      const ignoreInWildcardExpansion = columns.slice(0, wildcardIndex)
      const { excluding } = inferred.SELECT
      if (excluding) ignoreInWildcardExpansion.push(...excluding)

      const wildcardColumns = getColumnsForWildcard(ignoreInWildcardExpansion, columns.slice(wildcardIndex + 1))
      transformedColumns.push(...wildcardColumns)
    }

    function handleDefault(col) {
      let transformedColumn = getTransformedColumn(col)
      if (col.as) transformedColumn.as = col.as

      const replaceWith = transformedColumns.findIndex(
        t => (t.as || t.ref?.[t.ref.length - 1]) === transformedColumn.as,
      )
      if (replaceWith === -1) transformedColumns.push(transformedColumn)
      else transformedColumns.splice(replaceWith, 1, transformedColumn)

      setElementOnColumns(transformedColumn, inferred.elements[col.as])
    }

    function getTransformedColumn(col) {
      let ret
      if (col.func) {
        ret = {
          func: col.func,
          args: getTransformedFunctionArgs(col.args),
          as: col.func, // may be overwritten by the explicit alias
        }
      }
      if (col.xpr) {
        ret ??= {}
        ret.xpr = getTransformedTokenStream(col.xpr)
      }
      if (ret) {
        if (col.cast) ret.cast = col.cast
        return ret
      }
      return copy(col)
    }

    function handleEmptyColumns(columns) {
      if (columns.some(c => c.$refLinks?.[c.$refLinks.length - 1].definition.type === 'cds.Composition')) return
      throw new Error('Queries must have at least one non-virtual column')
    }
  }

  function resolveCalculatedElement(column, omitAlias = false, baseLink = null) {
    let value

    if (column.$refLinks) {
      const { $refLinks } = column
      value = $refLinks[$refLinks.length - 1].definition.value
      if (column.$refLinks.length > 1) {
        baseLink =
          [...$refLinks].reverse().find($refLink => $refLink.definition.isAssociation) ||
          // if there is no association in the path, the table alias is the base link
          // TA might refer to subquery -> we need to propagate the alias to all paths of the calc element
          column.$refLinks[0]
      }
    } else {
      value = column.value
    }
    const { ref, val, xpr, func } = value

    let res
    if (ref) {
      res = getTransformedTokenStream([value], baseLink)[0]
    } else if (xpr) {
      res = { xpr: getTransformedTokenStream(value.xpr, baseLink) }
    } else if (val !== undefined) {
      res = { val }
    } else if (func) {
      res = { args: getTransformedFunctionArgs(value.args, baseLink), func: value.func }
    }
    if (!omitAlias) res.as = column.as || column.name || column.flatName
    return res
  }

  /**
   * This function resolves a `ref` starting with a `$self`.
   * Such a path targets another element of the query by it's implicit, or explicit alias.
   *
   * A `$self` reference may also target another `$self` path. In this case, this function
   * recursively resolves the tail of the `$self` references (`$selfPath.ref.slice(2)`) onto it's
   * new base.
   *
   * @param {object} col with a ref like `[ '$self', <target column>, <optional further path navigation> ]`
   * @param {boolean} omitAlias if we replace a $self reference in an aggregation or a token stream, we must not add an "as" to the result
   */
  function calculateDollarSelfColumn(col, omitAlias = false) {
    const dummyColumn = buildDummyColumnForDollarSelf({ ...col }, col.$refLinks)

    return dummyColumn

    function buildDummyColumnForDollarSelf(dollarSelfColumn, $refLinks) {
      const { ref, as } = dollarSelfColumn
      const stepToFind = ref[1]
      let referencedColumn = inferred.SELECT.columns.find(
        otherColumn =>
          otherColumn !== dollarSelfColumn &&
          (otherColumn.as
            ? stepToFind === otherColumn.as
            : stepToFind === otherColumn.ref?.[otherColumn.ref.length - 1]),
      )
      if (referencedColumn.ref?.[0] === '$self') {
        referencedColumn = buildDummyColumnForDollarSelf({ ...referencedColumn }, referencedColumn.$refLinks)
      }

      if (referencedColumn.ref) {
        dollarSelfColumn.ref = [...referencedColumn.ref, ...dollarSelfColumn.ref.slice(2)]
        Object.defineProperties(dollarSelfColumn, {
          flatName: {
            value:
              referencedColumn.$refLinks[0].definition.kind === 'entity'
                ? dollarSelfColumn.ref.slice(1).join('_')
                : dollarSelfColumn.ref.join('_'),
          },
          isJoinRelevant: {
            value: referencedColumn.isJoinRelevant,
          },
          $refLinks: {
            value: [...referencedColumn.$refLinks, ...$refLinks.slice(2)],
          },
        })
      } else {
        // target column is `val` or `xpr`, destructure and throw away the ref with the $self
        // eslint-disable-next-line no-unused-vars
        const { xpr, val, ref, as: _as, ...rest } = referencedColumn
        if (xpr) rest.xpr = xpr
        else rest.val = val
        dollarSelfColumn = { ...rest } // reassign dummyColumn without 'ref'
        if (!omitAlias) dollarSelfColumn.as = as
      }
      return dollarSelfColumn.ref?.[0] === '$self'
        ? buildDummyColumnForDollarSelf({ ...dollarSelfColumn }, $refLinks)
        : dollarSelfColumn
    }
  }

  /**
   * Calculates the columns for a nested projection on a structure.
   *
   * @param {object} col
   * @param {'inline'|'expand'} prop the property on which to operate. Default is `inline`.
   * @returns a list of flat columns.
   */
  function nestedProjectionOnStructure(col, prop = 'inline') {
    const res = []

    col[prop].forEach((nestedProjection, i) => {
      let rewrittenColumns = []
      if (nestedProjection === '*') {
        res.push(...expandNestedProjectionWildcard(col, i, prop))
      } else {
        const nameParts = col.as ? [col.as] : [col.ref.map(idOnly).join('_')]
        nameParts.push(nestedProjection.as ? nestedProjection.as : nestedProjection.ref.map(idOnly).join('_'))
        const name = nameParts.join('_')
        if (nestedProjection.ref) {
          const augmentedInlineCol = { ...nestedProjection }
          augmentedInlineCol.ref = col.ref ? [...col.ref, ...nestedProjection.ref] : nestedProjection.ref
          if (
            col.as ||
            nestedProjection.as ||
            nestedProjection.$refLinks[nestedProjection.$refLinks.length - 1].definition.value ||
            nestedProjection.isJoinRelevant
          ) {
            augmentedInlineCol.as = nameParts.join('_')
          }
          Object.defineProperties(augmentedInlineCol, {
            $refLinks: { value: [...nestedProjection.$refLinks], writable: true },
            isJoinRelevant: {
              value: nestedProjection.isJoinRelevant,
              writable: true,
            },
          })
          // if the expand is not anonymous, we must prepend the expand columns path
          // to make sure the full path is resolvable
          if (col.ref) {
            augmentedInlineCol.$refLinks.unshift(...col.$refLinks)
            augmentedInlineCol.isJoinRelevant = augmentedInlineCol.isJoinRelevant || col.isJoinRelevant
          }
          const flatColumns = getTransformedColumns([augmentedInlineCol])
          flatColumns.forEach(flatColumn => {
            const flatColumnName = flatColumn.as || flatColumn.ref[flatColumn.ref.length - 1]
            if (!res.some(c => (c.as || c.ref.slice(1).map(idOnly).join('_')) === flatColumnName)) {
              const rewrittenColumn = { ...flatColumn }
              if (nestedProjection.as) rewrittenColumn.as = flatColumnName
              rewrittenColumns.push(rewrittenColumn)
            }
          })
        } else {
          // func, xpr, val..
          // we need to check if the column was already added
          // in the wildcard expansion
          if (!res.some(c => (c.as || c.ref.slice(1).map(idOnly).join('_')) === name)) {
            const rewrittenColumn = { ...nestedProjection }
            rewrittenColumn.as = name
            rewrittenColumns.push(rewrittenColumn)
          }
        }
      }
      res.push(...rewrittenColumns)
    })

    return res
  }

  /**
   * Expand the wildcard of the given column into all leaf elements.
   * Respect smart wildcard rules and excluding clause.
   *
   * Every column before the wildcardIndex is excluded from the wildcard expansion.
   * Columns after the wildcardIndex overwrite columns within the wildcard expansion in place.
   *
   * @TODO use this also for `expand` wildcards on structures.
   *
   * @param {csn.Column} col
   * @param {integer} wildcardIndex
   * @returns an array of columns which represents the expanded wildcard
   */
  function expandNestedProjectionWildcard(col, wildcardIndex, prop = 'inline') {
    const res = []
    // everything before the wildcard is inserted before the wildcard
    // and ignored from the wildcard expansion
    const exclude = col[prop].slice(0, wildcardIndex)
    // everything after the wildcard, is a potential replacement
    // in the wildcard expansion
    const replace = []

    const baseRef = col.ref || []
    const baseRefLinks = col.$refLinks || []

    // column has no ref, then it is an anonymous expand:
    // select from books { { * } as bar }
    // only possible if there is exactly one query source
    if (!baseRef.length) {
      const [tableAlias, { definition }] = Object.entries(inferred.sources)[0]
      baseRef.push(tableAlias)
      baseRefLinks.push({ definition, source: definition })
    }
    // we need to make the refs absolute
    col[prop].slice(wildcardIndex + 1).forEach(c => {
      const fakeColumn = { ...c }
      if (fakeColumn.ref) {
        fakeColumn.ref = [...baseRef, ...fakeColumn.ref]
        fakeColumn.$refLinks = [...baseRefLinks, ...c.$refLinks]
      }
      replace.push(fakeColumn)
    })
    // respect excluding clause
    if (col.excluding) {
      // fake the ref since excluding only has strings
      col.excluding.forEach(c => {
        const fakeColumn = {
          ref: [...baseRef, c],
        }
        exclude.push(fakeColumn)
      })
    }

    if (baseRefLinks.at(-1).definition.kind === 'entity') {
      res.push(...getColumnsForWildcard(exclude, replace, col.as))
    } else
      res.push(
        ...getFlatColumnsFor(col, { columnAlias: col.as, tableAlias: getTableAlias(col) }, [], {
          exclude,
          replace,
        }),
      )
    return res
  }

  /**
   * This function converts a column with an `expand` property into a subquery.
   *
   * It operates by using the following steps:
   *
   * 1. It creates an intermediate SQL query, selecting `from <effective query source>:...<column>.ref { ...<column>.expand }`.
   *    For example, from the query `SELECT from Authors { books { title } }`, it generates:
   *    - `SELECT from Authors:books as books {title}`
   *
   * 2. It then adds the properties `expand: true` and `one: <expand assoc>.is2one` to the intermediate SQL query.
   *
   * 3. It applies `cqn4sql` to the intermediate query (ensuring the aliases of the outer query are maintained).
   *    For example, `cqn4sql(…)` is used to create the following query:
   *    - `SELECT from Books as books {books.title} where exists ( SELECT 1 from Authors as Authors where Authors.ID = books.author_ID )`
   *
   * 4. It then replaces the `exists <subquery>` with the where condition of the `<subquery>` and correlates it with the effective query source.
   *    For example, this query is created:
   *    - `SELECT from Books as books { books.title } where Authors.ID = books.author_ID`
   *
   * 5. Lastly, it replaces the `expand` column of the original query with the transformed subquery.
   *    For example, the query becomes:
   *    - `SELECT from Authors { (SELECT from Books as books { books.title } where Authors.ID = books.author_ID) as books }`
   *
   * @param {CSN.column} column - The column with the 'expand' property to be transformed into a subquery.
   *
   * @returns {object} Returns a subquery correlated with the enclosing query, with added properties `expand:true` and `one:true|false`.
   */
  function expandColumn(column) {
    let outerAlias
    let subqueryFromRef
    const ref = column.$refLinks[0].definition.kind === 'entity' ? column.ref.slice(1) : column.ref
    const assoc = column.$refLinks.at(-1)
    ensureValidForeignKeys(assoc.definition, column.ref, 'expand')
    if (column.isJoinRelevant) {
      // all n-1 steps of the expand column are already transformed into joins
      // find the last join relevant association. That is the n-1 assoc in the ref path.
      // slice the ref array beginning from the n-1 assoc in the ref and take that as the postfix for the subqueries from ref.
      ;[...column.$refLinks]
        .reverse()
        .slice(1)
        .find((link, i) => {
          if (link.definition.isAssociation) {
            subqueryFromRef = [link.definition.target, ...column.ref.slice(-(i + 1), column.ref.length)]
            // alias of last join relevant association is also the correlation alias for the subquery
            outerAlias = link.alias
            return true
          }
        })
    } else {
      outerAlias = transformedQuery.SELECT.from.as
      subqueryFromRef = [transformedQuery._target.name, ...ref]
    }

    // this is the alias of the column which holds the correlated subquery
    const columnAlias = column.as || ref.map(idOnly).join('_')

    // if there is a group by on the main query, all
    // columns of the expand must be in the groupBy
    if (transformedQuery.SELECT.groupBy) {
      const baseRef = column.$refLinks[0].definition.SELECT || ref

      return _subqueryForGroupBy(column, baseRef, columnAlias)
    }

    // Alias in expand subquery is derived from but not equal to
    // the alias of the column because to account for potential ambiguities
    // the alias cannot be addressed anyways
    const uniqueSubqueryAlias = getNextAvailableTableAlias(getImplicitAlias(columnAlias), inferred.outerQueries)

    // `SELECT from Authors {  books.genre as genreOfBooks { name } } becomes `SELECT from Books:genre as genreOfBooks`
    const from = { ref: subqueryFromRef, as: uniqueSubqueryAlias }
    const subqueryBase = {}
    const queryModifiers = { ...column }
    for (const [key, value] of Object.entries(queryModifiers)) {
      if (key in { limit: 1, orderBy: 1, groupBy: 1, excluding: 1, where: 1, having: 1, count: 1 })
        subqueryBase[key] = value
    }

    const subquery = {
      SELECT: {
        ...subqueryBase,
        from,
        columns: JSON.parse(JSON.stringify(column.expand)),
        expand: true,
        one: column.$refLinks.at(-1).definition.is2one,
      },
    }
    const expanded = transformSubquery(subquery)
    const correlated = _correlate({ ...expanded, as: columnAlias }, outerAlias)
    defineProperty(correlated, 'elements', expanded.elements)
    return correlated

    function _correlate(subq, outer) {
      const subqueryFollowingExists = (a, indexOfExists) => a[indexOfExists + 1]
      let {
        SELECT: { where },
      } = subq
      let recent = where
      let i = where.indexOf('exists')
      while (i !== -1) {
        where = subqueryFollowingExists((recent = where), i).SELECT.where
        i = where.indexOf('exists')
      }
      const existsIndex = recent.indexOf('exists')
      recent.splice(
        existsIndex,
        2,
        ...where.map(x => {
          return replaceAliasWithSubqueryAlias(x)
        }),
      )

      function replaceAliasWithSubqueryAlias(x) {
        const existsSubqueryAlias = recent[existsIndex + 1].SELECT.from.as
        if (existsSubqueryAlias === x.ref?.[0]) return { ref: [outer, ...x.ref.slice(1)] }
        if (x.xpr) x.xpr = x.xpr.map(replaceAliasWithSubqueryAlias)
        if (x.args) x.args = x.args.map(replaceAliasWithSubqueryAlias)
        return x
      }
      return subq
    }

    /**
     * Generates a special subquery for the `expand` of the `column`.
     * All columns in the `expand` must be part of the GROUP BY clause of the main query.
     * If this is the case, the subqueries columns match the corresponding references of the group by.
     * Nested expands are also supported.
     *
     * @param {Object} column - To expand.
     * @param {Array} baseRef - The base reference for the expanded column.
     * @param {string} subqueryAlias - The alias of the `expand` subquery column.
     * @returns {Object} - The subquery object or null if the expand has a wildcard.
     * @throws {Error} - If one of the `ref`s in the `column.expand` is not part of the GROUP BY clause.
     */
    function _subqueryForGroupBy(column, baseRef, subqueryAlias) {
      const groupByLookup = new Map(
        transformedQuery.SELECT.groupBy.map(c => [c.ref && c.ref.map(refWithConditions).join('.'), c]),
      )

      // to be attached to dummy query
      const elements = {}
      const containsWildcard = column.expand.includes('*')
      if (containsWildcard) {
        // expand with wildcard vanishes as expand is part of the group by (OData $apply + $expand)
        return null
      }
      const expandedColumns = column.expand
        .flatMap(expand => {
          if (!expand.ref) return expand
          const fullRef = [...baseRef, ...expand.ref]

          if (expand.expand) {
            const nested = _subqueryForGroupBy(expand, fullRef, expand.as || expand.ref.map(idOnly).join('_'))
            if (nested) {
              setElementOnColumns(nested, expand.element)
              elements[expand.as || expand.ref.map(idOnly).join('_')] = nested
            }
            return nested
          }

          const groupByRef = groupByLookup.get(fullRef.map(refWithConditions).join('.'))
          if (!groupByRef) {
            throw new Error(
              `The expanded column "${fullRef.map(refWithConditions).join('.')}" must be part of the group by clause`,
            )
          }

          const copy = Object.create(groupByRef)
          // always alias for this special case, so that they nested element names match the expected result structure
          // otherwise we'd get `author { <outer>.author_ID }`, but we need `author { <outer>.author_ID as ID }`
          copy.as = expand.as || expand.ref.at(-1)
          const tableAlias = getTableAlias(copy)
          const res = getFlatColumnsFor(copy, { tableAlias })
          res.forEach(c => {
            elements[c.as || c.ref.at(-1)] = c.element
          })
          return res
        })
        .filter(c => c)

      if (expandedColumns.length === 0) {
        return null
      }

      const SELECT = {
        from: null,
        columns: expandedColumns,
      }
      return Object.defineProperties(
        {},
        {
          SELECT: {
            value: Object.defineProperties(SELECT, {
              expand: { value: true, writable: true }, // non-enumerable
              one: { value: column.$refLinks.at(-1).definition.is2one, writable: true }, // non-enumerable
            }),
            enumerable: true,
          },
          as: { value: subqueryAlias, enumerable: true, writable: true },
          elements: { value: elements }, // non-enumerable
        },
      )
    }
  }

  function getTransformedOrderByGroupBy(columns, inOrderBy = false) {
    const res = []
    for (let i = 0; i < columns.length; i++) {
      let col = columns[i]
      if (isCalculatedOnRead(col.$refLinks?.[col.$refLinks.length - 1].definition)) {
        const calcElement = resolveCalculatedElement(col, true)
        res.push(calcElement)
      } else if (pseudos.elements[col.ref?.[0]]) {
        res.push({ ...col })
      } else if (col.ref) {
        if (col.$refLinks.some(link => getDefinition(link.definition.target)?.['@cds.persistence.skip'] === true))
          continue
        if (col.ref.length > 1 && col.ref[0] === '$self' && !col.$refLinks[0].definition.kind) {
          const dollarSelfReplacement = calculateDollarSelfColumn(col)
          res.push(...getTransformedOrderByGroupBy([dollarSelfReplacement], inOrderBy))
          continue
        }
        const { target, definition } = col.$refLinks[0]
        let tableAlias = null
        if (target.SELECT?.columns && inOrderBy) {
          // usually TA is omitted if order by ref is a column
          // if a localized sorting is requested, we add `COLLATE`s
          // later on, which transforms the simple name to an expression
          // --> in an expression, only source elements can be addressed, hence we must add TA
          if (target.SELECT.localized && definition.type === 'cds.String') {
            const referredCol = target.SELECT.columns.find(c => {
              return c.as === col.ref[0] || c.ref?.at(-1) === col.ref[0]
            })
            if (referredCol) {
              // keep sort and nulls properties
              referredCol.sort = col.sort
              referredCol.nulls = col.nulls
              col = referredCol
              if (definition.kind === 'element') {
                tableAlias = getTableAlias(col)
              } else {
                // we must replace the reference with the underlying expression
                const { val, func, args, xpr } = col
                if (val) res.push({ val })
                if (func) res.push({ func, args })
                if (xpr) res.push({ xpr })
                continue
              }
            }
          }
        } else {
          tableAlias = getTableAlias(col) // do not prepend TA if orderBy column addresses element of query
        }
        const leaf = col.$refLinks[col.$refLinks.length - 1].definition
        if (leaf.virtual === true) continue // already in getFlatColumnForElement
        let baseName
        if (col.ref.length >= 2) {
          // leaf might be intermediate structure
          baseName = col.ref
            .map(idOnly)
            .slice(col.ref[0] === tableAlias ? 1 : 0, col.ref.length - 1)
            .join('_')
        }
        const flatColumns = getFlatColumnsFor(col, { baseName, tableAlias })
        /**
         * We can't guarantee that the element order will NOT change in the future.
         * We claim that the element order doesn't matter, hence we can't allow elements
         * in the order by clause which expand to more than one column, as the order impacts
         * the result.
         */
        if (inOrderBy && flatColumns.length > 1)
          throw new Error(`"${getFullName(leaf)}" can't be used in order by as it expands to multiple fields`)
        flatColumns.forEach(fc => {
          if (col.nulls) fc.nulls = col.nulls
          if (col.sort) fc.sort = col.sort
          if (fc.as) delete fc.as
        })
        res.push(...flatColumns)
      } else {
        let transformedColumn
        if (col.SELECT) transformedColumn = transformSubquery(col)
        else if (col.xpr) transformedColumn = { xpr: getTransformedTokenStream(col.xpr) }
        else if (col.func) transformedColumn = { args: getTransformedFunctionArgs(col.args), func: col.func }
        // val
        else transformedColumn = copy(col)
        if (col.sort) transformedColumn.sort = col.sort
        if (col.nulls) transformedColumn.nulls = col.nulls
        res.push(transformedColumn)
      }
    }
    return res
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
  function transformSubquery(q) {
    if (q.outerQueries) q.outerQueries.push(inferred)
    else {
      const outerQueries = inferred.outerQueries || []
      outerQueries.push(inferred)
      defineProperty(q, 'outerQueries', outerQueries)
    }
    const target = cds.infer.target(inferred) // REVISIT: we should reliably use inferred._target instead
    if (isLocalized(target)) q.SELECT.localized = true
    if (q.SELECT.from.ref && !q.SELECT.from.as) assignUniqueSubqueryAlias()
    return cqn4sql(q, model)

    function assignUniqueSubqueryAlias() {
      if (q.SELECT.from.uniqueSubqueryAlias) return
      const last = q.SELECT.from.ref.at(-1)
      const uniqueSubqueryAlias = inferred.joinTree.addNextAvailableTableAlias(
        getImplicitAlias(last.id || last),
        inferred.outerQueries,
      )
      defineProperty(q.SELECT.from, 'uniqueSubqueryAlias', uniqueSubqueryAlias)
    }
  }

  /**
   * This function converts a wildcard into explicit columns.
   *
   * Based on the query's `$combinedElements` attribute, the function computes the flat column representations
   * and returns them. Additionally, it prepends the respective table alias to each column. Columns specified
   * in the `excluding` clause are ignored during this transformation.
   *
   * Furthermore, foreign keys (FK) for OData CSN and blobs are excluded from the wildcard expansion.
   *
   * @param {array} exclude - An optional list of columns to be excluded during the wildcard expansion.
   * @param {array} replace - An optional list of columns to replace during the wildcard expansion.
   * @param {string} baseName - the explicit alias of the column.
   * Only possible for anonymous expands on implicit table alias: `select from books { { * } as FOO }`
   *
   * @returns {Array} Returns an array of explicit columns derived from the wildcard.
   */
  function getColumnsForWildcard(exclude = [], replace = [], baseName = null) {
    const wildcardColumns = []
    for (const k of Object.keys(inferred.$combinedElements)) {
      if (!exclude.includes(k)) {
        const { index, tableAlias } = inferred.$combinedElements[k][0]
        const element = tableAlias.elements[k]
        // ignore FK for odata csn / ignore blobs from wildcard expansion
        if (isManagedAssocInFlatMode(element) || element.type === 'cds.LargeBinary') continue
        // for wildcard on subquery in from, just reference the elements
        if (tableAlias.SELECT && !element.elements && !element.target) {
          wildcardColumns.push(index ? { ref: [index, k] } : { ref: [k] })
        } else if (isCalculatedOnRead(element)) {
          wildcardColumns.push(resolveCalculatedElement(replace.find(r => r.as === k) || element))
        } else {
          const flatColumns = getFlatColumnsFor(
            element,
            { tableAlias: index, baseName },
            [],
            { exclude, replace },
            true,
          )
          wildcardColumns.push(...flatColumns)
        }
      }
    }
    return wildcardColumns

    /**
     * foreign keys are already part of the elements in a flat model
     * not excluding the associations from the wildcard columns would cause duplicate columns upon foreign key expansion
     * @param {CSN.element} e
     * @returns {boolean} true if the element is a managed association and the model is flat
     */
    function isManagedAssocInFlatMode(e) {
      return (
        e.isAssociation && e.keys && (model.meta.transformation === 'odata' || model.meta.unfolded?.includes('structs'))
      )
    }
  }

  /**
   * Resolve `ref` within `def` and return the element
   *
   * @param {string[]} ref
   * @param {CSN.Artifact} def
   * @returns {CSN.Element}
   */
  function getElementForRef(ref, def) {
    return ref.reduce((prev, res) => {
      return (prev?.elements || prev?.foreignKeys)?.[res] || getDefinition(prev?.target)?.elements[res] // PLEASE REVIEW: should we add the .foreignKey check here for the non-ucsn case?
    }, def)
  }

  /**
   * Recursively expands a structured element into flat columns, representing all leaf paths.
   * This function transforms complex structured elements into simple column representations.
   *
   * For each element, the function checks if it's a structure, an association or a scalar,
   * and proceeds accordingly. If the element is a structure, it recursively fetches flat columns for all sub-elements.
   * If it's an association, it fetches flat columns for it's foreign keys.
   * If it's a scalar, it creates a flat column for it.
   *
   * Columns excluded in a wildcard expansion or replaced by other columns are also handled accordingly.
   *
   * @param {object} column - The structured element which needs to be expanded.
   * @param {{
   *  columnAlias: string
   *  tableAlias: string
   *  baseName: string
   * }} names - configuration object for naming parameters:
   * columnAlias - The explicit alias which the user has defined for the column.
   *                               For instance `{ struct.foo as bar}` will be transformed into
   *                               `{ struct_foo_leaf1 as bar_foo_leaf1, struct_foo_leaf2 as bar_foo_leaf2 }`.
   * tableAlias - The table alias to prepend to the column name. Optional.
   * baseName - The prefixes of the column reference (joined with '_'). Optional.
   * @param {string} columnAlias - The explicit alias which the user has defined for the column.
   *                               For instance `{ struct.foo as bar}` will be transformed into
   *                               `{ struct_foo_leaf1 as bar_foo_leaf1, struct_foo_leaf2 as bar_foo_leaf2 }`.
   * @param {string} tableAlias - The table alias to prepend to the column name. Optional.
   * @param {Array} csnPath - An array containing CSN paths. Optional.
   * @param {Array} exclude - An array of columns to be excluded from the flat structure. Optional.
   * @param {Array} replace - An array of columns to be replaced in the flat structure. Optional.
   *
   * @returns {object[]} Returns an array of flat column(s) for the given element.
   */
  function getFlatColumnsFor(column, names, csnPath = [], excludeAndReplace, isWildcard = false) {
    if (!column) return column
    if (column.val || column.func || column.SELECT) return [column]

    const structsAreUnfoldedAlready = model.meta.unfolded?.includes('structs')
    let { baseName, columnAlias = column.as, tableAlias } = names
    const { exclude, replace } = excludeAndReplace || {}
    const { $refLinks, flatName, isJoinRelevant } = column
    let firstNonJoinRelevantAssoc, stepAfterAssoc
    let element = $refLinks ? $refLinks[$refLinks.length - 1].definition : column
    if (isWildcard && element.type === 'cds.LargeBinary') return []
    if (element.on && !element.keys)
      return [] // unmanaged doesn't make it into columns
    else if (element.virtual === true) return []
    else if (!isJoinRelevant && flatName) baseName = flatName
    else if (isJoinRelevant) {
      const leafAssocIndex = column.$refLinks.findIndex(link => link.definition.isAssociation && link.onlyForeignKeyAccess)
      firstNonJoinRelevantAssoc = column.$refLinks[leafAssocIndex] || [...column.$refLinks].reverse().find(link => link.definition.isAssociation)
      stepAfterAssoc = column.$refLinks.at(leafAssocIndex + 1) || column.$refLinks.at(-1)
      let elements = firstNonJoinRelevantAssoc.definition.elements || firstNonJoinRelevantAssoc.definition.foreignKeys
      if (elements && stepAfterAssoc.definition.name in elements) {
        element = firstNonJoinRelevantAssoc.definition
        baseName = getFullName(firstNonJoinRelevantAssoc.definition)
        columnAlias = column.as || column.ref.slice(0, -1).map(idOnly).join('_')
      } else baseName = getFullName(column.$refLinks[column.$refLinks.length - 1].definition)

      if(column.element && !isAssocOrStruct(column.element)) {
        columnAlias = column.as || leafAssocIndex === -1 ? columnAlias : column.ref.slice(leafAssocIndex - 1).map(idOnly).join('_')
        return [{ref: [tableAlias, calculateElementName(column)], as: columnAlias }]
      }

    } else if (!baseName && structsAreUnfoldedAlready) {
      baseName = element.name // name is already fully constructed
    } else {
      baseName = baseName ? `${baseName}_${element.name}` : getFullName(element)
    }

    // now we have the name of the to be expanded column
    // it could be a structure, an association or a scalar
    // check if the column shall be skipped
    // e.g. for wildcard elements which have been overwritten before
    if (exclude && getReplacement(exclude)) return []
    const replacedBy = getReplacement(replace)
    if (replacedBy) {
      // the replacement alias is the baseName of the flat structure
      // e.g. `office.{ *, address.city as floor }`
      // for the `ref: [ office, floor ]` we find the replacement
      // `ref: [ office, address, city]` so the `baseName` of the replacement
      if (replacedBy.as) replacedBy.as = baseName
      // we might have a new base ref
      if (replacedBy.ref && replacedBy.ref.length > 1)
        baseName = getFullName(replacedBy.$refLinks?.[replacedBy.$refLinks.length - 2].definition)
      if (replacedBy.isJoinRelevant)
        // we need to provide the correct table alias
        tableAlias = getTableAlias(replacedBy)

      if (replacedBy.expand) return [{ as: baseName }]

      return getFlatColumnsFor(replacedBy, { baseName, columnAlias: replacedBy.as, tableAlias }, csnPath)
    }

    csnPath.push(element.name)

    if (element.keys) {
      const flatColumns = []
      for (const k of element.keys) {
        // if only one part of a foreign key is requested, only flatten the partial key
        const keyElement = getElementForRef(k.ref, getDefinition(element.target))
        const flattenThisForeignKey =
          !$refLinks || // the association is passed as element, not as ref --> flatten full foreign key
          element === $refLinks.at(-1).definition || // the association is the leaf of the ref --> flatten full foreign key
          keyElement === stepAfterAssoc.definition // the foreign key is the leaf of the ref --> only flatten this specific foreign key
        if (flattenThisForeignKey) {
          const fkElement = getElementForRef(k.ref, getDefinition(element.target))
          let fkBaseName
          if (!firstNonJoinRelevantAssoc || firstNonJoinRelevantAssoc.onlyForeignKeyAccess) fkBaseName = `${baseName}_${k.as || k.ref.at(-1)}`
          // e.g. if foreign key is accessed via infix filter - use join alias to access key in target
          else fkBaseName = k.ref.at(-1)
          const fkPath = [...csnPath, k.ref.at(-1)]
          if (fkElement.elements) {
            // structured key
            for (const e of Object.values(fkElement.elements)) {
              let alias
              if (columnAlias) {
                const fkName = k.as
                  ? `${k.as}_${e.name}` // foreign key might also be re-named: `assoc { id as foo }`
                  : `${k.ref.join('_')}_${e.name}`
                alias = `${columnAlias}_${fkName}`
              }
              flatColumns.push(
                ...getFlatColumnsFor(
                  e,
                  { baseName: fkBaseName, columnAlias: alias, tableAlias },
                  [...fkPath],
                  excludeAndReplace,
                  isWildcard,
                ),
              )
            }
          } else if (fkElement.isAssociation) {
            // assoc as key
            flatColumns.push(
              ...getFlatColumnsFor(
                fkElement,
                { baseName, columnAlias, tableAlias },
                csnPath,
                excludeAndReplace,
                isWildcard,
              ),
            )
          } else {
            // leaf reached
            let flatColumn
            if (columnAlias) {
              // if the column has an explicit alias AND the original ref
              // directly resolves to the foreign key, we must not append the fk name to the column alias
              // e.g. `assoc.fk as FOO` => columns.alias = FOO
              //      `assoc as FOO`    => columns.alias = FOO_fk
              let columnAliasWithFlatFk
              if (!(column.as && fkElement === column.$refLinks?.at(-1).definition))
                columnAliasWithFlatFk = `${columnAlias}_${k.as || k.ref.join('_')}`
              flatColumn = { ref: [fkBaseName], as: columnAliasWithFlatFk || columnAlias }
            } else flatColumn = { ref: [fkBaseName] }
            if (tableAlias) flatColumn.ref.unshift(tableAlias)

            // in a flat model, we must assign the foreign key rather than the key in the target
            const flatForeignKey = getDefinition(element.parent.name)?.elements[fkBaseName]

            setElementOnColumns(flatColumn, flatForeignKey || fkElement)
            defineProperty(flatColumn, '_csnPath', csnPath)
            flatColumns.push(flatColumn)
          }
        }
      }
      return flatColumns
    } else if (element.elements && element.type !== 'cds.Map') {
      const flatRefs = []
      Object.values(element.elements).forEach(e => {
        const alias = columnAlias ? `${columnAlias}_${e.name}` : null
        flatRefs.push(
          ...getFlatColumnsFor(
            e,
            { baseName, columnAlias: alias, tableAlias },
            [...csnPath],
            excludeAndReplace,
            isWildcard,
          ),
        )
      })
      return flatRefs
    }
    const flatRef = tableAlias ? { ref: [tableAlias, baseName] } : { ref: [baseName] }
    if (column.cast) {
      flatRef.cast = column.cast
      if (!columnAlias)
        // provide an explicit alias
        columnAlias = baseName
    }
    if (column.sort) flatRef.sort = column.sort
    if (columnAlias) flatRef.as = columnAlias
    setElementOnColumns(flatRef, element)
    defineProperty(flatRef, '_csnPath', csnPath)
    return [flatRef]

    function getReplacement(from) {
      return from?.find(replacement => {
        const nameOfExcludedColumn = replacement.as || replacement.ref?.at(-1) || replacement
        return nameOfExcludedColumn === element.name
      })
    }
  }

  /**
   * Transforms a CQN token stream (e.g. `where`, `xpr` or `having`) into a SQL like expression.
   *
   * Expand `exists <assoc>` into `WHERE EXISTS` subqueries, apply flattening to `ref`s.
   * Recursively apply `cqn4sql` to query expressions found in the token stream.
   *
   * @param {object[]} tokenStream - The token stream to transform. Each token in the stream is an
   *                                 object representing a CQN construct such as a column, an operator,
   *                                 or a subquery.
   * @param {object} [$baseLink=null] - The context in which the `ref`s in the token stream are resolvable.
   *                                    It serves as the reference point for resolving associations in
   *                                    statements like `{…} WHERE exists assoc[exists anotherAssoc]`.
   *                                    Here, the $baseLink for `anotherAssoc` would be `assoc`.
   * @returns {object[]} - The transformed token stream.
   */
  function getTransformedTokenStream(tokenStream, $baseLink = null) {
    const transformedTokenStream = []
    for (let i = 0; i < tokenStream.length; i++) {
      const token = tokenStream[i]
      if (token === 'exists') {
        transformedTokenStream.push(token)
        const whereExistsSubSelects = []
        const { ref, $refLinks } = tokenStream[i + 1]
        if (!ref) continue
        if (ref[0] in { $self: true, $projection: true })
          throw new Error(`Unexpected "${ref[0]}" following "exists", remove it or add a table alias instead`)
        const firstStepIsTableAlias = ref.length > 1 && ref[0] in inferred.sources
        for (let j = 0; j < ref.length; j += 1) {
          let current, next
          const step = ref[j]
          const id = step.id || step
          if (j === 0) {
            if (firstStepIsTableAlias) continue
            current = $baseLink || {
              definition: $refLinks[0].target,
              target: $refLinks[0].target,
              // if the first step of a where is not a table alias,
              // the table alias is the query source where the current ref step
              // originates from. As no table alias is specified, there must be
              // only one table alias for the given ref step
              alias: inferred.$combinedElements[id][0].index,
            }
            next = $refLinks[0]
          } else {
            current = $refLinks[j - 1]
            next = $refLinks[j]
          }

          if (isStructured(next.definition)) {
            // find next association / entity in the ref because this is actually our real nextStep
            const nextAssocIndex =
              2 + $refLinks.slice(j + 2).findIndex(rl => rl.definition.isAssociation || rl.definition.kind === 'entity')
            next = $refLinks[nextAssocIndex]
            j = nextAssocIndex
          }

          const as = getNextAvailableTableAlias(getImplicitAlias(next.alias))
          next.alias = as
          if (!next.definition.target) {
            let type = next.definition.type
            if (isCalculatedElement(next.definition)) {
              // try to infer the type at the leaf for better error message
              const { $refLinks } = next.definition.value
              type = $refLinks?.at(-1).definition.type || 'expression'
            }
            throw new Error(
              `Expecting path “${tokenStream[i + 1].ref
                .map(idOnly)
                .join('.')}” following “EXISTS” predicate to end with association/composition, found “${type}”`,
            )
          }
          const { definition: fkSource } = next
          ensureValidForeignKeys(fkSource, ref)
          const { where, ...args } = step
          whereExistsSubSelects.push(getWhereExistsSubquery(current, next, where, true, args))
        }

        const whereExists = { SELECT: whereExistsSubqueries(whereExistsSubSelects) }
        transformedTokenStream[i + 1] = whereExists
        // skip newly created subquery from being iterated
        i += 1
      } else if (token.list) {
        if (token.list.length === 0) {
          // replace `[not] in <empty list>` to harmonize behavior across dbs
          const precedingTwoTokens = tokenStream.slice(i - 2, i)
          const firstPrecedingToken =
            typeof precedingTwoTokens[0] === 'string' ? precedingTwoTokens[0].toLowerCase() : ''
          const secondPrecedingToken =
            typeof precedingTwoTokens[1] === 'string' ? precedingTwoTokens[1].toLowerCase() : ''

          if (firstPrecedingToken === 'not') {
            transformedTokenStream.splice(i - 2, 2, 'is', 'not', 'null')
          } else if (secondPrecedingToken === 'in') {
            transformedTokenStream.splice(i - 1, 1, '=', { val: null })
          } else {
            transformedTokenStream.push({ list: [] })
          }
        } else {
          const { list } = token
          if (list.every(e => e.val))
            // no need for transformation
            transformedTokenStream.push({ list })
          else transformedTokenStream.push({ list: getTransformedTokenStream(list, $baseLink) })
        }
      } else if (tokenStream.length === 1 && token.val && $baseLink) {
        // infix filter - OData variant w/o mentioning key --> flatten out and compare each leaf to token.val
        const def = getDefinition($baseLink.definition.target) || $baseLink.definition
        const keys = def.keys // use key aspect on entity
        const keyValComparisons = []
        const flatKeys = []
        for (const v of Object.values(keys)) {
          if (v !== backlinkFor($baseLink.definition)?.[0]) {
            // up__ID already part of inner where exists, no need to add it explicitly here
            flatKeys.push(...getFlatColumnsFor(v, { tableAlias: $baseLink.alias }))
          }
        }
        if (flatKeys.length > 1)
          throw new Error('Filters can only be applied to managed associations which result in a single foreign key')
        flatKeys.forEach(c => keyValComparisons.push([...[c, '=', token]]))
        keyValComparisons.forEach((kv, j) =>
          transformedTokenStream.push(...kv) && keyValComparisons[j + 1] ? transformedTokenStream.push('and') : null,
        )
      } else if (token.ref && token.param) {
        transformedTokenStream.push({ ...token })
      } else if (pseudos.elements[token.ref?.[0]]) {
        transformedTokenStream.push({ ...token })
      } else {
        // expand `struct = null | struct2`
        const definition = token.$refLinks?.at(-1).definition
        const next = tokenStream[i + 1]
        if (allOps.some(([firstOp]) => firstOp === next) && (definition?.elements || definition?.keys)) {
          const ops = [next]
          let indexRhs = i + 2
          let rhs = tokenStream[i + 2] // either another operator (i.e. `not like` et. al.) or the operand, i.e. the val | null
          if (allOps.some(([, secondOp]) => secondOp === rhs)) {
            ops.push(rhs)
            rhs = tokenStream[i + 3]
            indexRhs += 1
          }
          if (
            isAssocOrStruct(rhs.$refLinks?.[rhs.$refLinks.length - 1].definition) ||
            rhs.val !== undefined ||
            /* unary operator `is null` parsed as string */
            rhs === 'null'
          ) {
            if (notSupportedOps.some(([firstOp]) => firstOp === next))
              throw new Error(`The operator "${next}" is not supported for structure comparison`)
            const newTokens = expandComparison(token, ops, rhs, $baseLink)
            const needXpr = Boolean(tokenStream[i - 1] || tokenStream[indexRhs + 1])
            transformedTokenStream.push(...(needXpr ? [asXpr(newTokens)] : newTokens))
            i = indexRhs // jump to next relevant index
          }
        } else {
          // reject associations in expression, except if we are in an infix filter -> $baseLink is set
          assertNoStructInXpr(token, $baseLink)
          // reject virtual elements in expressions as they will lead to a sql error down the line
          if (definition?.virtual) throw new Error(`Virtual elements are not allowed in expressions`)

          let result = is_regexp(token?.val) ? token : copy(token) // REVISIT: too expensive! //
          if (token.ref) {
            const { definition } = token.$refLinks[token.$refLinks.length - 1]
            // Add definition to result
            setElementOnColumns(result, definition)
            if (isCalculatedOnRead(definition)) {
              const calculatedElement = resolveCalculatedElement(token, true, $baseLink)
              transformedTokenStream.push(calculatedElement)
              continue
            }
            if (token.ref.length > 1 && token.ref[0] === '$self' && !token.$refLinks[0].definition.kind) {
              const dollarSelfReplacement = [calculateDollarSelfColumn(token, true)]
              transformedTokenStream.push(...getTransformedTokenStream(dollarSelfReplacement))
              continue
            }
            // if we have e.g. a calculated element like `books.authorLastName,`
            // we have effectively a ref ['books', 'author', 'lastName']
            // in that case, we have a baseLink `books` which we need to resolve the following steps
            // however, the correct table alias has been assigned to the `author` step
            // hence we need to ignore the alias of the `$baseLink`
            const lastAssoc =
              token.isJoinRelevant && [...token.$refLinks].reverse().find(l => l.definition.isAssociation)
            const tableAlias = getTableAlias(token, (!lastAssoc?.onlyForeignKeyAccess && lastAssoc) || $baseLink)
            if ((!$baseLink || lastAssoc) && token.isJoinRelevant) {
              let name = calculateElementName(token)
              result.ref = [tableAlias, name]
            } else if (tableAlias) {
              result.ref = [tableAlias, token.flatName]
            } else {
              // if there is no table alias, we might select from an anonymous subquery
              result.ref = [token.flatName]
            }
          } else if (token.SELECT) {
            result = transformSubquery(token)
          } else {
            if (token.xpr) {
              result.xpr = getTransformedTokenStream(token.xpr, $baseLink)
            }
            if (token.func && token.args) {
              result.args = getTransformedFunctionArgs(token.args, $baseLink)
            }
          }

          transformedTokenStream.push(result)
        }
      }
    }
    return transformedTokenStream
  }

  /**
   * Expand the given definition and compare all leafs to `val`.
   *
   * @param {object} token with $refLinks
   * @param {string} operator one of allOps
   * @param {object} value either `null` or a column (with `ref` and `$refLinks`)
   * @param {object} $baseLink optional base `$refLink`, e.g. for infix filters of scoped queries.
   *                           In the following example, we must pass `bookshop:Reproduce` as $baseLink for `author`:
   *
   *                           `DELETE.from('bookshop.Reproduce[author = null]:accessGroup')`
   *                                                            ^^^^^^
   * @returns {array}
   */
  function expandComparison(token, operator, value, $baseLink = null) {
    const { definition } = token.$refLinks[token.$refLinks.length - 1]
    let flatRhs
    const result = []
    if (value.$refLinks) {
      // structural comparison
      flatRhs = flattenWithBaseName(value)
    }

    if (flatRhs) {
      const flatLhs = flattenWithBaseName(token)
      // make sure we can compare both structures
      if (flatRhs.length !== flatLhs.length) {
        throw new Error(
          `Can't compare "${definition.name}" with "${
            value.$refLinks[value.$refLinks.length - 1].definition.name
          }": the operands must have the same structure`,
        )
      }

      const boolOp = notEqOps.some(([f, s]) => operator[0] === f && operator[1] === s) ? 'or' : 'and'
      while (flatLhs.length > 0) {
        // retrieve and remove one flat element from LHS and search for it in RHS (remove it there too)
        const { ref, _csnPath: lhs_csnPath } = flatLhs.shift()
        const indexOfElementOnRhs = flatRhs.findIndex(rhs => {
          const { _csnPath: rhs_csnPath } = rhs
          // all following steps must also be part of lhs
          return lhs_csnPath.slice(1).every((val, i) => val === rhs_csnPath[i + 1]) // first step is name of struct -> ignore
        })
        // not found in rhs --> exit
        if (indexOfElementOnRhs === -1) {
          const lhsPath = token.ref.join('.')
          const rhsPath = value.ref.join('.')
          throw new Error(`Can't compare "${lhsPath}" with "${rhsPath}": the operands must have the same structure`)
        }
        const rhs = flatRhs.splice(indexOfElementOnRhs, 1)[0] // remove the element also from RHS
        result.push({ ref }, ...operator, rhs)
        if (flatLhs.length > 0) result.push(boolOp)
      }
    } else {
      // compare with value
      const flatLhs = flattenWithBaseName(token)
      if (flatLhs.length > 1 && value.val !== null && value !== 'null')
        throw new Error(`Can't compare structure "${token.ref.join('.')}" with value "${value.val}"`)
      const boolOp = notEqOps.some(([f, s]) => operator[0] === f && operator[1] === s) ? 'or' : 'and'
      flatLhs.forEach((column, i) => {
        result.push(column, ...operator, value)
        if (flatLhs[i + 1]) result.push(boolOp)
      })
    }
    return result

    function flattenWithBaseName(def) {
      if (!def.$refLinks) return def
      const leaf = def.$refLinks[def.$refLinks.length - 1]
      const first = def.$refLinks[0]
      const tableAlias = getTableAlias(def, def.ref.length > 1 && first.definition.isAssociation ? first : $baseLink)
      if (leaf.definition.parent.kind !== 'entity')
        // we need the base name
        return getFlatColumnsFor(leaf.definition, {
          baseName: def.ref
            .map(idOnly)
            .slice(0, def.ref.length - 1)
            .join('_'),
          tableAlias,
        })
      return getFlatColumnsFor(leaf.definition, { tableAlias })
    }
  }

  function assertNoStructInXpr(token, inInfixFilter = false) {
    if (!inInfixFilter && token.$refLinks?.[token.$refLinks.length - 1].definition.target)
      // REVISIT: let this through if not requested otherwise
      rejectAssocInExpression()
    if (isStructured(token.$refLinks?.[token.$refLinks.length - 1].definition))
      // REVISIT: let this through if not requested otherwise
      rejectStructInExpression()

    function rejectAssocInExpression() {
      throw new Error(`An association can't be used as a value in an expression`)
    }
    function rejectStructInExpression() {
      throw new Error(`A structured element can't be used as a value in an expression`)
    }
  }

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
  function getTransformedFrom(from, existingWhere = []) {
    const transformedWhere = []
    let transformedFrom = copy(from) // REVISIT: too expensive!
    if (from.$refLinks) defineProperty(transformedFrom, '$refLinks', [...from.$refLinks])
    if (from.args) {
      transformedFrom.args = []
      from.args.forEach(arg => {
        if (arg.SELECT) {
          const { whereExists: e, transformedFrom: f } = getTransformedFrom(arg.SELECT.from, arg.SELECT.where)
          const transformedArg = { SELECT: { from: f, where: e } }
          transformedFrom.args.push(transformedArg)
        } else {
          const { transformedFrom: f } = getTransformedFrom(arg)
          transformedFrom.args.push(f)
        }
      })
      return { transformedFrom, transformedWhere: existingWhere }
    } else if (from.SELECT) {
      transformedFrom = transformSubquery(from)
      if (from.as) {
        // preserve explicit TA
        transformedFrom.as = from.as
      } else {
        // select from anonymous query, use artificial alias
        transformedFrom.as = Object.keys(inferred.sources)[0]
      }
      return { transformedFrom, transformedWhere: existingWhere }
    } else {
      return _transformFrom()
    }
    function _transformFrom() {
      if (typeof from === 'string') {
        // normalize to `ref`, i.e. for `UPDATE.entity('bookshop.Books')`
        return { transformedFrom: { ref: [from], as: getImplicitAlias(from) } }
      }
      transformedFrom.as =
        from.uniqueSubqueryAlias ||
        from.as ||
        getImplicitAlias(transformedFrom.$refLinks[transformedFrom.$refLinks.length - 1].definition.name)
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
          let as = getImplicitAlias(next.alias)
          /**
           * for an `expand` subquery, we do not need to add
           * the table alias of the `expand` host to the join tree
           * --> This is an artificial query, which will later be correlated
           * with the main query alias. see @function expandColumn()
           * There is one exception:
           * - if current and next have the same alias, we need to assign a new alias to the next
           *
           */
          if (!(inferred.SELECT?.expand === true && current.alias.toLowerCase() !== as.toLowerCase())) {
            as = getNextAvailableTableAlias(as)
          }
          next.alias = as
          const { definition: fkSource } = current
          ensureValidForeignKeys(fkSource, from.ref)
          whereExistsSubSelects.push(getWhereExistsSubquery(current, next, where, false, args))
        }
      }

      // only append infix filter to outer where if it is the leaf of the from ref
      if (refReverse[0].where)
        filterConditions.push(getTransformedTokenStream(refReverse[0].where, $refLinksReverse[0]))

      if (existingWhere.length > 0) filterConditions.push(existingWhere)
      if (whereExistsSubSelects.length > 0) {
        const { definition: leafAssoc, alias } = transformedFrom.$refLinks[transformedFrom.$refLinks.length - 1]
        Object.assign(transformedFrom, {
          ref: [leafAssoc.target],
          as: alias,
        })
        transformedWhere.push(...['exists', { SELECT: whereExistsSubqueries(whereExistsSubSelects) }])
        filterConditions.forEach(f => {
          transformedWhere.push('and')
          if (filterConditions.length > 1) transformedWhere.push(asXpr(f))
          else if (f.length > 3 || f.includes('or') || f.includes('and')) transformedWhere.push(asXpr(f))
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
        getDefinition(transformedFrom.$refLinks[0].definition.target) || transformedFrom.$refLinks[0].target
      const id = getLocalizedName(subquerySource)
      transformedFrom.ref = [subquerySource.params ? { id, args: from.ref.at(-1).args || {} } : id]

      return { transformedWhere, transformedFrom }
    }
  }

  function ensureValidForeignKeys(fkSource, ref, kind = null) {
    if (fkSource.keys && fkSource.keys.length === 0) {
      const path = prettyPrintRef(ref, model)
      if (kind === 'expand') throw new Error(`Can't expand “${fkSource.name}” as it has no foreign keys`)
      throw new Error(`Path step “${fkSource.name}” of “${path}” has no foreign keys`)
    }
  }

  function whereExistsSubqueries(whereExistsSubSelects) {
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

  function getNextAvailableTableAlias(id) {
    return inferred.joinTree.addNextAvailableTableAlias(id, inferred.outerQueries)
  }

  /**
   * @param {CSN.Element} elt
   * @returns {boolean}
   */
  function isStructured(elt) {
    return Boolean(elt?.kind !== 'entity' && elt?.elements && !elt.isAssociation)
  }

  /**
   * @param {CSN.Element} elt
   * @returns {boolean}
   */
  function isAssocOrStruct(elt) {
    return elt?.keys || (elt?.elements && elt.kind === 'element')
  }

  /**
   * Calculates which elements are the backlinks of a $self comparison in a
   * given on-condition. That are the managed associations in the target of the
   * given association.
   *
   * @param {CSN.Association} assoc with on-condition
   * @returns {[CSN.Association] | null} all assocs which are compared to `$self`
   */
  function backlinkFor(assoc) {
    if (!assoc.on) return null
    const target = getDefinition(assoc.target)
    // technically we could have multiple backlinks
    const backlinks = []
    for (let i = 0; i < assoc.on.length; i += 3) {
      const lhs = assoc.on[i]
      const rhs = assoc.on[i + 2]
      if (lhs?.ref?.length === 1 && lhs.ref[0] === '$self') backlinks.push(rhs)
      else if (rhs?.ref?.length === 1 && rhs.ref[0] === '$self') backlinks.push(lhs)
    }
    return backlinks.map(each =>
      getElementForRef(
        each.ref.slice(1),
        each.ref[0] in { $self: true, $projection: true } ? getParentEntity(assoc) : target,
      ),
    )
  }

  /**
   * Calculates the on-condition for the given (un-)managed association.
   *
   * @param {$refLink} assocRefLink with on-condition
   * @param {$refLink} targetSideRefLink the reflink which has the target alias of the association
   * @returns {[CSN.Association] | null} all assocs which are compared to `$self`
   */
  function onCondFor(assocRefLink, targetSideRefLink, inWhereOrJoin) {
    const { on, keys } = assocRefLink.definition
    const target = getDefinition(assocRefLink.definition.target)
    let res
    if (keys) {
      const fkPkPairs = getParentKeyForeignKeyPairs(assocRefLink.definition, targetSideRefLink, true)
      const transformedOn = []
      fkPkPairs.forEach((pair, i) => {
        const { sourceSide, targetSide } = pair
        sourceSide.ref.unshift(assocRefLink.alias)
        transformedOn.push(sourceSide, '=', targetSide)
        if (fkPkPairs[i + 1]) transformedOn.push('and')
      })
      res = transformedOn
    } else if (on) {
      res = calculateOnCondition(on)
    }
    return res

    /**
     * For an unmanaged association, calculate the proper on-condition.
     * For a `$self = assoc.<backlink>` comparison, the three tokens are replaced
     * by the on-condition of the <backlink>.
     *
     *
     * @param {on} tokenStream the on condition of the unmanaged association
     * @returns the final on-condition for the unmanaged association
     */
    function calculateOnCondition(tokenStream) {
      const result = copy(tokenStream) // REVISIT: too expensive!
      for (let i = 0; i < result.length; i += 1) {
        const lhs = result[i]
        if (lhs.xpr) {
          const xpr = calculateOnCondition(lhs.xpr)
          result[i] = asXpr(xpr)
          continue
        }
        if (lhs.args) {
          const args = calculateOnCondition(lhs.args)
          result[i] = { ...lhs, args }
          continue
        }
        const rhs = result[i + 2]
        if (rhs?.ref || lhs.ref) {
          // if we have refs on each side of the comparison, we might need to perform tuple expansion
          // or flatten the structures
          const refLinkFaker = thing => {
            const { ref } = thing
            const assocHost = getParentEntity(assocRefLink.definition)
            defineProperty(thing, '$refLinks', [])
            let pseudoPath = false
            ref.reduce((prev, res, i) => {
              if (res === '$self') {
                // next is resolvable in entity
                thing.$refLinks.push({ definition: prev, target: prev })
                return prev
              }
              if (res in pseudos.elements) {
                pseudoPath = true
                thing.$refLinks.push({ definition: pseudos.elements[res], target: pseudos })
                return pseudos.elements[res]
              } else if (pseudoPath) {
                thing.$refLinks.push({ definition: {}, target: pseudos })
                return prev?.elements[res]
              }
              const definition =
                prev?.elements?.[res] || getDefinition(prev?.target)?.elements[res] || pseudos.elements[res]
              const target = getParentEntity(definition)
              thing.$refLinks[i] = {
                definition,
                target,
                alias: definition === assocRefLink.definition ? assocRefLink.alias : definition.name,
              }
              return prev?.elements?.[res] || getDefinition(prev?.target)?.elements[res] || pseudos.elements[res]
            }, assocHost)
          }

          // comparison in on condition needs to be expanded...
          // re-use existing algorithm for that
          // we need to fake some $refLinks for that to work though...
          lhs?.ref && !lhs.$refLinks && refLinkFaker(lhs)
          rhs?.ref && !rhs.$refLinks && refLinkFaker(rhs)
        }

        let backlink
        if (rhs?.ref && lhs?.ref) {
          if (lhs?.ref?.length === 1 && lhs.ref[0] === '$self')
            backlink = getElementForRef(
              rhs.ref.slice(1),
              rhs.ref[0] in { $self: true, $projection: true } ? getParentEntity(assocRefLink.definition) : target,
            )
          else if (rhs?.ref?.length === 1 && rhs.ref[0] === '$self')
            backlink = getElementForRef(
              lhs.ref.slice(1),
              lhs.ref[0] in { $self: true, $projection: true } ? getParentEntity(assocRefLink.definition) : target,
            )
          else {
            const lhsLeafDef = lhs.ref && lhs.$refLinks.at(-1).definition
            const rhsLeafDef = rhs.ref && rhs.$refLinks.at(-1).definition
            const lhsFirstDef = lhs.$refLinks.find(r => r.definition.kind === 'element')?.definition
            // compare structures in on-condition
            if ((lhsLeafDef?.target && rhsLeafDef?.target) || (lhsLeafDef?.elements && rhsLeafDef?.elements)) {
              if (rhs.$refLinks[0].definition !== assocRefLink.definition) {
                rhs.ref.unshift(targetSideRefLink.alias)
                rhs.$refLinks.unshift(targetSideRefLink)
              }
              if (lhsFirstDef !== assocRefLink.definition) {
                lhs.ref.unshift(targetSideRefLink.alias)
                lhs.$refLinks.unshift(targetSideRefLink)
              }
              const expandedComparison = getTransformedTokenStream([lhs, result[i + 1], rhs])
              const res = tokenStream[i + 3] ? [asXpr(expandedComparison)] : expandedComparison
              result.splice(i, 3, ...res)
              i += res.length
              continue
            }
            // assumption: if first step is the association itself, all following ref steps must be resolvable
            // within target `assoc.assoc.fk` -> `assoc.assoc_fk`
            else if (lhsFirstDef === getParentEntity(assocRefLink.definition).elements[assocRefLink.definition.name])
              result[i].ref = [assocRefLink.alias, lhs.ref.slice(lhs.ref[0] === '$self' ? 2 : 1).join('_')]
            // naive assumption: if the path starts with an association which is not the association from
            // which the on-condition originates, it must be a foreign key and hence resolvable in the source
            else if (lhsFirstDef?.target) result[i].ref = [result[i].ref.join('_')]
          }
        }
        if (backlink) {
          const wrapInXpr = result[i + 3] || result[i - 1] // if we have a complex on-condition, wrap each part in xpr
          let backlinkOnCondition = []
          if (backlink.on) {
            // unmanaged backlink -> prepend correct aliases
            backlinkOnCondition = backlink.on.map(t => {
              if (t.ref?.length > 1 && t.ref[0] === (backlink.name || targetSideRefLink.definition.name)) {
                return { ref: [targetSideRefLink.alias, ...t.ref.slice(1)] }
              } else if (t.ref) {
                if (t.ref.length > 1 && !(t.ref[0] in pseudos.elements))
                  return { ref: [assocRefLink.alias, ...t.ref.slice(1)] }
                else return { ref: [assocRefLink.alias, ...t.ref] }
              } else {
                return t
              }
            })
          } else if (backlink.keys) {
            // sanity check: error out if we can't produce a join
            if (backlink.keys.length === 0) {
              throw new Error(
                `Path step “${assocRefLink.definition.name}” is a self comparison with “${getFullName(backlink)}” that has no foreign keys`,
              )
            }
            // managed backlink -> calculate fk-pk pairs
            const fkPkPairs = getParentKeyForeignKeyPairs(backlink, targetSideRefLink)
            fkPkPairs.forEach((pair, j) => {
              const { sourceSide, targetSide } = pair
              sourceSide.ref.unshift(assocRefLink.alias)
              backlinkOnCondition.push(sourceSide, '=', targetSide)
              if (!inWhereOrJoin) backlinkOnCondition.reverse()
              if (fkPkPairs[j + 1]) backlinkOnCondition.push('and')
            })
          }
          result.splice(i, 3, ...(wrapInXpr ? [asXpr(backlinkOnCondition)] : backlinkOnCondition))
          i += wrapInXpr ? 1 : backlinkOnCondition.length // skip inserted tokens
        } else if (lhs.ref && lhs.$refLinks[0]?.target !== pseudos) {
          if (lhs.ref[0] === '$self') {
            // $self in ref of length > 1
            // if $self is followed by association, the alias of the association must be used
            if (lhs.$refLinks[1].definition.isAssociation) result[i].ref.splice(0, 1)
            // otherwise $self is replaced by the alias of the entity
            else result[i].ref.splice(0, 1, targetSideRefLink.alias)
          } else if (lhs.ref.length > 1) {
            if (lhs.ref[0] !== assocRefLink.alias && lhs.ref[0] !== targetSideRefLink.alias) {
              // we need to find correct table alias for the structured access
              const { definition } = lhs.$refLinks[0]
              if (definition === getParentEntity(assocRefLink.definition).elements[assocRefLink.definition.name]) {
                // first step is the association itself -> use it's name as it becomes the table alias
                result[i].ref.splice(0, 1, assocRefLink.alias)
              } else if (
                definition.name in
                (targetSideRefLink.definition.elements || getDefinition(targetSideRefLink.definition.target).elements)
              ) {
                // first step is association which refers to its foreign key by dot notation
                result[i].ref = [targetSideRefLink.alias, lhs.ref.join('_')]
              }
            }
          } else if (lhs.ref.length === 1) result[i].ref.unshift(targetSideRefLink.alias)
        }
      }
      return result
    }
    /**
     * Recursively calculates the containing entity for a given element.
     * If the query is localized, this function may return the localized entity.
     *
     * @param {CSN.element} element
     * @returns {CSN.definition} the entity containing the given element
     */
    function getParentEntity(element) {
      if (!element.kind)
        // pseudo element
        return element
      if (element.kind === 'entity') return element
      else return getDefinition(getParentEntity(element.parent).name)
    }
  }

  /**
   * For a given managed association, calculate the foreign key - parent key tuples.
   *
   * @param {CDS.Association} assoc the association for which the on condition shall be calculated
   * @param {object} targetSideRefLink the reflink which has the target alias of the (backlink) association
   * @param {boolean} flipSourceAndTarget target and source side are flipped in the where exists subquery
   * @returns {[{sourceSide: {ref: []}, targetSide: {ref:[]}}]} array of source side - target side reference tuples, i.e. the foreign keys and parent keys.
   */
  function getParentKeyForeignKeyPairs(assoc, targetSideRefLink, flipSourceAndTarget = false) {
    const res = []
    const backlink = backlinkFor(assoc)?.[0]
    const { keys, target } = backlink || assoc
    if (keys) {
      keys.forEach(fk => {
        const { ref, as } = fk
        const elem = getElementForRef(ref, getDefinition(target)) // find the element (the target element of the foreign key) in the target of the (backlink) association
        const flatParentKeys = getFlatColumnsFor(elem, { baseName: ref.slice(0, ref.length - 1).join('_') }) // it might be a structured element, so expand it into the full parent key tuple
        const flatAssociationName = getFullName(backlink || assoc) // get the name of the (backlink) association
        const flatForeignKeys = getFlatColumnsFor(elem, { baseName: flatAssociationName, columnAlias: as }) // the name of the (backlink) association is the base of the foreign key tuple, also respect aliased fk.

        for (let i = 0; i < flatForeignKeys.length; i++) {
          if (flipSourceAndTarget) {
            // `where exists <assoc>` expansion
            // a backlink will cause the foreign key to be on the source side
            const refInTarget = backlink ? flatParentKeys[i] : flatForeignKeys[i]
            const refInSource = backlink ? flatForeignKeys[i] : flatParentKeys[i]
            res.push({
              sourceSide: refInSource,
              targetSide: {
                ref: [
                  targetSideRefLink.alias,
                  refInTarget.as ? `${flatAssociationName}_${refInTarget.as}` : refInTarget.ref[0],
                ],
              },
            })
          } else {
            // `select from <assoc>` to `where exists` expansion
            // a backlink will cause the foreign key to be on the target side
            const refInTarget = backlink ? flatForeignKeys[i] : flatParentKeys[i]
            const refInSource = backlink ? flatParentKeys[i] : flatForeignKeys[i]
            res.push({
              sourceSide: {
                ref: [refInSource.as ? `${flatAssociationName}_${refInSource.as}` : refInSource.ref[0]],
              },
              targetSide: { ref: [targetSideRefLink.alias, ...refInTarget.ref] },
            })
          }
        }
      })
    }
    return res
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
  function getWhereExistsSubquery(current, next, customWhere = null, inWhere = false, queryModifier = null) {
    const { definition } = current
    const { definition: nextDefinition } = next
    const on = []
    const fkSource = inWhere ? nextDefinition : definition
    // TODO: use onCondFor()
    if (fkSource.keys) {
      const pkFkPairs = getParentKeyForeignKeyPairs(fkSource, current, inWhere)
      pkFkPairs.forEach((pkFkPair, i) => {
        const { targetSide, sourceSide } = pkFkPair
        sourceSide.ref.unshift(next.alias)
        if (i > 0) on.push('and')
        on.push(sourceSide, '=', targetSide)
      })
    } else {
      const unmanagedOn = onCondFor(inWhere ? next : current, inWhere ? current : next, inWhere)
      on.push(...(customWhere && hasLogicalOr(unmanagedOn) ? [asXpr(unmanagedOn)] : unmanagedOn))
    }

    const subquerySource = getDefinition(nextDefinition.target) || nextDefinition
    const id = getLocalizedName(subquerySource)
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
    if (next.pathExpressionInsideFilter || (queryModifier && ['orderBy', 'groupBy', 'having', 'limit', 'offset'].some(key => key in queryModifier))) {
      SELECT.where = next.pathExpressionInsideFilter ? customWhere : [];
      if (queryModifier) assignQueryModifiers(SELECT, queryModifier);

      const transformedExists = transformSubquery({ SELECT });
      if (transformedExists.SELECT.where?.length) {
      const wrappedWhere = hasLogicalOr(transformedExists.SELECT.where)
        ? [asXpr(transformedExists.SELECT.where)]
        : transformedExists.SELECT.where;

      on.push('and', ...wrappedWhere);
      }
      transformedExists.SELECT.where = on;
      return transformedExists.SELECT;
    }

    if (customWhere) {
      const filter = getTransformedTokenStream(customWhere, next);
      const wrappedFilter = hasLogicalOr(filter) ? [asXpr(filter)] : filter;
      on.push('and', ...wrappedFilter);
    }
    return SELECT
  }

  /**
   * For a given search expression return a function "search" which holds the search expression
   * as well as the searchable columns as arguments.
   *
   * @param {object} search - The search expression which shall be applied to the searchable columns on the query source.
   * @param {object} query - The FROM clause of the CQN statement.
   *
   * @returns {(Object|null)} returns either:
   * - a function with two arguments: The first one being the list of searchable columns, the second argument holds the search expression.
   * - or null, if no searchable columns are found in neither in `@cds.search` nor in the target entity itself.
   */
  function getSearchTerm(search, query) {
    const entity = query.SELECT.from.SELECT ? query.SELECT.from : cds.infer.target(query) // REVISIT: we should reliably use inferred._target instead
    const searchIn = computeColumnsToBeSearched(inferred, entity)
    if (searchIn.length > 0) {
      const xpr = search
      const searchFunc = {
        func: 'search',
        args: [{ list: searchIn }, xpr.length === 1 && 'val' in xpr[0] ? xpr[0] : { xpr }],
      }
      return searchFunc
    } else {
      return null
    }
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
  function getTableAlias(node, $baseLink = null) {
    if (!node || !node.$refLinks || !node.ref) {
      throw new Error('Invalid node')
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
      return [...node.$refLinks]
        .reverse()
        .find($refLink => $refLink.definition.isAssociation && !$refLink.onlyForeignKeyAccess).alias
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
          inferred.SELECT?.from.uniqueSubqueryAlias &&
          !inferred.SELECT?.from.as &&
          getImplicitAlias(firstStep) === getImplicitAlias(transformedQuery.SELECT.from.ref[0])
        ) {
          return inferred.SELECT?.from.uniqueSubqueryAlias
        }
        return node.ref[0]
      }
    }

    function getCombinedElementAlias(node) {
      return inferred.$combinedElements[node.ref[0].id || node.ref[0]]?.[0].index
    }
  }
  function getTransformedFunctionArgs(args, $baseLink = null) {
    let result = null
    if (Array.isArray(args)) {
      result = args.map(t => {
        if (!t.val)
          // this must not be touched
          return getTransformedTokenStream([t], $baseLink)[0]
        return t
      })
    } else if (typeof args === 'object') {
      result = {}
      for (const prop in args) {
        const t = args[prop]
        if (!t.val)
          // this must not be touched
          result[prop] = getTransformedTokenStream([t], $baseLink)[0]
        else result[prop] = t
      }
    }
    return result
  }
}

function calculateElementName(token) {
  const nonJoinRelevantAssoc = [...token.$refLinks].findIndex(l => l.definition.isAssociation && l.onlyForeignKeyAccess)
  let name
  if (nonJoinRelevantAssoc !== -1)
    // calculate fk name
    name = token.ref.slice(nonJoinRelevantAssoc).join('_')
  else name = getFullName(token.$refLinks[token.$refLinks.length - 1].definition)
  return name
}

/**
 * Calculate the flat name for a deeply nested element:
 * @example `entity E { struct: { foo: String} }` => `getFullName(foo)` => `struct_foo`
 *
 * @param {CSN.element} node an element
 * @param {object} name the last part of the name, e.g. the name of the deeply nested element
 * @returns the flat name of the element
 */
function getFullName(node, name = node.name) {
  // REVISIT: this is an unfortunate implementation
  if (!node.parent || node.parent.kind === 'entity') return name

  return getFullName(node.parent, `${node.parent.name}_${name}`)
}

function copy(obj) {
  const walk = function (par, prop) {
    const val = prop ? par[prop] : par

    // If value is native return
    if (typeof val !== 'object' || val == null || val instanceof RegExp || val instanceof Date || val instanceof Buffer)
      return val

    const ret = Array.isArray(val) ? [] : {}
    Object.keys(val).forEach(k => {
      ret[k] = walk(val, k)
    })
    return ret
  }

  return walk(obj)
}

function hasLogicalOr(tokenStream) {
  return tokenStream.some(t => t in { OR: true, or: true })
}

function getParentEntity(element) {
  if (element.kind === 'entity') return element
  else return getParentEntity(element.parent)
}


function asXpr(thing) {
  return { xpr: thing }
}

function assignQueryModifiers(SELECT, modifiers) {
  for (const [key, val] of Object.entries(modifiers)) {
    if (key in { orderBy: 1, groupBy: 1 }) {
      if (SELECT[key]) SELECT[key].push(...val)
      else SELECT[key] = val
    } else if (key === 'limit') {
      // limit defined on the query has precedence
      if (!SELECT.limit) SELECT.limit = val
    } else if (key === 'having') {
      if (!SELECT.having) SELECT.having = val
      else SELECT.having.push('and', ...val)
    }
  }
}

/**
 * Assigns the given `element` as non-enumerable property 'element' onto `col`.
 *
 * @param {object} col
 * @param {csn.Element} element
 */
function setElementOnColumns(col, element) {
  defineProperty(col, 'element', element)
}

const getName = col => col.as || col.ref?.at(-1)
const idOnly = ref => ref.id || ref
const refWithConditions = step => {
  let appendix
  const { args, where } = step
  if (where && args) appendix = JSON.stringify(where) + JSON.stringify(args)
  else if (where) appendix = JSON.stringify(where)
  else if (args) appendix = JSON.stringify(args)
  return appendix ? step.id + appendix : step
}
const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl

module.exports = Object.assign(cqn4sql, {
  // for own tests only:
  eqOps,
  notEqOps,
  notSupportedOps,
})
