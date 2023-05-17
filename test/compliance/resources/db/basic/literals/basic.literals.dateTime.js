module.exports = [
  {
    dateTime: null,
  },
  {
    // HANA support up-to 9999-12-31 24:00:00
    dateTime: '9999-12-31T23:59:59Z',
  },
  /* Ignoring transformations
  {
    dateTime: '1970-01-01',
    '=dateTime': '1970-01-01 00:00:00'
  },
  {
    dateTime: '1970-1-1',
    '=dateTime': '1970-01-01 00:00:00'
  },
  {
    dateTime: '2',
    '=dateTime': '0002-01-01 00:00:00'
  },
  {
    // HANA supports left trim
    dateTime: ' 2',
    '=dateTime': '0002-01-01 00:00:00'
  },
  {
    // HANA does not support right trim
    dateTime: '2 ',
    '!': 'Invalid cds.DateTime "2 "'
  },
  {
    // HANA does not support date expansion when time is included
    dateTime: '2 00:00:00',
    '!': 'Invalid cds.DateTime "2 00:00:00"'
  },
  {
    dateTime: '2-2',
    '=dateTime': '0002-02-01 00:00:00'
  },
  {
    dateTime: '2-2-2',
    '=dateTime': '0002-02-02 00:00:00'
  },
  {
    dateTime: () => new Date('1970-01-01Z'),
    '=dateTime': '1970-01-01 00:00:00'
  },
  {
    // Z+2359 adds 23 hour and 59 minutes to the UTC time
    // Which means when converting it back to ISO it is subtracting that time from the date
    dateTime: '1970-01-01Z+2359',
    '!': 'Invalid cds.DateTime "1970-01-01Z+2359"'
  },
  {
    dateTime: '1970-01-01Z-2359',
    '!': 'Invalid cds.DateTime "1970-01-01Z-2359"'
  },
  {
    // Missing 'Z' before the +/-, because - is a valid separator for the date section
    dateTime: '1970-01-01+2359',
    '!': 'Invalid cds.DateTime "1970-01-01+2359"'
  },
  {
    dateTime: '1970-01-01T01:10:59',
    '=dateTime': '1970-01-01 01:10:59'
  },
  {
    dateTime: '1970-01-01T00:00:00-2359',
    '=dateTime': '1970-01-01 23:59:00'
  },
  {
    // HANA SECONDDATE does not support year 0 or lower
    dateTime: '0000-01-01',
    '!': 'Invalid cds.DateTime "0000-01-01"'
  },
  {
    // HANA SECONDDATE does not support year 10000 or higher
    dateTime: '10000-01-01 00:00:00',
    '!': 'Invalid cds.DateTime "10000-01-01 00:00:00"'
  },
  {
    // HANA SECONDDATE does not assume date information
    dateTime: '00:00:00',
    '!': 'Invalid cds.DateTime "00:00:00"'
  }
  */
]
