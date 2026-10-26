'use strict'

module.exports = { getTransformedTokenStream, expandComparison, assertNoStructInXpr, getTransformedFunctionArgs }

const { mapArgs } = require('./expression-tree')

const { elementSources } = require('./resolve/sources')

const { getCalculatedValue } = require('./scope')
const { bindingFor } = require('./binding')

const sourcesModule = require('./sources')
const enumsModule = require('./enums')
const columnsModule = require('./columns')
const flattenModule = require('./flatten')

const { keysOf } = require('./model')

const { pseudos } = require('./pseudos')
const { isCalculatedOnRead, isCalculatedElement } = require('../utils')
const {
  getFullName,
  asXpr,
  setElementOnColumns,
  getPrimaryKey,
  idOnly,
  is_regexp,
  notEqOps,
  notSupportedOps,
  allOps,
  isStructured,
  isAssocOrStruct,
} = require('./helpers')

/**
 * Transforms a CQN token stream (e.g. `where`, `xpr` or `having`) into a SQL like expression.
 *
 * Expand `exists <assoc>` into `WHERE EXISTS` subqueries, apply flattening to `ref`s.
 * Recursively apply `cqn4sql` to query expressions found in the token stream.
 *
 * @param {object[]} tokenStream - The token stream to transform. Each token in the stream is an
 *                                 object representing a CQN construct such as a column, an operator,
 *                                 or a subquery.
 * @param {object} [context] - Optional context object.
 * @param {object} [context.$baseLink] - The context in which the `ref`s in the token stream are resolvable.
 *                                   It serves as the reference point for resolving associations in
 *                                   statements like `{…} WHERE exists assoc[exists anotherAssoc]`.
 *                                   Here, the $baseLink for `anotherAssoc` would be `assoc`.
 * @param {string} [context.prop] - The query property which holds the token stream which shall be
 *                                  transformed by this function, e.g. "where".
 * @returns {object[]} - The transformed token stream.
 */
function getTransformedTokenStream(ctx, tokenStream, context = {}) {
  const transformedTokenStream = []
  const { $baseLink /* prop */ } = context
  for (let i = 0; i < tokenStream.length; i++) {
    const token = tokenStream[i]
    if (token === 'exists') {
      transformedTokenStream.push(token)
      const whereExistsSubSelects = []
      const { ref, $refLinks } = tokenStream[i + 1]
      if (!ref) continue
      if (ref[0] in { $self: true, $projection: true })
        throw new Error(`Unexpected "${ref[0]}" following "exists", remove it or add a table alias instead`)
      const firstStepIsTableAlias = ref.length > 1 && ref[0] in ctx.query.sources
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
            alias: elementSources(ctx.query, id)[0].index,
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

        const as = sourcesModule.getNextAvailableTableAlias(ctx, ctx.getImplicitAlias(next.alias))
        next.alias = as
        if (!next.definition.target) {
          let type = next.definition.type
          if (isCalculatedElement(next.definition)) {
            // try to infer the type at the leaf for better error message
            const { $refLinks } = getCalculatedValue(ctx, tokenStream[i + 1])
            type = $refLinks?.at(-1).definition.type || 'expression'
          }
          throw new Error(
            `Expecting path “${tokenStream[i + 1].ref
              .map(idOnly)
              .join('.')}” following “EXISTS” predicate to end with association/composition, found “${type}”`,
          )
        }
        const { definition: fkSource } = next
        sourcesModule.ensureValidForeignKeys(ctx, fkSource, ref)
        const { where, ...args } = step
        whereExistsSubSelects.push(sourcesModule.getWhereExistsSubquery(ctx, current, next, where, true, args))
      }

      const whereExists = { SELECT: sourcesModule.whereExistsSubqueries(ctx, whereExistsSubSelects) }
      // append, don't index by `i`: a preceding branch (e.g. flattening `<assoc> is null`)
      // may have changed the transformed stream's length, so `[i + 1]` would leave holes
      transformedTokenStream.push(whereExists)
      // skip the association ref which we just turned into the subquery
      i += 1
    } else if (token !== null && typeof token === 'object' && '#' in token) {
      // Enum token: resolve to its value
      transformedTokenStream.push(enumsModule.resolveEnumToken(ctx, token, tokenStream, i))
    } else if (token.list) {
      if (token.list.length === 0) {
        // replace `[not] in <empty list>` to harmonize behavior across dbs
        const precedingTwoTokens = tokenStream.slice(i - 2, i)
        const firstPrecedingToken = typeof precedingTwoTokens[0] === 'string' ? precedingTwoTokens[0].toLowerCase() : ''
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
        let { list } = token
        // Resolve enum tokens in list items using context from the parent token stream
        if (list.some(e => e !== null && typeof e === 'object' && '#' in e)) {
          const enumDef = enumsModule.findEnumDefinition(ctx, tokenStream, i)
          list = list.map(item =>
            item !== null && typeof item === 'object' && '#' in item
              ? enumsModule.resolveEnumToken(ctx, item, tokenStream, i, enumDef)
              : item,
          )
        }
        if (list.every(e => 'val' in e))
          // no need for transformation
          transformedTokenStream.push({ list })
        else transformedTokenStream.push({ list: getTransformedTokenStream(ctx, list, { $baseLink, prop: 'list' }) })
      }
    } else if (tokenStream.length === 1 && token.val && $baseLink) {
      // infix filter - OData variant w/o mentioning key
      const def = ctx.getDefinition($baseLink.definition.target) || $baseLink.definition
      const flatKeys = getPrimaryKey(def, $baseLink.alias)
      if (flatKeys.length > 1)
        // TODO: what about keyless?
        throw new Error(
          `Shortcut notation “[${token.val}]” not available for composite primary key of “${def.name}”, write “<key> = ${token.val}” explicitly`,
        )
      transformedTokenStream.push(...[flatKeys[0], '=', token])
    } else if (token.ref && token.param) {
      transformedTokenStream.push({ ...token })
    } else if (pseudos.elements[token.ref?.[0]]) {
      transformedTokenStream.push({ ...token })
    } else {
      // expand `struct = null | struct2`
      const next = tokenStream[i + 1]
      let indexRhs = i + 2
      let rhs = tokenStream[indexRhs] // either another operator (i.e. `not like` et. al.) or the operand, i.e. the val | null
      const lhsDef = token.$refLinks?.at(-1).definition
      let rhsDef = rhs?.$refLinks?.at(-1)?.definition
      if (
        allOps.some(([firstOp]) => firstOp === next) &&
        (lhsDef?.elements ||
          keysOf(lhsDef, ctx.state.metadata) ||
          rhsDef?.elements ||
          keysOf(rhsDef, ctx.state.metadata))
      ) {
        const ops = [next]
        if (allOps.some(([, secondOp]) => secondOp === rhs)) {
          ops.push(rhs)
          rhs = tokenStream[i + 3]
          indexRhs += 1
        }

        if (notSupportedOps.some(([firstOp]) => firstOp === next))
          throw new Error(`The operator "${next}" can only be used with scalar operands`)

        const newTokens = expandComparison(ctx, token, ops, rhs, $baseLink)
        if (newTokens.length === 0) throw new Error(`Can't compare two empty structures`)

        const needXpr = Boolean(tokenStream[i - 1] || tokenStream[indexRhs + 1])
        transformedTokenStream.push(...(needXpr ? [asXpr(newTokens)] : newTokens))
        i = indexRhs // jump to next relevant index
      } else {
        // reject associations in expression, except if we are in an infix filter -> $baseLink is set
        assertNoStructInXpr(ctx, token, context)
        // reject virtual elements in expressions as they will lead to a sql error down the line
        if (lhsDef?.virtual) throw new Error(`Virtual elements are not allowed in expressions`)

        let result = typeof token !== 'object' || is_regexp(token?.val) ? token : { ...token }
        if (typeof token === 'object' && 'val' in token && 'param' in token)
          Object.defineProperty(result, 'param', { value: token.param })
        if (token.ref) {
          const { definition } = token.$refLinks.at(-1)
          // Add definition to result
          setElementOnColumns(result, definition)
          if (isCalculatedOnRead(definition)) {
            const calculatedElement = columnsModule.resolveCalculatedElement(ctx, token, true, $baseLink)
            transformedTokenStream.push(calculatedElement)
            continue
          }
          if (token.ref.length > 1 && token.ref[0] === '$self' && !token.$refLinks[0].definition.kind) {
            if (ctx.query.outerQueries) {
              const outerQuery = ctx.query.outerQueries[0]
              const stepToFind = token.ref[1]?.id || token.ref[1]
              const outerAlias = elementSources(outerQuery, stepToFind)?.[0].index
              if (outerAlias) {
                result.ref = [outerAlias, token.flatName]
                transformedTokenStream.push(result)
                continue
              }
            }
            const dollarSelfReplacement = [columnsModule.calculateDollarSelfColumn(ctx, token, true)]
            transformedTokenStream.push(...getTransformedTokenStream(ctx, dollarSelfReplacement))
            continue
          }
          // if we have e.g. a calculated element like `books.authorLastName,`
          // we have effectively a ref ['books', 'author', 'lastName']
          // in that case, we have a baseLink `books` which we need to resolve the following steps
          // however, the correct table alias has been assigned to the `author` step
          // hence we need to ignore the alias of the `$baseLink`
          const lastAssoc = token.isJoinRelevant && bindingFor(ctx, token).association
          const tableAlias = sourcesModule.getTableAlias(
            ctx,
            token,
            (!lastAssoc?.onlyForeignKeyAccess && lastAssoc) || $baseLink,
          )
          if (isAssocOrStruct(definition)) {
            const flat = flattenModule.getFlatColumnsFor(ctx, token, { tableAlias: $baseLink?.alias || tableAlias })
            if (flat.length === 0)
              throw new Error(
                `Structured element “${getFullName(definition)}” expands to nothing and can't be used in expressions`,
              )
            else if (flat.length > 1 && context.prop !== 'list')
              // only acceptable in `list`
              throw new Error(
                `Structured element “${getFullName(definition)}” expands to multiple fields and can't be used in expressions`,
              )
            transformedTokenStream.push(...flat)
            continue
          } else if ((!$baseLink || lastAssoc) && token.isJoinRelevant) {
            let name = bindingFor(ctx, token).columnName
            result.ref = [tableAlias, name]
          } else if (tableAlias) {
            result.ref = [tableAlias, token.flatName]
          } else {
            // if there is no table alias, we might select from an anonymous subquery
            result.ref = [token.flatName]
          }
        } else if (token.SELECT) {
          result = sourcesModule.transformSubquery(ctx, token)
        } else {
          if (token.xpr) {
            result.xpr = getTransformedTokenStream(ctx, token.xpr, { $baseLink })
          }
          if (token.func && token.args) {
            result.args = getTransformedFunctionArgs(ctx, token.args, $baseLink)
          }
        }

        if (result.cast) result.cast = enumsModule.resolveEnumCastType(ctx, result.cast)
        transformedTokenStream.push(result)
      }
    }
  }
  return transformedTokenStream
}

/**
 * Expand the given definition and compare all leafs to `val`.
 *
 * @param {object} lhs with $refLinks
 * @param {string} operator one of allOps
 * @param {object} rhs either `null` or a column (with `ref` and `$refLinks`)
 * @param {object} $baseLink optional base `$refLink`, e.g. for infix filters of scoped queries.
 *                           In the following example, we must pass `bookshop:Reproduce` as $baseLink for `author`:
 *
 *                           `DELETE.from('bookshop.Reproduce[author = null]:accessGroup')`
 *                                                            ^^^^^^
 * @returns {array}
 */
function expandComparison(ctx, lhs, operator, rhs, $baseLink = null) {
  const { definition: lhsDef, val: lhsVal } = lhs.val ? lhs : lhs.$refLinks.at(-1)
  const { definition: rhsDef, val: rhsVal } = rhs.val ? rhs : rhs.$refLinks?.at(-1) || {}
  const result = []
  if (lhsDef && rhsDef) {
    // both must be structured
    const lhsIsStructured = isAssocOrStruct(lhsDef)
    const rhsIsStructured = isAssocOrStruct(rhsDef)
    if (!lhsIsStructured)
      throw new Error(
        `Can't compare structure “${rhs.ref.map(idOnly).join('.')}” with non-structure “${lhs.ref.map(idOnly).join('.')}”`,
      )
    if (!rhsIsStructured)
      throw new Error(
        `Can't compare structure “${lhs.ref.map(idOnly).join('.')}” with non-structure “${rhs.ref.map(idOnly).join('.')}”`,
      )

    const flatLhs = flattenWithBaseName(lhs)
    const flatRhs = flattenWithBaseName(rhs)
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
        const lhsPath = lhs.ref.map(idOnly).join('.')
        const rhsPath = rhs.ref.map(idOnly).join('.')
        throw new Error(`Can't compare "${lhsPath}" with "${rhsPath}": the operands must have the same structure`)
      }
      const cleansedRhs = flatRhs.splice(indexOfElementOnRhs, 1)[0] // remove the element also from RHS
      result.push({ ref }, ...operator, cleansedRhs)
      if (flatLhs.length > 0) result.push(boolOp)
    }
  } else if (lhsDef && (rhsVal || rhs === 'null' || rhs.val === null)) {
    // compare with value
    const flatLhs = flattenWithBaseName(lhs)
    if (flatLhs.length !== 1 && rhsVal && rhs !== 'null') canOnlyCompareToExactlyOneLeaf(lhsDef, lhs.ref, rhsVal)

    const boolOp = notEqOps.some(([f, s]) => operator[0] === f && operator[1] === s) ? 'or' : 'and'
    flatLhs.forEach((column, i) => {
      result.push(column, ...operator, rhs)
      if (flatLhs[i + 1]) result.push(boolOp)
    })
  } else if (lhsVal && rhsDef) {
    const flatRhs = flattenWithBaseName(rhs)
    // comparing a struct to a value is ok if structure has exactly one leaf
    if (flatRhs.length !== 1 && lhsVal) canOnlyCompareToExactlyOneLeaf(rhsDef, rhs.ref, lhsVal)

    const boolOp = notEqOps.some(([f, s]) => operator[0] === f && operator[1] === s) ? 'or' : 'and'
    flatRhs.forEach((column, i) => {
      result.push(lhs, ...operator, column)
      if (flatRhs[i + 1]) result.push(boolOp)
    })
  }
  return result

  function canOnlyCompareToExactlyOneLeaf(struct, structRef, val) {
    const what = struct.isAssociation ? 'association' : 'structure'
    const postfix = struct.isAssociation ? 'associations with one foreign key' : 'structures with one sub-element'
    throw new Error(
      `Can't compare ${what} "${structRef.map(idOnly).join('.')}" to value "${val}"; only possible for ${postfix}`,
    )
  }

  function flattenWithBaseName(def) {
    if (!def.$refLinks) return def
    const leaf = def.$refLinks[def.$refLinks.length - 1]
    const first = def.$refLinks[0]
    const tableAlias = sourcesModule.getTableAlias(
      ctx,
      def,
      def.ref.length > 1 && first.definition.isAssociation ? first : $baseLink,
    )
    if (leaf.definition.parent.kind !== 'entity')
      // we need the base name
      return flattenModule.getFlatColumnsFor(ctx, leaf.definition, {
        baseName: def.ref
          .map(idOnly)
          .slice(0, def.ref.length - 1)
          .join('_'),
        tableAlias,
      })
    return flattenModule.getFlatColumnsFor(ctx, leaf.definition, { tableAlias })
  }
}

function assertNoStructInXpr(ctx, token, context) {
  const definition = token.$refLinks?.at(-1).definition
  if (!definition) return
  const rejectStructs = context && context.prop in { where: 1, having: 1 }
  // unmanaged is always forbidden
  // expanding a ref in a `where`/`having` context
  if ((rejectStructs && definition?.target) || definition?.on) rejectAssocInExpression()
  if (rejectStructs && isStructured(definition))
    // REVISIT: let this through if not requested otherwise
    rejectStructInExpression()

  function rejectAssocInExpression() {
    throw new Error(`An association can't be used as a value in an expression`)
  }
  function rejectStructInExpression() {
    throw new Error(`A structured element can't be used as a value in an expression`)
  }
}

function getTransformedFunctionArgs(ctx, args, $baseLink = null) {
  return mapArgs(args, token => (token.val ? [token] : getTransformedTokenStream(ctx, [token], { $baseLink })))
}
