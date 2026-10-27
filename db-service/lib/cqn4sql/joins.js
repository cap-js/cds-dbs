'use strict'

module.exports = { translateAssocsToJoins, backlinkFor, onCondFor, getParentKeyForeignKeyPairs }

const runtimeViewsModule = require('./runtime-views')
const expressionsModule = require('./expressions')
const flattenModule = require('./flatten')

const { keysOf } = require('./model')
const { mapArgs } = require('./expression-tree')
const cloneCqn = require('./clone')
const { resolveExpression } = require('./resolve/references')

const { pseudos } = require('./pseudos')
const { hasOwnSkip, isRuntimeView } = require('../utils')
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

  function calculateOnCondition(tokens) {
    const host = ctx.getDefinition(getParentEntity(assocRefLink.definition).name)
    const sourceBase = { definition: host, target: host, alias: targetSideRefLink.alias }
    const targetBase = { definition: target, target, alias: assocRefLink.alias }
    const sources = { [sourceBase.alias]: sourceBase, [targetBase.alias]: targetBase }
    const scope = { ...ctx, sources, query: { sources } }
    return transform(cloneCqn(tokens))

    function transform(tokens) {
      const result = [],
        pending = []
      const flush = () => {
        result.push(...expressionsModule.getTransformedTokenStream(scope, pending))
        pending.length = 0
      }
      for (let i = 0; i < tokens.length; i++) {
        const lhs = tokens[i],
          rhs = tokens[i + 2]
        const self = token => token?.ref?.length === 1 && token.ref[0] === '$self'
        const other = self(lhs) ? rhs : self(rhs) ? lhs : null
        if (other?.ref) {
          flush()
          const backlink = flattenModule.getElementForRef(
            ctx,
            other.ref.slice(1),
            other.ref[0] in { $self: true, $projection: true } ? host : target,
          )
          if (keysOf(backlink, ctx.state.metadata)?.length === 0) {
            throw new Error(
              `Path step “${assocRefLink.definition.name}” is a self comparison with “${getFullName(backlink)}” that has no foreign keys`,
            )
          }
          const condition = onCondFor(
            ctx,
            { definition: backlink, alias: targetSideRefLink.alias },
            { definition: target, target, alias: assocRefLink.alias },
            !inWhereOrJoin,
          )
          result.push(...(tokens[i - 1] || tokens[i + 3] ? [asXpr(condition)] : condition))
          i += 2
        } else if (lhs.xpr || lhs.list || lhs.args) {
          flush()
          const rewritten = { ...lhs }
          if (lhs.xpr) rewritten.xpr = transform(lhs.xpr)
          if (lhs.list) rewritten.list = transform(lhs.list)
          if (lhs.args) rewritten.args = mapArgs(lhs.args, arg => transform([arg]))
          result.push(rewritten)
        } else {
          bind(lhs)
          // Expressions are emitted together so tuple comparisons retain their context.
          pending.push(lhs)
        }
      }
      flush()
      return result
    }

    function bind(token) {
      if (token.ref) {
        if (token.ref[0] in pseudos.elements || token.param) return
        const ref = token.ref[0] === '$self' ? token.ref.slice(1) : token.ref
        const targetSide = ref[0] === assocRefLink.definition.name
        const base = targetSide ? targetBase : sourceBase
        token.ref = targetSide ? ref.slice(1) : ref
        resolveExpression(scope, token, null, base, { inExists: true })
        token.ref.unshift(base.alias)
        token.$refLinks.unshift(base)
      }
    }
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
        // Backlinks exchange the key and foreign-key sides; WHERE/EXISTS
        // determines which side is rendered first in the comparison.
        const [source, target] =
          flipSourceAndTarget !== !!backlink
            ? [flatParentKeys[i], flatForeignKeys[i]]
            : [flatForeignKeys[i], flatParentKeys[i]]
        const name = column => (column.as ? flatAssociationName + '_' + column.as : column.ref[0])
        res.push({
          sourceSide: flipSourceAndTarget ? source : { ref: [name(source)] },
          targetSide: { ref: [targetSideRefLink.alias, ...(flipSourceAndTarget ? [name(target)] : target.ref)] },
        })
      }
    })
  }
  return res
}
