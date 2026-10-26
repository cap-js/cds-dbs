'use strict'

module.exports = {
  nestedProjectionOnStructure,
  expandNestedProjectionWildcard,
  expandAssociationWildcard,
  expandColumn,
}

const columnsModule = require('./columns')
const flattenModule = require('./flatten')
const sourcesModule = require('./sources')

const { keysOf } = require('./model')
const cloneCqn = require('./clone')
const { planFor, indexColumns } = require('./projection-plan')
const joinsModule = require('./joins')

const {
  setElementOnColumns,
  idOnly,
  refWithConditions,
  assignQueryModifiers,
  hasLogicalOr,
  asXpr,
} = require('./helpers')

/**
 * Calculates the columns for a nested projection on a structure.
 *
 * @param {object} col
 * @param {'inline'|'expand'} prop the property on which to operate. Default is `inline`.
 * @returns a list of flat columns.
 */
function nestedProjectionOnStructure(ctx, col, prop = 'inline') {
  const res = []
  const names = new Set()
  function append(...columns) {
    for (const column of columns) {
      names.add(column.as || column.ref?.slice(1).map(idOnly).join('_'))
      res.push(column)
    }
  }

  col[prop].forEach((nestedProjection, i) => {
    let rewrittenColumns = []
    if (nestedProjection === '*') {
      append(...expandNestedProjectionWildcard(ctx, col, prop))
    } else {
      const nameParts = col.as ? [col.as] : [col.ref.map(idOnly).join('_')]
      nameParts.push(
        nestedProjection.as
          ? nestedProjection.as
          : nestedProjection.ref
            ? nestedProjection.ref.map(idOnly).join('_')
            : nestedProjection.func || `expr${i}`,
      )
      const name = nameParts.join('_')
      if (nestedProjection.ref) {
        const augmentedInlineCol = augmentInlineRefWithParent(nestedProjection, col)
        if (
          col.as ||
          nestedProjection.as ||
          nestedProjection.$refLinks[nestedProjection.$refLinks.length - 1].definition.value ||
          nestedProjection.isJoinRelevant
        ) {
          augmentedInlineCol.as = nameParts.join('_')
        }
        const flatColumns = columnsModule.getTransformedColumns(ctx, [augmentedInlineCol])
        flatColumns.forEach(flatColumn => {
          const flatColumnName = flatColumn.as || flatColumn.ref[flatColumn.ref.length - 1]
          if (!names.has(flatColumnName)) {
            const rewrittenColumn = { ...flatColumn }
            if (nestedProjection.as) rewrittenColumn.as = flatColumnName
            rewrittenColumns.push(rewrittenColumn)
          }
        })
      } else {
        // func, xpr, val..
        // we need to check if the column was already added
        // in the wildcard expansion
        if (!names.has(name)) {
          const rewrittenColumn = { ...nestedProjection }
          rewrittenColumn.as = name
          // For xpr/func, we need to transform refs inside to include the struct prefix
          if (nestedProjection.xpr && col.ref) {
            rewrittenColumn.xpr = augmentInlineXprRefs(nestedProjection.xpr, col)
          } else if (nestedProjection.func && nestedProjection.args && col.ref) {
            rewrittenColumn.args = augmentInlineXprRefs([nestedProjection], col)[0].args
          }
          rewrittenColumns.push(rewrittenColumn)
        }
      }
    }
    append(...rewrittenColumns)
  })

  return res

  /**
   * Augment a ref column with the parent column's path and $refLinks.
   */
  function augmentInlineRefWithParent(refCol, parentCol) {
    const augmented = { ...refCol }
    if (ctx.projectionPlans.has(refCol)) ctx.projectionPlans.set(augmented, ctx.projectionPlans.get(refCol))
    if (ctx.wildcardCalculations.has(refCol))
      ctx.wildcardCalculations.set(augmented, ctx.wildcardCalculations.get(refCol))
    if (ctx.calculatedValues.has(refCol)) ctx.calculatedValues.set(augmented, ctx.calculatedValues.get(refCol))
    augmented.ref = parentCol.ref ? [...parentCol.ref, ...refCol.ref] : refCol.ref
    Object.defineProperties(augmented, {
      $refLinks: { value: [...refCol.$refLinks], writable: true },
      isJoinRelevant: { value: refCol.isJoinRelevant, writable: true },
    })
    if (parentCol.ref) {
      augmented.$refLinks.unshift(...parentCol.$refLinks)
      augmented.isJoinRelevant = augmented.isJoinRelevant || parentCol.isJoinRelevant
    }
    return augmented
  }

  /**
   * Augment refs inside an xpr with the parent column's path and $refLinks,
   * then transform them to flat refs.
   */
  function augmentInlineXprRefs(xpr, parentCol) {
    return xpr.map(token => {
      if (typeof token === 'string' || token.val !== undefined) {
        return token
      }
      if (token.ref && token.$refLinks) {
        const augmented = augmentInlineRefWithParent(token, parentCol)
        // Transform this single ref column to get the flat version
        const transformed = columnsModule.getTransformedColumns(ctx, [augmented])
        if (transformed.length === 1) {
          return transformed[0]
        }
        return augmented
      }
      if (token.xpr) {
        return { ...token, xpr: augmentInlineXprRefs(token.xpr, parentCol) }
      }
      if (token.list) {
        return { ...token, list: augmentInlineXprRefs(token.list, parentCol) }
      }
      if (token.func && token.args) {
        return { ...token, args: augmentInlineFunctionArgs(token.args, parentCol) }
      }
      return token
    })
  }

  function augmentInlineFunctionArgs(args, parentCol) {
    if (Array.isArray(args)) return augmentInlineXprRefs(args, parentCol)
    const result = {}
    for (const prop in args) result[prop] = augmentInlineXprRefs([args[prop]], parentCol)[0]
    return result
  }
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
 * @returns an array of columns which represents the expanded wildcard
 */
function expandNestedProjectionWildcard(ctx, col, prop = 'inline') {
  const res = []
  const plan = planFor(ctx, col, prop)
  const exclude = plan.exclude
  const replace = new Map()

  const baseRef = col.ref || []
  const baseRefLinks = col.$refLinks || []

  // column has no ref, then it is an anonymous expand:
  // select from books { { * } as bar }
  // only possible if there is exactly one query source
  if (!baseRef.length) {
    const [tableAlias, { definition }] = Object.entries(ctx.query.sources)[0]
    baseRef.push(tableAlias)
    baseRefLinks.push({ definition, source: definition })
  }
  // we need to make the refs absolute
  plan.replace.forEach((c, name) => {
    const fakeColumn = { ...c }
    if (fakeColumn.ref) {
      fakeColumn.ref = [...baseRef, ...fakeColumn.ref]
      fakeColumn.$refLinks = [...baseRefLinks, ...c.$refLinks]
    }
    replace.set(name, fakeColumn)
  })

  if (baseRefLinks.at(-1).definition.kind === 'entity') {
    res.push(...flattenModule.getColumnsForWildcard(ctx, exclude, replace, col.as))
  } else if (baseRefLinks.at(-1).definition.target) {
    // Wildcard on association - need to include FK columns and join-relevant target columns
    res.push(...expandAssociationWildcard(ctx, col, baseRef, baseRefLinks, exclude, replace))
  } else
    res.push(
      ...flattenModule.getFlatColumnsFor(
        ctx,
        col,
        { columnAlias: col.as, tableAlias: sourcesModule.getTableAlias(ctx, col) },
        [],
        {
          exclude,
          replace,
        },
      ),
    )
  return res
}

/**
 * Expands a wildcard on an association into:
 * 1. FK columns from the source table
 * 2. Non-FK columns from the target via join
 */
function expandAssociationWildcard(ctx, col, baseRef, baseRefLinks, exclude, replace) {
  const res = []
  exclude = indexColumns(exclude)
  replace = indexColumns(replace)
  const assocDef = baseRefLinks.at(-1).definition
  const targetDef = ctx.getDefinition(assocDef.target)
  const columnAlias = col.as || baseRef.map(idOnly).join('_')
  const sourceTableAlias = sourcesModule.getTableAlias(ctx, col)

  // Get the join alias for this association (set during join tree merge)
  const joinAlias = baseRefLinks.at(-1).alias

  // Collect FK element names
  const fkNames = new Set()
  if (keysOf(assocDef, ctx.state.metadata)) {
    for (const k of keysOf(assocDef, ctx.state.metadata)) {
      fkNames.add(k.ref[0])
    }
  }

  // First, add FK columns from source table
  // These are accessed via the source table alias, not the join
  const fkColumns = flattenModule.getFlatColumnsFor(ctx, col, { tableAlias: sourceTableAlias }, [], {
    exclude,
    replace,
  })
  res.push(...fkColumns.filter(fk => !col.excluding?.some(e => targetDef.elements[e] === fk.element)))

  // Then, add non-FK columns from target via join
  if (targetDef?.elements) {
    for (const [elemName, elemDef] of Object.entries(targetDef.elements)) {
      // Skip FK elements (already included above), virtual, blobs, and unmanaged assocs
      if (fkNames.has(elemName)) continue
      if (elemDef.virtual) continue
      if (elemDef.type === 'cds.LargeBinary') continue
      if (elemDef.on && !keysOf(elemDef, ctx.state.metadata)) continue // unmanaged association

      // Check exclusions
      const fullName = `${columnAlias}_${elemName}`
      if (exclude.has(elemName)) continue
      if (exclude.has(fullName)) continue

      // Check for replacement
      const replacement = replace.get(elemName)
      if (replacement) {
        // Handle replacement - create augmented column
        const augmented = { ...replacement }
        augmented.as = fullName
        res.push(...columnsModule.getTransformedColumns(ctx, [augmented]))
        continue
      }

      if (elemDef.value) {
        const calcElement = columnsModule.resolveCalculatedElement(
          ctx,
          ctx.wildcardCalculations.get(col).get(elemName),
          true,
          baseRefLinks.at(-1),
        )
        calcElement.as = fullName
        res.push(calcElement)
      } else {
        const flatColumns = flattenModule.getFlatColumnsFor(
          ctx,
          elemDef,
          { baseName: elemDef.elements ? elemName : null, columnAlias: fullName, tableAlias: joinAlias },
          [],
          { exclude, replace },
          !!elemDef.elements,
        )
        res.push(...flatColumns.filter(c => !exclude.has(c.as) && !exclude.has(c.ref?.at(-1))))
      }
    }
  }

  return res
}

/** Build an expand directly on its target and correlate it with the bound
 * association's ON condition. Only the selected target query is transformed.
 */
function expandColumn(ctx, column) {
  let outerAlias
  let subqueryFromRef
  const ref = column.$refLinks[0].definition.kind === 'entity' ? column.ref.slice(1) : column.ref
  const assoc = column.$refLinks.at(-1)
  sourcesModule.ensureValidForeignKeys(ctx, assoc.definition, column.ref, 'expand')
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
    outerAlias = ctx.transformedQuery.SELECT.from.as
    subqueryFromRef = [ctx.transformedQuery._target.name, ...ref]
  }

  // this is the alias of the column which holds the correlated subquery
  const columnAlias = column.as || ref.map(idOnly).join('_')

  // if there is a group by on the main query, all
  // columns of the expand must be in the groupBy
  if (ctx.transformedQuery.SELECT.groupBy) {
    const baseRef = column.$refLinks[0].definition.SELECT || ref

    return _subqueryForGroupBy(column, baseRef, columnAlias)
  }

  // Alias in expand subquery is derived from but not equal to
  // the alias of the column because to account for potential ambiguities
  // the alias cannot be addressed anyways
  const uniqueSubqueryAlias = sourcesModule.getNextAvailableTableAlias(
    ctx,
    ctx.getImplicitAlias(columnAlias),
    ctx.query.outerQueries,
  )

  // `SELECT from Authors {  books.genre as genreOfBooks { name } } becomes `SELECT from Books:genre as genreOfBooks`
  const leafStep = column.ref.at(-1)
  const target = ctx.model.definitions[assoc.definition.target]
  const from = {
    ref: [target.params ? { id: target.name, args: leafStep.args || {} } : target.name],
    as: uniqueSubqueryAlias,
  }
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
      columns: cloneCqn(column.expand),
      expand: true,
      one: column.$refLinks.at(-1).definition.is2one,
    },
  }
  if (leafStep.id) assignQueryModifiers(subquery.SELECT, leafStep)
  const expanded = sourcesModule.transformSubquery(ctx, subquery)
  const parent = ctx.getDefinition(subqueryFromRef[0])
  const condition = joinsModule.onCondFor(
    ctx,
    { ...assoc, alias: uniqueSubqueryAlias },
    { definition: parent, target: parent, alias: outerAlias },
    false,
  )
  const filter = expanded.SELECT.where
  expanded.SELECT.where = filter?.length
    ? [
        ...(hasLogicalOr(condition) ? [asXpr(condition)] : condition),
        'and',
        ...(filter.length > 3 || filter.includes('or') || filter.includes('and') || filter.includes('in')
          ? [asXpr(filter)]
          : filter),
      ]
    : condition
  expanded.as = columnAlias
  return expanded

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
      ctx.transformedQuery.SELECT.groupBy.map(c => [c.ref && c.ref.map(refWithConditions).join('.'), c]),
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
        const tableAlias = sourcesModule.getTableAlias(ctx, copy)
        const res = flattenModule.getFlatColumnsFor(ctx, copy, { tableAlias })
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
