'use strict'

const cds = require('@sap/cds')

const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
const isDate = /^\d{1,4}-\d{1,2}-\d{1,2}$/
const isVal = x => x && 'val' in x
const getTimeType = x => (isTime.test(x.val) ? 'TIME' : 'TIMESTAMP')
const getTimeCast = x => (isVal(x) ? `TO_${getTimeType(x)}(${x})` : x)
const getDateType = x => (isDate.test(x.val) ? 'DATE' : 'TIMESTAMP')
const getDateCast = x => (isVal(x) ? `TO_${getDateType(x)}(${x})` : x)

const StandardFunctions = {
  // ==============================
  // String Functions
  // ==============================

  /**
   * Generates SQL statement that produces the index of the first occurrence of the second string in the first string
   * @param {string} x - The string to search
   * @param {string} y - The substring to find
   * @returns {string} - SQL statement
   */
  indexof: (x, y) => `locate(${x},${y}) - 1`, // locate is 1 indexed

  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string starts with the second string
   * @param {string} x - The string to evaluate
   * @param {string} y - The prefix to check
   * @returns {string} - SQL statement
   */
  startswith: (x, y) => `(CASE WHEN locate(${x},${y}) = 1 THEN TRUE ELSE FALSE END)`,

  /**
   * Generates SQL statement that produces a boolean value indicating whether the first string ends with the second string
   * @param {string} x - The string to evaluate
   * @param {string} y - The suffix to check
   * @returns {string} - SQL statement
   */
  endswith: (x, y) => `(CASE WHEN substring(${x},length(${x})+1 - length(${y})) = ${y} THEN TRUE ELSE FALSE END)`,

  /**
   * Generates SQL statement that matches the given string against a regular expression
   * @param {string} x - The string to match
   * @param {string} y - The regular expression
   * @returns {string} - SQL statement
   */
  matchesPattern: (x, y) => `(CASE WHEN ${x} LIKE_REGEXPR ${y} THEN TRUE ELSE FALSE END)`,

  /**
   * Alias for matchesPattern
   * @param {string} x - The string to match
   * @param {string} y - The regular expression
   * @returns {string} - SQL statement
   */
  matchespattern: (x, y) => `(CASE WHEN ${x} LIKE_REGEXPR ${y} THEN TRUE ELSE FALSE END)`,

  /**
   * Generates SQL statement that checks if the first string contains the second string
   * @param  {...string} args - The strings to evaluate
   * @returns {string} - SQL statement
   */
  contains: (...args) =>
    args.length > 2 ? `CONTAINS(${args})` : `(CASE WHEN coalesce(locate(${args}),0)>0 THEN TRUE ELSE FALSE END)`,

  // ==============================
  // Search Function
  // ==============================

  /**
   * Generates SQL statement for search functionality
   * @param {string} ref - Reference object containing columns
   * @param {string} arg - Argument object containing search values
   * @returns {string} - SQL statement
   */
  search: function (ref, arg) {
    if (cds.env.hana.fuzzy === false) {
      // Handle non-fuzzy search
      arg = arg.xpr ? arg.xpr : arg
      if (Array.isArray(arg)) {
        arg = [
          {
            val: arg
              .filter(a => a.val)
              .map(a => a.val)
              .join(' '),
          },
        ]
      } else arg = [arg]

      const searchTerms = arg[0].val
        .match(/("")|("(?:[^"]|\\")*(?:[^\\]|\\\\)")|(\S*)/g)
        .filter(el => el.length)
        .map(el => {
          try {
            return `%${JSON.parse(el).toLowerCase()}%`
          } catch {
            return `%${el.toLowerCase()}%`
          }
        })

      const columns = ref.list
      const xpr = []
      for (const s of searchTerms) {
        const nestedXpr = []
        for (const c of columns) {
          if (nestedXpr.length) nestedXpr.push('or')
          nestedXpr.push({ func: 'lower', args: [c] }, 'like', { val: s })
        }
        if (xpr.length) xpr.push('and')
        xpr.push({ xpr: nestedXpr })
      }

      const { toString } = ref
      return `(CASE WHEN (${toString({ xpr })}) THEN TRUE ELSE FALSE END)`
    }

    // fuzziness config
    const fuzzyIndex = cds.env.hana?.fuzzy || 0.7

    const csnElements = ref.list
    // if column specific value is provided, the configuration has to be defined on column level
    if (csnElements.some(e => e.element?.['@Search.ranking'] || e.element?.['@Search.fuzzinessThreshold'])) {
      csnElements.forEach(e => {
        let fuzzy = `FUZZY`
        // weighted search
        const rank = e.element?.['@Search.ranking']?.['=']
        switch (rank) {
          case 'HIGH':
            fuzzy += ' WEIGHT 0.8'
            break
          case 'LOW':
            fuzzy += ' WEIGHT 0.3'
            break
          case 'MEDIUM':
          case undefined:
            fuzzy += ' WEIGHT 0.5'
            break
          default:
            throw new Error(
              `Invalid configuration ${rank} for @Search.ranking. HIGH, MEDIUM, LOW are supported values.`,
            )
        }
        fuzzy += ` MINIMAL TOKEN SCORE ${e.element?.['@Search.fuzzinessThreshold'] || fuzzyIndex} SIMILARITY CALCULATION MODE 'search'`
        // rewrite ref to xpr to mix in search config
        // ensure in place modification to reuse .toString method that ensures quoting
        e.xpr = [{ ref: e.ref }, fuzzy]
        delete e.ref
      })
    } else {
      ref = `${ref} FUZZY MINIMAL TOKEN SCORE ${fuzzyIndex} SIMILARITY CALCULATION MODE 'search'`
    }

    if (Array.isArray(arg.xpr)) {
      arg = {
        val: arg.xpr
          .filter(a => a.val)
          .map(a => a.val)
          .join(' '),
      }
    }

    return `(CASE WHEN SCORE(${arg} IN ${ref}) > 0 THEN TRUE ELSE FALSE END)`
  },

  // ==============================
  // Arithmetic Functions
  // ==============================

  /**
   * Generates SQL statement that produces the rounded value of a given number
   * @param {string} x - The number input
   * @param {string} [p] - Precision
   * @param {string} [r] - Rounding mode (for compatibility with native HANA function)
   * <rounding_mode> ::= ROUND_HALF_UP | ROUND_HALF_DOWN | ROUND_HALF_EVEN | ROUND_UP | ROUND_DOWN | ROUND_CEILING | ROUND_FLOOR
   * @returns {string} - SQL statement
   */
  round: (x, p, r) => {
    if (p) {
      if (r) {
        // REVISIT: r is a literal string, should be passed as is and not as param
        // e.g. ROUND(1.2345, 2, ROUND_HALF_UP)
        return `ROUND(${x}, ${p}, ${r})`
      }
      return `ROUND(${x}, ${p})`
    }
    return `ROUND(${x})`
  },

  // ==============================
  // Date and Time Functions
  // ==============================

  year: x => `YEAR(${getDateCast(x)})`,
  month: x => `MONTH(${getDateCast(x)})`,
  day: x => `DAYOFMONTH(${getDateCast(x)})`,
  hour: x => `HOUR(${getTimeCast(x)})`,
  minute: x => `MINUTE(${getTimeCast(x)})`,
  second: x => `TO_INTEGER(SECOND(${getTimeCast(x)}))`,
  date: x => `TO_DATE(${x})`,
  time: x => `TO_TIME(${x})`,
  now: () => `session_context('$now')`,
  fractionalseconds: x => `(TO_DECIMAL(SECOND(${x}),5,3) - TO_INTEGER(SECOND(${x})))`,
}

const HANAFunctions = {
  current_date: () => 'current_utcdate',
  current_time: () => 'current_utctime',
  current_timestamp: () => 'current_utctimestamp',
  current_utctimestamp: x => (x ? `current_utctimestamp(${x})` : 'current_utctimestamp'),
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
