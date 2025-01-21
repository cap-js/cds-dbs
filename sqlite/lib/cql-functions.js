'use strict'

const StandardFunctions = {
  // Ensure ISO strings are returned for date/time functions
  current_timestamp: () => 'ISO(current_timestamp)',
  // SQLite doesn't support arguments for current_date and current_time
  current_date: () => 'current_date',
  current_time: () => 'current_time',
  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string contains the second string
   * @param  {...string} args
   * @returns {string}
   */
  contains: (...args) => `(ifnull(instr(${args}),0) > 0)`,
  /**
   * Generates SQL statement that produces the index of the first occurrence of the second string in the first string
   * @param {string} x
   * @param {string} y
   * @returns {string}
   */
  indexof: (x, y) => `instr(${x},${y}) - 1`, // sqlite instr is 1 indexed
  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string starts with the second string
   * @param {string} x
   * @param {string} y
   * @returns {string}
   */
  startswith: (x, y) => `coalesce(instr(${x},${y}) = 1,false)`, // sqlite instr is 1 indexed
  // takes the end of the string of the size of the target and compares it with the target
  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string ends with the second string
   * @param {string} x
   * @param {string} y
   * @returns {string}
   */
  endswith: (x, y) => `coalesce(substr(${x}, length(${x}) + 1 - length(${y})) = ${y},false)`,
  /**
   * Generates SQL statement that matches the given string against a regular expression
   * @param {string} x
   * @param {string} y
   * @returns {string}
   */
  matchesPattern: (x, y) => `(${x} regexp ${y})`,
  /**
   * Generates SQL statement that matches the given string against a regular expression
   * @param {string} x
   * @param {string} y
   * @returns {string}
   */
  matchespattern: (x, y) => `(${x} regexp ${y})`,

  // date functions
  /**
   * Generates SQL statement that produces the year of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  year: x => `cast( strftime('%Y',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the month of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  month: x => `cast( strftime('%m',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the day of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  day: x => `cast( strftime('%d',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the hours of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  hour: x => `cast( strftime('%H',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the minutes of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  minute: x => `cast( strftime('%M',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the seconds of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  second: x => `cast( strftime('%S',${x}) as Integer )`,
  // REVISIT: make precision configurable
  /**
   * Generates SQL statement that produces the fractional seconds of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  fractionalseconds: x => `cast( substr( strftime('%f', ${x}), length(strftime('%f', ${x})) - 3) as REAL)`,
}

const HANAFunctions = {
  /**
   * Generates SQL statement that calculates the difference in 100nanoseconds between two timestamps
   * @param {string} x left timestamp
   * @param {string} y right timestamp
   * @returns {string}
   */
  nano100_between: (x, y) => `(julianday(${y}) - julianday(${x})) * 864000000000`,
  /**
   * Generates SQL statement that calculates the difference in seconds between two timestamps
   * @param {string} x left timestamp
   * @param {string} y right timestamp
   * @returns {string}
   */
  seconds_between: (x, y) => `(julianday(${y}) - julianday(${x})) * 86400`,
  /**
   * Generates SQL statement that calculates the difference in days between two timestamps
   * Calculates the difference in full days using julian day
   * Using the exact time of the day to determine whether 24 hours have passed or not to add the final day
   * When just comparing the julianday values with each other there are leap seconds included
   * Which on the day resolution are included as the individual days therefor ignoring them to match HANA
   * @param {string} x left timestamp
   * @param {string} y right timestamp
   * @returns {string}
   */
  days_between: (x, y) => `(
    cast ( julianday(${y}) as Integer ) - cast ( julianday(${x}) as Integer )
  ) + (
    case
      when ( julianday(${y}) < julianday(${x}) ) then
        (cast( strftime('%H%M%S%f0000', ${y}) as Integer ) < cast( strftime('%H%M%S%f0000', ${x}) as Integer ))
      else
        (cast( strftime('%H%M%S%f0000', ${y}) as Integer ) > cast( strftime('%H%M%S%f0000', ${x}) as Integer )) * -1
    end
  )`,
  /**
   * Generates SQL statement that calculates the difference in months between two timestamps
   *
   * (y1 - y0) * 12 + (m1 - m0) + (t1 < t0) * -1
   * '%d%H%M%S%f' returns as a number like which results in an equal check to:
   * (
   *   d1 < d0 ||
   *   (d1 = d0 && h1 < h0) ||
   *   (d1 = d0 && h1 = h0 && m1 < m0) ||
   *   (d1 = d0 && h1 = h0 && m1 = m0 && s1 < s0) ||
   *   (d1 = d0 && h1 = h0 && m1 = m0 && s1 = s0 && ms1 < ms0)
   * )
   * Which will remove the current month if the time of the month is below the time of the month of the start date
   * It should not matter that the number of days in the month is different as for a month to have passed
   * the time of the month would have to be higher then the time of the month of the start date
   *
   * Also check whether the result will be positive or negative to make sure to not subtract an extra month
   * @param {string} x left timestamp
   * @param {string} y right timestamp
   * @returns {string}
   */
  months_between: (x, y) => `
  (
    (
      ( cast( strftime('%Y', ${y}) as Integer ) - cast( strftime('%Y', ${x}) as Integer ) ) * 12
    ) + (
      cast( strftime('%m', ${y}) as Integer ) - cast( strftime('%m', ${x}) as Integer )
    ) + (
      (
        case
          when ( cast( strftime('%Y%m', ${y}) as Integer ) < cast( strftime('%Y%m', ${x}) as Integer ) ) then
            (cast( strftime('%d%H%M%S%f0000', ${y}) as Integer ) > cast( strftime('%d%H%M%S%f0000', ${x}) as Integer ))
          else
            (cast( strftime('%d%H%M%S%f0000', ${y}) as Integer ) < cast( strftime('%d%H%M%S%f0000', ${x}) as Integer )) * -1
        end
      )
    )
  )`,
  /**
   * Generates SQL statement that calculates the difference in years between two timestamps
   * @param {string} x left timestamp
   * @param {string} y right timestamp
   * @returns {string}
   */
  years_between(x, y) {
    return `floor(${this.months_between(x, y)} / 12)`
  },
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
