'use strict'

const cds = require('@sap/cds/lib')

const JoinTree = require('./join-tree')
const { pseudos } = require('./pseudos')
// REVISIT: we should always return cds.linked elements
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
 * @param {CQN|CQL} originalQuery
 * @param {CSN} [model]
 * @returns {InferredCQN} = q with .target and .elements
 */
function infer(originalQuery, model = cds.context?.model || cds.model) {
  if (!model) cds.error('Please specify a model')
  const inferred = typeof originalQuery === 'string' ? cds.parse.cql(originalQuery) : cds.ql.clone(originalQuery)

  // REVISIT: The more edge use cases we support, thes less optimized are we for the 90+% use cases
  // e.g. there's a lot of overhead for infer( SELECT.from(Books) )
  if (originalQuery.SET) cds.error('”UNION” based queries are not supported')
  const _ =
    inferred.SELECT ||
    inferred.INSERT ||
    inferred.UPSERT ||
    inferred.UPDATE ||
    inferred.DELETE ||
    inferred.CREATE ||
    inferred.DROP
  const sources = inferTarget(_.from || _.into || _.entity, {})
  const joinTree = new JoinTree(sources)
  const aliases = Object.keys(sources)
  Object.defineProperties(inferred, {
    // REVISIT: public, or for local reuse, or in cqn4sql only?
    sources: { value: sources, writable: true },
    target: { value: aliases.length === 1 ? sources[aliases[0]] : originalQuery, writable: true }, // REVISIT: legacy?
  })
  // also enrich original query -> writable because it may be inferred again
  Object.defineProperties(originalQuery, {
    sources: { value: sources, writable: true },
    target: {
      value: aliases.length === 1 ? sources[aliases[0]] : originalQuery,
      writable: true,
    },
  })
  if (originalQuery.SELECT || originalQuery.DELETE || originalQuery.UPDATE) {
    const $combinedElements = inferCombinedElements()
    /**
     * TODO: this function is currently only called on DELETE's
     *       because it correctly set's up the $refLink's in the
     *       where clause: This functionality should be pulled out
     *       of ´inferQueryElement()` as this is a subtle side effect
     */
    const elements = inferQueryElements($combinedElements)
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
   * Infers all query sources from a queries `from` clause.
   * Drills down into join arguments of the from clause.
   */
  function inferTarget(from, querySources) {
    const { ref } = from
    if (ref) {
      const first = ref[0].id || ref[0]
      let target = getDefinition(first, model)
      if (!target) cds.error(`"${first}" not found in the definitions of your model`)
      if (ref.length > 1) {
        target = from.ref.slice(1).reduce((d, r) => {
          const next = d.elements[r.id || r]?.elements ? d.elements[r.id || r] : d.elements[r.id || r]?._target
          if (!next) cds.error(`No association "${r.id || r}" in ${d.kind} "${d.name}": ${d}`)
          return next
        }, target)
      }
      if (target.kind !== 'entity' && !target._isAssociation)
        throw new Error(/Query source must be a an entity or an association/)

      attachRefLinksToArg(from) // REVISIT: remove
      const alias =
        from.as || (ref.length === 1 ? first.match(/[^.]+$/)[0] : ref[ref.length - 1].id || ref[ref.length - 1])
      if (alias in querySources) throw new Error(`Duplicate alias "${alias}"`)
      querySources[alias] = target
    } else if (from.args) {
      from.args.forEach(a => inferTarget(a, querySources))
    } else if (from.SELECT) {
      infer(from, model) // we need the .elements in the sources
      querySources[from.as] = from
    } else if (typeof from === 'string') {
      querySources[/([^.]*)$/.exec(from)[0]] = getDefinition(from, model)
    } else if (from.SET) {
      infer(from, model)
    }
    return querySources
  }

  // REVISIT: this helper is doing by far too much, with too many side effects

  /**
   * Walk recursively through all `ref` steps of the `arg` and attach information such as
   * the corresponding definition of each `ref` step as well as the target of the `ref` step
   * in which the next `ref` step must be searched for in.
   *
   * @param {object} arg the arg which shall be augmented
   * @param {$refLink} $baseLink environment where the first `ref` step shall be resolved in.
   *                             For infix filter / expand columns
   * @param {boolean} expandOrExists whether the `arg` is part of a `column.expand` /
   *                                 preceded by an `exists`.
   *                                 In those cases, unmanaged association paths are allowed .
   */
  function attachRefLinksToArg(arg, $baseLink = null, expandOrExists = false) {
    const { ref, xpr } = arg
    if (xpr) xpr.forEach(t => attachRefLinksToArg(t, $baseLink, expandOrExists))
    if (!ref) return
    init$refLinks(arg)
    ref.forEach((step, i) => {
      const id = step.id || step
      if (i === 0) {
        // infix filter never have table alias
        // we need to search for first step in ´model.definitions[infixAlias]`
        if ($baseLink) {
          const { definition } = $baseLink
          const elements = definition.elements || definition._target?.elements
          const e = elements?.[id] || cds.error`"${id}" not found in the elements of "${definition.name}"`
          if (e.target) {
            // only fk access in infix filter
            const nextStep = ref[1]?.id || ref[1]
            // no unmanaged assoc in infix filter path
            if (!expandOrExists && e.on)
              throw new Error(
                `"${e.name}" in path "${arg.ref.map(idOnly).join('.')}" must not be an unmanaged association`,
              )
            // no non-fk traversal in infix filter
            if (!expandOrExists && nextStep && !(nextStep in e.foreignKeys))
              throw new Error(`Only foreign keys of "${e.name}" can be accessed in infix filter`)
          }
          arg.$refLinks.push({ definition: e, target: e._target || e })
          // filter paths are flattened
          // REVISIT: too much augmentation -> better remove flatName..
          Object.defineProperty(arg, 'flatName', { value: ref.join('_'), writable: true })
        } else {
          // must be in model.definitions
          const definition = getDefinition(id, model)
          arg.$refLinks[0] = { definition, target: definition }
        }
      } else {
        const recent = arg.$refLinks[i - 1]
        const { elements } = recent.target
        const e = elements[id]
        if (!e) throw new Error(`"${id}" not found in the elements of "${arg.$refLinks[i - 1].definition.name}"`)
        arg.$refLinks.push({ definition: e, target: e._target || e })
      }
      arg.$refLinks[i].alias = !ref[i + 1] && arg.as ? arg.as : id.split('.').pop()

      // link refs in where
      if (step.where) {
        // REVISIT: why do we need to walk through these so early?
        if (arg.$refLinks[i].definition.kind === 'entity' || arg.$refLinks[i].definition._target) {
          let existsPredicate = false
          const walkTokenStream = token => {
            if (token === 'exists') {
              // no joins for infix filters along `exists <path>`
              existsPredicate = true
            } else if (token.xpr) {
              // don't miss an exists within an expression
              token.xpr.forEach(walkTokenStream)
            } else {
              attachRefLinksToArg(token, arg.$refLinks[i], existsPredicate)
              existsPredicate = false
            }
          }
          step.where.forEach(walkTokenStream)
        } else throw new Error('A filter can only be provided when navigating along associations')
      }
    })
  }

  /**
   * Based on the queries `sources`, the `$combinedElements` are calculated.
   * The `$combinedElements` of a query consist of all accessible elements
   * across all the table aliases found in the from clause.
   *
   * The `$combinedElements` are attached to the query as non-enumerable property.
   * Each entry in the `$combinedElements` dictionary maps from the element name
   * to all table aliases where an element with this name can be found.
   */
  function inferCombinedElements() {
    const combinedElements = {}
    for (const index in sources) {
      const tableAlias = sources[index]
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
    if(col.element) return

    Object.defineProperty(col, 'element', {
      value: element,
      writable: true,
    })
  }

  /**
   * Walks over all columns of a queries `SELECT` and infers each `ref`, `xpr`
   * or `val` as query element based on the queries `$combinedElements` and
   * `sources`.
   *
   * The `elements` are attached to the query as non-enumerable property.
   *
   * Also walks over other `ref`s in the query, validates them and attaches `$refLinks`.
   * --> `where`, infix filters within column refs or other csn paths...
   *
   */
  function inferQueryElements($combinedElements) {
    let queryElements = {}
    const { columns, where, groupBy, having, orderBy } = _
    if (!columns) {
      inferElementsFromWildCard(aliases)
    } else {
      let wildcardSelect = false
      const refs = []
      columns.forEach(col => {
        if (col === '*') {
          wildcardSelect = true
        } else if (col.val !== undefined || col.xpr || col.SELECT || col.func || col.param) {
          const as = col.as || col.func || col.val
          if (as === undefined) throw cds.error`Expecting expression to have an alias name`
          if (queryElements[as]) throw cds.error`Duplicate definition of element “${as}”`
          if (col.xpr || col.SELECT) {
            queryElements[as] = getElementForXprOrSubquery(col)
          } else if (col.func) {
            col.args?.forEach(arg => inferQueryElement(arg, false)) // {func}.args are optional
            queryElements[as] = getElementForCast(col)
          } else {
            // either binding parameter (col.param) or value
            queryElements[as] = col.cast ? getElementForCast(col) : getCdsTypeForVal(col.val)
          }
          setElementOnColumns(col, queryElements[as])
        } else if (col.ref) {
          refs.push(col)
        } else {
          throw cds.error`Not supported: ${JSON.stringify(col)}`
        }
      })
      refs.forEach(col => {
        inferQueryElement(col)
        const { definition } = col.$refLinks[col.$refLinks.length - 1]
        if (col.cast)
          // final type overwritten -> element not visible anymore
          setElementOnColumns(col, getElementForCast(col))
        else if ((col.ref.length === 1) & (col.ref[0] === '$user'))
          // shortcut to $user.id
          setElementOnColumns(col, queryElements[col.as || '$user'])
        else setElementOnColumns(col, definition)
      })
      if (wildcardSelect) inferElementsFromWildCard(aliases)
    }
    if (orderBy) {
      // link $refLinks -> special name resolution rules for orderBy
      orderBy.forEach(token => {
        let $baseLink
        // first check if token ref is resolvable in query elements
        if (columns) {
          const e = queryElements[token.ref?.[0]]
          const isAssocExpand = e?.$assocExpand // expand on structure can be addressed
          if (e && !isAssocExpand) $baseLink = { definition: { elements: queryElements }, target: inferred }
        } else {
          // fallback to elements of query source
          $baseLink = null
        }

        inferQueryElement(token, false, $baseLink)
      })
    }
    if (where) {
      let skipJoins
      const walkTokenStream = token => {
        if (token === 'exists') {
          // no joins for infix filters along `exists <path>`
          skipJoins = true
        } else if (token.xpr) {
          // don't miss an exists within an expression
          token.xpr.forEach(walkTokenStream)
        } else {
          inferQueryElement(token, false, null, skipJoins)
          skipJoins = false
        }
      }
      where.forEach(walkTokenStream)
    }
    if (groupBy)
      // link $refLinks
      groupBy.forEach(token => inferQueryElement(token, false))
    if (having)
      // link $refLinks
      having.forEach(token => inferQueryElement(token, false))
    if (_.with)
      // consider UPDATE.with
      Object.values(_.with).forEach(val => inferQueryElement(val, false))

    return queryElements

    /**
     * Infers an element of the query based on the given `column`
     *
     * attaches non-enumerable property `$refLinks` to the `column`
     * which holds the corresponding artifact represented by the ref step
     * at the same index. Based on the leaf artifact of the `ref` path, the queryElement
     * is inferred.
     *
     * @param {object} column
     * @param {object} [insertIntoQueryElements=true]
     * whether the inferred element shall be inserted into the queries elements.
     * E.g. we do not want to do that when we walk over the where clause.
     * @param {boolean} [inExists=false]
     * In some cases, no joins must be created for non-assoc path traversals:
     * - for infix filters in `exists assoc[parent.foo='bar']` -> part of semi join
     */
    function inferQueryElement(column, insertIntoQueryElements = true, $baseLink = null, inExists = false) {
      if (column.param) return // parameter references are only resolved into values on execution e.g. :val, :1 or ?
      if (column.args) column.args.forEach(arg => inferQueryElement(arg, false, $baseLink, inExists)) // e.g. function in expression
      if (column.list) column.list.forEach(arg => inferQueryElement(arg, false, $baseLink, inExists))
      if (column.xpr) column.xpr.forEach(token => inferQueryElement(token, false, $baseLink, inExists)) // e.g. function in expression
      if (column.SELECT) return

      if (!column.ref) return

      init$refLinks(column)

      const firstStepIsTableAlias =
        (column.ref.length > 1 && column.ref[0] in sources) ||
        // nested projection on table alias
        (column.ref.length === 1 && column.ref[0] in sources && column.inline)
      const firstStepIsSelf =
        !firstStepIsTableAlias && column.ref.length > 1 && ['$self', '$projection'].includes(column.ref[0])
      const nameSegments = []
      // if a (segment) of a (structured) foreign key is renamed, we must not include
      // the aliased ref segments into the name of the final foreign key which is e.g. used in
      // on conditions of joins
      const skipAliasedFkSegmentsOfNameStack = []
      let pseudoPath = false
      column.ref.forEach((step, i) => {
        const id = step.id || step
        if (i === 0) {
          if (id in pseudos.elements) {
            // pseudo path
            column.$refLinks.push({ definition: pseudos.elements[id], target: pseudos })
            pseudoPath = true // only first path step must be well defined
            nameSegments.push(id)
          } else if ($baseLink) {
            const { definition, target } = $baseLink
            const elements = definition.elements || definition._target?.elements
            if (elements && id in elements) {
              column.$refLinks.push({ definition: elements[id], target })
            } else {
              stepNotFoundInPredecessor(id, definition.name)
            }
            nameSegments.push(id)
          } else if (firstStepIsTableAlias) {
            column.$refLinks.push({ definition: sources[id], target: sources[id] })
          } else if (firstStepIsSelf) {
            column.$refLinks.push({ definition: { elements: queryElements }, target: { elements: queryElements } })
          } else if (inferred.outerQueries?.find(outer => id in outer.sources)) {
            // outer query accessed via alias
            const outerAlias = inferred.outerQueries.find(outer => id in outer.sources)
            column.$refLinks.push({ definition: outerAlias.sources[id], target: outerAlias.sources[id] })
          } else if (id in $combinedElements) {
            if ($combinedElements[id].length > 1) stepIsAmbiguous(id) // exit
            const definition = $combinedElements[id][0].tableAlias.elements[id]
            const $refLink = { definition, target: $combinedElements[id][0].tableAlias }
            column.$refLinks.push($refLink)
            nameSegments.push(id)
          } else {
            stepNotFoundInCombinedElements(id) // REVISIT: fails with {__proto__:elements)
          }
        } else {
          const { definition } = column.$refLinks[i - 1]
          const elements = definition.elements || definition._target?.elements
          if (elements && id in elements) {
            const $refLink = { definition: elements[id], target: column.$refLinks[i - 1].target }
            column.$refLinks.push($refLink)
          } else if (firstStepIsSelf) {
            stepNotFoundInColumnList(id)
          } else if (column.ref[0] === '$user' && pseudoPath) {
            // `$user.some.unknown.element` -> no error
            column.$refLinks.push({ definition: {}, target: column.$refLinks[i - 1].target })
          } else if (id === '$dummy') {
            // `some.known.element.$dummy` -> no error; used by cds.ql to simulate joins
            column.$refLinks.push({ definition: { name: '$dummy', parent: column.$refLinks[i - 1].target } })
            Object.defineProperty(column, 'isJoinRelevant', { value: true })
          } else {
            const notFoundIn = pseudoPath ? column.ref[i - 1] : getFullPathForLinkedArg(column)
            stepNotFoundInPredecessor(id, notFoundIn)
          }
          const foreignKeyAlias = Array.isArray(definition.keys)
            ? definition.keys.find(k => {
                if (k.ref.every((step, j) => column.ref[i + j] === step)) {
                  skipAliasedFkSegmentsOfNameStack.push(...k.ref.slice(1))
                  return true
                }
                return false
              })?.as
            : null
          if (foreignKeyAlias) nameSegments.push(foreignKeyAlias)
          else if (skipAliasedFkSegmentsOfNameStack[0] === id) skipAliasedFkSegmentsOfNameStack.shift()
          else nameSegments.push(id)
        }

        if (step.where) {
          const danglingFilter = !(column.ref[i + 1] || column.expand || inExists)
          if (!column.$refLinks[i].definition.target || danglingFilter)
            throw new Error(/A filter can only be provided when navigating along associations/)
          if (!column.expand) Object.defineProperty(column, 'isJoinRelevant', { value: true })
          // books[exists genre[code='A']].title --> column is join relevant but inner exists filter is not
          let skipJoinsForFilter = inExists
          step.where.forEach(token => {
            if (token === 'exists') {
              // no joins for infix filters along `exists <path>`
              skipJoinsForFilter = true
            } else if (token.ref || token.xpr) {
              inferQueryElement(token, false, column.$refLinks[i], skipJoinsForFilter)
            } else if (token.func) {
              token.args?.forEach(arg => inferQueryElement(arg, false, column.$refLinks[i], skipJoinsForFilter))
            }
          })
        }

        column.$refLinks[i].alias = !column.ref[i + 1] && column.as ? column.as : id.split('.').pop()

        if (!column.ref[i + 1]) {
          const flatName = nameSegments.join('_')
          Object.defineProperty(column, 'flatName', { value: flatName, writable: true })
          // if column is casted, we overwrite it's origin with the new type
          if (column.cast) {
            const base = getElementForCast(column)
            if (insertIntoQueryElements) queryElements[column.as || flatName] = getCopyWithAnnos(column, base)
          } else if (column.expand) {
            const elements = resolveExpand(column)
            if (insertIntoQueryElements) queryElements[column.as || flatName] = elements
          } else if (column.inline && insertIntoQueryElements) {
            const elements = resolveInline(column)
            queryElements = { ...queryElements, ...elements }
          } else {
            // shortcut for `ref: ['$user']` -> `ref: ['$user', 'id']`
            const leafArt =
              i === 0 && id === '$user' ? column.$refLinks[i].definition.elements.id : column.$refLinks[i].definition
            // infer element based on leaf artifact of path
            if (insertIntoQueryElements) {
              let elementName
              if (column.as) {
                elementName = column.as
              } else {
                // if the navigation the user has written differs from the final flat ref - e.g. for renamed foreign keys -
                // the inferred name of the element equals the flat version of the user-written ref.
                const refNavigation = column.ref
                  .slice(firstStepIsSelf || firstStepIsTableAlias ? 1 : 0)
                  .map(idOnly)
                  .join('_')
                if (refNavigation !== flatName) elementName = refNavigation
                else elementName = flatName
              }
              if (queryElements[elementName] !== undefined)
                throw new Error(`Duplicate definition of element “${elementName}”`)
              queryElements[elementName] = getCopyWithAnnos(column, leafArt)
            }
          }
        }
      })

      // ignore whole expand if target of assoc along path has ”@cds.persistence.skip”
      if (column.expand) {
        const { $refLinks } = column
        const skip = $refLinks.some(
          link => model.definitions[link.definition.target]?.['@cds.persistence.skip'] === true,
        )
        if (skip) {
          $refLinks[$refLinks.length - 1].skipExpand = true
          return
        }
      }
      // check if we need to merg the column `ref` into the join tree of the query
      if (!inExists && isColumnJoinRelevant(column)) {
        Object.defineProperty(column, 'isJoinRelevant', { value: true })
        joinTree.mergeColumn(column)
      }

      function resolveInline(col, namePrefix = col.as || col.flatName) {
        const { inline, $refLinks } = col
        const $leafLink = $refLinks[$refLinks.length - 1]
        let elements = {}
        inline.forEach(inlineCol => {
          inferQueryElement(inlineCol, false, $leafLink, false, true)
          if (inlineCol === '*') {
            const wildCardElements = {}
            // either the `.elements´ of the struct or the `.elements` of the assoc target
            const leafLinkElements = $leafLink.definition.elements || $leafLink.definition._target.elements
            Object.entries(leafLinkElements).forEach(([k, v]) => {
              const name = namePrefix ? `${namePrefix}_${k}` : k
              // if overwritten/excluded omit from wildcard elements
              // in elements the names are already flat so consider the prefix
              // in excluding, the elements are addressed without the prefix
              if (!(name in elements || col.excluding?.some(e => e === k))) wildCardElements[name] = v
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
      function resolveExpand(col) {
        const { expand, $refLinks } = col
        const $leafLink = $refLinks[$refLinks.length - 1]
        if ($leafLink.definition._target) {
          const expandSubquery = {
            SELECT: {
              from: $leafLink.definition._target.name,
              columns: expand.filter(c => !c.inline),
            },
          }
          if (col.as) expandSubquery.SELECT.as = col.as
          const inferredExpandSubquery = infer(expandSubquery, model)
          const res =
            $leafLink.definition._isStructured || $leafLink.definition.is2one
              ? // IMPORTANT: all definitions / elements in a cds.linked model have to be linked
                new cds.struct({ elements: inferredExpandSubquery.elements })
              : new cds.array({ items: new cds.struct({ elements: inferredExpandSubquery.elements }) })
          return Object.defineProperty(res, '$assocExpand', { value: true })
        } // struct
        let elements = {}
        expand.forEach(e => {
          if (e === '*') {
            elements = { ...elements, ...$leafLink.definition.elements }
          } else {
            inferQueryElement(e, false, $leafLink)
            if (e.expand) elements[e.as || e.flatName] = resolveExpand(e)
            if (e.inline) elements = { ...elements, ...resolveInline(e) }
            else elements[e.as || e.flatName] = e.$refLinks ? e.$refLinks[e.$refLinks.length - 1].definition : e
          }
        })
        return new cds.struct({ elements })
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
            .map(def => `"${def.name || /* subquery */ def.as}"`)
            .join(', ')}`,
        )
      }

      function stepNotFoundInColumnList(step) {
        const err = [`"${step}" not found in the columns list of query`]
        // if the `elt` from a `$self.elt` path is found in the `$combinedElements` -> hint to remove `$self`
        if (step in $combinedElements)
          err.push(` did you mean ${$combinedElements[step].map(ta => `"${ta.index || ta.as}.${step}"`).join(',')}?`)
        throw new Error(err)
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
      else return true
    }

    /**
     * Iterates over all `$combinedElements` of the `query` and puts them into the `query`s `elements`,
     * if there is not already an element with the same name present.
     */
    function inferElementsFromWildCard() {
      if (Object.keys(queryElements).length === 0 && aliases.length === 1) {
        // only one query source and no overwritten columns
        queryElements = sources[aliases[0]].elements
        return
      }

      const exclude = _.excluding ? x => _.excluding.includes(x) : () => false
      const ambiguousElements = {}
      Object.entries($combinedElements).forEach(([name, tableAliases]) => {
        if (Object.keys(tableAliases).length > 1) {
          ambiguousElements[name] = tableAliases
          return ambiguousElements[name]
        }
        if (exclude(name) || name in queryElements) return true
        queryElements[name] = tableAliases[0].tableAlias.elements[name]
        return queryElements[name]
      })

      if (Object.keys(ambiguousElements).length > 0) throwAmbiguousWildcardError()

      function throwAmbiguousWildcardError() {
        const err = []
        err.push('Ambiguous wildcard elements:')
        Object.keys(ambiguousElements).forEach(name => {
          const tableAliasNames = Object.values(ambiguousElements[name]).map(v => v.index)
          err.push(
            `       select "${name}" explicitly with ${tableAliasNames
              .map(taName => `"${taName}.${name}"`)
              .join(', ')}`,
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
    function getElementForXprOrSubquery(col) {
      const { xpr } = col
      let skipJoins = false
      xpr?.forEach(token => {
        if (token === 'exists') {
          // no joins for infix filters along `exists <path>`
          skipJoins = true
        } else {
          inferQueryElement(token, false, null, skipJoins)
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

  // REVISIT: functions without return are by nature side-effect functions -> bad
  function init$refLinks(arg) {
    Object.defineProperty(arg, '$refLinks', {
      value: [],
      writable: true,
    })
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

  /** gets the CSN element for the given name from the model */
  function getDefinition(name, model) {
    return model.definitions[name] || cds.error`"${name}" not found in the definitions of your model`
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
const idOnly = ref => ref.id || ref

module.exports = infer
