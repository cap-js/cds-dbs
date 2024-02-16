test('bs error', async () => {
  const bs = require('better-sqlite3')
  const dbc = new bs(':memory:')
  await dbc.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)')
  await dbc.exec("INSERT INTO test (id,name) VALUES (12, 'test')")
  try {
    try {
      await dbc.exec("INSERT INTO test (id,name) VALUES (12, 'test')")
    } catch (err) {
      throw Object.assign(err, {
        originalMessage: err.message,
        message: 'asdf',
        code: 400,
      })
    }
  } catch (e) {
    const { VError } = require('verror')
    var err2 = new VError(e, 'sdfsd')
    console.error(err2.message)
    expect(e).toBeInstanceOf(Error)
  }
})
