'use strict'

const cds = require('@sap/cds/lib')

const JoinTree = require('./join-tree')
const { pseudos } = require('./pseudos')
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
  const inferred = typeof originalQuery === 'string' ? cds.parse.cql(originalQuery) : cds.ql.clone(originalQuery)

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
      $combinedElements: { value: $combinedElements, writable: true },
      elements: { value: elements, writable: true },
      joinTree: { value: joinTree, writable: true }, // REVISIT: eliminate
    })
    // also enrich original query -> writable because it may be inferred again
    Object.defineProperty(originalQuery, 'elements', { value: elements, writable: true })
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

      inferArgument(from, null, null, { inFrom: true })
      const alias =
        from.uniqueSubqueryAlias ||
        from.as ||
        (ref.length === 1 ? first.match(/[^.]+$/)[0] : ref[ref.length - 1].id || ref[ref.length - 1])
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
      const definition = getDefinition(from) || cds.error`"${from}" not found in the definitions of your model`
      querySources[/([^.]*)$/.exec(from)[0]] = { definition }
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
            queryElements[as] = getElementForXprOrSubquery(col, queryElements)
          } else if (col.func) {
            col.args?.forEach(arg => inferArgument(arg, queryElements, null, { inExpr: true })) // {func}.args are optional
            queryElements[as] = getElementForCast(col)
          } else {
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
          else handleRef(col, queryElements)
        } else if (col.expand) {
          inferArgument(col, queryElements, null, { queryElements })
        } else {
          cds.error`Not supported: ${JSON.stringify(col)}`
        }
      })

      if (dollarSelfRefs.length) inferDollarSelfRefs(dollarSelfRefs, queryElements)

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

        inferArgument(token, queryElements, $baseLink, { inQueryModifier: true })
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
      Object.values(_.with).forEach(val => inferArgument(val, queryElements, null, { inExpr: true }))

    return queryElements

    /**
     * Recursively drill down into a tokenStream (`where` or `having`) and pass
     * on the information whether the next token is resolved within an `exists` predicates.
     * If such a token has an infix filter, it is not join relevant, because the filter
     * condition is applied to the generated `exists <subquery>` condition.
     *
     * @param {array} tokenStream
     */
    function walkTokenStream(tokenStream, inExpr) {
      let skipJoins
      const processToken = t => {
        if (t === 'exists') {
          // no joins for infix filters along `exists <path>`
          skipJoins = true
        } else if (t.xpr) {
          // don't miss an exists within an expression
          t.xpr.forEach(processToken)
        } else {
          inferArgument(t, queryElements, null, { inExists: skipJoins, inQueryModifier: true, inExpr })
          skipJoins = false
        }
      }
      tokenStream.forEach(processToken)
    }
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
  function inferDollarSelfRefs(dollarSelfColumns, queryElements) {
    do {
      const unprocessedColumns = []

      for (const currentDollarSelfColumn of dollarSelfColumns) {
        const { ref } = currentDollarSelfColumn
        const stepToFind = ref[1]

        const referencesOtherDollarSelfColumn = dollarSelfColumns.find(
          otherDollarSelfCol =>
            otherDollarSelfCol !== currentDollarSelfColumn &&
            (otherDollarSelfCol.as
              ? stepToFind === otherDollarSelfCol.as
              : stepToFind === otherDollarSelfCol.ref?.[otherDollarSelfCol.ref.length - 1]),
        )

        if (referencesOtherDollarSelfColumn) {
          unprocessedColumns.push(currentDollarSelfColumn)
        } else {
          handleRef(currentDollarSelfColumn, queryElements)
        }
      }

      dollarSelfColumns = unprocessedColumns
    } while (dollarSelfColumns.length > 0)
  }

  function handleRef(col, queryElements) {
    inferArgument(col, queryElements)
    const { definition } = col.$refLinks[col.$refLinks.length - 1]
    if (col.cast)
      // final type overwritten -> element not visible anymore
      setElementOnColumns(col, getElementForCast(col))
    else if ((col.ref.length === 1) & (col.ref[0] === '$user'))
      // shortcut to $user.id
      setElementOnColumns(col, queryElements[col.as || '$user'])
    else setElementOnColumns(col, definition)
  }

  /**
   * Recursively infers and resolves references within the given argument.
   * This function handles complex structures such as nested functions, list processing,
   * and nested projections (expand, inline) based on the context provided. It links column references to their
   * definitions in the model, handles special cases like pseudo paths and unresolvable steps,
   * and inserts elements corresponding to the columns into the query elements object when required.
   *
   * @param {object} argument - The object that is being processed. This object may include
   *                          various properties like `ref`, `args`, `list`, `xpr`, and others.
   * @param {object|null} queryElements - The current state of query elements being constructed
   *                                      or modified. Null if no modifications are needed, e.g. for infix filters.
   * @param {object|null} $baseLink - The base link context for resolving references, may be null.
   * @param {object} context - Additional context for processing, including flags and settings like
   *                           `inExists`, `inExpr`, `inCalcElement`, etc., which influence how
   *                           references are resolved and processed.
   *
   * The function processes different aspects of the argument object:
   * - Handles parameter references which are resolved at execution time.
   * - Recursively processes `args`, `list`, and `xpr` properties to handle nested structures.
   * - Manages the inclusion or exclusion of elements based on the persistence settings
   *   and the context in which they are found (e.g., inside filters or modifiers).
   * - Constructs links for references (`$refLinks`) to their definitions in the model, handling
   *   various complexities such as pseudo paths, unresolvable steps, and ambiguous references.
   * - Integrates with the overall query processing by modifying the `queryElements` object
   *   based on the inference results.
   *
   * @throws {Error} If an element cannot be resolved or if an invalid operation is attempted
   *                 on a path, such as filtering on a non-association type.
   */
  function inferArgument(argument, queryElements = null, $baseLink = null, context = {}) {
    const {
      inExists,
      inExpr,
      inCalcElement,
      inInfixFilter,
      inFrom,
      inQueryModifier, // orderBy, groupBy, having
      baseColumn, // inline, expand, calculated elements
    } = context
    if (argument.param || argument.SELECT) return // parameter references are only resolved into values on execution e.g. :val, :1 or ?
    if (argument.args) argument.args.forEach(arg => inferArgument(arg, null, $baseLink, context)) // e.g. function in expression
    if (argument.list) argument.list.forEach(arg => inferArgument(arg, null, $baseLink, context))
    if (argument.xpr)
      argument.xpr.forEach(token => inferArgument(token, queryElements, $baseLink, { ...context, inExpr: true })) // e.g. function in expression

    if (!argument.ref) {
      if (argument.expand && queryElements) queryElements[argument.as] = resolveExpand(argument)
      return
    }

    // initialize $refLinks
    Object.defineProperty(argument, '$refLinks', {
      value: [],
      writable: true,
    })
    let isPersisted = true
    let firstStepIsTableAlias, firstStepIsSelf, expandOnTableAlias
    if (!inFrom) {
      firstStepIsTableAlias = argument.ref.length > 1 && sources && argument.ref[0] in sources
      firstStepIsSelf =
        !firstStepIsTableAlias && argument.ref.length > 1 && ['$self', '$projection'].includes(argument.ref[0])
      expandOnTableAlias =
        argument.ref.length === 1 && sources && argument.ref[0] in sources && (argument.expand || argument.inline)
    }
    // if any path step points to an artifact with `@cds.persistence.skip`
    // we must ignore the element from the queries elements
    const nameSegments = []
    // if a (segment) of a (structured) foreign key is renamed, we must not include
    // the aliased ref segments into the name of the final foreign key which is e.g. used in
    // on conditions of joins
    const skipAliasedFkSegmentsOfNameStack = []
    let pseudoPath = false
    argument.ref.forEach((step, i) => {
      const id = step.id || step
      if (i === 0) {
        if (id in pseudos.elements) {
          // pseudo path
          argument.$refLinks.push({ definition: pseudos.elements[id], target: pseudos })
          pseudoPath = true // only first path step must be well defined
          nameSegments.push(id)
        } else if ($baseLink) {
          const { definition, target } = $baseLink
          const elements = getDefinition(definition.target)?.elements || definition.elements
          if (elements && id in elements) {
            const element = elements[id]
            rejectNonFkAccess(element)
            const resolvableIn = getDefinition(definition.target) || target
            argument.$refLinks.push({ definition: elements[id], target: resolvableIn })
          } else {
            stepNotFoundInPredecessor(id, definition.name)
          }
          nameSegments.push(id)
        } else if (inFrom) {
          const definition = getDefinition(id) || cds.error`"${id}" not found in the definitions of your model`
          argument.$refLinks.push({ definition, target: definition })
        } else if (firstStepIsTableAlias) {
          argument.$refLinks.push({
            definition: getDefinitionFromSources(sources, id),
            target: getDefinitionFromSources(sources, id),
          })
        } else if (firstStepIsSelf) {
          argument.$refLinks.push({ definition: { elements: queryElements }, target: { elements: queryElements } })
        } else if (argument.ref.length > 1 && inferred.outerQueries?.find(outer => id in outer.sources)) {
          // outer query accessed via alias
          const outerAlias = inferred.outerQueries.find(outer => id in outer.sources)
          argument.$refLinks.push({
            definition: getDefinitionFromSources(outerAlias.sources, id),
            target: getDefinitionFromSources(outerAlias.sources, id),
          })
        } else if (id in $combinedElements) {
          if ($combinedElements[id].length > 1) stepIsAmbiguous(id) // exit
          const definition = $combinedElements[id][0].tableAlias.elements[id]
          const $refLink = { definition, target: $combinedElements[id][0].tableAlias }
          argument.$refLinks.push($refLink)
          nameSegments.push(id)
        } else if (expandOnTableAlias) {
          // expand on table alias
          argument.$refLinks.push({
            definition: getDefinitionFromSources(sources, id),
            target: getDefinitionFromSources(sources, id),
          })
        } else {
          stepNotFoundInCombinedElements(id) // REVISIT: fails with {__proto__:elements)
        }
      } else {
        const { definition } = argument.$refLinks[i - 1]
        const elements = getDefinition(definition.target)?.elements || definition.elements //> go for assoc._target first, instead of assoc as struct
        const element = elements?.[id]

        if (firstStepIsSelf && element?.isAssociation) {
          throw new Error(
            `Paths starting with “$self” must not contain steps of type “cds.Association”: ref: [ ${argument.ref
              .map(idOnly)
              .join(', ')} ]`,
          )
        }

        const target = getDefinition(definition.target) || argument.$refLinks[i - 1].target
        if (element) {
          if ($baseLink) rejectNonFkAccess(element)
          const e = elements[id]
          const $refLink = { definition: e, target }
          argument.$refLinks.push($refLink)
        } else if (firstStepIsSelf) {
          stepNotFoundInColumnList(id)
        } else if (argument.ref[0] === '$user' && pseudoPath) {
          // `$user.some.unknown.element` -> no error
          argument.$refLinks.push({ definition: {}, target })
        } else if (id === '$dummy') {
          // `some.known.element.$dummy` -> no error; used by cds.ql to simulate joins
          argument.$refLinks.push({ definition: { name: '$dummy', parent: argument.$refLinks[i - 1].target } })
          Object.defineProperty(argument, 'isJoinRelevant', { value: true })
        } else {
          const notFoundIn = pseudoPath ? argument.ref[i - 1] : getFullPathForLinkedArg(argument)
          stepNotFoundInPredecessor(id, notFoundIn)
        }
        const foreignKeyAlias = Array.isArray(definition.keys)
          ? definition.keys.find(k => {
              if (k.ref.every((step, j) => argument.ref[i + j] === step)) {
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
        // Checks if there is a dangling filter at the end of a path.
        // A dangling filter is not followed by another reference, expansion, or inline and is not within an EXISTS clause.
        const hasDanglingFilter = !(argument.ref[i + 1] || argument.expand || argument.inline || inExists)

        const definition = argument.$refLinks[i].definition
        // Ensures that a filter is valid only under specific conditions:
        // 1. The filter must be on associations, except when it is directly on an entity specified in the from.ref clause, like `SELECT from Books[42]`.
        // 2. A dangling filter is invalid unless it is used in the from.ref, like `SELECT from Books:author[name = 'foo']`
        if ((!definition.target && definition.kind !== 'entity') || (!inFrom && hasDanglingFilter)) {
          throw new Error('A filter can only be provided when navigating along associations')
        }

        if (!argument.expand && !inFrom) Object.defineProperty(argument, 'isJoinRelevant', { value: true })
        let skipJoinsForFilter = false
        step.where.forEach(token => {
          if (token === 'exists') {
            // books[exists genre[code='A']].title --> column is join relevant but inner exists filter is not
            skipJoinsForFilter = true
          } else if (token.func) {
            token.args?.forEach(arg =>
              inferArgument(arg, false, argument.$refLinks[i], {
                inExists: skipJoinsForFilter,
                inInfixFilter: true,
                inFrom,
              }),
            )
          } else if (typeof token !== 'string') {
            // xpr, ref, val
            inferArgument(token, false, argument.$refLinks[i], {
              inExists: skipJoinsForFilter,
              inInfixFilter: true,
              inFrom,
            })
          }
        })
      }

      argument.$refLinks[i].alias = !argument.ref[i + 1] && argument.as ? argument.as : id.split('.').pop()
      if (getDefinition(argument.$refLinks[i].definition.target)?.['@cds.persistence.skip'] === true)
        isPersisted = false
      if (!argument.ref[i + 1]) {
        const flatName = nameSegments.join('_')
        Object.defineProperty(argument, 'flatName', { value: flatName, writable: true })
        // if column is casted, we overwrite it's origin with the new type
        if (argument.cast) {
          const base = getElementForCast(argument)
          if (insertIntoQueryElements()) queryElements[argument.as || flatName] = getCopyWithAnnos(argument, base)
        } else if (argument.expand) {
          const elements = resolveExpand(argument)
          let elementName
          // expand on table alias
          if (argument.$refLinks.length === 1 && argument.$refLinks[0].definition.kind === 'entity')
            elementName = argument.$refLinks[0].alias
          else elementName = argument.as || flatName
          if (queryElements) queryElements[elementName] = elements
        } else if (argument.inline && queryElements) {
          const elements = resolveInline(argument)
          Object.assign(queryElements, elements)
        } else {
          // shortcut for `ref: ['$user']` -> `ref: ['$user', 'id']`
          const leafArt =
            i === 0 && id === '$user' ? argument.$refLinks[i].definition.elements.id : argument.$refLinks[i].definition
          // infer element based on leaf artifact of path
          if (insertIntoQueryElements()) {
            let elementName
            if (argument.as) {
              elementName = argument.as
            } else {
              // if the navigation the user has written differs from the final flat ref - e.g. for renamed foreign keys -
              // the inferred name of the element equals the flat version of the user-written ref.
              const refNavigation = argument.ref
                .slice(firstStepIsSelf || firstStepIsTableAlias ? 1 : 0)
                .map(idOnly)
                .join('_')
              if (refNavigation !== flatName) elementName = refNavigation
              else elementName = flatName
            }
            if (queryElements[elementName] !== undefined)
              throw new Error(`Duplicate definition of element “${elementName}”`)
            const element = getCopyWithAnnos(argument, leafArt)
            queryElements[elementName] = element
          }
        }
      }

      function insertIntoQueryElements() {
        return queryElements && !inExpr && !inInfixFilter && !inQueryModifier
      }

      /**
       * Check if the next step in the ref is foreign key of `assoc`
       * if not, an error is thrown.
       *
       * @param {CSN.Element} assoc if this is an association, the next step must be a foreign key of the element.
       */
      function rejectNonFkAccess(assoc) {
        if (inInfixFilter && assoc.target) {
          // only fk access in infix filter
          const nextStep = argument.ref[i + 1]?.id || argument.ref[i + 1]
          // no unmanaged assoc in infix filter path
          if (!inExists && assoc.on) {
            const err = `Unexpected unmanaged association “${assoc.name}” in filter expression of “${$baseLink.definition.name}”`
            throw new Error(err)
          }
          // no non-fk traversal in infix filter in non-exists path
          if (nextStep && !assoc.on && !isForeignKeyOf(nextStep, assoc))
            throw new Error(
              `Only foreign keys of “${assoc.name}” can be accessed in infix filter, but found “${nextStep}”`,
            )
        }
      }
    })

    // ignore whole expand if target of assoc along path has ”@cds.persistence.skip”
    if (argument.expand) {
      const { $refLinks } = argument
      const skip = $refLinks.some(link => getDefinition(link.definition.target)?.['@cds.persistence.skip'] === true)
      if (skip) {
        $refLinks[$refLinks.length - 1].skipExpand = true
        return
      }
    }
    const leafArt = argument.$refLinks[argument.$refLinks.length - 1].definition
    const virtual = (leafArt.virtual || !isPersisted) && !inExpr
    // check if we need to merge the column `ref` into the join tree of the query
    if (!inFrom && !inExists && !virtual && !inCalcElement) {
      // for a ref inside an `inline` we need to consider the column `ref` which has the `inline` prop
      const colWithBase = baseColumn
        ? { ref: [...baseColumn.ref, ...argument.ref], $refLinks: [...baseColumn.$refLinks, ...argument.$refLinks] }
        : argument
      if (isColumnJoinRelevant(colWithBase)) {
        Object.defineProperty(argument, 'isJoinRelevant', { value: true })
        joinTree.mergeColumn(colWithBase, originalQuery.outerQueries)
      }
    }
    if (leafArt.value && !leafArt.value.stored) {
      linkCalculatedElement(argument, $baseLink, baseColumn, context)
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
        inferArgument(inlineCol, false, $leafLink, { inExpr: true, baseColumn: col })
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
            inferArgument(e, false, $leafLink, { inExpr: true, ...context })
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
  /**
   * Processes and links a calculated element. This function recursively identifies
   * calculated elements within a column, ensures they are not processed multiple times, and handles
   * their integration into the query's join tree if necessary. It deals with calculated elements that
   * are derived from both expressions and function calls, recursively processing any nested elements.
   *
   * @param {object} column - The column that contains the calculated element to be linked.
   * @param {object} baseLink - The base link context used for resolving the calculated element's references.
   *                            This may be adjusted during processing to reflect the parent of the calculated element.
   * @param {object} baseColumn - Base column context that may provide additional reference paths to be merged
   *                              into the join tree alongside the calculated element's path.
   * @param {object} [context={}] - Additional processing context that may influence how calculated elements
   *                                are processed, such as flags indicating if the current processing is within
   *                                a calculated element.
   *
   * This function identifies the calculated element within the column based on its `$refLinks` or defaults
   * to the column itself if no `$refLinks` are found. It then ensures this element has not been processed before,
   * registers it in a cache, and proceeds to handle different scenarios:
   * - If the element is an expression or reference, it recursively infers arguments within this context,
   *   merging any necessary paths into the queries join tree.
   * - If the element involves a function call, it processes each argument of the function in a similar manner.
   *
   * Throughout its operation, it adjusts the base link context and merges paths as necessary, ensuring
   * that calculated elements are correctly integrated into the query's join tree, affecting how joins are
   * constructed during SQL generation.
   *
   * @throws {Error} If calculated elements contain errors in their path definitions or if recursive processing
   *                 of nested elements identifies issues that cannot be resolved within the current query context.
   */
  function linkCalculatedElement(column, baseLink, baseColumn, context = {}) {
    const calcElement = column.$refLinks?.[column.$refLinks.length - 1].definition || column
    if (alreadySeenCalcElements.has(calcElement)) return
    else alreadySeenCalcElements.add(calcElement)
    const { ref, xpr, func } = calcElement.value
    if (ref || xpr) {
      baseLink = { definition: calcElement.parent, target: calcElement.parent }
      inferArgument(calcElement.value, null, baseLink, { inCalcElement: true, ...context })
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
    if (func)
      calcElement.value.args?.forEach(arg => {
        inferArgument(
          arg,
          false,
          { definition: calcElement.parent, target: calcElement.parent },
          { inCalcElement: true, ...context },
        )
        const basePath =
          column.$refLinks?.length > 1
            ? { $refLinks: column.$refLinks.slice(0, -1), ref: column.ref.slice(0, -1) }
            : { $refLinks: [], ref: [] }
        mergePathsIntoJoinTree(arg, basePath)
      }) // {func}.args are optional

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
          const subPath = { $refLinks: [...basePath.$refLinks], ref: [...basePath.ref] }
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
              mergePathsIntoJoinTree(a, subPath)
            })
          }
        })
      }

      function mergePathIfNecessary(p, step) {
        const calcElementIsJoinRelevant = isColumnJoinRelevant(p)
        if (calcElementIsJoinRelevant) {
          if (!calcElement.value.isJoinRelevant)
            Object.defineProperty(step, 'isJoinRelevant', { value: true, writable: true })
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
      if (assoc && assoc.keys?.some(key => key.ref.every((step, j) => column.ref[i + j] === step))) {
        // foreign key access without filters never join relevant
        return false
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
      Object.keys(elements)
        .filter(k => !exclude(k))
        .forEach(k => {
          const element = elements[k]
          if (element.type !== 'cds.LargeBinary') queryElements[k] = element
          if (element.value) {
            linkCalculatedElement(element)
          }
        })
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
      if (element.value) {
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
  function getElementForXprOrSubquery(col, queryElements) {
    const { xpr } = col
    let skipJoins = false
    xpr?.forEach(token => {
      if (token === 'exists') {
        // no joins for infix filters along `exists <path>`
        skipJoins = true
      } else {
        inferArgument(token, queryElements, null, { inExists: skipJoins, inExpr: true })
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
      }
      const dot = i === 1 && firstStepIsEntity ? ':' : '.' // divide with colon if first step is entity
      return res !== '' ? res + dot + cur.definition.name : cur.definition.name
    }, '')
  }
}

/**
 * Returns true if e is a foreign key of assoc.
 * this function is also compatible with unfolded csn (UCSN),
 * where association do not have foreign keys anymore.
 */
function isForeignKeyOf(e, assoc) {
  if (!assoc.isAssociation) return false
  return e in (assoc.elements || assoc.foreignKeys)
}
const idOnly = ref => ref.id || ref

module.exports = infer
