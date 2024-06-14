const session = require('./session.json')

const StandardFunctions = {
  session_context: x => {
    let sql = `current_setting('${session[x.val] || x.val}')`
    if (x.val === '$now') sql += '::timestamp'
    return sql
  },
  count: x => `count(${x?.val || x || '*'})`,
  countdistinct: x => `count(distinct ${x.val || x || '*'})`,
  contains: (...args) => `(coalesce(strpos(${args}),0) > 0)`,
  indexof: (x, y) => `strpos(${x},${y}) - 1`, // strpos is 1 indexed
  startswith: (x, y) => `strpos(${x},${y}) = 1`, // strpos is 1 indexed
  endswith: (x, y) => `substr(${x},length(${x}) + 1 - length(${y})) = ${y}`,
  matchesPattern: (x, y) => `regexp_like(${x}, ${y})`,
  matchespattern: (x, y) => `regexp_like(${x}, ${y})`,

  // Date and Time Functions
  year: x => `date_part('year', ${castVal(x)})`,
  month: x => `date_part('month', ${castVal(x)})`,
  day: x => `date_part('day', ${castVal(x)})`,
  time: x => `to_char(${castVal(x)}, 'HH24:MI:SS')`,
  hour: x => `date_part('hour', ${castVal(x)})`,
  minute: x => `date_part('minute', ${castVal(x)})`,
  second: x => `floor(date_part('second', ${castVal(x)}))`,
  fractionalseconds: x => `CAST(date_part('second', ${castVal(x)}) - floor(date_part('second', ${castVal(x)})) AS DECIMAL)`,
  now: function() {
    return this.session_context({val: '$now'})
  }
}

const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
const isVal = x => x && 'val' in x
const castVal = (x) => `${x}${isVal(x) ? isTime.test(x.val) ? '::TIME' : '::TIMESTAMP' : ''}`

const HANAFunctions = {
  // https://help.sap.com/docs/SAP_HANA_PLATFORM/4fe29514fd584807ac9f2a04f6754767/f12b86a6284c4aeeb449e57eb5dd3ebd.html

  // Time functions
  nano100_between: (x, y) => `EXTRACT(EPOCH FROM ${y} - ${x}) * 10000000`,
  seconds_between: (x, y) => `EXTRACT(EPOCH FROM ${y} - ${x})`,
  days_between: (x, y) => `EXTRACT(DAY FROM ${y} - ${x})`,

  months_between: (x, y) => `((
        (EXTRACT(YEAR FROM ${y}) - EXTRACT(YEAR FROM ${x})) * 12
    )+(
        EXTRACT(MONTH FROM ${y}) - EXTRACT(MONTH FROM ${x})
    )+(
        case when ( cast( to_char(${y},'YYYYMM') as Integer ) < cast( to_char(${x},'YYYYMM') as Integer ) ) then
            cast((cast( to_char(${y},'DDHH24MISSFF3') as bigint ) > cast( to_char(${x},'DDHH24MISSFF3') as bigint )) as Integer)
        else
            cast((cast( to_char(${y},'DDHH24MISSFF3') as bigint ) < cast( to_char(${x},'DDHH24MISSFF3') as bigint )) as Integer) * -1
        end
    ))`,
  years_between(x, y) {
    return `TRUNC(${this.months_between(x, y)} / 12,0)`
  },
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
