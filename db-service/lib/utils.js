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

// export the function to be used in other modules
module.exports = {
  prettyPrintRef,
  isCalculatedOnRead,
  isCalculatedElement
}
