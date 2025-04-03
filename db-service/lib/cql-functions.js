'use strict'

// OData: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_CanonicalFunctions
const StandardFunctions = {
  /**
   * Generates SQL statement that produces a boolean value indicating whether the search term is contained in the given columns
   * @param {string} ref - The reference object containing column information
   * @param {string} arg - The argument object containing the search value
   * @returns {string} - SQL statement
   */
  search: function (ref, arg) {
    if (!('val' in arg)) throw new Error('Only single value arguments are allowed for $search')
    // Only apply first search term, rest is ignored
    const sub = /("")|("(?:[^"]|\\")*(?:[^\\]|\\\\)")|(\S*)/.exec(arg.val)
    let val
    try {
      val = (sub[2] ? JSON.parse(sub[2]) : sub[3]) || ''
    } catch {
      val = sub[2] || sub[3] || ''
    }
    arg.val = arg.__proto__.val = val
    const refs = ref.list
    const { toString } = ref
    return '(' + refs.map(ref2 => this.contains(this.tolower(toString(ref2)), this.tolower(arg))).join(' or ') + ')'
  },

  // ==============================
  // Aggregation Functions
  // ==============================

  /**
   * Generates SQL statement that produces the average of a given expression
   * @param {string} x - The expression to average
   * @returns {string} - SQL statement
   */
  average: x => `avg(${x})`,

  /**
   * Generates SQL statement that produces the number of elements in a given collection
   * @param {string} x - The collection input
   * @returns {string} - SQL statement
   */
  count: x => `count(${x?.val || x || '*'})`,

  /**
   * Generates SQL statement that produces the number of distinct values of a given expression
   * @param {string} x - The expression input
   * @returns {string} - SQL statement
   */
  countdistinct: x => `count(distinct ${x.val || x || '*'})`,

  // ==============================
  // String Functions
  // ==============================

  /**
   * Generates SQL statement that produces the length of a given string
   * @param {string} x - The string input
   * @returns {string} - SQL statement
   */
  length: x => `length(${x})`,

  /**
   * Generates SQL statement that produces a string with all provided strings concatenated
   * @param  {...string} args - The strings to concatenate
   * @returns {string} - SQL statement
   */
  concat: (...args) => args.map(a => (a.xpr ? `(${a})` : a)).join(' || '),

  /**
   * Generates SQL statement that produces the substring of a given string
   * @example
   * // returns 'bc'
   * {func:'substring',args:[{val:'abc'},{val:1}]}
   * @example
   * // returns 'b'
   * {func:'substring',args:[{val:'abc'},{val:1},{val:1}]}
   * @param {string} x - The string input
   * @param {string} y - The starting position
   * @param {string} [z] - Optional length of the substring
   * @returns {string} - SQL statement
   */
  substring: (x, y, z) =>
    z
      ? `substr(${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end, ${z})`
      : `substr(${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end)`,

  /**
   * Generates SQL statement that produces the lower case value of a given string
   * @param {string} x - The string input
   * @returns {string} - SQL statement
   */
  tolower: x => `lower(${x})`,

  /**
   * Generates SQL statement that produces the upper case value of a given string
   * @param {string} x - The string input
   * @returns {string} - SQL statement
   */
  toupper: x => `upper(${x})`,

  /**
   * Generates SQL statement that produces the trimmed value of a given string
   * @param {string} x - The string input
   * @returns {string} - SQL statement
   */
  trim: x => `trim(${x})`,

  // ==============================
  // Arithmetic Functions
  // ==============================

  /**
   * Generates SQL statement that produces the rounded up value of a given number
   * @param {string} x - The number input
   * @returns {string} - SQL statement
   */
  ceiling: x => `ceil(${x})`,

  /**
   * Generates SQL statement that produces the rounded down value of a given number
   * @param {string} x - The number input
   * @returns {string} - SQL statement
   */
  floor: x => `floor(${x})`,

  /**
   * Generates SQL statement that produces the rounded value of a given number
   * @param {string} x - The number input
   * @param {string} p - The precision
   * @returns {string} - SQL statement
   */
  round: (x, p) => `round(${x}${p ? `,${p}` : ''})`,

  // ==============================
  // Date and Time Functions
  // ==============================

  /**
   * Generates SQL statement that produces current point in time (date and time with time zone)
   * @returns {string} - SQL statement
   */
  now: function () {
    return this.session_context({ val: '$now' })
  },

  /**
   * Maximum date time value
   * @returns {string} - SQL statement
   */
  maxdatetime: () => `'9999-12-31T23:59:59.999Z'`,

  /**
   * Minimum date time value
   * @returns {string} - SQL statement
   */
  mindatetime: () => `'0001-01-01T00:00:00.000Z'`,
}

const HANAFunctions = {
  /**
   * Generates SQL statement that calls the session_context function with the given parameter
   * @param {string} x - The session variable name or SQL expression
   * @returns {string} - SQL statement
   */
  session_context: x => `session_context('${x.val}')`,

  /**
   * Generates SQL statement for the current date
   * @returns {string} - SQL statement
   */
  current_date: () => 'current_date',

  /**
   * Generates SQL statement for the current time
   * @param {string} [p] - Optional precision parameter
   * @returns {string} - SQL statement
   */
  current_time: p => (p ? `current_time(${p})` : 'current_time'),

  /**
   * Generates SQL statement for the current timestamp
   * @param {string} [p] - Optional precision parameter
   * @returns {string} - SQL statement
   */
  current_timestamp: p => (p ? `current_timestamp(${p})` : 'current_timestamp'),

  /**
   * Generates SQL statement for the hierarchy function
   * @param {string} [p] - 
   * @returns {string} - SQL statement
   */
  HIERARCHY: function (args) {
    let src = args.xpr[1]
    const passThroughColumns = src.SELECT.columns.map(c => ({ ref: ['Source', this.column_name(c)] }))
    src.SELECT.columns.push({ func: 'row_number', args: [], xpr: ['OVER', { xpr: [] }], as: 'rowid' })
    src.as = 'HierarchySource'
    src = this.expr(this.with(src))

    const cqn = cds.ql(`
SELECT
  1 as HIERARCHY_LEVEL,
  0 as HIERARCHY_PARENT_RANK,
  rowid as HIERARCHY_RANK,
  rowid as HIERARCHY_ROOT_RANK,
  (SELECT COUNT(*) + 1 FROM ${src} as children WHERE children.PARENT_ID=Source.NODE_ID) as HIERARCHY_TREE_SIZE
 FROM ${src} AS Source
WHERE parent_ID IS NULL
UNION ALL
SELECT
  Parent.HIERARCHY_LEVEL + 1,
  Parent.HIERARCHY_RANK,
  Source.rowid,
  Parent.HIERARCHY_ROOT_RANK,
  (SELECT COUNT(*) + 1 FROM ${src} as children WHERE children.PARENT_ID=Source.NODE_ID)
 FROM ${src} AS Source
JOIN Hierarchy AS Parent ON Source.PARENT_ID=Parent.NODE_ID
ORDER BY HIERARCHY_LEVEL DESC`)
    cqn.as = 'Hierarchy'
    cqn.SET.args[0].SELECT.columns = [...cqn.SET.args[0].SELECT.columns, ...passThroughColumns]
    cqn.SET.args[1].SELECT.columns = [...cqn.SET.args[1].SELECT.columns, ...passThroughColumns]

    this.with(cqn)
    return this.ref({ ref: ['Hierarchy'] })
  },

  /**
   * Generates SQL statement for the hierarchy_descendants function
   * @param {string} [p] - 
   * @returns {string} - SQL statement
   */
  HIERARCHY_DESCENDANTS: function (args) {
    // Find Hierarchy function call source query
    const passThroughColumns = args.xpr[1].args[0].xpr[1].SELECT.columns.map(c => ({ ref: ['Source', this.column_name(c)] }))
    // REVISIT: currently only supports func: HIERARCHY as source
    const src = this.expr(args.xpr[1])

    const alias = args.xpr.find((_, i, arr) => /AS/i.test(arr[i - 1]))
    const where = args.xpr.find((a, i, arr) => a.xpr && /WHERE/i.test(arr[i - 1]) && /START/i.test(arr[i - 2]))

    const cqn = cds.ql(`
SELECT
  HIERARCHY_LEVEL,
  HIERARCHY_PARENT_RANK,
  HIERARCHY_RANK,
  HIERARCHY_ROOT_RANK,
  HIERARCHY_TREE_SIZE,
  0 as HIERARCHY_DISTANCE
 FROM ${src} AS ![${alias}]
UNION ALL
SELECT
  Source.HIERARCHY_LEVEL,
  Source.HIERARCHY_PARENT_RANK,
  Source.HIERARCHY_RANK,
  Source.HIERARCHY_ROOT_RANK,
  Source.HIERARCHY_TREE_SIZE,
  Child.HIERARCHY_DISTANCE + 1
 FROM ${src} AS Source
JOIN HierarchyDescendants AS Child ON Source.PARENT_ID=Child.NODE_ID`)
    cqn.as = 'HierarchyDescendants'
    cqn.SET.args[0].SELECT.where = where.xpr
    cqn.SET.args[0].SELECT.columns = [...cqn.SET.args[0].SELECT.columns, ...passThroughColumns.map(r => ({ ref: [alias, r.ref[1]] }))]
    cqn.SET.args[1].SELECT.columns = [...cqn.SET.args[1].SELECT.columns, ...passThroughColumns]

    this.with(cqn)
    return this.expr({
      SELECT: {
        columns: ['*'],
        from: {
          join: 'inner',
          args: [{ ref: ['Hierarchy'] }, { ref: ['HierarchyDescendants'] }],
          on: [{ ref: ['Hierarchy', 'HIERARCHY_RANK'] }, '=', { ref: ['HierarchyDescendants', 'HIERARCHY_RANK'] }]
        },
      }
    })
  },

  /**
   * Generates SQL statement for the hierarchy_ancestors function
   * @param {string} [p] - 
   * @returns {string} - SQL statement
   */
  HIERARCHY_ANCESTORS: function (args) {
    // Find Hierarchy function call source query
    const passThroughColumns = args.xpr[1].args[0].xpr[1].SELECT.columns.map(c => ({ ref: ['Source', this.column_name(c)] }))
    // REVISIT: currently only supports func: HIERARCHY as source
    const src = this.expr(args.xpr[1])

    const alias = args.xpr.find((_, i, arr) => /AS/i.test(arr[i - 1]))
    const where = args.xpr.find((a, i, arr) => a.xpr && /WHERE/i.test(arr[i - 1]) && /START/i.test(arr[i - 2]))

    const cqn = cds.ql(`
SELECT
  HIERARCHY_LEVEL,
  HIERARCHY_PARENT_RANK,
  HIERARCHY_RANK,
  HIERARCHY_ROOT_RANK,
  HIERARCHY_TREE_SIZE,
  0 as HIERARCHY_DISTANCE
 FROM ${src} AS ![${alias}]
UNION ALL
SELECT
  Source.HIERARCHY_LEVEL,
  Source.HIERARCHY_PARENT_RANK,
  Source.HIERARCHY_RANK,
  Source.HIERARCHY_ROOT_RANK,
  Source.HIERARCHY_TREE_SIZE,
  Child.HIERARCHY_DISTANCE - 1
 FROM ${src} AS Source
JOIN HierarchyAncestor AS Child ON Source.NODE_ID=Child.PARENT_ID`)
    cqn.as = 'HierarchyAncestor'
    cqn.SET.args[0].SELECT.where = where.xpr
    cqn.SET.args[0].SELECT.columns = [...cqn.SET.args[0].SELECT.columns, ...passThroughColumns.map(r => ({ ref: [alias, r.ref[1]] }))]
    cqn.SET.args[1].SELECT.columns = [...cqn.SET.args[1].SELECT.columns, ...passThroughColumns]

    this.with(cqn)
    return this.expr({
      SELECT: {
        columns: ['*'],
        from: {
          join: 'inner',
          args: [{ ref: ['Hierarchy'] }, { ref: ['HierarchyAncestor'] }],
          on: [{ ref: ['Hierarchy', 'HIERARCHY_RANK'] }, '=', { ref: ['HierarchyAncestor', 'HIERARCHY_RANK'] }]
        },
      }
    })
  },
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
