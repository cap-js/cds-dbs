const session = require('./session.json')
const cds = require('@sap/cds/lib')

const StandardFunctions = {
  session_context: x => {
    let sql = `current_setting('${session[x.val] || x.val}')`
    if (x.val === '$now') sql += '::timestamp'
    return sql
  },
  countdistinct: x => `count(distinct ${x || '*'})`,
  contains: (...args) => `(coalesce(strpos(${args}),0) > 0)`,
  indexof: (x, y) => `strpos(${x},${y}) - 1`, // sqlite instr is 1 indexed
  startswith: (x, y) => `strpos(${x},${y}) = 1`, // sqlite instr is 1 indexed
  endswith: (x, y) => `substr(${x},length(${x}) + 1 - length(${y})) = ${y}`,  

  // Date and Time Functions
  year: x => getTimePart(x, 'year'),
  month: x => getTimePart(x, 'month'),
  day: x => getTimePart(x, 'day'),
  hour: x => getTimePart(x, 'hour'),
  minute: x => getTimePart(x, 'minute'),
  second: x => getTimePart(x, 'second'),
}

const getTimePart = (x, part) => {
  if ((part === 'hour' || part === 'minute' || part === 'second') && isDate(x.val)) {
    throw new cds.error({
      message: 'Is date but time expected',
      code: 400,
    })
  }
  if ((part === 'year' || part === 'month' || part === 'day') && isTime(x.val)) {
    throw new cds.error({
      message: 'Is time but date expected',
      code: 400,
    })
  }
  const castType = !x.val ? '' : isTime(x.val) ? '::TIME' : '::TIMESTAMP'
  return `date_part('${part}', ${`${x}${castType}`})`
}

function isTime(input) {
  const timePattern = /^(?:\d{2}|\d{1}):(\d{2}|\d{1}):(\d{2}|\d{1})$/
  return timePattern.test(input)
}

function isDate(input) {
  const datePattern = /^(?:(\d{2}|\d{1})\/(\d{2}|\d{1})\/(\d{4})|(\d{2}|\d{1})\.(\d{2}|\d{1})\.(\d{4})|(\d{4})-(\d{2}|\d{1})-(\d{2}|\d{1}))$/
  return datePattern.test(input)
}


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
