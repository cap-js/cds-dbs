'use strict'

const session = require('./session.json')

const StandardFunctions = {
  // ==============================
  // Session Context Functions
  // ==============================

  /**
   * Generates SQL statement to retrieve session context
   * @param {Object} x - Object containing the session variable
   * @returns {string} - SQL statement
   */
  session_context: x => {
    let sql = `current_setting('${session[x.val] || x.val}')`
    if (x.val === '$now') sql += '::timestamp'
    return sql
  },

  // ==============================
  // String Functions
  // ==============================

  /**
   * Generates SQL statement that checks if one string contains another
   * @param  {...string} args - The strings to evaluate
   * @returns {string} - SQL statement
   */
  contains: (...args) => `(coalesce(strpos(${args}),0) > 0)`,

  /**
   * Generates SQL statement for the index of the first occurrence of one string in another
   * @param {string} x - The string to search
   * @param {string} y - The substring to find
   * @returns {string} - SQL statement
   */
  indexof: (x, y) => `strpos(${x},${y}) - 1`, // strpos is 1 indexed

  /**
   * Generates SQL statement that checks if a string starts with another string
   * @param {string} x - The string to evaluate
   * @param {string} y - The prefix to check
   * @returns {string} - SQL statement
   */
  startswith: (x, y) => `coalesce(strpos(${x},${y}) = 1,false)`,

  /**
   * Generates SQL statement that checks if a string ends with another string
   * @param {string} x - The string to evaluate
   * @param {string} y - The suffix to check
   * @returns {string} - SQL statement
   */
  endswith: (x, y) => `coalesce(substr(${x},length(${x}) + 1 - length(${y})) = ${y},false)`,

  /**
   * Generates SQL statement to match a string against a regular expression
   * @param {string} x - The string to match
   * @param {string} y - The regular expression
   * @returns {string} - SQL statement
   */
  matchesPattern: (x, y) => `regexp_like(${x}, ${y})`,

  /**
   * Alias for matchesPattern
   * @param {string} x - The string to match
   * @param {string} y - The regular expression
   * @returns {string} - SQL statement
   */
  matchespattern: (x, y) => `regexp_like(${x}, ${y})`,

  // ==============================
  // Date and Time Functions
  // ==============================

  /**
   * Generates SQL statement for the year part of a date
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  year: x => `date_part('year', ${castVal(x)})`,

  /**
   * Generates SQL statement for the month part of a date
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  month: x => `date_part('month', ${castVal(x)})`,

  /**
   * Generates SQL statement for the day part of a date
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  day: x => `date_part('day', ${castVal(x)})`,

  /**
   * Generates SQL statement to extract time from a date
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  time: x => `to_char(${castVal(x)}, 'HH24:MI:SS')`,

  /**
   * Generates SQL statement for the hour part of a date
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  hour: x => `date_part('hour', ${castVal(x)})`,

  /**
   * Generates SQL statement for the minute part of a date
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  minute: x => `date_part('minute', ${castVal(x)})`,

  /**
   * Generates SQL statement for the second part of a date
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  second: x => `floor(date_part('second', ${castVal(x)}))`,

  /**
   * Generates SQL statement for fractional seconds
   * @param {string} x - The date input
   * @returns {string} - SQL statement
   */
  fractionalseconds: x =>
    `CAST(date_part('second', ${castVal(x)}) - floor(date_part('second', ${castVal(x)})) AS DECIMAL)`,
}

const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
const isVal = x => x && 'val' in x
const castVal = x => `${x}${isVal(x) ? (isTime.test(x.val) ? '::TIME' : '::TIMESTAMP') : ''}`

const HANAFunctions = {
  // ==============================
  // Time Difference Functions
  // ==============================

  /**
   * Generates SQL statement for the difference in 100-nanoseconds between two timestamps
   * @param {string} x - Start timestamp
   * @param {string} y - End timestamp
   * @returns {string} - SQL statement
   */
  nano100_between: (x, y) => `EXTRACT(EPOCH FROM ${y}::TIMESTAMP - ${x}::TIMESTAMP) * 10000000`,

  /**
   * Generates SQL statement for the difference in seconds between two timestamps
   * @param {string} x - Start timestamp
   * @param {string} y - End timestamp
   * @returns {string} - SQL statement
   */
  seconds_between: (x, y) => `EXTRACT(EPOCH FROM ${y}::TIMESTAMP - ${x}::TIMESTAMP )`,

  /**
   * Generates SQL statement for the difference in days between two timestamps
   * @param {string} x - Start timestamp
   * @param {string} y - End timestamp
   * @returns {string} - SQL statement
   */
  days_between: (x, y) => `EXTRACT(DAY FROM ${y}::timestamp - ${x}::timestamp)::integer`,

  /**
   * Generates SQL statement for the difference in months between two timestamps
   * @param {string} x - Start timestamp
   * @param {string} y - End timestamp
   * @returns {string} - SQL statement
   */
  months_between: (x, y) => `((
        (EXTRACT(YEAR FROM ${castVal(y)}) - EXTRACT(YEAR FROM ${castVal(x)})) * 12
    )+(
        EXTRACT(MONTH FROM ${castVal(y)}) - EXTRACT(MONTH FROM ${castVal(x)})
    )+(
        case when ( cast( to_char(${castVal(y)},'YYYYMM') as Integer ) < cast( to_char(${castVal(x)},'YYYYMM') as Integer ) ) then
            cast((cast( to_char(${castVal(y)},'DDHH24MISSFF3') as bigint ) > cast( to_char(${castVal(x)},'DDHH24MISSFF3') as bigint )) as Integer)
        else
            cast((cast( to_char(${castVal(y)},'DDHH24MISSFF3') as bigint ) < cast( to_char(${castVal(x)},'DDHH24MISSFF3') as bigint )) as Integer) * -1
        end
    ))`,

  /**
   * Generates SQL statement for the difference in years between two timestamps
   * @param {string} x - Start timestamp
   * @param {string} y - End timestamp
   * @returns {string} - SQL statement
   */
  years_between(x, y) {
    return `TRUNC(${this.expr({ func: 'months_between', args: [x, y] })} / 12,0)`
  },
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
