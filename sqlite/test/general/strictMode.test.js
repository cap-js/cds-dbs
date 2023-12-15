const cds = require('../../../test/cds.js')
process.env.cds_features_db__strict = 'true'

describe('strict mode', () => {
  cds.test(__dirname, 'model.cds')

  afterAll(() => {
    process.env.cds_features_db__strict = undefined
  })

  async function runAndExpectError(cqn, expectedStatusCode, expectedMessage, expectedDetails) {
    let error
    try {
      await cds.run(cqn)
    } catch (e) {
      error = e
    }

    expect(error.statusCode).toEqual(expectedStatusCode)
    expect(error.message).toEqual(expectedMessage)

    if (expectedDetails) {
      expect(error.details.map(detail => detail.message)).toEqual(expectedDetails)
    } else {
      expect(error.details).toEqual(undefined)
    }
  }
  describe('UPDATE Scenarios', () => {
    test('Update with multiple errors', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        UPDATE.entity(foo).where({ ID: 2 }).set({ abc: 'bar', abc2: 'baz' }),
        400,
        'MULTIPLE_ERRORS',
        ['Table test.foo has no column named abc', 'Table test.foo has no column named abc2'],
      )
    })

    test('Update with single error', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        UPDATE.entity(foo).where({ ID: 2 }).set({ abc: 'bar' }),
        400,
        'Table test.foo has no column named abc',
      )
    })
  })

  describe('INSERT Scenarios', () => {
    test('Insert with single error using entries', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(INSERT.into(foo).entries({ abc: 'bar' }), 400, 'Table test.foo has no column named abc')
    })

    test('Insert with multiple errors using entries', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(INSERT.into(foo).entries([{ abc: 'bar' }, { abc2: 'bar2' }]), 400, 'MULTIPLE_ERRORS', [
        'Table test.foo has no column named abc',
        'Table test.foo has no column named abc2',
      ])
    })

    test('Insert with single error using columns and values', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).columns(['abc']).values(['foo', 'bar']),
        400,
        'Table test.foo has no column named abc',
      )
    })

    test('Insert with multiple errors with columns and rows', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).columns(['abc', 'abc2']).rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        400,
        'MULTIPLE_ERRORS',
        ['Table test.foo has no column named abc', 'Table test.foo has no column named abc2'],
      )
    })

    test('Insert with single error using columns and rows', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(
        INSERT.into(foo).columns(['abc']).rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        400,
        'Table test.foo has no column named abc',
      )
    })
  })

  describe('UPSERT Scenarios', () => {
    test('UPSERT with single error', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(UPSERT.into(foo).entries({ abc: 'bar' }), 400, 'Table test.foo has no column named abc')
    })
    test('UPSERT with multiple errors', async () => {
      const { foo } = cds.entities('test')
      await runAndExpectError(UPSERT.into(foo).entries({ abc: 'bar', abc2: 'baz' }), 400, 'MULTIPLE_ERRORS', [
        'Table test.foo has no column named abc',
        'Table test.foo has no column named abc2',
      ])
    })
  })
})
