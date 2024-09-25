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

// export the function to be used in other modules
module.exports = {
  prettyPrintRef,
}
