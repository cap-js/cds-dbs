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
    if (cds.env.hana.fuzzy === false) {
      // REVISIT: remove once the protocol adapter only creates vals
      arg = arg.xpr ? arg.xpr : arg
      if (Array.isArray(arg)) arg = [{ val: arg.filter(a => a.val).map(a => a.val).join(' ') }]
      else arg = [arg]
      const searchTerms = arg[0].val
          .match(/("")|("(?:[^"]|\\")*(?:[^\\]|\\\\)")|(\S*)/g)
          .filter(el => el.length).map(el => `%${el.replace(/^\"|\"$/g, '').toLowerCase()}%`)

      const columns = ref.list
      const xpr = []
      for (const s of searchTerms) {
        const nestedXpr = []
        for (const c of columns) {
          if (nestedXpr.length) nestedXpr.push('or')
          nestedXpr.push({ func: 'lower', args: [c]}, 'like', {val: s})
        }
        if (xpr.length) xpr.push('and')
        xpr.push({xpr: nestedXpr})
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
        switch(rank) {
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
          default: throw new Error(`Invalid configuration ${rank} for @Search.ranking. HIGH, MEDIUM, LOW are supported values.`)
        }
        
        // fuzziness
        fuzzy+= ` MINIMAL TOKEN SCORE ${e.element?.['@Search.fuzzinessThreshold'] || fuzzyIndex} SIMILARITY CALCULATION MODE 'search'`

        // rewrite ref to xpr to mix in search config
        // ensure in place modification to reuse .toString method that ensures quoting
        e.xpr = [{ ref: e.ref }, fuzzy]
        delete e.ref
      })
    } else {
      ref = `${ref} FUZZY MINIMAL TOKEN SCORE ${fuzzyIndex} SIMILARITY CALCULATION MODE 'search'`
    }

    // REVISIT: remove once the protocol adapter only creates vals
    if (Array.isArray(arg.xpr)) arg = { val: arg.xpr.filter(a => a.val).map(a => a.val).join(' ') }

    return (`(CASE WHEN SCORE(${arg} IN ${ref}) > 0 THEN TRUE ELSE FALSE END)`)
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

const HANAFunctions = {
  current_date: () => 'current_utcdate',
  current_time: () => 'current_utctime',
  current_timestamp: () => 'current_utctimestamp',
  current_utctimestamp: x => x ? `current_utctimestamp(${x})` : 'current_utctimestamp',
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
