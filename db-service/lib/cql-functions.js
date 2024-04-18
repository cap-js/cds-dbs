const StandardFunctions = {
  // OData: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_CanonicalFunctions

  // String and Collection Functions
  /**
   * Generates SQL statement that produces the length of a given string
   * @param {string} x
   * @returns {string}
   */
  length: x => `length(${x})`,
  /**
   * Generates SQL statement that produces the average of a given expression
   * @param {string} x
   * @returns {string}
   */
  average: x => `avg(${x})`,
  /**
   * Generates SQL statement that produces a boolean value indicating whether the search term is contained in the given columns
   * @param {string} ref
   * @param {string} arg
   * @returns {string}
   */
  search: function (ref, arg) {
    if (!('val' in arg)) throw new Error(`Only single value arguments are allowed for $search`)
    const refs = ref.list || [ref],
      { toString } = ref
    return '(' + refs.map(ref2 => this.contains(this.tolower(toString(ref2)), this.tolower(arg))).join(' or ') + ')'
  },
  /**
   * Generates SQL statement that produces a string with all provided strings concatenated
   * @param  {...string} args
   * @returns {string}
   */
  concat: (...args) => args.map(a => (a.xpr ? `(${a})` : a)).join(' || '),

  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string contains the second string
   * @param  {...string} args
   * @returns {string}
   */
  contains: (...args) => `ifnull(instr(${args}),0)`,
  /**
   * Generates SQL statement that produces the number of elements in a given collection
   * @param {string} x
   * @returns {string}
   */
  count: x => `count(${x || '*'})`,
  /**
   * Generates SQL statement that produces the number of distinct values of a given expression
   * @param {string} x
   * @returns {string}
   */
  countdistinct: x => `count(distinct ${x || '*'})`,
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
  startswith: (x, y) => `instr(${x},${y}) = 1`, // sqlite instr is 1 indexed
  // takes the end of the string of the size of the target and compares it with the target
  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string ends with the second string
   * @param {string} x
   * @param {string} y
   * @returns {string}
   */
  endswith: (x, y) => `substr(${x}, length(${x}) + 1 - length(${y})) = ${y}`,
  /**
   * Generates SQL statement that produces the substring of a given string
   * @example
   * // returns 'bc'
   * {func:'substring',args:[{val:'abc'},{val:1}]}
   * @example
   * // returns 'b'
   * {func:'substring',args:[{val:'abc'},{val:1},{val:1}]}
   * @param {string} x
   * @param {string} y
   * @param {string} z
   * @returns {string}
   */
  substring: (x, y, z) =>
    z
      ? `substr( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end, ${z} )`
      : `substr( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end )`,

  // String Functions
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
  /**
   * Generates SQL statement that produces the lower case value of a given string
   * @param {string} x
   * @returns {string}
   */
  tolower: x => `lower(${x})`,
  /**
   * Generates SQL statement that produces the upper case value of a given string
   * @param {string} x
   * @returns {string}
   */
  toupper: x => `upper(${x})`,
  /**
   * Generates SQL statement that produces the trimmed value of a given string
   * @param {string} x
   * @returns {string}
   */
  trim: x => `trim(${x})`,

  // Arithmetic Functions
  /**
   * Generates SQL statement that produces the rounded up value of a given number
   * @param {string} x
   * @returns {string}
   */
  ceiling: x => `ceil(${x})`,
  /**
   * Generates SQL statement that produces the rounded down value of a given number
   * @param {string} x
   * @returns {string}
   */
  floor: x => `floor(${x})`,
  /**
   * Generates SQL statement that produces the rounded value of a given number
   * @param {string} x
   * @param {string} p precision
   * @returns {string}
   */
  round: (x, p) => `round(${x}${p ? `,${p}` : ''})`,

  // Date and Time Functions

  current_date: p => (p ? `current_date(${p})` : 'current_date'),
  current_time: p => (p ? `current_time(${p})` : 'current_time'),
  current_timestamp: p => (p ? `current_timestamp(${p})` : 'current_timestamp'),

  /**
   * Generates SQL statement that produces current point in time (date and time with time zone)
   * @returns {string}
   */
   now: function() {
    return this.session_context({val: '$now'})
  },
  /**
   * Generates SQL statement that produces the year of a given timestamp
   * @param {string} x
   * @returns {string}
   * /
  year: x => `cast( strftime('%Y',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the month of a given timestamp
   * @param {string} x
   * @returns {string}
   * /
  month: x => `cast( strftime('%m',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the day of a given timestamp
   * @param {string} x
   * @returns {string}
   * /
  day: x => `cast( strftime('%d',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the hours of a given timestamp
   * @param {string} x
   * @returns {string}
   * /
  hour: x => `cast( strftime('%H',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the minutes of a given timestamp
   * @param {string} x
   * @returns {string}
   * /
  minute: x => `cast( strftime('%M',${x}) as Integer )`,
  /**
   * Generates SQL statement that produces the seconds of a given timestamp
   * @param {string} x
   * @returns {string}
   * /
  second: x => `cast( strftime('%S',${x}) as Integer )`,

  // REVISIT: make precision configurable
  /**
   * Generates SQL statement that produces the fractional seconds of a given timestamp
   * @param {string} x
   * @returns {string}
   */
  fractionalseconds: x => `cast( substr( strftime('%f', ${x}), length(strftime('%f', ${x})) - 3) as REAL)`,

  /**
   * maximum date time value
   * @returns {string}
   */
  maxdatetime: () => "'9999-12-31T23:59:59.999Z'",
  /**
   * minimum date time value
   * @returns {string}
   */
  mindatetime: () => "'0001-01-01T00:00:00.000Z'",

  // odata spec defines the value format for totalseconds as a duration like: P12DT23H59M59.999999999999S
  // P -> duration indicator
  // D -> days, T -> Time seperator, H -> hours, M -> minutes, S -> fractional seconds
  // By splitting the DT and calculating the seconds of the time separate from the day
  // it possible to determine the full amount of seconds by adding them together as fractionals and multiplying
  // the number of seconds in a day
  // As sqlite is most accurate with juliandays it is better to do then then using actual second function
  // while the odata specification states that the seconds has to be fractional which only julianday allows
  /**
   * Generates SQL statement that produces an OData compliant duration string like: P12DT23H59M59.999999999999S
   * @param {string} x
   * @returns {string}
   */
  totalseconds: x => `(
    (
      (
        cast(substr(${x},2,instr(${x},'DT') - 2) as Integer)
      ) + (
        julianday(
          '-4713-11-25T' ||
          replace(
          replace(
          replace(
            substr(${x},instr(${x},'DT') + 2),
            'H',':'
          ),'M',':'
          ),'S','Z'
          )
        ) - 0.5
      )
    ) * 86400
  )`,

  /**
   * Generates SQL statement that calls the session_context function with the given parameter
   * @param {string} x session variable name or SQL expression
   * @returns {string}
   */
  session_context: x => `session_context('${x.val}')`,
}

const HANAFunctions = {
  // https://help.sap.com/docs/SAP_HANA_PLATFORM/4fe29514fd584807ac9f2a04f6754767/f12b86a6284c4aeeb449e57eb5dd3ebd.html

  // Time functions
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
  // Calculates the difference in full days using julian day
  // Using the exact time of the day to determine whether 24 hours have passed or not to add the final day
  // When just comparing the julianday values with each other there are leap seconds included
  // Which on the day resolution are included as the individual days therefor ignoring them to match HANA
  /**
   * Generates SQL statement that calculates the difference in days between two timestamps
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

  // (y1 - y0) * 12 + (m1 - m0) + (t1 < t0) * -1
  /* '%d%H%M%S%f' returns as a number like which results in an equal check to:
  (
    d1 < d0 ||
    (d1 = d0 && h1 < h0) ||
    (d1 = d0 && h1 = h0 && m1 < m0) ||
    (d1 = d0 && h1 = h0 && m1 = m0 && s1 < s0) ||
    (d1 = d0 && h1 = h0 && m1 = m0 && s1 = s0 && ms1 < ms0)
  )
  Which will remove the current month if the time of the month is below the time of the month of the start date
  It should not matter that the number of days in the month is different as for a month to have passed
  the time of the month would have to be higher then the time of the month of the start date

  Also check whether the result will be positive or negative to make sure to not subtract an extra month
  */
  /**
   * Generates SQL statement that calculates the difference in months between two timestamps
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
