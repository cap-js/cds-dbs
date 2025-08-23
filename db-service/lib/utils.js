'use strict'

/**
 * Formats a ref array into a string representation.
 * If the first step is an entity, the separator is a colon, otherwise a dot.
 *
 * @param {Array} ref - The reference array to be formatted.
 * @param {Object} model - The model object containing definitions.
 * @returns {string} The formatted string representation of the reference.
 */
function prettyPrintRef(ref, model = null) {
  return ref.reduce((acc, curr, j) => {
    if (j > 0) {
      if (j === 1 && model?.definitions[ref[0]]?.kind === 'entity') {
        acc += ':'
      } else {
        acc += '.'
      }
    }
    return acc + `${curr.id ? curr.id + '[…]' : curr}`
  }, '')
}

function hasOwnSkip(definition) {
  return (
    definition && Object.hasOwn(definition, '@cds.persistence.skip') && definition['@cds.persistence.skip'] === true
  )
}

/**
 * Determines if a definition is calculated on read.
 * - Stored calculated elements are not unfolded
 * - Association like calculated elements have been re-written by the compiler
 *   they essentially behave like unmanaged associations as their calculations
 *   have been incorporated into an on-condition which is handled elsewhere
 *
 * @param {Object} def - The definition to check.
 * @returns {boolean} - Returns true if the definition is calculated on read, otherwise false.
 */
function isCalculatedOnRead(def) {
  return isCalculatedElement(def) && !def.value.stored && !def.on
}
function isCalculatedElement(def) {
  return def?.value
}

/**
 * Calculates the implicit table alias for a given string.
 *
 * Based on the last part of the string, the implicit alias is calculated
 * by taking the first character and prepending it with '$'.
 * A leading '$' is removed if the last part already starts with '$'.
 *
 * @example
 * getImplicitAlias('Books') => '$B'
 * getImplicitAlias('bookshop.Books') => '$B'
 * getImplicitAlias('bookshop.$B') => '$B'
 *
 * @param {string} str - The input string.
 * @returns {string}
 */
function getImplicitAlias(str, useTechnicalAlias = true) {
  const index = str.lastIndexOf('.')
  if (useTechnicalAlias) {
    const postfix = (index != -1 ? str.substring(index + 1) : str).replace(/^\$/, '')[0] || /* str === '$' */ '$'
    return '$' + postfix
  }
  return index != -1 ? str.substring(index + 1) : str
}

function defineProperty(obj, prop, value) {
  return Object.defineProperty(obj, prop, {
    value,
    writable: true,
    configurable: true,
  })
}

/**
 * Shared utility functions which operate dynamically on the model / query.
 *
 * @param {CSN.model} model
 * @param {CQL} query
 */
function getModelUtils(model, query) {
  /**
   * Returns the name of the localized entity for the given `definition`.
   * 
   * If the query is `localized`, returns the name of the `localized` version of the `definition`.
   * If there is no `localized` version of the `definition`, return the name of the `definition`
   *
   * @param {CSN.definition} definition
   * @returns the name of the localized entity for the given `definition` or `definition.name`
   */
  function getLocalizedName(definition) {
    if (!isLocalized(definition)) return definition.name
    const view = getDefinition(`localized.${definition.name}`)
    return view?.name || definition.name
  }

  /**
   * Returns true if the definition shall be localized, in the context of the given query.
   * 
   * If a given query is required to be translated, the query has
   * the `.localized` property set to `true`. If that is the case,
   * and the definition has not set the `@cds.localized` annotation
   * to `false`, the given definition must be translated.
   *
   * @returns true if the given definition shall be localized
   */
  function isLocalized(definition) {
    return (
      query.SELECT?.localized &&
      definition?.['@cds.localized'] !== false &&
      !query.SELECT.forUpdate &&
      !query.SELECT.forShareLock
    )
  }

  /**
   * Returns the (potentially localized) CSN definition for the given name from the model.
   *
   * @param {string} name - The name of the definition to retrieve.
   * @returns {Object|null} The CSN definition or null if not found. The definition may be localized.
   */
  function getDefinition(name) {
    if (!name) return null
    const def = model.definitions[name]
    if (!def || !isLocalized(def)) return def
    return model.definitions[`localized.${def.name}`] || def
  }
  return {
    getLocalizedName,
    isLocalized,
    getDefinition,
  }
}

// export the function to be used in other modules
module.exports = {
  prettyPrintRef,
  isCalculatedOnRead,
  isCalculatedElement,
  getImplicitAlias,
  defineProperty,
  getModelUtils,
  hasOwnSkip,
}
