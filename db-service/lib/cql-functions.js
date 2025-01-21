const cds = require("@sap/cds")

// OData: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_CanonicalFunctions
const StandardFunctions = {
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
   * Generates SQL statement that produces a string with all provided strings concatenated
   * @param  {...string} args
   * @returns {string}
   */
  concat: (...args) => args.map(a => (a.xpr ? `(${a})` : a)).join(' || '),

  /**
   * Generates SQL statement that produces the number of elements in a given collection
   * @param {string} x
   * @returns {string}
   */
  count: x => `count(${x?.val || x || '*'})`,
  /**
   * Generates SQL statement that produces the number of distinct values of a given expression
   * @param {string} x
   * @returns {string}
   */
  countdistinct: x => `count(distinct ${x.val || x || '*'})`,
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

  /**
   * Generates SQL statement that produces current point in time (date and time with time zone)
   * @returns {string}
   */
  now: function () {
    return this.session_context({ val: '$now' })
  },
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
}

const HANAFunctions = {
  // https://help.sap.com/docs/SAP_HANA_PLATFORM/4fe29514fd584807ac9f2a04f6754767/f12b86a6284c4aeeb449e57eb5dd3ebd.html

  /**
   * Generates SQL statement that calls the session_context function with the given parameter
   * @param {string} x session variable name or SQL expression
   * @returns {string}
   */
  session_context: x => `session_context('${x.val}')`,

  // Time functions
  current_date: p => (p ? `current_date(${p})` : 'current_date'),
  current_time: p => (p ? `current_time(${p})` : 'current_time'),
  current_timestamp: p => (p ? `current_timestamp(${p})` : 'current_timestamp'),
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
