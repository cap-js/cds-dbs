const cds = require('../../../test/cds.js')
process.env.cds_features_db__strict = 'true'

describe('strict mode', () => {
  cds.test(__dirname, 'model.cds')

  afterAll(() => {
    process.env.cds_features_db__strict = undefined
  })

  async function runAndExpectError(cqn, expectedMessage) {
    let error
    try {
      await cds.run(cqn)
    } catch (e) {
      error = e
    }
    expect(error.message).toEqual(expectedMessage)
  }
  describe('UPDATE Scenarios', () => {
    test('Update with multiple errors', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        UPDATE.entity(foo).where({ ID: 2 }).set({ abc: 'bar', abc2: 'baz' }),
        'STRICT MODE: Trying to UPDATE non existent columns (abc,abc2)',
      )
    })

    test('Update with single error', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        UPDATE.entity(foo).where({ ID: 2 }).set({ abc: 'bar' }),
        'STRICT MODE: Trying to UPDATE non existent columns (abc)',
      )
    })

    test.skip('Update on non existing entity', async () => {
      await runAndExpectError(
        UPDATE.entity('notExisting').where({ ID: 2 }).set({ abc: 'bar' }),
        'STRICT MODE: Trying to UPDATE non existent columns (abc,abc2)',
      )
    })
  })

  describe('INSERT Scenarios', () => {
    test('Insert with single error using entries', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).entries({ abc: 'bar' }),
        'STRICT MODE: Trying to INSERT non existent columns (abc)',
      )
    })

    test('Insert with multiple errors using entries', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).entries([{ abc: 'bar' }, { abc2: 'bar2' }]),
        'STRICT MODE: Trying to INSERT non existent columns (abc,abc2)',
      )
    })

    test('Insert with single error using columns and values', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).columns(['abc']).values(['foo', 'bar']),
        'STRICT MODE: Trying to INSERT non existent columns (abc)',
      )
    })

    test('Insert with multiple errors with columns and rows', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).columns(['abc', 'abc2']).rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        'STRICT MODE: Trying to INSERT non existent columns (abc,abc2)',
      )
    })

    test('Insert with single error using columns and rows', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).columns(['abc']).rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        'STRICT MODE: Trying to INSERT non existent columns (abc)',
      )
    })

    test('Insert on non existing entity using entries', async () => {
      await runAndExpectError(
        INSERT.into('notExisting').entries({ abc: 'bar' }),
        'STRICT MODE: Trying to INSERT non existent columns (abc)',
      )
    })
  })

  describe('UPSERT Scenarios', () => {
    test('UPSERT with single error', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        UPSERT.into(foo).entries({ abc: 'bar' }),
        'STRICT MODE: Trying to UPSERT non existent columns (abc)',
      )
    })
    test('UPSERT with multiple errors', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        UPSERT.into(foo).entries({ abc: 'bar', abc2: 'baz' }),
        'STRICT MODE: Trying to UPSERT non existent columns (abc,abc2)',
      )
    })

    test('UPSERT on non existing entity', async () => {
      await runAndExpectError(
        UPSERT.into('notExisting').entries({ abc: 'bar' }),
        'STRICT MODE: Trying to UPSERT non existent columns (abc)',
      )
    })
  })
})
