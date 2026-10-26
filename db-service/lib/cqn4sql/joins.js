'use strict'

module.exports = { translateAssocsToJoins, backlinkFor, onCondFor, getParentKeyForeignKeyPairs }

const runtimeViewsModule = require('./runtime-views')
const expressionsModule = require('./expressions')
const flattenModule = require('./flatten')

const { keysOf } = require('./model')
const cloneCqn = require('./clone')

const { pseudos } = require('./pseudos')
const { defineProperty, hasOwnSkip, isRuntimeView } = require('../utils')
const { getFullName, hasLogicalOr, getParentEntity, asXpr } = require('./helpers')

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
function translateAssocsToJoins(ctx, transformedFrom) {
  let from
  /**
   * remember already seen aliases, do not create a join for them again
   */
  const alreadySeen = new Map()
  ctx.query.joinTree._roots.forEach(r => {
    const args = []
    if (r.queryArtifact.SELECT) {
      const transformedSubquery = transformedFrom
      transformedSubquery.as = r.alias
      args.push(transformedSubquery)
    } else {
      const id = ctx.getLocalizedName(r.queryArtifact)
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
    const nextAssoc = ctx.query.joinTree.findNextAssoc(node)
    if (!nextAssoc || alreadySeen.has(nextAssoc.$refLink.alias)) return lhs.args.length > 1 ? lhs : lhs.args[0]

    lhs.on.push(
      ...onCondFor(
        ctx,
        nextAssoc.$refLink,
        node.parent.$refLink || /** tree roots do not have $refLink */ {
          alias: node.parent.alias,
          definition: node.parent.queryArtifact,
          target: node.parent.queryArtifact,
        },
        /** flip source and target in on condition */ true,
      ),
    )

    const def = ctx.getDefinition(nextAssoc.$refLink.definition.target)
    const id = def.name
    if (hasOwnSkip(def) && isRuntimeView(def))
      runtimeViewsModule.addWith(ctx, ctx.model.definitions[id], ctx.transformedQuery, ctx.model)
    const { args } = nextAssoc
    const arg = {
      ref: [args ? { id, args } : id],
      as: nextAssoc.$refLink.alias,
    }

    lhs.args.push(arg)
    alreadySeen.set(nextAssoc.$refLink.alias, true)
    if (nextAssoc.where) {
      const filter = expressionsModule.getTransformedTokenStream(ctx, nextAssoc.where, {
        $baseLink: nextAssoc.$refLink,
      })
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
 * Calculates which elements are the backlinks of a $self comparison in a
 * given on-condition. That are the managed associations in the target of the
 * given association.
 *
 * @param {CSN.Association} assoc with on-condition
 * @returns {[CSN.Association] | null} all assocs which are compared to `$self`
 */
function backlinkFor(ctx, assoc) {
  if (!assoc.on) return null
  const target = ctx.getDefinition(assoc.target)
  // technically we could have multiple backlinks
  const backlinks = []
  for (let i = 0; i < assoc.on.length; i += 3) {
    const lhs = assoc.on[i]
    const rhs = assoc.on[i + 2]
    if (lhs?.ref?.length === 1 && lhs.ref[0] === '$self') backlinks.push(rhs)
    else if (rhs?.ref?.length === 1 && rhs.ref[0] === '$self') backlinks.push(lhs)
  }
  return backlinks.map(each =>
    flattenModule.getElementForRef(
      ctx,
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
function onCondFor(ctx, assocRefLink, targetSideRefLink, inWhereOrJoin) {
  const { on } = assocRefLink.definition
  const keys = keysOf(assocRefLink.definition, ctx.state.metadata)
  const target = ctx.getDefinition(assocRefLink.definition.target)
  let res
  if (keys) {
    const fkPkPairs = getParentKeyForeignKeyPairs(
      ctx,
      assocRefLink.definition,
      inWhereOrJoin ? targetSideRefLink : assocRefLink,
      inWhereOrJoin,
    )
    const transformedOn = []
    fkPkPairs.forEach((pair, i) => {
      const { sourceSide, targetSide } = pair
      sourceSide.ref.unshift(inWhereOrJoin ? assocRefLink.alias : targetSideRefLink.alias)
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
    const result = cloneCqn(tokenStream)
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
              prev?.elements?.[res] || ctx.getDefinition(prev?.target)?.elements[res] || pseudos.elements[res]
            const target = getParentEntity(definition)
            thing.$refLinks[i] = {
              definition,
              target,
              alias: definition === assocRefLink.definition ? assocRefLink.alias : definition.name,
            }
            return prev?.elements?.[res] || ctx.getDefinition(prev?.target)?.elements[res] || pseudos.elements[res]
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
          backlink = flattenModule.getElementForRef(
            ctx,
            rhs.ref.slice(1),
            rhs.ref[0] in { $self: true, $projection: true } ? getParentEntity(assocRefLink.definition) : target,
          )
        else if (rhs?.ref?.length === 1 && rhs.ref[0] === '$self')
          backlink = flattenModule.getElementForRef(
            ctx,
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
            const expandedComparison = expressionsModule.getTransformedTokenStream(ctx, [lhs, result[i + 1], rhs])
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
        } else if (keysOf(backlink, ctx.state.metadata)) {
          // sanity check: error out if we can't produce a join
          if (keysOf(backlink, ctx.state.metadata).length === 0) {
            throw new Error(
              `Path step “${assocRefLink.definition.name}” is a self comparison with “${getFullName(backlink)}” that has no foreign keys`,
            )
          }
          // managed backlink -> calculate fk-pk pairs
          const fkPkPairs = getParentKeyForeignKeyPairs(ctx, backlink, targetSideRefLink)
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
              (targetSideRefLink.definition.elements || ctx.getDefinition(targetSideRefLink.definition.target).elements)
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
    else return ctx.getDefinition(getParentEntity(element.parent).name)
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
function getParentKeyForeignKeyPairs(ctx, assoc, targetSideRefLink, flipSourceAndTarget = false) {
  const res = []
  const backlink = backlinkFor(ctx, assoc)?.[0]
  const { target } = backlink || assoc
  const keys = keysOf(backlink || assoc, ctx.state.metadata)
  if (keys) {
    keys.forEach(fk => {
      const { ref, as } = fk
      const elem = flattenModule.getElementForRef(ctx, ref, ctx.getDefinition(target)) // find the element (the target element of the foreign key) in the target of the (backlink) association
      const flatParentKeys = flattenModule.getFlatColumnsFor(ctx, elem, {
        baseName: ref.slice(0, ref.length - 1).join('_'),
      }) // it might be a structured element, so expand it into the full parent key tuple
      const flatAssociationName = getFullName(backlink || assoc) // get the name of the (backlink) association
      const flatForeignKeys = flattenModule.getFlatColumnsFor(ctx, elem, {
        baseName: flatAssociationName,
        columnAlias: as,
      }) // the name of the (backlink) association is the base of the foreign key tuple, also respect aliased fk.

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
