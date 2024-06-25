const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
const isDate = /^\d{1,4}-\d{1,2}-\d{1,2}$/
const isVal = x => x && 'val' in x
const getTimeType = x => isTime.test(x.val) ? 'TIME' : 'TIMESTAMP'
const getTimeCast = x => isVal(x) ? `TO_${getTimeType(x)}(${x})` : x
const getDateType = x => isDate.test(x.val) ? 'DATE' : 'TIMESTAMP'
const getDateCast = x => isVal(x) ? `TO_${getDateType(x)}(${x})` : x

const StandardFunctions = {
  tolower: x => `lower(${x})`,
  toupper: x => `upper(${x})`,
  indexof: (x, y) => `locate(${x},${y}) - 1`, // locate is 1 indexed
  startswith: (x, y) => `(CASE WHEN locate(${x},${y}) = 1 THEN TRUE ELSE FALSE END)`, // locate is 1 indexed
  endswith: (x, y) => `(CASE WHEN substring(${x},length(${x})+1 - length(${y})) = ${y} THEN TRUE ELSE FALSE END)`,
  matchesPattern: (x, y) => `(CASE WHEN ${x} LIKE_REGEXPR ${y} THEN TRUE ELSE FALSE END)`,
  matchespattern: (x, y) => `(CASE WHEN ${x} LIKE_REGEXPR ${y} THEN TRUE ELSE FALSE END)`,
  substring: (x, y, z) =>
    z
      ? `substring( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end, ${z} )`
      : `substring( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end )`,
  count: x => `count(${x || '*'})`,
  countdistinct: x => `count(distinct ${x || '*'})`,
  average: x => `avg(${x})`,
  contains: (...args) => args.length > 2 ? `CONTAINS(${args})` : `(CASE WHEN coalesce(locate(${args}),0)>0 THEN TRUE ELSE FALSE END)`,
  concat: (...args) => `(${args.map(a => (a.xpr ? `(${a})` : a)).join(' || ')})`,
  search: function (ref, arg) {
    // REVISIT: remove once the protocol adapter only creates vals
    if (Array.isArray(arg.xpr)) arg = { val: arg.xpr.filter(a => a.val).map(a => a.val).join(' ') }
    // REVISIT: make this more configurable
    return (`(CASE WHEN SCORE(${arg} IN ${ref} FUZZY MINIMAL TOKEN SCORE 0.7 SIMILARITY CALCULATION MODE 'search') > 0 THEN TRUE ELSE FALSE END)`)
  },

  // Date and Time Functions
  year: x => `YEAR(${getDateCast(x)})`,
  month: x => `MONTH(${getDateCast(x)})`,
  day: x => `DAYOFMONTH(${getDateCast(x)})`,
  hour: x => `HOUR(${getTimeCast(x)})`,
  minute: x => `MINUTE(${getTimeCast(x)})`,
  second: x => `TO_INTEGER(SECOND(${getTimeCast(x)}))`,
  date: x => `TO_DATE(${x})`,
  time: x => `TO_TIME(${x})`,
  maxdatetime: () => "'9999-12-31T23:59:59.999Z'",
  mindatetime: () => "'0001-01-01T00:00:00.000Z'",
  now: () => `session_context('$now')`,
  fractionalseconds: x => `(TO_DECIMAL(SECOND(${x}),5,3) - TO_INTEGER(SECOND(${x})))`
}

module.exports = StandardFunctions
