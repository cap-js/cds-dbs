const StandardFunctions = {
  countdistinct: x => `count(distinct ${x || '*'})`,
  contains: (...args) => `(coalesce(strpos(${args}),0) > 0)`,
  indexof: (x, y) => `strpos(${x},${y}) - 1`, // sqlite instr is 1 indexed
  startswith: (x, y) => `strpos(${x},${y}) = 1`, // sqlite instr is 1 indexed
  endswith: (x, y) => `substr(${x},length(${x}) + 1 - length(${y})) = ${y}`,

  // Date and Time Functions
  year: x => `date_part('year',(${x})::TIMESTAMP)`,
  month: x => `date_part('month',(${x})::TIMESTAMP)`,
  day: x => `date_part('day',(${x})::TIMESTAMP)`,
  hour: x => `date_part('hour',(${x})::TIMESTAMP)`,
  minute: x => `date_part('minute',(${x})::TIMESTAMP)`,
  second: x => `date_part('second',(${x})::TIMESTAMP)`,
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
