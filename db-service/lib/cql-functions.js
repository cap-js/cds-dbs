'use strict'

const cds = require('@sap/cds')

// OData: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_CanonicalFunctions
const StandardFunctions = {
  /**
   * Generates SQL statement that produces a runtime compatible error object
   * @param {string|object} message - The i18n key or message of the error object
   * @param {Array<xpr>} args - The arguments to apply to the i18n string
   * @param {Array<xpr>} targets - The name of the element that the error is related to
   * @return {string} - SQL statement
   */
  error: function (message, args, targets) {
    targets = targets && (targets.list || (targets.val || targets.ref) && [targets])
    if (Array.isArray(targets)) targets = targets.map(e => e.ref && { val: e.ref.at(-1) } || e)
    args = args && (args.list || (args.val || args.ref) && [args])

    return `(${this.SELECT({
      SELECT: {
        expand: 'root',
        columns: [
          {
            __proto__: (message || { val: null }),
            as: 'message',
          },
          args ? {
            func: 'json_array',
            args: args,
            as: 'args',
            element: cds.builtin.types.Map,
          } : { val: null, as: 'args' },
          targets ? {
            func: 'json_array',
            args: targets,
            as: 'targets',
            element: cds.builtin.types.Map,
          } : { val: null, as: 'targets' },
        ]
      },
      elements: {
        message: cds.builtin.types.String,
        args: cds.builtin.types.Map,
        targets: cds.builtin.types.Map,
      }
    })})`
  },

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
    arg.val = val
    const refs = ref.list || [ref]
    return `(${refs.map(ref => this.expr({
      func: 'contains',
      args: [
        { func: 'tolower', args: [ref] },
        { func: 'tolower', args: [arg] },
      ]
    })).join(' or ')})`
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
    return this.expr({ func: 'session_context', args: [{ val: '$now' }] })
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
    let uniqueCounter = this._with?.length ?? 0
    let src = args.xpr[1]

    // Ensure that the orderBy column are exposed by the source for hierarchy sorting
    const orderBy = args.xpr.find((_, i, arr) => /ORDER/i.test(arr[i - 2]) && /BY/i.test(arr[i - 1]))

    const passThroughColumns = src.SELECT.columns.map(c => ({ ref: ['Source', this.column_name(c)] }))
    src.as = 'H' + (uniqueCounter++)
    src = this.expr(this.with(src))

    let recursive = cds.ql(`
SELECT
  1 as HIERARCHY_LEVEL,
  NODE_ID as HIERARCHY_ROOT_ID
 FROM ${src} AS Source
WHERE parent_ID IS NULL
UNION ALL
SELECT
  Parent.HIERARCHY_LEVEL + 1,
  Parent.HIERARCHY_ROOT_ID
 FROM ${src} AS Source
JOIN H${uniqueCounter} AS Parent ON Source.PARENT_ID=Parent.NODE_ID
ORDER BY HIERARCHY_LEVEL DESC${orderBy ? `,${orderBy}` : ''}`)
    recursive.as = 'H' + (uniqueCounter++)
    recursive.SET.args[0].SELECT.columns = [...recursive.SET.args[0].SELECT.columns, ...passThroughColumns]
    recursive.SET.args[1].SELECT.columns = [...recursive.SET.args[1].SELECT.columns, ...passThroughColumns]
    recursive = this.expr(this.with(recursive))

    let ranked = cds.ql(`
SELECT
  HIERARCHY_LEVEL,
  row_number() over () as HIERARCHY_RANK,
  HIERARCHY_ROOT_ID
 FROM ${recursive} AS Source`)
    ranked.as = 'H' + (uniqueCounter++)
    ranked.SELECT.columns = [...ranked.SELECT.columns, ...passThroughColumns]
    ranked = this.expr(this.with(ranked))

    let Hierarchy = cds.ql(`
SELECT
  HIERARCHY_LEVEL,
  HIERARCHY_RANK,
  (SELECT HIERARCHY_RANK FROM ${ranked} AS Ranked WHERE Ranked.NODE_ID = Source.PARENT_ID) AS HIERARCHY_PARENT_RANK,
  (SELECT HIERARCHY_RANK FROM ${ranked} AS Ranked WHERE Ranked.NODE_ID = Source.HIERARCHY_ROOT_ID) AS HIERARCHY_ROOT_RANK,
  coalesce(
    (SELECT MIN(HIERARCHY_RANK) FROM ${ranked} AS Ranked WHERE Ranked.HIERARCHY_RANK > Source.HIERARCHY_RANK AND Ranked.HIERARCHY_LEVEL <= Source.HIERARCHY_LEVEL),
    (SELECT MAX(HIERARCHY_RANK) + 1 FROM ${ranked})
  ) - Source.HIERARCHY_RANK AS HIERARCHY_TREE_SIZE
 FROM ${ranked} AS Source`)
    Hierarchy.as = 'H' + (uniqueCounter++)
    Hierarchy.SELECT.columns = [...Hierarchy.SELECT.columns, ...passThroughColumns]
    Hierarchy = this.expr(this.with(Hierarchy))

    return Hierarchy
  },

  /**
   * Generates SQL statement for the hierarchy_descendants function
   * @param {string} [p] - 
   * @returns {string} - SQL statement
   */
  HIERARCHY_DESCENDANTS: function (args) {
    // Find Hierarchy function call source query
    const passThroughColumns = args.xpr[1].args[0].xpr[1].SELECT.columns.map(c => ({ ref: [this.column_name(c)] }))
    // REVISIT: currently only supports func: HIERARCHY as source
    const src = this.expr(args.xpr[1])

    let uniqueCounter = this._with?.length ?? 0

    let alias = args.xpr.find((_, i, arr) => /AS/i.test(arr[i - 1]))
    const where = args.xpr.find((a, i, arr) => a.xpr && /WHERE/i.test(arr[i - 1]) && /START/i.test(arr[i - 2]))
    const distance = args.xpr.find((a, i, arr) => typeof a.val === 'number' && (/DISTANCE/i.test(arr[i - 1]) || /DISTANCE/i.test(arr[i - 2])))
    const distanceFrom = args.xpr.find((a, i, arr) => /FROM/.test(a) && /DISTANCE/i.test(arr[i - 1]))

    if (alias.startsWith('"') && alias.endsWith('"')) alias = alias.slice(1, -1).replace(/""/g, '"')

    let HierarchyDescendants = cds.ql(`
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
JOIN H${uniqueCounter} AS Child ON Source.PARENT_ID=Child.NODE_ID`)
    HierarchyDescendants.as = 'H' + uniqueCounter
    HierarchyDescendants.SET.args[0].SELECT.where = where.xpr
    HierarchyDescendants.SET.args[0].SELECT.columns = [...HierarchyDescendants.SET.args[0].SELECT.columns, ...passThroughColumns.map(r => ({ ref: [alias, r.ref[0]] }))]
    HierarchyDescendants.SET.args[1].SELECT.columns = [...HierarchyDescendants.SET.args[1].SELECT.columns, ...passThroughColumns.map(r => ({ ref: ['Source', r.ref[0]] }))]

    HierarchyDescendants = this.with(HierarchyDescendants)
    HierarchyDescendants.as = 'HierarchyDescendants'

    return this.expr({
      SELECT: {
        columns: [
          { ref: ['HIERARCHY_LEVEL'] },
          { ref: ['HIERARCHY_PARENT_RANK'] },
          { ref: ['HIERARCHY_RANK'] },
          { ref: ['HIERARCHY_ROOT_RANK'] },
          { ref: ['HIERARCHY_TREE_SIZE'] },
          {
            SELECT: {
              columns: [{ func: 'MAX', args: [{ ref: ['HIERARCHY_DISTANCE'] }] }],
              from: HierarchyDescendants,
              where: [{ ref: [HierarchyDescendants.as, 'HIERARCHY_RANK'] }, '=', { ref: [src, 'HIERARCHY_RANK'] }]
            },
            as: 'HIERARCHY_DISTANCE',
          },
          ...passThroughColumns,
        ],
        from: { ref: [src] },
        where: [
          { ref: ['HIERARCHY_RANK'] },
          'IN',
          {
            SELECT: {
              columns: [{ ref: ['HIERARCHY_RANK'] }],
              from: HierarchyDescendants,
              where: [{ ref: ['HIERARCHY_DISTANCE'] }, distanceFrom ? '>=' : '=', distance]
            }
          }
        ]
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
    const passThroughColumns = args.xpr[1].args[0].xpr[1].SELECT.columns.map(c => ({ ref: [this.column_name(c)] }))
    // REVISIT: currently only supports func: HIERARCHY as source
    const src = this.expr(args.xpr[1])

    let uniqueCounter = this._with?.length ?? 0

    let alias = args.xpr.find((_, i, arr) => /AS/i.test(arr[i - 1]))
    const where = args.xpr.find((a, i, arr) => a.xpr && /WHERE/i.test(arr[i - 1]) && /START/i.test(arr[i - 2]))

    if (alias.startsWith('"') && alias.endsWith('"')) alias = alias.slice(1, -1).replace(/""/g, '"')

    let HierarchyAncestors = cds.ql(`
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
JOIN H${uniqueCounter} AS Child ON Source.NODE_ID=Child.PARENT_ID`)
    HierarchyAncestors.as = 'H' + uniqueCounter
    HierarchyAncestors.SET.args[0].SELECT.where = where.xpr
    HierarchyAncestors.SET.args[0].SELECT.columns = [...HierarchyAncestors.SET.args[0].SELECT.columns, ...passThroughColumns.map(r => ({ ref: [alias, r.ref[0]] }))]
    HierarchyAncestors.SET.args[1].SELECT.columns = [...HierarchyAncestors.SET.args[1].SELECT.columns, ...passThroughColumns.map(r => ({ ref: ['Source', r.ref[0]] }))]

    HierarchyAncestors = this.with(HierarchyAncestors)
    HierarchyAncestors.as = 'HierarchyAncestors'
    return this.expr({
      SELECT: {
        columns: [
          { ref: ['HIERARCHY_LEVEL'] },
          { ref: ['HIERARCHY_PARENT_RANK'] },
          { ref: ['HIERARCHY_RANK'] },
          { ref: ['HIERARCHY_ROOT_RANK'] },
          { ref: ['HIERARCHY_TREE_SIZE'] },
          {
            SELECT: {
              columns: [{ func: 'MIN', args: [{ ref: ['HIERARCHY_DISTANCE'] }] }],
              from: HierarchyAncestors,
              where: [{ ref: [HierarchyAncestors.as, 'HIERARCHY_RANK'] }, '=', { ref: [src, 'HIERARCHY_RANK'] }]
            },
            as: 'HIERARCHY_DISTANCE',
          },
          ...passThroughColumns,
        ],
        from: { ref: [src] },
        where: [
          { ref: ['HIERARCHY_RANK'] },
          'IN',
          {
            SELECT: {
              columns: [{ ref: ['HIERARCHY_RANK'] }],
              from: HierarchyAncestors,
            }
          }
        ]
      }
    })
  },
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
