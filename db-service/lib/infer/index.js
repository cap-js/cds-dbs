'use strict'

const cds = require('@sap/cds')

const JoinTree = require('./join-tree')
const { pseudos } = require('./pseudos')
const { isCalculatedOnRead } = require('../utils')
const cdsTypes = cds.linked({
  definitions: {
    Timestamp: { type: 'cds.Timestamp' },
    DateTime: { type: 'cds.DateTime' },
    Date: { type: 'cds.Date' },
    Time: { type: 'cds.Time' },
    String: { type: 'cds.String' },
    Decimal: { type: 'cds.Decimal' },
    Integer: { type: 'cds.Integer' },
    Boolean: { type: 'cds.Boolean' },
  },
}).definitions
for (const each in cdsTypes) cdsTypes[`cds.${each}`] = cdsTypes[each]
/**
 * @param {import('@sap/cds/apis/cqn').Query|string} originalQuery
 * @param {import('@sap/cds/apis/csn').CSN} [model]
 * @returns {import('./cqn').Query} = q with .target and .elements
 */
function infer(originalQuery, model) {
  if (!model) throw new Error('Please specify a model')
  const inferred = originalQuery

  // REVISIT: The more edge use cases we support, thes less optimized are we for the 90+% use cases
  // e.g. there's a lot of overhead for infer( SELECT.from(Books) )
  if (originalQuery.SET) throw new Error('”UNION” based queries are not supported')
  const _ =
    inferred.SELECT ||
    inferred.INSERT ||
    inferred.UPSERT ||
    inferred.UPDATE ||
    inferred.DELETE ||
    inferred.CREATE ||
    inferred.DROP

  // cache for already processed calculated elements
  const alreadySeenCalcElements = new Set()

  let $combinedElements

  const sources = inferTarget(_.from || _.into || _.entity, {})
  const joinTree = new JoinTree(sources)
  const aliases = Object.keys(sources)
  Object.defineProperties(inferred, {
    // REVISIT: public, or for local reuse, or in cqn4sql only?
    sources: { value: sources, writable: true },
    target: {
      value: aliases.length === 1 ? getDefinitionFromSources(sources, aliases[0]) : originalQuery,
      writable: true,
    }, // REVISIT: legacy?
  })
  // also enrich original query -> writable because it may be inferred again
  Object.defineProperties(originalQuery, {
    sources: { value: sources, writable: true },
    target: {
      value: aliases.length === 1 ? getDefinitionFromSources(sources, aliases[0]) : originalQuery,
      writable: true,
    },
  })
  if (originalQuery.SELECT || originalQuery.DELETE || originalQuery.UPDATE) {
    $combinedElements = inferCombinedElements()
    /**
     * TODO: this function is currently only called on DELETE's
     *       because it correctly set's up the $refLink's in the
     *       where clause: This functionality should be pulled out
     *       of ´inferQueryElement()` as this is a subtle side effect
     */
    const elements = inferQueryElements()
    Object.defineProperties(inferred, {
      $combinedElements: { value: $combinedElements, writable: true, configurable: true },
      elements: { value: elements, writable: true, configurable: true },
      joinTree: { value: joinTree, writable: true, configurable: true }, // REVISIT: eliminate
    })
    // also enrich original query -> writable because it may be inferred again
    Object.defineProperty(originalQuery, 'elements', { value: elements, writable: true, configurable: true })
  }
  return inferred

  /**
   * Infers all query sources from a given SQL-like query's `from` clause.
   * It drills down into join arguments of the `from` clause.
   *
   * This function helps identify each source, target, and association within the `from` clause.
   * It processes the `from` clause in the query and maps each source to a respective target and alias.
   * In case of any errors like missing definitions or associations, this function will throw an error.
   *
   * @function inferTarget
   * @param {object|string} from - The `from` clause of the query to infer the target from.
   *                              It could be an object or a string.
   * @param {object} querySources - An object to map the query sources.
   *                              Each key is a query source alias, and its value is the corresponding CSN Definition.
   * @returns {object} The updated `querySources` object with inferred sources from the `from` clause.
   */
  function inferTarget(from, querySources) {
    const { ref } = from
    if (ref) {
      const { id, args } = ref[0]
      const first = id || ref[0]
      let target = getDefinition(first) || cds.error`"${first}" not found in the definitions of your model`
      if (!target) throw new Error(`"${first}" not found in the definitions of your model`)
      if (ref.length > 1) {
        target = from.ref.slice(1).reduce((d, r) => {
          const next = getDefinition(d.elements[r.id || r]?.target) || d.elements[r.id || r]
          if (!next) throw new Error(`No association “${r.id || r}” in ${d.kind} “${d.name}”`)
          return next
        }, target)
      }
      if (target.kind !== 'entity' && !target.isAssociation)
        throw new Error('Query source must be a an entity or an association')

      inferArg(from, null, null, { inFrom: true })
      const alias =
      from.uniqueSubqueryAlias ||
      from.as ||
      (ref.length === 1
        ? first.substring(first.lastIndexOf('.') + 1)
        : (ref.at(-1).id || ref.at(-1)));    
      if (alias in querySources) throw new Error(`Duplicate alias "${alias}"`)
      querySources[alias] = { definition: target, args }
      const last = from.$refLinks.at(-1)
      last.alias = alias
    } else if (from.args) {
      from.args.forEach(a => inferTarget(a, querySources))
    } else if (from.SELECT) {
      const subqueryInFrom = infer(from, model) // we need the .elements in the sources
      // if no explicit alias is provided, we make up one
      const subqueryAlias =
        from.as || subqueryInFrom.joinTree.addNextAvailableTableAlias('__select__', subqueryInFrom.outerQueries)
      querySources[subqueryAlias] = { definition: from }
    } else if (typeof from === 'string') {
      // TODO: Create unique alias, what about duplicates?
      const definition = getDefinition(from) || cds.error`"${from}" not found in the definitions of your model`
      querySources[from.substring(from.lastIndexOf('.') + 1)] = { definition }
    } else if (from.SET) {
      infer(from, model)
    }
    return querySources
  }

  /**
   * Calculates the `$combinedElements` based on the provided queries `sources`.
   * The `$combinedElements` of a query consist of all accessible elements across all
   * the table aliases found in the from clause.
   *
   * The `$combinedElements` are attached to the query as a non-enumerable property.
   * Each entry in the `$combinedElements` dictionary maps from the element name
   * to an array of objects containing the index and table alias where the element can be found.
   *
   * @returns {object} The `$combinedElements` dictionary, which maps element names to an array of objects
   *                   containing the index and table alias where the element can be found.
   */
  function inferCombinedElements() {
    const combinedElements = {}
    for (const index in sources) {
      const tableAlias = getDefinitionFromSources(sources, index)
      for (const key in tableAlias.elements) {
        if (key in combinedElements) combinedElements[key].push({ index, tableAlias })
        else combinedElements[key] = [{ index, tableAlias }]
      }
    }
    return combinedElements
  }

  /**
   * Assigns the given `element` as non-enumerable property 'element' onto `col`.
   *
   * @param {object} col
   * @param {csn.Element} element
   */
  function setElementOnColumns(col, element) {
    Object.defineProperty(col, 'element', {
      value: element,
      writable: true,
    })
  }

  /**
   * Walks over all columns of a query's `SELECT` and infers each `ref`, `xpr`, or `val` as a query element
   * based on the query's `$combinedElements` and `sources`.
   *
   * The inferred `elements` are attached to the query as a non-enumerable property.
   *
   * Also walks over other `ref`s in the query, validates them, and attaches `$refLinks`.
   * This includes handling `where`, infix filters within column `refs`, or other `csn` paths.
   *
   * @param {object} $combinedElements The `$combinedElements` dictionary of the query, which maps element names
   *                                   to an array of objects containing the index and table alias where the element can be found.
   * @returns {object} The inferred `elements` dictionary of the query, which maps element names to their corresponding definitions.
   */
  function inferQueryElements() {
    let queryElements = {}
    const { columns, where, groupBy, having, orderBy } = _
    if (!columns) {
      inferElementsFromWildCard(queryElements)
    } else {
      let wildcardSelect = false
      const dollarSelfRefs = []
      columns.forEach(col => {
        if (col === '*') {
          wildcardSelect = true
        } else if (col.val !== undefined || col.xpr || col.SELECT || col.func || col.param) {
          const as = col.as || col.func || col.val
          if (as === undefined) cds.error`Expecting expression to have an alias name`
          if (queryElements[as]) cds.error`Duplicate definition of element “${as}”`
          if (col.xpr || col.SELECT) {
            queryElements[as] = getElementForXprOrSubquery(col, queryElements, dollarSelfRefs)
          }
          if (col.func) {
            if (col.args) {
              // {func}.args are optional
              applyToFunctionArgs(col.args, inferArg, [false, null, {dollarSelfRefs}])
            }
            queryElements[as] = getElementForCast(col)
          }
          if (!queryElements[as]) {
            // either binding parameter (col.param) or value
            queryElements[as] = col.cast ? getElementForCast(col) : getCdsTypeForVal(col.val)
          }
          setElementOnColumns(col, queryElements[as])
        } else if (col.ref) {
          const firstStepIsTableAlias =
            (col.ref.length > 1 && col.ref[0] in sources) ||
            // nested projection on table alias
            (col.ref.length === 1 && col.ref[0] in sources && col.inline)
          const firstStepIsSelf =
            !firstStepIsTableAlias && col.ref.length > 1 && ['$self', '$projection'].includes(col.ref[0])
          // we must handle $self references after the query elements have been calculated
          if (firstStepIsSelf) dollarSelfRefs.push(col)
          else handleRef(col)
        } else if (col.expand) {
          inferArg(col, queryElements, null)
        } else {
          cds.error`Not supported: ${JSON.stringify(col)}`
        }
      })

      if (dollarSelfRefs.length) inferDollarSelfRefs(dollarSelfRefs)

      if (wildcardSelect) inferElementsFromWildCard(queryElements)
    }
    if (orderBy) {
      // link $refLinks -> special name resolution rules for orderBy
      orderBy.forEach(token => {
        let $baseLink
        let rejectJoinRelevantPath
        // first check if token ref is resolvable in query elements
        if (columns) {
          const firstStep = token.ref?.[0].id || token.ref?.[0]
          const tokenPointsToQueryElements = columns.some(c => {
            const columnName = c.as || c.flatName || c.ref?.at(-1).id || c.ref?.at(-1) || c.func
            return columnName === firstStep
          })
          const needsElementsOfQueryAsBase =
            tokenPointsToQueryElements &&
            queryElements[token.ref?.[0]] &&
            /* expand on structure can be addressed */ !queryElements[token.ref?.[0]].$assocExpand

          // if the ref points into the query itself and follows an exposed association
          // to a non-fk column, we must reject the ref, as we can't join with the queries own results
          rejectJoinRelevantPath = needsElementsOfQueryAsBase
          if (needsElementsOfQueryAsBase) $baseLink = { definition: { elements: queryElements }, target: inferred }
        } else {
          // fallback to elements of query source
          $baseLink = null
        }

        inferArg(token, queryElements, $baseLink, { inQueryModifier: true })
        if (token.isJoinRelevant && rejectJoinRelevantPath) {
          // reverse the array, find the last association and calculate the index of the association in non-reversed order
          const assocIndex =
            token.$refLinks.length - 1 - token.$refLinks.reverse().findIndex(link => link.definition.isAssociation)

          throw new Error(
            `Can follow managed association “${token.ref[assocIndex].id || token.ref[assocIndex]}” only to the keys of its target, not to “${token.ref[assocIndex + 1].id || token.ref[assocIndex + 1]}”`,
          )
        }
      })
    }

    // walk over all paths in other query properties
    if (where) walkTokenStream(where, true)
    if (groupBy) walkTokenStream(groupBy)
    if (having) walkTokenStream(having)
    if (_.with)
      // consider UPDATE.with
      Object.values(_.with).forEach(val => inferArg(val, queryElements, null, { inXpr: true }))

    return queryElements

    /**
     * Recursively drill down into a tokenStream (`where` or `having`) and pass
     * on the information whether the next token is resolved within an `exists` predicates.
     * If such a token has an infix filter, it is not join relevant, because the filter
     * condition is applied to the generated `exists <subquery>` condition.
     *
     * @param {array} tokenStream
     */
    function walkTokenStream(tokenStream, inXpr = false) {
      let skipJoins
      const processToken = t => {
        if (t === 'exists') {
          // no joins for infix filters along `exists <path>`
          skipJoins = true
        } else if (t.xpr) {
          // don't miss an exists within an expression
          t.xpr.forEach(processToken)
        } else {
          inferArg(t, queryElements, null, { inExists: skipJoins, inXpr, inQueryModifier: true })
          skipJoins = false
        }
      }
      tokenStream.forEach(processToken)
    }
    /**
     * Processes references starting with `$self`, which are intended to target other query elements.
     * These `$self` paths must be handled after processing the "regular" columns since they are dependent on other query elements.
     *
     * This function checks for `$self` references that may target other `$self` columns, and delays their processing.
     * `$self` references not targeting other `$self` references are handled by the generic `handleRef` function immediately.
     *
     * @param {array} dollarSelfColumns - An array of column objects containing `$self` references.
     */
    function inferDollarSelfRefs(dollarSelfColumns) {
      do {
        const unprocessedColumns = []

        for (const currentDollarSelfColumn of dollarSelfColumns) {
          const { ref, inXpr } = currentDollarSelfColumn
          const stepToFind = ref[1]

          const referencesOtherDollarSelfColumn = dollarSelfColumns.find(
            otherDollarSelfCol =>
              !(stepToFind in queryElements) &&
              otherDollarSelfCol !== currentDollarSelfColumn &&
              (otherDollarSelfCol.as
                ? stepToFind === otherDollarSelfCol.as
                : stepToFind === otherDollarSelfCol.ref?.[otherDollarSelfCol.ref.length - 1]),
          )

          if (referencesOtherDollarSelfColumn) {
            unprocessedColumns.push(currentDollarSelfColumn)
          } else {
            handleRef(currentDollarSelfColumn, inXpr)
          }
        }

        dollarSelfColumns = unprocessedColumns
      } while (dollarSelfColumns.length > 0)
    }

    function handleRef(col, inXpr) {
      inferArg(col, queryElements, null,  { inXpr })
      const { definition } = col.$refLinks[col.$refLinks.length - 1]
      if (col.cast)
        // final type overwritten -> element not visible anymore
        setElementOnColumns(col, getElementForCast(col))
      else if ((col.ref.length === 1) & (col.ref[0] === '$user'))
        // shortcut to $user.id
        setElementOnColumns(col, queryElements[col.as || '$user'])
      else setElementOnColumns(col, definition)
    }
  }

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

  function inferArg(arg, queryElements = null, $baseLink = null, context = {}) {
    const { inExists, inXpr, inCalcElement, baseColumn, inInfixFilter, inQueryModifier, inFrom, dollarSelfRefs } = context
    if (arg.param || arg.SELECT) return // parameter references are only resolved into values on execution e.g. :val, :1 or ?
    if (arg.args) applyToFunctionArgs(arg.args, inferArg, [null, $baseLink, context])
    if (arg.list) arg.list.forEach(arg => inferArg(arg, null, $baseLink, context))
    if (arg.xpr) arg.xpr.forEach(token => inferArg(token, queryElements, $baseLink, { ...context, inXpr: true })) // e.g. function in expression

    if (!arg.ref) {
      if (arg.expand && queryElements) queryElements[arg.as] = resolveExpand(arg)
      return
    }

    // initialize $refLinks
    Object.defineProperty(arg, '$refLinks', {
      value: [],
      writable: true,
    })
    // if any path step points to an artifact with `@cds.persistence.skip`
    // we must ignore the element from the queries elements
    let isPersisted = true
    let firstStepIsTableAlias, firstStepIsSelf, expandOnTableAlias
    if (!inFrom) {
      firstStepIsTableAlias = arg.ref.length > 1 && arg.ref[0] in sources
      firstStepIsSelf = !firstStepIsTableAlias && arg.ref.length > 1 && ['$self', '$projection'].includes(arg.ref[0])
      expandOnTableAlias = arg.ref.length === 1 && arg.ref[0] in sources && (arg.expand || arg.inline)
    }
    if(dollarSelfRefs && firstStepIsSelf) {
      Object.defineProperty(arg, 'inXpr', { value: true, writable: true })
      dollarSelfRefs.push(arg)
      return
    }
    const nameSegments = []
    // if a (segment) of a (structured) foreign key is renamed, we must not include
    // the aliased ref segments into the name of the final foreign key which is e.g. used in
    // on conditions of joins
    const skipAliasedFkSegmentsOfNameStack = []
    let pseudoPath = false
    arg.ref.forEach((step, i) => {
      const id = step.id || step
      if (i === 0) {
        if (id in pseudos.elements) {
          // pseudo path
          arg.$refLinks.push({ definition: pseudos.elements[id], target: pseudos })
          pseudoPath = true // only first path step must be well defined
          nameSegments.push(id)
        } else if ($baseLink) {
          const { definition, target } = $baseLink
          const elements = getDefinition(definition.target)?.elements || definition.elements
          if (elements && id in elements) {
            const element = elements[id]
            if (inInfixFilter) {
              const nextStep = arg.ref[1]?.id || arg.ref[1]
              if (isNonForeignKeyNavigation(element, nextStep)) {
                if (inExists) {
                  Object.defineProperty($baseLink, 'pathExpressionInsideFilter', { value: true })
                } else {
                  rejectNonFkNavigation(element, element.on ? $baseLink.definition.name : nextStep)
                }
              }
            }
            const resolvableIn = getDefinition(definition.target) || target
            const $refLink = { definition: elements[id], target: resolvableIn }
            arg.$refLinks.push($refLink)
          } else {
            stepNotFoundInPredecessor(id, definition.name)
          }
          nameSegments.push(id)
        } else if (inFrom) {
          const definition = getDefinition(id) || cds.error`"${id}" not found in the definitions of your model`
          arg.$refLinks.push({ definition, target: definition })
        } else if (firstStepIsTableAlias) {
          arg.$refLinks.push({
            definition: getDefinitionFromSources(sources, id),
            target: getDefinitionFromSources(sources, id),
          })
        } else if (firstStepIsSelf) {
          arg.$refLinks.push({ definition: { elements: queryElements }, target: { elements: queryElements } })
        } else if (arg.ref.length > 1 && inferred.outerQueries?.find(outer => id in outer.sources)) {
          // outer query accessed via alias
          const outerAlias = inferred.outerQueries.find(outer => id in outer.sources)
          arg.$refLinks.push({
            definition: getDefinitionFromSources(outerAlias.sources, id),
            target: getDefinitionFromSources(outerAlias.sources, id),
          })
        } else if (id in $combinedElements) {
          if ($combinedElements[id].length > 1) stepIsAmbiguous(id) // exit
          const definition = $combinedElements[id][0].tableAlias.elements[id]
          const $refLink = { definition, target: $combinedElements[id][0].tableAlias }
          arg.$refLinks.push($refLink)
          nameSegments.push(id)
        } else if (expandOnTableAlias) {
          // expand on table alias
          arg.$refLinks.push({
            definition: getDefinitionFromSources(sources, id),
            target: getDefinitionFromSources(sources, id),
          })
        } else {
          stepNotFoundInCombinedElements(id) // REVISIT: fails with {__proto__:elements)
        }
      } else {
        const { definition } = arg.$refLinks[i - 1]
        const elements = getDefinition(definition.target)?.elements || definition.elements //> go for assoc._target first, instead of assoc as struct
        const element = elements?.[id]

        if (firstStepIsSelf && element?.isAssociation) {
          throw new Error(
            `Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ ${arg.ref
              .map(idOnly)
              .join(', ')} ]`,
          )
        }

        const target = getDefinition(definition.target) || arg.$refLinks[i - 1].target
        if (element) {
          if ($baseLink && inInfixFilter) {
            const nextStep = arg.ref[i + 1]?.id || arg.ref[i + 1]
            if (isNonForeignKeyNavigation(element, nextStep)) {
              if (inExists) {
                Object.defineProperty($baseLink, 'pathExpressionInsideFilter', { value: true })
              } else {
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
          Object.defineProperty(arg, 'isJoinRelevant', { value: true })
        } else {
          const notFoundIn = pseudoPath ? arg.ref[i - 1] : getFullPathForLinkedArg(arg)
          stepNotFoundInPredecessor(id, notFoundIn)
        }
        const foreignKeyAlias = Array.isArray(definition.keys)
          ? definition.keys.find(k => {
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
        if ((!definition.target && definition.kind !== 'entity') || (!inFrom && danglingFilter))
          throw new Error('A filter can only be provided when navigating along associations')
        if (!inFrom && !arg.expand) Object.defineProperty(arg, 'isJoinRelevant', { value: true })
        let skipJoinsForFilter = false
        step.where.forEach(token => {
          if (token === 'exists') {
            // books[exists genre[code='A']].title --> column is join relevant but inner exists filter is not
            skipJoinsForFilter = true
          } else if (token.ref || token.xpr || token.list) {
            inferArg(token, false, arg.$refLinks[i], {
              inExists: skipJoinsForFilter || inExists,
              inXpr: !!token.xpr,
              inInfixFilter: true,
              inFrom,
            })
          } else if (token.func) {
            if (token.args) {
              applyToFunctionArgs(token.args, inferArg, [
                false,
                arg.$refLinks[i],
                { inExists: skipJoinsForFilter || inExists, inXpr: true, inInfixFilter: true, inFrom },
              ])
            }
          }
        })
      }

      arg.$refLinks[i].alias = !arg.ref[i + 1] && arg.as ? arg.as : id.split('.').pop()
      if (getDefinition(arg.$refLinks[i].definition.target)?.['@cds.persistence.skip'] === true) isPersisted = false
      if (!arg.ref[i + 1]) {
        const flatName = nameSegments.join('_')
        Object.defineProperty(arg, 'flatName', { value: flatName, writable: true })
        // if column is casted, we overwrite it's origin with the new type
        if (arg.cast) {
          const base = getElementForCast(arg)
          if (insertIntoQueryElements()) queryElements[arg.as || flatName] = getCopyWithAnnos(arg, base)
        } else if (arg.expand) {
          const elements = resolveExpand(arg)
          let elementName
          // expand on table alias
          if (arg.$refLinks.length === 1 && arg.$refLinks[0].definition.kind === 'entity')
            elementName = arg.$refLinks[0].alias
          else elementName = arg.as || flatName
          if (queryElements) queryElements[elementName] = elements
        } else if (arg.inline && queryElements) {
          const elements = resolveInline(arg)
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
            if (queryElements[elementName] !== undefined)
              throw new Error(`Duplicate definition of element “${elementName}”`)
            const element = getCopyWithAnnos(arg, leafArt)
            queryElements[elementName] = element
          }
        }
      }
    })

    // we need inner joins for the path expressions inside filter expressions after exists predicate
    if ($baseLink?.pathExpressionInsideFilter) Object.defineProperty(arg, 'join', { value: 'inner' })

    // ignore whole expand if target of assoc along path has ”@cds.persistence.skip”
    if (arg.expand) {
      const { $refLinks } = arg
      const skip = $refLinks.some(link => getDefinition(link.definition.target)?.['@cds.persistence.skip'] === true)
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
      if (isColumnJoinRelevant(colWithBase)) {
        Object.defineProperty(arg, 'isJoinRelevant', { value: true })
        joinTree.mergeColumn(colWithBase, originalQuery.outerQueries)
      }
    }
    if (isCalculatedOnRead(leafArt)) {
      linkCalculatedElement(arg, $baseLink, baseColumn, context)
    }

    function insertIntoQueryElements() {
      return queryElements && !inXpr && !inInfixFilter && !inQueryModifier
    }

    /**
     * Resolves and processes the inline attribute of a column in a database query.
     *
     * @param {object} col - The column object with properties: `inline` and `$refLinks`.
     * @param {string} [namePrefix=col.as || col.flatName] - Prefix for naming new columns. Defaults to `col.as` or `col.flatName`.
     * @returns {object} - An object with resolved and processed inline column definitions.
     *
     * Procedure:
     * 1. Iterate through `inline` array. For each `inlineCol`:
     *    a. If `inlineCol` equals '*', wildcard elements are processed and added to the `elements` object.
     *    b. If `inlineCol` has inline or expand attributes, corresponding functions are called recursively and the resulting elements are added to the `elements` object.
     *    c. If `inlineCol` has val or func attributes, new elements are created and added to the `elements` object.
     *    d. Otherwise, the corresponding `$refLinks` definition is added to the `elements` object.
     * 2. Returns the `elements` object.
     */
    function resolveInline(col, namePrefix = col.as || col.flatName) {
      const { inline, $refLinks } = col
      const $leafLink = $refLinks[$refLinks.length - 1]
      if (!$leafLink.definition.target && !$leafLink.definition.elements) {
        throw new Error(
          `Unexpected “inline” on “${col.ref.map(idOnly)}”; can only be used after a reference to a structure, association or table alias`,
        )
      }
      let elements = {}
      inline.forEach(inlineCol => {
        inferArg(inlineCol, null, $leafLink, { inXpr: true, baseColumn: col })
        if (inlineCol === '*') {
          const wildCardElements = {}
          // either the `.elements´ of the struct or the `.elements` of the assoc target
          const leafLinkElements = getDefinition($leafLink.definition.target)?.elements || $leafLink.definition.elements
          Object.entries(leafLinkElements).forEach(([k, v]) => {
            const name = namePrefix ? `${namePrefix}_${k}` : k
            // if overwritten/excluded omit from wildcard elements
            // in elements the names are already flat so consider the prefix
            // in excluding, the elements are addressed without the prefix
            if (!(name in elements || col.excluding?.includes(k))) wildCardElements[name] = v
          })
          elements = { ...elements, ...wildCardElements }
        } else {
          const nameParts = namePrefix ? [namePrefix] : []
          if (inlineCol.as) nameParts.push(inlineCol.as)
          else nameParts.push(...inlineCol.ref.map(idOnly))
          const name = nameParts.join('_')
          if (inlineCol.inline) {
            const inlineElements = resolveInline(inlineCol, name)
            elements = { ...elements, ...inlineElements }
          } else if (inlineCol.expand) {
            const expandElements = resolveExpand(inlineCol)
            elements = { ...elements, [name]: expandElements }
          } else if (inlineCol.val) {
            elements[name] = { ...getCdsTypeForVal(inlineCol.val) }
          } else if (inlineCol.func) {
            elements[name] = {}
          } else {
            elements[name] = inlineCol.$refLinks[inlineCol.$refLinks.length - 1].definition
          }
        }
      })
      return elements
    }

    /**
     * Resolves a query column which has an `expand` property.
     *
     * @param {object} col - The column object with properties: `expand` and `$refLinks`.
     * @returns {object} - A `cds.struct` object with expanded column definitions.
     *
     * Procedure:
     * - if `$leafLink` is an association, constructs an `expandSubquery` and infers a new query structure.
     *   Returns a new `cds.struct` if the association has a target cardinality === 1 or a `cds.array` for to many relations.
     * - else constructs an `elements` object based on the refs `expand` found in the expand and returns a new `cds.struct` with these `elements`.
     */
    function resolveExpand(col) {
      const { expand, $refLinks } = col
      const $leafLink = $refLinks?.[$refLinks.length - 1] || inferred.SELECT.from.$refLinks.at(-1) // fallback to anonymous expand
      if (!$leafLink.definition.target && !$leafLink.definition.elements) {
        throw new Error(
          `Unexpected “expand” on “${col.ref.map(idOnly)}”; can only be used after a reference to a structure, association or table alias`,
        )
      }
      const target = getDefinition($leafLink.definition.target)
      if (target) {
        const expandSubquery = {
          SELECT: {
            from: target.name,
            columns: expand.filter(c => !c.inline),
          },
        }
        if (col.excluding) expandSubquery.SELECT.excluding = col.excluding
        if (col.as) expandSubquery.SELECT.as = col.as
        const inferredExpandSubquery = infer(expandSubquery, model)
        const res = $leafLink.definition.is2one
          ? new cds.struct({ elements: inferredExpandSubquery.elements })
          : new cds.array({ items: new cds.struct({ elements: inferredExpandSubquery.elements }) })
        return Object.defineProperty(res, '$assocExpand', { value: true })
      } else if ($leafLink.definition.elements) {
        let elements = {}
        expand.forEach(e => {
          if (e === '*') {
            elements = { ...elements, ...$leafLink.definition.elements }
          } else {
            inferArg(e, false, $leafLink, { inXpr: true })
            if (e.expand) elements[e.as || e.flatName] = resolveExpand(e)
            if (e.inline) elements = { ...elements, ...resolveInline(e) }
            else elements[e.as || e.flatName] = e.$refLinks ? e.$refLinks[e.$refLinks.length - 1].definition : e
          }
        })
        return new cds.struct({ elements })
      }
    }

    function stepNotFoundInPredecessor(step, def) {
      throw new Error(`"${step}" not found in "${def}"`)
    }

    function stepIsAmbiguous(step) {
      throw new Error(
        `ambiguous reference to "${step}", write ${Object.values($combinedElements[step])
          .map(ta => `"${ta.index}.${step}"`)
          .join(', ')} instead`,
      )
    }

    function stepNotFoundInCombinedElements(step) {
      throw new Error(
        `"${step}" not found in the elements of ${Object.values(sources)
          .map(s => s.definition)
          .map(def => `"${def.name || /* subquery */ def.as}"`)
          .join(', ')}`,
      )
    }

    function stepNotFoundInColumnList(step) {
      const err = [`"${step}" not found in the columns list of query`]
      // if the `elt` from a `$self.elt` path is found in the `$combinedElements` -> hint to remove `$self`
      if (step in $combinedElements)
        err.push(` did you mean ${$combinedElements[step].map(ta => `"${ta.index || ta.as}.${step}"`).join(',')}?`)
      throw new Error(err.join(','))
    }
  }
  function linkCalculatedElement(column, baseLink, baseColumn, context = {}) {
    const calcElement = column.$refLinks?.[column.$refLinks.length - 1].definition || column
    if (alreadySeenCalcElements.has(calcElement)) return
    else alreadySeenCalcElements.add(calcElement)
    const { ref, xpr } = calcElement.value
    if (ref || xpr) {
      baseLink = { definition: calcElement.parent, target: calcElement.parent }
      inferArg(calcElement.value, null, baseLink, { inCalcElement: true, ...context })
      const basePath =
        column.$refLinks?.length > 1
          ? { $refLinks: column.$refLinks.slice(0, -1), ref: column.ref.slice(0, -1) }
          : { $refLinks: [], ref: [] }
      if (baseColumn) {
        basePath.$refLinks.push(...baseColumn.$refLinks)
        basePath.ref.push(...baseColumn.ref)
      }
      mergePathsIntoJoinTree(calcElement.value, basePath)
    }

    if (calcElement.value.args) {
      const processArgument = (arg, calcElement, column) => {
        inferArg(arg, null, { definition: calcElement.parent, target: calcElement.parent }, { inCalcElement: true })
        const basePath =
          column.$refLinks?.length > 1
            ? { $refLinks: column.$refLinks.slice(0, -1), ref: column.ref.slice(0, -1) }
            : { $refLinks: [], ref: [] }
        mergePathsIntoJoinTree(arg, basePath)
      }

      if (calcElement.value.args) {
        applyToFunctionArgs(calcElement.value.args, processArgument, [calcElement, column])
      }
    }

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
        if (leafOfCalculatedElementRef.value) mergePathsIntoJoinTree(leafOfCalculatedElementRef.value, basePath)

        mergePathIfNecessary(basePath, arg)
      } else if (arg.xpr || arg.args) {
        const prop = arg.xpr ? 'xpr' : 'args'
        arg[prop].forEach(step => {
          let subPath = { $refLinks: [...basePath.$refLinks], ref: [...basePath.ref] }
          if (step.ref) {
            step.$refLinks.forEach((link, i) => {
              const { definition } = link
              if (definition.value) {
                mergePathsIntoJoinTree(definition.value, subPath)
              } else {
                subPath.$refLinks.push(link)
                subPath.ref.push(step.ref[i])
              }
            })
            mergePathIfNecessary(subPath, step)
          } else if (step.args || step.xpr) {
            const nestedProp = step.xpr ? 'xpr' : 'args'
            step[nestedProp].forEach(a => {
              // reset sub path for each nested argument
              // e.g. case when <path> then <otherPath> else <anotherPath> end
              if(!a.ref)
                subPath = { $refLinks: [...basePath.$refLinks], ref: [...basePath.ref] }
              mergePathsIntoJoinTree(a, subPath)
            })
          }
        })
      }

      function mergePathIfNecessary(p, step) {
        const calcElementIsJoinRelevant = isColumnJoinRelevant(p)
        if (calcElementIsJoinRelevant) {
          if (!calcElement.value.isJoinRelevant)
            Object.defineProperty(step, 'isJoinRelevant', { value: true, writable: true,  })
          joinTree.mergeColumn(p, originalQuery.outerQueries)
        } else {
          // we need to explicitly set the value to false in this case,
          // e.g. `SELECT from booksCalc.Books { ID, author.{name }, author {name } }`
          // --> for the inline column, the name is join relevant, while for the expand, it is not
          Object.defineProperty(step, 'isJoinRelevant', { value: false, writable: true })
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
  function isColumnJoinRelevant(column) {
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
        // foreign key access without filters never join relevant
        if (assoc.keys?.some(key => key.ref.every((step, j) => column.ref[i + j] === step))) return false
        // <assoc>.<anotherAssoc>.<…> is join relevant as <anotherAssoc> is not fk of <assoc>
        return true
      }
      if (link.definition.target && link.definition.keys) {
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

  /**
   * Iterates over all `$combinedElements` of the `query` and puts them into the `query`s `elements`,
   * if there is not already an element with the same name present.
   */
  function inferElementsFromWildCard(queryElements) {
    const exclude = _.excluding ? x => _.excluding.includes(x) : () => false

    if (Object.keys(queryElements).length === 0 && aliases.length === 1) {
      const { elements } = getDefinitionFromSources(sources, aliases[0])
      // only one query source and no overwritten columns
      for (const k of Object.keys(elements)) {
        if (!exclude(k)) {
          const element = elements[k]
          if (element.type !== 'cds.LargeBinary') {
            queryElements[k] = element
          }
          // only relevant if we actually select the calculated element
          if (originalQuery.SELECT && isCalculatedOnRead(element)) {
            linkCalculatedElement(element)
          }
        }
      }
      return
    }

    const ambiguousElements = {}
    Object.entries($combinedElements).forEach(([name, tableAliases]) => {
      if (Object.keys(tableAliases).length > 1) {
        ambiguousElements[name] = tableAliases
        return ambiguousElements[name]
      }
      if (exclude(name) || name in queryElements) return true
      const element = tableAliases[0].tableAlias.elements[name]
      if (element.type !== 'cds.LargeBinary') queryElements[name] = element
      if (isCalculatedOnRead(element)) {
        linkCalculatedElement(element)
      }
    })

    if (Object.keys(ambiguousElements).length > 0) throwAmbiguousWildcardError()

    function throwAmbiguousWildcardError() {
      const err = []
      err.push('Ambiguous wildcard elements:')
      Object.keys(ambiguousElements).forEach(name => {
        const tableAliasNames = Object.values(ambiguousElements[name]).map(v => v.index)
        err.push(
          `       select "${name}" explicitly with ${tableAliasNames.map(taName => `"${taName}.${name}"`).join(', ')}`,
        )
      })
      throw new Error(err.join('\n'))
    }
  }

  /**
   * Returns a new object which is the inferred element for the given `col`.
   * A cast type (via cast function) on the column gets preserved.
   *
   * @param {object} col
   * @returns object
   */
  function getElementForXprOrSubquery(col, queryElements, dollarSelfRefs) {
    const { xpr } = col
    let skipJoins = false
    xpr?.forEach(token => {
      if (token === 'exists') {
        // no joins for infix filters along `exists <path>`
        skipJoins = true
      } else {
        inferArg(token, queryElements, null, { inExists: skipJoins, inXpr: true, dollarSelfRefs })
        skipJoins = false
      }
    })
    const base = getElementForCast(col.cast ? col : xpr?.[0] || col)
    if (col.key) base.key = col.key // > preserve key on column
    return getCopyWithAnnos(col, base)
  }

  /**
   * Returns an object with the cast-type defined in the cast of the `thing`.
   * If no cast property is present, it just returns an empty object.
   * The type of the cast is mapped to the `cds` type if possible.
   *
   * @param {object} thing with the cast property
   * @returns {object}
   */
  function getElementForCast(thing) {
    const { cast, $refLinks } = thing
    if (!cast) return {}
    if ($refLinks?.[$refLinks.length - 1].definition.elements)
      // no cast on structure
      cds.error`Structured elements can't be cast to a different type`
    thing.cast = cdsTypes[cast.type] || cast
    return thing.cast
  }

  /**
   * return a new object based on @param base
   * with all annotations found in @param from
   *
   * @param {object} from
   * @param {object} base
   * @returns {object} a copy of @param base with all annotations of @param from
   * @TODO prototype based
   */
  // REVISIT: TODO: inferred.elements should be linked
  function getCopyWithAnnos(from, base) {
    const result = { ...base }
    // REVISIT: we don't need to and hence should not handle annotations at runtime
    for (const prop in from) {
      if (prop.startsWith('@')) result[prop] = from[prop]
    }

    if (from.as && base.name !== from.as) Object.defineProperty(result, 'name', { value: from.as }) // TODO double check if this is needed
    // in subqueries we need the linked element if an outer query accesses it
    return Object.setPrototypeOf(result, base)
  }

  function getCdsTypeForVal(val) {
    // REVISIT: JS null should have a type for proper DB layer conversion logic
    // if(val === null) return {type:'cds.String'}
    switch (typeof val) {
      case 'string':
        return cdsTypes.String
      case 'boolean':
        return cdsTypes.Boolean
      case 'number':
        return Number.isSafeInteger(val) ? cdsTypes.Integer : cdsTypes.Decimal
      default:
        return {}
    }
  }

  /** returns the CSN definition for the given name from the model */
  function getDefinition(name) {
    if (!name) return null
    return model.definitions[name]
  }

  function getDefinitionFromSources(sources, id) {
    return sources[id].definition
  }

  /**
   * Returns the csn path as string for a given column ref with sibling $refLinks
   *
   * @param {object} arg
   * @returns {string}
   */
  function getFullPathForLinkedArg(arg) {
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
}

/**
 * Determines if a given association is a non-foreign key navigation.
 *
 * @param {Object} assoc - The association.
 * @param {Object} nextStep - The next step in the navigation path.
 * @returns {boolean} - Returns true if the next step is a non-foreign key navigation, otherwise false.
 */
function isNonForeignKeyNavigation(assoc, nextStep) {
  if (!nextStep || !assoc.target) return false

  return assoc.on || !isForeignKeyOf(nextStep, assoc)
}

function rejectNonFkNavigation(assoc, additionalInfo) {
  if (assoc.on) {
    throw new Error(`Unexpected unmanaged association “${assoc.name}” in filter expression of “${additionalInfo}”`)
  }
  throw new Error(`Only foreign keys of “${assoc.name}” can be accessed in infix filter, but found “${additionalInfo}”`)
}

/**
 * Returns true if e is a foreign key of assoc.
 * this function is also compatible with unfolded csn (UCSN),
 * where association do not have foreign keys anymore.
 */
function isForeignKeyOf(e, assoc) {
  if (!assoc.isAssociation) return false
  return e in (assoc.elements || assoc.foreignKeys || {})
}
const idOnly = ref => ref.id || ref

function applyToFunctionArgs(funcArgs, cb, cbArgs) {
  if (Array.isArray(funcArgs)) funcArgs.forEach(arg => cb(arg, ...cbArgs))
  else if (typeof funcArgs === 'object') Object.keys(funcArgs).forEach(prop => cb(funcArgs[prop], ...cbArgs))
}

module.exports = infer
