const StandardFunctions = {
  // OData: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_CanonicalFunctions

  // String and Collection Functions
  // length     : (x) => `length(${x})`,
  search: function (ref, arg) {
    if (!('val' in arg)) throw `SQLite only supports single value arguments for $search`
    const refs = ref.list || [ref],
      { toString } = ref
    return '(' + refs.map(ref2 => this.contains(this.tolower(toString(ref2)), this.tolower(arg))).join(' or ') + ')'
  },
  concat: (...args) => args.join('||'),
  contains: (...args) => `ifnull(instr(${args}),0)`,
  count: x => `count(${x || '*'})`,
  countdistinct: x => `count(distinct ${x || '*'})`,
  indexof: (x, y) => `instr(${x},${y}) - 1`, // sqlite instr is 1 indexed
  startswith: (x, y) => `instr(${x},${y}) = 1`, // sqlite instr is 1 indexed
  endswith: (x, y) => `instr(${x},${y}) = length(${x}) - length(${y}) +1`,
  substring: (x, y, z) =>
    z
      ? `substr( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end, ${z} )`
      : `substr( ${x}, case when ${y} < 0 then length(${x}) + ${y} + 1 else ${y} + 1 end )`,

  // String Functions
  matchesPattern: (x, y) => `${x} regexp ${y})`,
  tolower: x => `lower(${x})`,
  toupper: x => `upper(${x})`,
  // trim           : (x) => `trim(${x})`,

  // Arithmetic Functions
  ceiling: x => `ceil(${x})`,
  // floor    : (x) => `floor(${x})`,
  // round    : (x) => `round(${x})`,

  // Date and Time Functions
  year: x => `cast( strftime('%Y',${x}) as Integer )`,
  month: x => `cast( strftime('%m',${x}) as Integer )`,
  day: x => `cast( strftime('%d',${x}) as Integer )`,
  hour: x => `cast( strftime('%H',${x}) as Integer )`,
  minute: x => `cast( strftime('%M',${x}) as Integer )`,
  second: x => `cast( strftime('%S',${x}) as Integer )`,

  fractionalseconds: x => `cast( strftime('%f0000',${x}) as Integer )`,

  maxdatetime: () => '9999-12-31 23:59:59.9999999',
  mindatetime: () => '0001-01-01 00:00:00.0000000',

  // odata spec defines the date time offset type as a normal ISO time stamp
  // Where the timezone can either be 'Z' (for UTC) or [+|-]xx:xx for the time offset
  // sqlite understands this so by splitting the timezone from the actual date
  // prefixing it with 1970 it allows sqlite to give back the number of seconds
  // which can be divided by 60 back to minutes
  totaloffsetminutes: x => `case
    when substr(${x}, length(${x})) = 'z' then 0
    else strftime('%s', '1970-01-01T00:00:00' || substr(${x}, length(${x}) - 5)) / 60
  end`,

  // odata spec defines the value format for totalseconds as a duration like: P12DT23H59M59.999999999999S
  // P -> duration indicator
  // D -> days, T -> Time seperator, H -> hours, M -> minutes, S -> fractional seconds
  // By splitting the DT and calculating the seconds of the time separate from the day
  // it possible to determine the full amount of seconds by adding them together as fractionals and multiplying
  // the number of seconds in a day
  // As sqlite is most accurate with juliandays it is better to do then then using actual second function
  // while the odata specification states that the seconds has to be fractional which only julianday allows
  totalseconds: x => `(
    (
      (
        cast(substr(${x},2,instr(${x},'DT') - 2) as Integer)
      ) + (
        julianday(
          '-4713-11-25T' ||
          replace(
          replace(
          replace(
            substr(${x},instr(${x},'DT') + 2),
            'H',':'
          ),'M',':'
          ),'S','Z'
          )
        ) - 0.5
      )
    ) * 86400
  )`,
}

const HANAFunctions = {
  // https://help.sap.com/docs/SAP_HANA_PLATFORM/4fe29514fd584807ac9f2a04f6754767/f12b86a6284c4aeeb449e57eb5dd3ebd.html

  // Time functions
  nano100_between: (x, y) => `(julianday(${y}) - julianday(${x})) * 864000000000`,
  seconds_between: (x, y) => `(julianday(${y}) - julianday(${x})) * 86400`,
  // Calculates the difference in full days using julian day
  // Using the exact time of the day to determine whether 24 hours have passed or not to add the final day
  // When just comparing the julianday values with each other there are leap seconds included
  // Which on the day resolution are included as the individual days therefor ignoring them to match HANA
  days_between: (x, y) => `(
    cast ( julianday(${y}) as Integer ) - cast ( julianday(${x}) as Integer )
  ) + (
    case
      when ( julianday(${y}) < julianday(${x}) ) then
        (cast( strftime('%H%M%S%f0000', ${y}) as Integer ) < cast( strftime('%H%M%S%f0000', ${x}) as Integer ))
      else
        (cast( strftime('%H%M%S%f0000', ${y}) as Integer ) > cast( strftime('%H%M%S%f0000', ${x}) as Integer )) * -1
    end
  )`,

  // (y1 - y0) * 12 + (m1 - m0) + (t1 < t0) * -1
  /* '%d%H%M%S%f' returns as a number like which results in an equal check to:
  (
    d1 < d0 ||
    (d1 = d0 && h1 < h0) ||
    (d1 = d0 && h1 = h0 && m1 < m0) ||
    (d1 = d0 && h1 = h0 && m1 = m0 && s1 < s0) ||
    (d1 = d0 && h1 = h0 && m1 = m0 && s1 = s0 && ms1 < ms0)
  )
  Which will remove the current month if the time of the month is below the time of the month of the start date
  It should not matter that the number of days in the month is different as for a month to have passed
  the time of the month would have to be higher then the time of the month of the start date

  Also check whether the result will be positive or negative to make sure to not subtract an extra month
  */
  months_between: (x, y) => `
  (
    (
      ( cast( strftime('%Y', ${y}) as Integer ) - cast( strftime('%Y', ${x}) as Integer ) ) * 12
    ) + (
      cast( strftime('%m', ${y}) as Integer ) - cast( strftime('%m', ${x}) as Integer )
    ) + (
      (
        case
          when ( cast( strftime('%Y%m', ${y}) as Integer ) < cast( strftime('%Y%m', ${x}) as Integer ) ) then
            (cast( strftime('%d%H%M%S%f0000', ${y}) as Integer ) > cast( strftime('%d%H%M%S%f0000', ${x}) as Integer ))
          else
            (cast( strftime('%d%H%M%S%f0000', ${y}) as Integer ) < cast( strftime('%d%H%M%S%f0000', ${x}) as Integer )) * -1
        end
      )
    )
  )`,
  years_between(x, y) {
    return `floor(${this.months_between(x, y)} / 12)`
  },
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
