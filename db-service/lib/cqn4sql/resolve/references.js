'use strict'

module.exports = { resolveExpression, getFullPathForLinkedArg }

const { forEachChild } = require('../expression-tree')

const { elementSources } = require('./sources')

const projectionsModule = require('./projections')
const calculatedModule = require('./calculated')

const cds = require('@sap/cds')

const { keysOf } = require('../model')

const { pseudos } = require('../pseudos')
const { isCalculatedOnRead, defineProperty, hasOwnSkip, isRuntimeView } = require('../../utils')
const {
  isNonForeignKeyNavigation,
  rejectNonFkNavigation,
  getMainAlias,
  idOnly,
  rejectDuplicatedElement,
  getElementForCast,
  getCopyWithAnnos,
} = require('./helpers')

/**
 * This function is responsible for inferring a query element based on a provided column.
 * It initializes and attaches a non-enumerable `$refLinks` property to the column,
 * which stores an array of objects that represent the corresponding artifact of the ref step.
 * Each object in the `$refLinks` array corresponds to the same index position in the `column.ref` array.
 * Based on the leaf artifact (last object in the `$refLinks` array), the query element is inferred.
 *
 * @param {object} arg - The column object that contains the properties to infer a query element.
 * @param {boolean} [queryElements=true] - Determines whether the inferred element should be inserted into the queries elements.
 * For instance, it's set to false when walking over the where clause.
 * @param {object} [$baseLink=null] - A base reference link, usually it's an object with a definition and a target.
 * Used for infix filters, exists <assoc> and nested projections.
 * @param {object} [context={}] - Contextual information for element inference.
 * @param {boolean} [context.inExists=false] - Flag to control the creation of joins for non-association path traversals.
 * for `exists <assoc>` paths we do not need to create joins for path expressions as they are part of the semi-joined subquery.
 * @param {boolean} [context.inXpr=false] - Flag to signal whether the element is part of an expression.
 * Used to ignore non-persisted elements.
 * @param {boolean} [context.inNestedProjection=false] - Flag to signal whether the element is part of a nested projection.
 *
 * Note:
 * - `inExists` is used to specify cases where no joins should be created for non-association path traversals.
 *   It is primarily used for infix filters in `exists assoc[parent.foo='bar']`, where it becomes part of a semi-join.
 * - Columns with a `param` property are parameter references resolved into values only at execution time.
 * - Columns with an `args` property are function calls in expressions.
 * - Columns with a `list` property represent a list of values (e.g., for the IN operator).
 * - Columns with a `SELECT` property represent subqueries.
 *
 * @throws {Error} If an unmanaged association is found in an infix filter path, an error is thrown.
 * @throws {Error} If a non-foreign key traversal is found in an infix filter, an error is thrown.
 * @throws {Error} If a first step is not found in the combined elements, an error is thrown.
 * @throws {Error} If a filter is provided while navigating along non-associations, an error is thrown.
 * @throws {Error} If the same element name is inferred more than once, an error is thrown.
 *
 * @returns {void}
 */

function resolveExpression(ctx, arg, queryElements = null, $baseLink = null, context = {}) {
  const { inExists, inXpr, inCalcElement, baseColumn, inInfixFilter, inQueryModifier, inFrom, dollarSelfRefs } = context
  if (arg.param || arg.SELECT) return // parameter references are only resolved into values on execution e.g. :val, :1 or ?
  forEachChild(arg, (token, i, prop, siblings) =>
    resolveExpression(
      ctx,
      token,
      prop === 'xpr' ? queryElements : null,
      $baseLink,
      prop === 'xpr' ? { ...context, inXpr: true, inExists: inExists || siblings[i - 1] === 'exists' } : context,
    ),
  )

  if (!arg.ref) {
    if (arg.expand && queryElements) queryElements[arg.as] = projectionsModule.resolveExpand(ctx, arg)
    return
  }

  // Before the arg is linked, it's meta information should be cleaned up.
  // This may be important if one manipulates the arg object
  // __after__ a query has been fired and re-uses the manipulated query
  defineProperty(arg, '$refLinks', [])
  defineProperty(arg, 'isJoinRelevant', false)

  // if any path step points to an artifact with `@cds.persistence.skip`
  // we must ignore the element from the queries elements
  let isPersisted = true
  let firstStepIsTableAlias, firstStepIsSelf, expandOnTableAlias
  const firstStepIsDollarMain = arg.ref.length > 1 && arg.ref[0] === '$main'
  if (!inFrom && !firstStepIsDollarMain) {
    firstStepIsTableAlias = arg.ref.length > 1 && arg.ref[0] in ctx.sources
    firstStepIsSelf = !firstStepIsTableAlias && arg.ref.length > 1 && ['$self', '$projection'].includes(arg.ref[0])
    expandOnTableAlias = arg.ref.length === 1 && arg.ref[0] in ctx.sources && (arg.expand || arg.inline)
  }

  if (dollarSelfRefs && firstStepIsSelf) {
    defineProperty(arg, 'inXpr', true)
    dollarSelfRefs.push(arg)
    return
  }
  const nameSegments = []
  // if a (segment) of a (structured) foreign key is renamed, we must not include
  // the aliased ref segments into the name of the final foreign key which is e.g. used in
  // on conditions of joins
  const skipAliasedFkSegmentsOfNameStack = []
  let pseudoPath = false
  for (let i = 0; i < arg.ref.length; i++) {
    const step = arg.ref[i]
    const id = step.id || step
    if (i === 0) {
      if (firstStepIsDollarMain) {
        if (inFrom) {
          // we need to resolve the full from clause first
          context.$mainLazyResolve.push(arg)
          return // this will be done once the from clause is fully resolved
        } else {
          // replace $main with the alias of the outermost query
          const mainAlias = getMainAlias(ctx.query)
          arg.$refLinks.push(Object.assign(mainAlias, { $main: true }))
        }
      } else if (id in pseudos.elements) {
        // pseudo path
        arg.$refLinks.push({ definition: pseudos.elements[id], target: pseudos })
        pseudoPath = true // only first path step must be well defined
        nameSegments.push(id)
      } else if ($baseLink && !firstStepIsSelf) {
        const { definition, target } = $baseLink
        const elements = ctx.getDefinition(definition.target)?.elements || definition.elements
        if (elements && id in elements) {
          const element = elements[id]
          if (inInfixFilter) {
            const nextStep = arg.ref[1]?.id || arg.ref[1]
            if (isNonForeignKeyNavigation(element, nextStep) || arg.ref[0]?.where) {
              if (inExists) {
                defineProperty($baseLink, 'pathExpressionInsideFilter', true)
              } else if (!inFrom) {
                rejectNonFkNavigation(element, element.on ? $baseLink.definition.name : nextStep)
              }
            }
          }
          const resolvableIn = ctx.getDefinition(definition.target) || target
          const $refLink = { definition: elements[id], target: resolvableIn }
          arg.$refLinks.push($refLink)
        } else {
          stepNotFoundInPredecessor(id, definition.name)
        }
        nameSegments.push(id)
      } else if (inFrom) {
        const definition = ctx.getDefinition(id) || cds.error`"${id}" not found in the definitions of your model`
        arg.$refLinks.push({ definition, target: definition })
      } else if (firstStepIsTableAlias) {
        arg.$refLinks.push({
          definition: ctx.sources[id].definition,
          target: ctx.sources[id].definition,
        })
      } else if (firstStepIsSelf) {
        const nextStep = arg.ref[1]?.id || arg.ref[1]
        let elements = queryElements
        if (nextStep && (!queryElements || !(nextStep in queryElements)) && ctx.query.outerQueries) {
          const outerQuery = ctx.query.outerQueries[0]
          if (outerQuery?.elements && nextStep in outerQuery.elements) {
            elements = outerQuery.elements
          }
        }
        arg.$refLinks.push({ definition: { elements }, target: { elements } })
      } else if (arg.ref.length > 1 && ctx.query.outerQueries?.find(outer => id in outer.sources)) {
        // outer query accessed via alias
        const outerAlias = ctx.query.outerQueries.find(outer => id in outer.sources)
        arg.$refLinks.push({
          definition: outerAlias.sources[id].definition,
          target: outerAlias.sources[id].definition,
        })
      } else if (elementSources(ctx.query, id)) {
        if (elementSources(ctx.query, id).length > 1) stepIsAmbiguous(id) // exit
        const definition = elementSources(ctx.query, id)[0].tableAlias.elements[id]
        const $refLink = { definition, target: elementSources(ctx.query, id)[0].tableAlias }
        arg.$refLinks.push($refLink)
        nameSegments.push(id)
      } else if (expandOnTableAlias) {
        // expand on table alias
        arg.$refLinks.push({
          definition: ctx.sources[id].definition,
          target: ctx.sources[id].definition,
        })
      } else {
        stepNotFoundInCombinedElements(id) // REVISIT: fails with {__proto__:elements)
      }
    } else {
      const { definition } = arg.$refLinks[i - 1]
      const elements = ctx.getDefinition(definition.target)?.elements || definition.elements //> go for assoc._target first, instead of assoc as struct
      const element = elements?.[id]

      if (firstStepIsSelf && element?.isAssociation) {
        throw new Error(
          `Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ ${arg.ref
            .map(idOnly)
            .join(', ')} ]`,
        )
      }

      const target = ctx.getDefinition(definition.target) || arg.$refLinks[i - 1].target
      if (element) {
        if ($baseLink && inInfixFilter) {
          const nextStep = arg.ref[i + 1]?.id || arg.ref[i + 1]
          if (isNonForeignKeyNavigation(element, nextStep) || arg.ref[i - 1]?.where) {
            if (inExists) {
              defineProperty($baseLink, 'pathExpressionInsideFilter', true)
            } else if (!inFrom) {
              rejectNonFkNavigation(element, element.on ? $baseLink.definition.name : nextStep)
            }
          }
        }
        const $refLink = { definition: elements[id], target }
        arg.$refLinks.push($refLink)
      } else if (firstStepIsSelf) {
        stepNotFoundInColumnList(id)
      } else if (arg.ref[0] === '$user' && pseudoPath) {
        // `$user.some.unknown.element` -> no error
        arg.$refLinks.push({ definition: {}, target })
      } else if (id === '$dummy') {
        // `some.known.element.$dummy` -> no error; used by cds.ql to simulate joins
        arg.$refLinks.push({ definition: { name: '$dummy', parent: arg.$refLinks[i - 1].target } })
        defineProperty(arg, 'isJoinRelevant', true)
      } else {
        const notFoundIn = pseudoPath ? arg.ref[i - 1] : getFullPathForLinkedArg(ctx, arg)
        stepNotFoundInPredecessor(id, notFoundIn)
      }
      const foreignKeyAlias = Array.isArray(keysOf(definition, ctx.state.metadata))
        ? keysOf(definition, ctx.state.metadata).find(k => {
            if (k.ref.every((step, j) => arg.ref[i + j] === step)) {
              skipAliasedFkSegmentsOfNameStack.push(...k.ref.slice(1))
              return true
            }
            return false
          })?.as
        : null
      if (foreignKeyAlias) nameSegments.push(foreignKeyAlias)
      else if (skipAliasedFkSegmentsOfNameStack[0] === id) skipAliasedFkSegmentsOfNameStack.shift()
      else {
        nameSegments.push(firstStepIsSelf && i === 1 ? element.__proto__.name : id)
      }
    }

    if (step.where) {
      const danglingFilter = !(arg.ref[i + 1] || arg.expand || arg.inline || inExists)
      const definition = arg.$refLinks[i].definition
      if ((!definition.target && definition.kind !== 'entity') || (!inFrom && !inCalcElement && danglingFilter))
        throw new Error('A filter can only be provided when navigating along associations')
      if (!inFrom && !arg.expand) defineProperty(arg, 'isJoinRelevant', true)
      // The filter of an `expand` becomes the `where` of the expand subquery.
      // Just like `where exists <assoc>[…]` semi-joins, path expressions in it are
      // resolved via joins inside that subquery, so they must not be rejected here.
      const filterOfExpand = !!arg.expand
      let skipJoinsForFilter = false
      step.where.forEach(token => {
        if (token === 'exists') {
          // books[exists genre[code='A']].title --> column is join relevant but inner exists filter is not
          skipJoinsForFilter = true
        } else if (token.ref || token.xpr || token.list || token.func) {
          // For scoped queries (non-dangling filters in FROM), treat filter contents as EXISTS context
          // because they will become part of an EXISTS subquery
          resolveExpression(ctx, token, false, arg.$refLinks[i], {
            ...context,
            inExists: skipJoinsForFilter || inExists || filterOfExpand || (inFrom && !danglingFilter),
            inXpr: !!(token.xpr || token.func),
            inInfixFilter: true,
            inFrom,
          })
        }
      })
    }

    if (!arg.$refLinks[i].$main) arg.$refLinks[i].alias = !arg.ref[i + 1] && arg.as ? arg.as : id.split('.').pop()
    const def = ctx.getDefinition(arg.$refLinks[i].definition.target)
    if (hasOwnSkip(def) && !isRuntimeView(def)) isPersisted = false
    if (!arg.ref[i + 1]) {
      const flatName = nameSegments.join('_')
      defineProperty(arg, 'flatName', flatName)
      // if column is casted, we overwrite it's origin with the new type
      if (arg.cast) {
        const base = getElementForCast(arg)
        if (insertIntoQueryElements())
          queryElements[arg.as || flatName] = getCopyWithAnnos(arg, base, ctx.resolveNestedElements)
      } else if (arg.expand && !context.inNestedProjection) {
        const elements = projectionsModule.resolveExpand(ctx, arg)
        let elementName
        // expand on table alias
        if (arg.$refLinks.length === 1 && arg.$refLinks[0].definition.kind === 'entity')
          elementName = arg.$refLinks[0].alias
        else elementName = arg.as || flatName

        if (queryElements) {
          if (queryElements[elementName] !== undefined) rejectDuplicatedElement(elementName)
          queryElements[elementName] = elements
        }
      } else if (arg.inline && queryElements) {
        const elements = projectionsModule.resolveInline(ctx, arg)
        for (const elName in elements) {
          if (queryElements[elName] !== undefined) rejectDuplicatedElement(elName)
        }
        Object.assign(queryElements, elements)
      } else {
        // shortcut for `ref: ['$user']` -> `ref: ['$user', 'id']`
        const leafArt =
          i === 0 && id === '$user' ? arg.$refLinks[i].definition.elements.id : arg.$refLinks[i].definition
        // infer element based on leaf artifact of path
        if (insertIntoQueryElements()) {
          let elementName
          if (arg.as) {
            elementName = arg.as
          } else {
            // if the navigation the user has written differs from the final flat ref - e.g. for renamed foreign keys -
            // the inferred name of the element equals the flat version of the user-written ref.
            const refNavigation = arg.ref
              .slice(firstStepIsSelf || firstStepIsTableAlias ? 1 : 0)
              .map(idOnly)
              .join('_')
            if (refNavigation !== flatName) elementName = refNavigation
            else elementName = flatName
          }
          if (queryElements[elementName] !== undefined) rejectDuplicatedElement(elementName)
          const element = getCopyWithAnnos(arg, leafArt, ctx.resolveNestedElements)
          queryElements[elementName] = element
        }
      }
    }
  }
  // we need inner joins for the path expressions inside filter expressions after exists predicate
  if ($baseLink?.pathExpressionInsideFilter) defineProperty(arg, 'join', 'inner')

  // ignore whole expand if target of assoc along path has ”@cds.persistence.skip”
  if (arg.expand) {
    const { $refLinks } = arg

    const skip = $refLinks.some(link => {
      const def = ctx.getDefinition(link.definition.target)
      return hasOwnSkip(def) && !isRuntimeView(def)
    })
    if (skip) {
      $refLinks[$refLinks.length - 1].skipExpand = true
      return
    }
  }
  const leafArt = arg.$refLinks[arg.$refLinks.length - 1].definition
  const virtual = (leafArt.virtual || !isPersisted) && !inXpr
  // check if we need to merge the column `ref` into the join tree of the query
  if (!inFrom && !inExists && !virtual && !inCalcElement) {
    // for a ref inside an `inline` we need to consider the column `ref` which has the `inline` prop
    const colWithBase = baseColumn
      ? { ref: [...baseColumn.ref, ...arg.ref], $refLinks: [...baseColumn.$refLinks, ...arg.$refLinks] }
      : arg
    if (calculatedModule.isColumnJoinRelevant(ctx, colWithBase)) {
      defineProperty(arg, 'isJoinRelevant', true)
      // join resolved in outer query
      if (!(arg.$refLinks[0].$main && ctx.query.outerQueries))
        ctx.query.joinTree.mergeColumn(colWithBase, ctx.query.outerQueries)
    }
  }
  if (isCalculatedOnRead(leafArt)) {
    calculatedModule.linkCalculatedElement(ctx, arg, $baseLink, baseColumn, context)
  }

  function insertIntoQueryElements() {
    return queryElements && !inXpr && !inInfixFilter && !inQueryModifier
  }

  function stepNotFoundInPredecessor(step, def) {
    throw new Error(`"${step}" not found in "${def}"`)
  }

  function stepIsAmbiguous(step) {
    throw new Error(
      `ambiguous reference to "${step}", write ${Object.values(elementSources(ctx.query, step))
        .map(ta => `"${ta.index}.${step}"`)
        .join(', ')} instead`,
    )
  }

  function stepNotFoundInCombinedElements(step) {
    throw new Error(
      `"${step}" not found in the elements of ${Object.values(ctx.sources)
        .map(s => s.definition)
        .map(def => `"${def.name || /* subquery */ def.as}"`)
        .join(', ')}`,
    )
  }

  function stepNotFoundInColumnList(step) {
    const err = [`"${step}" not found in the columns list of query`]
    // if the `elt` from a `$self.elt` path is found in the `$combinedElements` -> hint to remove `$self`
    if (elementSources(ctx.query, step))
      err.push(
        ` did you mean ${elementSources(ctx.query, step)
          .map(ta => `"${ta.index || ta.as}.${step}"`)
          .join(',')}?`,
      )
    throw new Error(err.join(','))
  }
}

/**
 * Returns the csn path as string for a given column ref with sibling $refLinks
 *
 * @param {object} arg
 * @returns {string}
 */
function getFullPathForLinkedArg(ctx, arg) {
  let firstStepIsEntity = false
  return arg.$refLinks.reduce((res, cur, i) => {
    if (cur.definition.kind === 'entity') {
      firstStepIsEntity = true
      if (arg.$refLinks.length === 1) return `${cur.definition.name}`
      return `${cur.definition.name}`
    } else if (cur.definition.SELECT) {
      return `${cur.definition.as}`
    }
    const dot = i === 1 && firstStepIsEntity ? ':' : '.' // divide with colon if first step is entity
    return res !== '' ? res + dot + cur.definition.name : cur.definition.name
  }, '')
}
