'use strict'

const { planFor } = require('./projection-plan')
const { bindingFor } = require('./binding')

module.exports = { getTransformedColumns, resolveCalculatedElement, calculateDollarSelfColumn }

const { getCalculatedValue } = require('./scope')

const sourcesModule = require('./sources')
const projectionsModule = require('./projections')
const flattenModule = require('./flatten')
const enumsModule = require('./enums')
const expressionsModule = require('./expressions')

const { pseudos } = require('./pseudos')
const { isCalculatedOnRead, hasOwnSkip, isRuntimeView, defineProperty } = require('../utils')
const { setElementOnColumns, getName, idOnly } = require('./helpers')

/**
 * Walks over a list of columns (ref's, xpr, subqueries, val), applies flattening on structured types and expands wildcards.
 *
 * @param {object[]} columns
 * @returns {object[]} the transformed representation of the input. Expanded and flattened.
 */
function getTransformedColumns(ctx, columns) {
  const transformedColumns = []
  const byName = new Map()
  function append(...columns) {
    for (const column of columns) {
      const name = getName(column)
      if (!byName.has(name)) byName.set(name, transformedColumns.length)
      transformedColumns.push(column)
    }
  }
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]

    if (isCalculatedOnRead(col.$refLinks?.at(-1).definition) && !col.$refLinks?.at(-1).target?.SELECT) {
      const name = getName(col)
      if (!byName.has(name)) {
        const calcElement = resolveCalculatedElement(ctx, col)
        append(calcElement)
      }
    } else if (col.expand) {
      if (col.ref?.length > 1 && col.ref[0] === '$self' && !col.$refLinks[0].definition.kind) {
        const dollarSelfReplacement = calculateDollarSelfColumn(ctx, col)
        append(...getTransformedColumns(ctx, [dollarSelfReplacement]))
        continue
      }
      append(() => {
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
        const dollarSelfReplacement = calculateDollarSelfColumn(ctx, col)
        append(...getTransformedColumns(ctx, [dollarSelfReplacement]))
        continue
      }
      handleRef(col)
    } else if (col === '*') {
      handleWildcard()
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
        transformedColumns[i] = res
      } else {
        const replaceWith = res.as ? byName.get(res.as) : undefined
        if (replaceWith === undefined || replaceWith === i) transformedColumns[i] = res
        else {
          transformedColumns[replaceWith] = res
          transformedColumns[i] = null
        }
        if (res.as) byName.set(res.as, replaceWith ?? i)
      }
    }
  }

  const result = transformedColumns.flat().filter(Boolean)
  if (result.length === 0 && columns.length) {
    handleEmptyColumns(columns)
  }

  return result

  function handleSubquery(col) {
    append(() => {
      const res = sourcesModule.transformSubquery(ctx, col)
      if (col.as) res.as = col.as
      return res
    })
  }

  function handleExpand(col) {
    const { $refLinks } = col
    const res = []
    const last = $refLinks?.[$refLinks.length - 1]
    if (last && !last.skipExpand && last.definition.isAssociation) {
      const expandedSubqueryColumn = projectionsModule.expandColumn(ctx, col)
      if (!expandedSubqueryColumn) return []
      const resultElement = ctx.query.elements[col.as || col.flatName]
      if (resultElement?.$assocExpand) {
        defineProperty(resultElement.items || resultElement, 'elements', expandedSubqueryColumn.elements)
      }
      setElementOnColumns(expandedSubqueryColumn, col.element)
      res.push(expandedSubqueryColumn)
    } else if (!last?.skipExpand) {
      const expandCols = projectionsModule.nestedProjectionOnStructure(ctx, col, 'expand')
      res.push(...expandCols)
    }
    return res
  }

  function handleInline(col) {
    const inlineCols = projectionsModule.nestedProjectionOnStructure(ctx, col)
    append(...inlineCols)
  }

  function handleRef(col) {
    if (pseudos.elements[col.ref[0]] || col.param) {
      append({ ...col })
      return
    }

    const tableAlias = sourcesModule.getTableAlias(ctx, col)
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

    if (
      col.$refLinks.some(link => {
        const def = ctx.getDefinition(link.definition.target)
        return hasOwnSkip(def) && !isRuntimeView(def)
      })
    )
      return

    const flatColumns = flattenModule.getFlatColumnsFor(ctx, col, { baseName, columnAlias, tableAlias })
    flatColumns.forEach(flatColumn => {
      const name = getName(flatColumn)
      if (!byName.has(name)) append(flatColumn)
    })
  }

  function handleWildcard() {
    const plan = planFor(ctx, ctx.query.SELECT)
    const wildcardColumns = flattenModule.getColumnsForWildcard(ctx, plan.exclude, plan.replace)
    append(...wildcardColumns)
  }

  function handleDefault(col) {
    let transformedColumn = getTransformedColumn(col)
    if (col.as) transformedColumn.as = col.as

    const replaceWith = byName.get(transformedColumn.as)
    if (replaceWith === undefined) append(transformedColumn)
    else transformedColumns[replaceWith] = transformedColumn

    setElementOnColumns(transformedColumn, ctx.query.elements[col.as])
  }

  function getTransformedColumn(col) {
    let ret
    if (col !== null && typeof col === 'object' && '#' in col) {
      ret = enumsModule.resolveEnumToken(ctx, col, [], -1)
      // cast is already resolved inside resolveEnumToken; do not overwrite it here
      return ret
    }
    if (col.func) {
      ret = {
        func: col.func,
        args: expressionsModule.getTransformedFunctionArgs(ctx, col.args),
        as: col.func, // may be overwritten by the explicit alias
      }
    }
    if (col.xpr) {
      ret ??= {}
      ret.xpr = expressionsModule.getTransformedTokenStream(ctx, col.xpr)
    }
    if (ret) {
      if (col.cast) ret.cast = enumsModule.resolveEnumCastType(ctx, col.cast)
      return ret
    }
    return { ...col }
  }

  function handleEmptyColumns(columns) {
    if (columns.some(c => c.$refLinks?.[c.$refLinks.length - 1].definition.type === 'cds.Composition')) return
    throw new Error('Queries must have at least one non-virtual column')
  }
}

function resolveCalculatedElement(ctx, column, omitAlias = false, $baseLink = null) {
  let value

  if (column.$refLinks) {
    value = getCalculatedValue(ctx, column)
    if (column.$refLinks.length > 1) {
      $baseLink =
        bindingFor(ctx, column).association ||
        // if there is no association in the path, the table alias is the base link
        // TA might refer to subquery -> we need to propagate the alias to all paths of the calc element
        column.$refLinks[0]
    }
  } else {
    value = getCalculatedValue(ctx, column)
  }
  const { ref, val, xpr, func } = value

  let res
  if (ref) {
    res = expressionsModule.getTransformedTokenStream(ctx, [value], { $baseLink })[0]
  } else if (xpr) {
    res = { xpr: expressionsModule.getTransformedTokenStream(ctx, value.xpr, { $baseLink }) }
  } else if (val !== undefined) {
    res = { val }
  } else if (func) {
    res = { args: expressionsModule.getTransformedFunctionArgs(ctx, value.args, $baseLink), func: value.func }
  }
  if (!omitAlias) res.as = column.as || column.name || column.flatName
  setElementOnColumns(res, column.element || column)
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
function calculateDollarSelfColumn(ctx, col, omitAlias = false) {
  const cache = ctx.selfColumns || (ctx.selfColumns = new WeakMap())
  const dummyColumn = buildDummyColumnForDollarSelf({ ...col }, col.$refLinks)

  return dummyColumn

  function buildDummyColumnForDollarSelf(dollarSelfColumn, $refLinks) {
    const { ref, as } = dollarSelfColumn
    const stepToFind = ref[1]
    let referencedColumn = planFor(ctx, ctx.query.SELECT).byName.get(stepToFind)
    if (referencedColumn.ref?.[0] === '$self') {
      const source = referencedColumn
      referencedColumn = cache.get(source)
      if (!referencedColumn) {
        referencedColumn = buildDummyColumnForDollarSelf({ ...source }, source.$refLinks)
        cache.set(source, referencedColumn)
      }
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
      // target column is `val`, `xpr`, or `func` — destructure and throw away the ref with the $self
      // eslint-disable-next-line no-unused-vars
      const { xpr, val, func, args, ref, as: _as, ...rest } = referencedColumn
      if (xpr) rest.xpr = xpr
      else if (func) {
        rest.func = func
        rest.args = args
      } else rest.val = val
      dollarSelfColumn = { ...rest } // reassign dummyColumn without 'ref'
      if (!omitAlias) dollarSelfColumn.as = as
    }
    return dollarSelfColumn.ref?.[0] === '$self'
      ? buildDummyColumnForDollarSelf({ ...dollarSelfColumn }, $refLinks)
      : dollarSelfColumn
  }
}
