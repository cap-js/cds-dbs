'use strict'

const StandardFunctions = {
  // Ensure ISO strings are returned for date/time functions
  current_timestamp: () => 'ISO(current_timestamp)',
  // SQLite doesn't support arguments for current_date and current_time
  current_date: () => 'current_date',
  current_time: () => 'current_time',
}

const HANAFunctions = {
  /** defined in db-service */
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
