module.exports = [
  {
    timestamp: null,
  },
  {
    timestamp: '1970-01-01T00:00:00.000Z',
    '=timestamp': /1970-01-01T00:00:00.0000{0,6}Z/,
  },
  {
    timestamp: new Date('1970-01-01Z'),
    '=timestamp': /1970-01-01T00:00:00.0000{0,6}Z/,
  },
  {
    timestamp: '1970-01-01T00:00:00.000Z',
    '=timestamp': /1970-01-01T00:00:00.0000{0,6}Z/
  },
  {
    timestamp: '2020-01-01T10:00:00.000+10:00',
    '=timestamp': /2020-01-01T00:00:00.0000{0,6}Z/
  },
  /*
  {
    timestamp: '1970-01-01',
    '=timestamp': /1970-01-01T00:00:00.0000{0,6}Z/
  },
  {
    timestamp: '1970-1-1',
    '=timestamp': /1970-01-01T00:00:00.0000{0,6}Z/
  },
  {
    timestamp: '2',
    '=timestamp': /0002-01-01T00:00:00.0000{0,6}Z/
  },
  {
    // HANA supports left trim
    timestamp: ' 2',
    '=timestamp': /0002-01-01T00:00:00.0000{0,6}Z/
  },
  {
    // HANA does not support right trim
    timestamp: '2 ',
    '!': 'Invalid cds.Timestamp "2 "'
  },
  {
    // HANA does not support date expansion when time is included
    timestamp: '2 00:00:00',
    '!': 'Invalid cds.Timestamp "2 00:00:00"'
  },
  {
    timestamp: '2-2',
    '=timestamp': /0002-02-01T00:00:00.0000{0,6}Z/
  },
  {
    timestamp: '2-2-2',
    '=timestamp': /0002-02-02T00:00:00.0000{0,6}Z/
  },
  {
    timestamp: () => new Date('1970-01-01Z'),
    '=timestamp': /1970-01-01T00:00:00.0000{0,6}Z/
  },
  {
    // Z+2359 adds 23 hour and 59 minutes to the UTC time
    // Which means when converting it back to ISO it is subtracting that time from the date
    timestamp: '1970-01-01Z+2359',
    '!': 'Invalid cds.Timestamp "1970-01-01Z+2359"'
  },
  {
    timestamp: '1970-01-01Z-2359',
    '!': 'Invalid cds.Timestamp "1970-01-01Z-2359"'
  },
  {
    // Missing 'Z' before the +/-, because - is a valid separator for the date section
    timestamp: '1970-01-01+2359',
    '!': 'Invalid cds.Timestamp "1970-01-01+2359"'
  },
  */
  {
    timestamp: '1970-01-01T01:10:59',
    '=timestamp': /1970-01-01T01:10:59.0000{0,6}Z/
  },
  {
    timestamp: '1970-01-01T00:00:00-11:59',
    '=timestamp': /1970-01-01T11:59:00.0000{0,6}Z/
  },
  {
    timestamp: '1970-01-01T00:00:00.999',
    '=timestamp': /1970-01-01T00:00:00.9990{0,6}Z/
  },
  {
    timestamp: '1970-01-01T00:00:00.1234567',
    '=timestamp': /1970-01-01T00:00:00.1234?5?6?7?0{0,2}Z/
  },
  {
    timestamp: '1970-01-01T00:00:00.123456789',
    '=timestamp': /1970-01-01T00:00:00.1234?5?6?7?8?9?Z/
  },
  /*
  {
    // HANA SECONDDATE does not support year 0 or lower
    timestamp: '0000-01-01',
    '!': 'Invalid cds.Timestamp "0000-01-01"'
  },
  {
    // HANA Timestamps don't support up-to 9999-12-31 24:00:00
    timestamp: '9999-12-31 24:00:00',
    '!': 'Invalid cds.Timestamp "9999-12-31 24:00:00"'
  },
  {
    // HANA SECONDDATE does not support year 10000 or higher
    timestamp: '10000-01-01 00:00:00',
    '!': 'Invalid cds.Timestamp "10000-01-01 00:00:00"'
  },
  {
    // HANA SECONDDATE does not assume date information
    timestamp: '00:00:00',
    '!': 'Invalid cds.Timestamp "00:00:00"'
  }
  */
]
