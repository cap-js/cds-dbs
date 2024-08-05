const cdsTypes = require('./cdsTypes')

// TODO: check the types of the arguments
// TODO: find the correct place for the functions to be called
const StandardFunctions = {
  // OData: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_CanonicalFunctions
  // methodCallExpr: https://docs.oasis-open.org/odata/odata/v4.01/os/abnf/odata-abnf-construction-rules.txt

  concat: (a, b) => {
    // a,b are strings
    return cdsTypes.String
  },
  contains: (a, b) => {
    // a,b are strings
    return cdsTypes.Boolean
  },
  endswith: (a, b) => {
    // a,b are strings
    return cdsTypes.Boolean
  },
  indexof: (a, b) => {
    // a,b are strings
    return cdsTypes.Number
  },
  length: a => {
    // a is a string
    return cdsTypes.Number
  },
  matchesPattern: (a, b) => {
    // a,b are strings
    return cdsTypes.Boolean
  },
  startswith: (a, b) => {
    // a,b are strings
    return cdsTypes.Boolean
  },
  substring: (a, b, c) => {
    // a is a string
    // b,c are numbers
    // c is optional
    return cdsTypes.String
  },
  tolower: a => {
    // a is a string
    return cdsTypes.String
  },
  toupper: a => {
    // a is a string
    return cdsTypes.String
  },
  trim: a => {
    // a is a string
    return cdsTypes.String
  },

  year: a => {
    // a is a date/dateTime/timestamp
    return cdsTypes.String
  },
  month: a => {
    // a is a date/dateTime/timestamp
    return cdsTypes.String
  },
  day: a => {
    // a is a date/dateTime/timestamp
    return cdsTypes.String
  },
  hour: a => {
    // a is a time/dateTime/timestamp
    return cdsTypes.String
  },
  minute: a => {
    // a is a time/dateTime/timestamp
    return cdsTypes.String
  },
  second: a => {
    // a is a time/dateTime/timestamp
    return cdsTypes.String
  },
  fractionalseconds: a => {
    // a is a timestamp
    return cdsTypes.String
  },
  totalseconds: a => {
    // a is a string (duration like: P12DT23H59M59.999999999999S)
    return cdsTypes.String
  },
  date: a => {
    // a is a dateTime/timestamp
    return cdsTypes.String
  },
  time: a => {
    // a is a dateTime/timestamp
    return cdsTypes.String
  },
  totaloffsetminutes: a => {
    // a is a dateTime/timestamp
    return cdsTypes.Number
  },

  mindatetime: () => {
    return cdsTypes.DateTime
  },
  maxdatetime: () => {
    return cdsTypes.DateTime
  },
  now: () => {
    return cdsTypes.Timestamp
  },

  round: a => {
    // a is a number
    return cdsTypes.Number
  },
  floor: a => {
    // a is a number
    return cdsTypes.Number
  },
  ceiling: a => {
    // a is a number
    return cdsTypes.Number
  },

  'geo.distance': (a, b) => {
    // a,b are hana.ST_POINT
    return cdsTypes.Decimal
  },
  'geo.length': a => {
    // a are hana.ST_GEOMETRY
    return cdsTypes.Decimal
  },
  'geo.intersects': (a, b) => {
    // a,b are hana.ST_GEOMETRY
    return cdsTypes.Boolean
  },

  hassubset: (a, b) => {
    // a,b are lists of equal types
    return cdsTypes.Boolean
  },
  hassubsequence: (a, b) => {
    // a,b are lists of equal types
    return cdsTypes.Boolean
  },

  case: (...args) => {
    // ...[boolean, any]
    return cdsTypes.Any
  },
}

module.exports = StandardFunctions
