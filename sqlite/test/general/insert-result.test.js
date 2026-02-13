const cds = require('../../../test/cds.js')
const assert = require('assert')

describe('insert from select', () => {
  cds.test(__dirname, 'testModel.cds')

  before(async () => {
    return cds.run([INSERT.into('Foo2').entries({ ID: 11, name: 'test' })])
  })

  test('insert result works for single entries', async () => {
    const insertResult = await cds.run(INSERT({ name: 'Foo' }).into('Foo2'))
    assert.strictEqual(insertResult.affectedRows, 1, 'One row should have been inserted')
    assert.equal(insertResult, 1, 'Lose equality should work for InsertResult')
    assert.deepStrictEqual([...insertResult],[{ID: 12}], 'The iterator should resolve the generated keys')
  })

  test('insert result works for batch entries', async () => {
    const {maxID} = await cds.run(SELECT.one.from('Foo2').columns('max(ID) as maxID'))

    const entries = Array(10).fill().map((_, idx) => ({ name: `Foo${maxID + 1 + idx}` }))
    const insertResult = await cds.run(INSERT(entries).into('Foo2'))
    assert.strictEqual(insertResult.affectedRows, 10, 'One row should have been inserted')
    assert.equal(insertResult, 10, 'Lose equality should work for InsertResult')
    const expected = Array(10).fill().map((_, idx) => ({ ID: maxID + 1 + idx }))
    assert.deepStrictEqual([...insertResult],expected, 'The iterator should resolve the generated keys')
  })
})