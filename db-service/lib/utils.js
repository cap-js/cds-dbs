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
  if(useTechnicalAlias) {
    const postfix = (index != -1 ? str.substring(index + 1) : str).replace(/^\$/, '')[0] || /* str === '$' */ '$'
    return '$' + postfix
  }
  return index != -1 ? str.substring(index + 1) : str
}

// export the function to be used in other modules
module.exports = {
  prettyPrintRef,
  isCalculatedOnRead,
  isCalculatedElement,
  getImplicitAlias,
}
