const cds = require('../cds.js')
const Books = 'complex.Books'

describe('strict mode', () => {
  beforeAll(() => {
    process.env.cds_features_db__strict = true
  })

  cds.test(__dirname + '/resources')

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
    if (expectedMessage === 'notExisting') expect(error.message.toLowerCase()).toContain('notexisting')
    else expect(error.message).toEqual(expectedMessage)
  }
  describe('UPDATE Scenarios', () => {
    test('Update with multiple errors', async () => {
      await runAndExpectError(
        UPDATE.entity(Books).where({ ID: 2 }).set({ abc: 'bar', abc2: 'baz' }),
        'STRICT MODE: Trying to UPDATE non existent columns (abc,abc2)',
      )
    })

    test('Update with single error', async () => {
      await runAndExpectError(
        UPDATE.entity(Books).where({ ID: 2 }).set({ abc: 'bar' }),
        'STRICT MODE: Trying to UPDATE non existent columns (abc)',
      )
    })

    test('Update on non existing entity', async () => {
      await runAndExpectError(UPDATE.entity('notExisting').where({ ID: 2 }).set({ abc: 'bar' }), 'notExisting')
    })
  })

  describe('INSERT Scenarios', () => {
    test('Insert with single error using entries', async () => {
      await runAndExpectError(
        INSERT.into(Books).entries({ abc: 'bar' }),
        'STRICT MODE: Trying to INSERT non existent columns (abc)',
      )
    })

    test('Insert with multiple errors using entries', async () => {
      await runAndExpectError(
        INSERT.into(Books).entries([{ abc: 'bar' }, { abc2: 'bar2' }]),
        'STRICT MODE: Trying to INSERT non existent columns (abc,abc2)',
      )
    })

    test('Insert with single error using columns and values', async () => {
      await runAndExpectError(
        INSERT.into(Books).columns(['abc']).values(['foo', 'bar']),
        'STRICT MODE: Trying to INSERT non existent columns (abc)',
      )
    })

    test('Insert with multiple errors with columns and rows', async () => {
      await runAndExpectError(
        INSERT.into(Books).columns(['abc', 'abc2']).rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        'STRICT MODE: Trying to INSERT non existent columns (abc,abc2)',
      )
    })

    test('Insert with single error using columns and rows', async () => {
      await runAndExpectError(
        INSERT.into(Books).columns(['abc']).rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        'STRICT MODE: Trying to INSERT non existent columns (abc)',
      )
    })

    test('Insert on non existing entity using entries', async () => {
      await runAndExpectError(INSERT.into('notExisting').entries({ abc: 'bar' }), 'notExisting')
    })
  })

  describe('UPSERT Scenarios', () => {
    test('UPSERT with single error', async () => {
      await runAndExpectError(
        UPSERT.into(Books).entries({ abc: 'bar' }),
        'STRICT MODE: Trying to UPSERT non existent columns (abc)',
      )
    })
    test('UPSERT with multiple errors', async () => {
      await runAndExpectError(
        UPSERT.into(Books).entries({ abc: 'bar', abc2: 'baz' }),
        'STRICT MODE: Trying to UPSERT non existent columns (abc,abc2)',
      )
    })

    test('UPSERT on non existing entity', async () => {
      await runAndExpectError(UPSERT.into('notExisting').entries({ abc: 'bar' }), 'notExisting')
    })
  })
})
