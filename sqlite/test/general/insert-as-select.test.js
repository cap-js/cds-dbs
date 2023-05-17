const cds = require('../../../test/cds.js')
cds.test(__dirname, 'testModel.cds')

const assert = require('assert')

describe('insert as select', () => {
  test('make sure that the placeholder values of the prepared statement are passed to the database', async () => {
    // fill other table first
    await cds.run(INSERT({ ID: 42, name: 'Foo2' }).into('Foo2'))
    const insert = INSERT.into('Foo')
      .columns(['ID', 'a'])
      .as(
        SELECT.from('Foo2')
          .columns(['ID', 'name'])
          .where({ ref: ['name'] }, '=', { val: 'Foo2' }),
      )
    // insert as select
    const insertRes = await cds.run(insert)
    assert.strictEqual(insertRes.affectedRows, 1, 'One row should have been inserted')
    // select the inserted column
    const selectRes = await cds.run(SELECT.from('Foo').where({ ref: ['ID'] }, '=', { val: 42 }))
    assert.strictEqual(selectRes.length, 1, 'One row should have been inserted')
  })
})
