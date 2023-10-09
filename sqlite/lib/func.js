'use strict'

const StandardFunctions = {
  // Ensure ISO strings are returned for date/time functions
  current_timestamp: () => 'ISO(current_timestamp)',
  // SQLite doesn't support arguments for current_date and current_time
  current_date: () => 'current_date',
  current_time: () => 'current_time',

  /**
   * Generates SQL statement that produces a boolean value indicating whether the search term is contained in the given columns
   * @param {string} ref
   * @param {string} arg
   * @returns {string}
   */
  search: function (ref, arg) {
    if (!('val' in arg)) throw `SQLite only supports single value arguments for $search`
    const refs = ref.list || [ref],
      { toString } = ref
    return '(' + refs.map(ref2 => this.contains(this.tolower(toString(ref2)), this.tolower(arg))).join(' or ') + ')'
  },
}

const HANAFunctions = {
  /** defined in db-service */
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
