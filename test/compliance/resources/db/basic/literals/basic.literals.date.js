module.exports = [
  {
    date: null,
  },
  {
    date: '1970-01-01',
  },
  {
    // HANA supports up-to 9999-12-31
    date: '9999-12-31',
  },
  /* Ignoring transformations
  {
    date: '1970-1-1',
    '=date': '1970-01-01'
  },
  {
    date: '2',
    '=date': '0002-01-01'
  },
  {
    // HANA supports left trim
    date: ' 2',
    '=date': '0002-01-01'
  },
  {
    // HANA does not support right trim
    date: '2 ',
    '!': 'Invalid cds.Date "2 "'
  },
  {
    // HANA does not support date expansion when time is included
    date: '2 00:00:00',
    '!': 'Invalid cds.Date "2 00:00:00"'
  },
  {
    date: '2-2',
    '=date': '0002-02-01'
  },
  {
    date: '2-2-2',
    '=date': '0002-02-02'
  },
  {
    date: () => new Date('1970-01-01Z'),
    '=date': '1970-01-01'
  },
  {
    // Z+2359 is supported by javascript, but HANA does not support timezones without a time being defined
    date: '1970-01-01Z+2359',
    '!': 'Invalid cds.Date "1970-01-01Z+2359"'
  },
  {
    date: '1970-01-01Z-2359',
    '!': 'Invalid cds.Date "1970-01-01Z-2359"'
  },
  {
    // Missing 'Z' before the +/-, because - is a valid separator for the date section
    date: '1970-01-01+2359',
    '!': 'Invalid cds.Date "1970-01-01+2359"'
  },
  {
    date: '1970-01-01T01:10:59',
    '=date': '1970-01-01'
  },
  {
    date: '1970-01-01T00:00:00-2359',
    '=date': '1970-01-01'
  },
  {
    // HANA DATE does not support year 0 or lower
    date: '0000-01-01',
    '!': 'Invalid cds.Date "0000-01-01"'
  },
  {
    // HANA DATE does not support year 10000 or higher
    date: '10000-01-01',
    '!': 'Invalid cds.Date "10000-01-01"'
  },
  {
    // HANA DATE does not assume date information
    date: '00:00:00',
    '!': 'Invalid cds.Date "00:00:00"'
  }
  */
]
