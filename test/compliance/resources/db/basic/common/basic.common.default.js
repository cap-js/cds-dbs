const dstring = size => ({ d: 'default'.slice(0, size), o: 'not default'.slice(0, size) })

const columns = {
  uuidDflt: { d: '00000000-0000-0000-4000-000000000000', o: '11111111-1111-1111-4111-111111111111'},
  bool: { d: false, o: true },
  integer8: { d: 8, o: 18 },
  integer16: { d: 9, o: 19 },
  integer32: { d: 10, o: 20 },
  integer64: { d: '11', o: '21' },
  double: { d: 1.1, o: 2.2 },
  float: { d: '1.1', o: '2.2' },
  decimal: { d: '1.1111', o: '2.1111' },
  string: dstring(255),
  char: dstring(1),
  short: dstring(10),
  medium: dstring(100),
  large: dstring(5000),
  // blob: dstring(5001),
  date: { d: '1970-01-01', o: '2000-01-01' },
  date_lit: { d: '2021-05-05', o: '2011-08-01' },   
  time: { d: '01:02:03', o: '21:02:03' },
  dateTime: { d: '1970-01-01T01:02:03Z', o: '2000-01-01T21:02:03Z' },
  timestamp: { d: '1970-01-01T01:02:03.123Z', o: '2000-01-01T21:02:03.123Z' },
  // func: { d: 'default', o: 'DefaULT' },
  // Binary default values don't make sense. while technically possible
  // binary: { d: Buffer.from('binary'), o: Buffer.from('...') },
  // largebinary: { d: Buffer.from('binary'), o: Buffer.from('...') },
}

module.exports = Object.keys(columns).map(c => {
  const vals = columns[c]
  return [{
    [c]: null // Make sure that null still works
  }, {
    [c]: vals.o // Make sure that overwriting the default works
  }, {
    [c]: vals.d // Make sure that the default can also be written
  }, {
    [`=${c}`]: vals.d // Make sure when excluded in the data that default is returned
  }]
}).flat()