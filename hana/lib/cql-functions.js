const isTime = /^\d{1,2}:\d{1,2}:\d{1,2}$/
const isVal = x => x && 'val' in x
const getTimeType = x => isTime.test(x.val) ? 'TIME' : 'TIMESTAMP'
const getTimeCast = x => isVal(x) ? `TO_${getTimeType(x)}(${x})` : x

const StandardFunctions = {
  tolower: x => `lower(${x})`,
  toupper: x => `upper(${x})`,
  indexof: (x, y) => `locate(${x},${y}) - 1`, // locate is 1 indexed
  startswith: (x, y) => `(CASE WHEN locate(${x},${y}) = 1 THEN TRUE ELSE FALSE END)`, // locate is 1 indexed
  endswith: (x, y) => `(CASE WHEN substring(${x},length(${x})+1 - length(${y})) = ${y} THEN TRUE ELSE FALSE END)`,
  substring: (x, y, z) =>
    z
      ? `substring( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end, ${z} )`
      : `substring( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end )`,
  count: x => `count(${x || '*'})`,
  countdistinct: x => `count(distinct ${x || '*'})`,
  average: x => `avg(${x})`,
  contains: (...args) => `(CASE WHEN coalesce(locate(${args}),0)>0 THEN TRUE ELSE FALSE END)`,
  search: function (ref, arg) {
    if (!('val' in arg)) throw `HANA only supports single value arguments for $search`
    const refs = ref.list || [ref],
      { toString } = ref
    return (
      '(CASE WHEN (' +
      refs.map(ref2 => `coalesce(locate(${this.tolower(toString(ref2))},${this.tolower(arg)}),0)>0`).join(' or ') +
      ') THEN TRUE ELSE FALSE END)'
    )
  },

  // Date and Time Functions
  day: x => `DAYOFMONTH(${x})`,
  hour: x => `HOUR(${getTimeCast(x)})`,
  minute: x => `MINUTE(${getTimeCast(x)})`,
  second: x => `SECOND(${getTimeCast(x)})`
}

module.exports = StandardFunctions
