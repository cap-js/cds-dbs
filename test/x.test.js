test('bs error', async () => {

  const bs = require('better-sqlite3')
  const dbc = new bs(':memory:')
  await dbc.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)')
  await dbc.exec('INSERT INTO test (id,name) VALUES (12, \'test\')')
  try {
    await dbc.exec('INSERT INTO test (id,name) VALUES (12, \'test\')')
  } catch (err) {
    const cdsErr = Object.assign(err, {message: 'xy'})
    const  {VError} = require('verror')
    var err2 = new VError(cdsErr, 'sdfsd');
    console.error(err2.message);
    expect(cdsErr).toBeInstanceOf(Error)
  }
})