'use strict'

module.exports = { linkCalculatedElement, isColumnJoinRelevant }

const { forEachChild } = require('../expression-tree')

const { getCalculatedValue } = require('../scope')

const referencesModule = require('./references')

const { keysOf } = require('../model')

const { defineProperty } = require('../../utils')

function linkCalculatedElement(ctx, column, baseLink, baseColumn, context = {}) {
  const calcElement = column.$refLinks?.[column.$refLinks.length - 1].definition || column
  if (ctx.alreadySeenCalcElements.has(column)) return
  else ctx.alreadySeenCalcElements.add(column)
  const value = getCalculatedValue(ctx, column)
  const parent = ctx.getDefinition(calcElement.parent.name)
  baseLink = { definition: parent, target: parent }
  referencesModule.resolveExpression(ctx, value, null, baseLink, { inCalcElement: true, ...context })
  const basePath = {
    $refLinks: [...(baseColumn?.$refLinks || []), ...(column.$refLinks?.slice(0, -1) || [])],
    ref: [...(baseColumn?.ref || []), ...(column.ref?.slice(0, -1) || [])],
  }
  mergePathsIntoJoinTree(value, basePath)

  /**
   * Calculates all paths from a given ref and merges them into the join tree.
   * Recursively walks into refs of calculated elements.
   *
   * @param {object} arg with a ref and sibling $refLinks
   * @param {object} basePath with a ref and sibling $refLinks, used for recursion
   */
  function mergePathsIntoJoinTree(arg, basePath = null) {
    basePath = basePath || { $refLinks: [], ref: [] }
    if (arg.ref) {
      arg.$refLinks.forEach((link, i) => {
        const { definition } = link
        if (!definition.value) {
          basePath.$refLinks.push(link)
          basePath.ref.push(arg.ref[i])
        }
      })
      const leafOfCalculatedElementRef = arg.$refLinks[arg.$refLinks.length - 1].definition
      if (leafOfCalculatedElementRef.value) mergePathsIntoJoinTree(getCalculatedValue(ctx, arg), basePath)

      mergePathIfNecessary(basePath, arg)
    } else {
      forEachChild(arg, (step, i, prop, siblings) => {
        const subPath = { $refLinks: [...basePath.$refLinks], ref: [...basePath.ref] }
        if (step.ref && prop === 'xpr' && siblings[i - 1] === 'exists') {
          // EXISTS owns its target scope. Only the prefix needs an outer join
          // to correlate the subquery, even if that prefix otherwise uses FKs.
          if (subPath.$refLinks.length) {
            ctx.query.joinTree.mergeColumn(subPath, ctx.query.outerQueries)
            subPath.$refLinks.at(-1).onlyForeignKeyAccess = false
            if (!value.isJoinRelevant) defineProperty(step, 'isJoinRelevant', true)
          }
        } else mergePathsIntoJoinTree(step, subPath)
      })
    }

    function mergePathIfNecessary(p, step) {
      const calcElementIsJoinRelevant = isColumnJoinRelevant(ctx, p)
      if (calcElementIsJoinRelevant) {
        if (!value.isJoinRelevant) defineProperty(step, 'isJoinRelevant', true)
        ctx.query.joinTree.mergeColumn(p, ctx.query.outerQueries)
      } else {
        // we need to explicitly set the value to false in this case,
        // e.g. `SELECT from booksCalc.Books { ID, author.{name }, author {name } }`
        // --> for the inline column, the name is join relevant, while for the expand, it is not
        defineProperty(step, 'isJoinRelevant', false)
      }
    }
  }
}

/**
 * Checks whether or not the `ref` of the given column is join relevant.
 * A `ref` is considered join relevant if it includes an association traversal and:
 *    - the association is unmanaged
 *    - a non-foreign key access is performed
 *    - an infix filter is applied at the association
 *
 * @param {object} column the column with the `ref` to check for join relevance
 * @returns {boolean} true if the column ref needs to be merged into a join tree
 */
function isColumnJoinRelevant(ctx, column) {
  let fkAccess = false
  let assoc = null
  for (let i = 0; i < column.ref.length; i++) {
    const ref = column.ref[i]
    const link = column.$refLinks[i]
    if (link.definition.on && link.definition.isAssociation) {
      if (!column.ref[i + 1]) {
        if (column.expand && assoc) return true
        // if unmanaged assoc is exposed, ignore it
        return false
      }
      return true
    }
    if (assoc) {
      // if(!link.definition.isAssociation) continue
      let fkIndex = keysOf(assoc, ctx.state.metadata)?.findIndex(key =>
        key.ref.every((step, j) => column.ref[i + j] === step),
      )
      // foreign key access without filters never join relevant
      if (fkIndex !== -1) {
        if (column.ref.slice(i).some(s => s.where)) continue // probably join relevant later on
        fkAccess = true
        assoc = null
        continue
      }
      // <assoc>.<anotherAssoc>.<…> is join relevant as <anotherAssoc> is not fk of <assoc>
      return true
    }
    if (link.definition.target && keysOf(link.definition, ctx.state.metadata)) {
      if (column.ref[i + 1] || assoc) fkAccess = false
      else fkAccess = true
      assoc = link.definition
      if (ref.where) {
        // always join relevant except for expand assoc
        if (column.expand && !column.ref[i + 1]) return false
        return true
      }
    }
  }

  if (!assoc) return false
  if (fkAccess) return false
  return true
}
