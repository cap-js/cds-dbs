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
    const csnElements = ref.element ? [ref] : [...ref.list]
    let fuzzyString

    // default config
    const fuzzyIndex = cds.env.hana?.fuzzy || 0.7

    // if column specific value is provided, the configuration has to be defined on column level
    if (csnElements.some(e => e.element?.['@Search.ranking'] || e.element?.['@Search.fuzzinessThreshold'])) {
      const cols = csnElements.map(e => {
        // REVISIT: How to do quoting?
        let col = `${e.ref.join('.')} FUZZY`
        
        const rank = e.element?.['@Search.ranking']?.['=']
        if(rank === 'HIGH') col += ' WEIGHT 0.8'
        else if(rank === 'LOW') col += ' WEIGHT 0.3'
        else col += ' WEIGHT 0.5' // MEDIUM
        
        col+= ` MINIMAL TOKEN SCORE ${e.element?.['@Search.fuzzinessThreshold'] || fuzzyIndex}`
        col+= " SIMILARITY CALCULATION MODE 'search'"
        return col
      }).join(',')
  
      fuzzyString = `(${cols})`
    } else {
      fuzzyString = `${ref} FUZZY MINIMAL TOKEN SCORE ${fuzzyIndex} SIMILARITY CALCULATION MODE 'search'`
    }



    // REVISIT: remove once the protocol adapter only creates vals
    if (Array.isArray(arg.xpr)) arg = { val: arg.xpr.filter(a => a.val).map(a => a.val).join(' ') }

    return (`(CASE WHEN SCORE(${arg} IN ${fuzzyString}) > 0 THEN TRUE ELSE FALSE END)`)
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
  current_date: () => 'current_utcdate',
  current_time: () => 'current_utctime',
  current_timestamp: () => 'current_utctimestamp',
  fractionalseconds: x => `(TO_DECIMAL(SECOND(${x}),5,3) - TO_INTEGER(SECOND(${x})))`,
}

module.exports = StandardFunctions
