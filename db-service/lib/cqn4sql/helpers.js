'use strict'

const { keysOf } = require('./model')

const { defineProperty } = require('../utils')

/**
 * For operators of <eqOps>, this is replaced by comparing all leaf elements with null, combined with and.
 * If there are at least two leaf elements and if there are tokens before or after the recognized pattern, we enclose the resulting condition in parens (...)
 */
const eqOps = [['is'], ['='] /* ['=='] */]
/**
 * For operators of <notEqOps>, do the same but use `or` instead of `and`.
 * This ensures that `not struct == <value>` is the same as `struct != <value>`.
 */
const notEqOps = [['is', 'not'], ['<>'], ['!=']]
/**
 * not supported in comparison w/ struct because of unclear semantics
 */
const notSupportedOps = [['>'], ['<'], ['>='], ['<='], ['*'], ['+'], ['-'], ['/']]

const allOps = eqOps.concat(notEqOps, notSupportedOps)

/**
 * @param {CSN.Element} elt
 * @returns {boolean}
 */
function isStructured(elt) {
  return Boolean(elt?.kind !== 'entity' && elt?.elements && !elt.isAssociation)
}

/**
 * @param {CSN.Element} elt
 * @returns {boolean}
 */
function isAssocOrStruct(elt) {
  return keysOf(elt) || (elt?.elements && elt.kind === 'element')
}

/**
 * Calculate the flat name for a deeply nested element:
 * @example `entity E { struct: { foo: String} }` => `getFullName(foo)` => `struct_foo`
 *
 * @param {CSN.element} node an element
 * @param {object} name the last part of the name, e.g. the name of the deeply nested element
 * @returns the flat name of the element
 */
function getFullName(node, name = node.name) {
  // REVISIT: this is an unfortunate implementation
  if (!node.parent || node.parent.kind === 'entity') return name

  return getFullName(node.parent, `${node.parent.name}_${name}`)
}

function hasLogicalOr(tokenStream) {
  return tokenStream.some(t => t in { OR: true, or: true })
}

function getParentEntity(element) {
  if (element.kind === 'entity') return element
  else return getParentEntity(element.parent)
}

function asXpr(thing) {
  return { xpr: thing }
}

function assignQueryModifiers(SELECT, modifiers) {
  for (const [key, val] of Object.entries(modifiers)) {
    if (key in { orderBy: 1, groupBy: 1 }) {
      if (SELECT[key]) SELECT[key].push(...val)
      else SELECT[key] = val
    } else if (key === 'limit') {
      // limit defined on the query has precedence
      if (!SELECT.limit) SELECT.limit = val
    } else if (key === 'having') {
      if (!SELECT.having) SELECT.having = val
      else SELECT.having.push('and', ...val)
    } else if (key === 'where') {
      // ignore OData shortcut variant: `… bookshop.Orders:items[2]`
      if (!val || (val.length === 1 && val[0].val)) continue
      if (!SELECT.where) SELECT.where = val
      // infix filter comes first in resulting where
      else
        SELECT.where = [
          ...(hasLogicalOr(val) ? [asXpr(val)] : val),
          'and',
          ...(hasLogicalOr(SELECT.where) ? [asXpr(SELECT.where)] : SELECT.where),
        ]
    }
  }
}

/**
 * Assigns the given `element` as non-enumerable property 'element' onto `col`.
 *
 * @param {object} col
 * @param {csn.Element} element
 */
function setElementOnColumns(col, element) {
  defineProperty(col, 'element', element)
}

function getPrimaryKey(entity, tableAlias = null) {
  const primaryKey = []
  for (const k in entity.elements) {
    const e = entity.elements[k]
    if (e.key === true && !e.virtual && e.isAssociation !== true) {
      primaryKey.push({ ref: tableAlias ? [tableAlias, e.name] : [e.name] })
    }
  }
  return primaryKey
}

const getName = col => col.as || col.ref?.at(-1)
const idOnly = ref => ref.id || ref
const refWithConditions = step => {
  let appendix
  const { args, where } = step
  if (where && args) appendix = JSON.stringify(where) + JSON.stringify(args)
  else if (where) appendix = JSON.stringify(where)
  else if (args) appendix = JSON.stringify(args)
  return appendix ? step.id + appendix : step
}
const is_regexp = x => x?.constructor?.name === 'RegExp' // NOTE: x instanceof RegExp doesn't work in repl

module.exports = {
  getFullName,
  hasLogicalOr,
  getParentEntity,
  asXpr,
  assignQueryModifiers,
  setElementOnColumns,
  getPrimaryKey,
  getName,
  idOnly,
  refWithConditions,
  is_regexp,
  eqOps,
  notEqOps,
  notSupportedOps,
  allOps,
  isStructured,
  isAssocOrStruct,
}
