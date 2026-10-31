'use strict'

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

function resolveTable(target) {
  if (target.query?._target && !Object.prototype.hasOwnProperty.call(target, '@cds.persistence.table'))
    return resolveTable(target.query._target)
  return target
}

module.exports = { getImplicitAlias, resolveTable }
