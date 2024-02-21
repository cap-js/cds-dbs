const dstring = size => ({ d: 'default'.slice(0, size), o: 'not default'.slice(0, size) })

const columns = {
  integer: { d: 10, o: 20 },
  integer64: { d: 11, o: 21 },
  double: { d: 1.1, o: 2.2 },
  float: { d: 1.1, o: 2.2 },
  decimal: { d: 1.12345, o: 2.12345 },
  string: dstring(255),
  char: dstring(1),
  short: dstring(10),
  medium: dstring(100),
  large: dstring(5000),
  // blob: dstring(5001),
  date: { d: '1970-01-01', o: '2000-01-01' },
  time: { d: '01:02:03', o: '21:02:03' },
  dateTime: { d: '1970-01-01T01:02:03Z', o: '2000-01-01T21:02:03Z' },
  timestamp: { d: '1970-01-01T01:02:03.123Z', o: '2000-01-01T21:02:03.123Z' },
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