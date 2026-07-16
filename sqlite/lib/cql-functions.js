'use strict'

const StandardFunctions = {
  // ==============================
  // Date and Time Functions
  // ==============================

  /**
   * Ensures ISO strings are returned for current timestamp
   * @returns {string} - SQL statement
   */
  current_timestamp: () => 'ISO(current_timestamp)',

  /**
   * SQLite doesn't support arguments for current_date
   * @returns {string} - SQL statement
   */
  current_date: () => 'current_date',

  /**
   * SQLite doesn't support arguments for current_time
   * @returns {string} - SQL statement
   */
  current_time: () => 'current_time',

  /**
   * Generates SQL statement that produces the fractional seconds of a given timestamp
   * @param {string} x - The timestamp input
   * @returns {string} - SQL statement
   */
  fractionalseconds: x => `cast(substr(strftime('%f', ${x}), length(strftime('%f', ${x})) - 3) as REAL)`,

  // ==============================
  // String Functions
  // ==============================

  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string contains the second string
   * @param  {...string} args - The strings to evaluate
   * @returns {string} - SQL statement
   */
  contains: (...args) => `(ifnull(instr(${args}),0) > 0)`,

  /**
   * Generates SQL statement that produces the index of the first occurrence of the second string in the first string
   * @param {string} x - The string to search
   * @param {string} y - The substring to find
   * @returns {string} - SQL statement
   */
  indexof: (x, y) => `instr(${x},${y}) - 1`,

  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string starts with the second string
   * @param {string} x - The string to evaluate
   * @param {string} y - The prefix to check
   * @returns {string} - SQL statement
   */
  startswith: (x, y) => `coalesce(instr(${x},${y}) = 1,false)`,

  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string ends with the second string
   * @param {string} x - The string to evaluate
   * @param {string} y - The suffix to check
   * @returns {string} - SQL statement
   */
  endswith: (x, y) => `coalesce(substr(${x}, length(${x}) + 1 - length(${y})) = ${y},false)`,

  /**
   * Generates SQL statement that matches the given string against a regular expression
   * @param {string} x - The string to match
   * @param {string} y - The regular expression
   * @returns {string} - SQL statement
   */
  matchesPattern: (x, y) => `(${x} regexp ${y})`,

  /**
   * Alias for matchesPattern
   * @param {string} x - The string to match
   * @param {string} y - The regular expression
   * @returns {string} - SQL statement
   */
  matchespattern: (x, y) => `(${x} regexp ${y})`,
}

const HANAFunctions = {
  // ==============================
  // Timestamp Difference Functions
  // ==============================

  /**
   * Generates SQL statement that calculates the difference in 100-nanoseconds between two timestamps
   * @param {string} x - Left timestamp
   * @param {string} y - Right timestamp
   * @returns {string} - SQL statement
   */
  nano100_between: (x, y) => `(julianday(${y}) - julianday(${x})) * 864000000000`,

  /**
   * Generates SQL statement that calculates the difference in seconds between two timestamps
   * @param {string} x - Left timestamp
   * @param {string} y - Right timestamp
   * @returns {string} - SQL statement
   */
  seconds_between: (x, y) => `(julianday(${y}) - julianday(${x})) * 86400`,

  /**
   * Generates SQL statement that calculates the difference in days between two timestamps
   * @param {string} x - Left timestamp
   * @param {string} y - Right timestamp
   * @returns {string} - SQL statement
   */
  days_between: (x, y) => `(
    cast(julianday(${y}) as Integer) - cast(julianday(${x}) as Integer)
  ) + (
    case
      when (julianday(${y}) < julianday(${x})) then
        (cast(strftime('%H%M%S%f0000', ${y}) as Integer) < cast(strftime('%H%M%S%f0000', ${x}) as Integer))
      else
        (cast(strftime('%H%M%S%f0000', ${y}) as Integer) > cast(strftime('%H%M%S%f0000', ${x}) as Integer)) * -1
    end
  )`,

  /**
   * Generates SQL statement that calculates the difference in months between two timestamps
   * @param {string} x - Left timestamp
   * @param {string} y - Right timestamp
   * @returns {string} - SQL statement
   */
  months_between: (x, y) => `
  (
    (
      (cast(strftime('%Y', ${y}) as Integer) - cast(strftime('%Y', ${x}) as Integer)) * 12
    ) + (
      cast(strftime('%m', ${y}) as Integer) - cast(strftime('%m', ${x}) as Integer)
    ) + (
      (
        case
          when (cast(strftime('%Y%m', ${y}) as Integer) < cast(strftime('%Y%m', ${x}) as Integer)) then
            (cast(strftime('%d%H%M%S%f0000', ${y}) as Integer) > cast(strftime('%d%H%M%S%f0000', ${x}) as Integer))
          else
            (cast(strftime('%d%H%M%S%f0000', ${y}) as Integer) < cast(strftime('%d%H%M%S%f0000', ${x}) as Integer)) * -1
        end
      )
    )
  )`,

  /**
   * Generates SQL statement that calculates the difference in years between two timestamps
   * @param {string} x - Left timestamp
   * @param {string} y - Right timestamp
   * @returns {string} - SQL statement
   */
  years_between(x, y) {
    return `floor(${this.expr({ func: 'months_between', args: [x, y] })} / 12)`
  },
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

// ==============================
// Vector Functions - SQL variants
// ==============================

const VectorFunctionsSQL = {
  /**
   * Generates SQL statement for cosine similarity calculation using pure SQL
   * @param {string} a - First vector
   * @param {string} b - Second vector
   * @returns {string} - SQL statement
   */
  cosine_similarity_sql: (a, b) => `
    (SELECT
      CASE
        WHEN SQRT(normA) * SQRT(normB) = 0 THEN 0
        ELSE dot / (SQRT(normA) * SQRT(normB))
      END
    FROM (
      SELECT
        SUM(a.value * b.value) as dot,
        SUM(a.value * a.value) as normA,
        SUM(b.value * b.value) as normB
      FROM json_each(${a}) a
      JOIN json_each(${b}) b ON a.key = b.key
    ))`,

  /**
   * Generates SQL statement for L2 distance calculation using pure SQL
   * @param {string} a - First vector
   * @param {string} b - Second vector
   * @returns {string} - SQL statement
   */
  l2distance_sql: (a, b) => `
    (SELECT SQRT(SUM((a.value - b.value) * (a.value - b.value)))
     FROM json_each(${a}) a
     JOIN json_each(${b}) b ON a.key = b.key)`,

  /**
   * Generates SQL statement for L2 normalization using pure SQL
   * @param {string} v - Vector to normalize
   * @returns {string} - SQL statement
   */
  l2normalize_sql: v => `
    (SELECT json_group_array(
      CASE
        WHEN (SELECT SQRT(SUM(value * value)) FROM json_each(${v})) = 0 THEN value
        ELSE value / (SELECT SQRT(SUM(value * value)) FROM json_each(${v}))
      END
    ) FROM json_each(${v}))`,
}

module.exports = { ...StandardFunctions, ...HANAFunctions, ...VectorFunctionsSQL }
