'use strict'

const { foreignKeysOf } = require('../model')

const cds = require('@sap/cds')
const cdsTypes = cds.builtin.types
const { defineProperty } = require('../../utils')

/**
 * Assigns the given `element` as non-enumerable property 'element' onto `col`.
 *
 * @param {object} col
 * @param {csn.Element} element
 */
function setElementOnColumns(col, element) {
  defineProperty(col, 'element', element)
}

function rejectDuplicatedElement(elementName) {
  throw new Error(`Duplicate definition of element “${elementName}”`)
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
  const cdsType = cdsTypes[cast.type]
  thing.cast = cdsType ? new cdsType.constructor(cast) : cast
  if (cdsType) thing.cast.type = cdsType._type
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
function getCopyWithAnnos(from, base, materialize = false) {
  const result = Object.create(base)
  if (materialize) Object.assign(result, base)
  for (const prop in from) {
    if (!prop.startsWith('@')) continue
    result[prop] = from[prop]
  }
  if (from.as && base.name !== from.as) {
    defineProperty(result, 'name', from.as)
  }
  return result
}

function getCdsTypeForVal(val) {
  // REVISIT: JS null should have a type for proper DB layer conversion logic
  // if(val === null) return {type:'cds.String'}
  switch (typeof val) {
    case 'string':
      return new cdsTypes.String.constructor()
    case 'boolean':
      return new cdsTypes.Boolean.constructor()
    case 'number':
      return Number.isSafeInteger(val) ? new cdsTypes.Integer.constructor() : new cdsTypes.Decimal.constructor()
    default:
      return {}
  }
}

function getDefinitionFromSources(sources, id) {
  return sources[id].definition
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
  return e in (assoc.elements || foreignKeysOf(assoc) || {})
}
const idOnly = ref => ref.id || ref

function applyToFunctionArgs(funcArgs, cb, cbArgs) {
  if (Array.isArray(funcArgs)) funcArgs.forEach(arg => cb(arg, ...cbArgs))
  else if (typeof funcArgs === 'object') Object.keys(funcArgs).forEach(prop => cb(funcArgs[prop], ...cbArgs))
}

function getMainAlias(query) {
  let mainAlias
  if (query.outerQueries) mainAlias = query.outerQueries[0].SELECT?.from.$refLinks.at(-1)
  else mainAlias = query.SELECT?.from.$refLinks.at(-1)
  if (!mainAlias) throw new Error('Cannot determine main query source for $main, please report this')
  return mainAlias
}

module.exports = {
  isNonForeignKeyNavigation,
  rejectNonFkNavigation,
  isForeignKeyOf,
  applyToFunctionArgs,
  getMainAlias,
  idOnly,
  setElementOnColumns,
  rejectDuplicatedElement,
  getElementForCast,
  getCopyWithAnnos,
  getCdsTypeForVal,
  getDefinitionFromSources,
}
