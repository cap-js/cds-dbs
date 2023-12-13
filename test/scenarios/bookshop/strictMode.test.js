process.env.cds_features_db__strict = 'true'
const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - strict mode', () => {
  const { expect } = cds.test(bookshop)

  async function runAndExpectError(cqn, expectedStatusCode, expectedMessage, expectedDetails) {
    let error
    try {
      await cds.run(cqn)
    } catch (e) {
      error = e
    }

    expect(error.statusCode).to.be.eq(expectedStatusCode)
    expect(error.message).to.be.eq(expectedMessage)

    if (expectedDetails) {
      expect(error.details.map(detail => detail.message)).to.eql(expectedDetails)
    } else {
      expect(error.details).to.be.undefined
    }
  }
  describe('UPDATE Scenarios', () => {
    test('Update with multiple errors', async () => {
      await runAndExpectError(
        UPDATE.entity('sap.capire.bookshop.Books').where({ ID: 2 }).set({ title: 'foo', abc: 'bar', abc2: 'baz' }),
        400,
        'MULTIPLE_ERRORS',
        [
          'Table sap.capire.bookshop.Books has no column named abc',
          'Table sap.capire.bookshop.Books has no column named abc2',
        ],
      )
    })

    test('Update with single error', async () => {
      await runAndExpectError(
        UPDATE.entity('sap.capire.bookshop.Books').where({ ID: 2 }).set({ title: 'foo', abc: 'bar' }),
        400,
        'Table sap.capire.bookshop.Books has no column named abc',
      )
    })
  })

  describe('INSERT Scenarios', () => {
    test('Insert with single error using entries', async () => {
      await runAndExpectError(
        INSERT.into('sap.capire.bookshop.Books').entries({ title: 'foo', abc: 'bar' }),
        400,
        'Table sap.capire.bookshop.Books has no column named abc',
      )
    })

    test('Insert with multiple errors using entries', async () => {
      await runAndExpectError(
        INSERT.into('sap.capire.bookshop.Books').entries([
          { title: 'foo', abc: 'bar' },
          { title: 'foo2', abc2: 'bar2' },
        ]),
        400,
        'MULTIPLE_ERRORS',
        [
          'Table sap.capire.bookshop.Books has no column named abc',
          'Table sap.capire.bookshop.Books has no column named abc2',
        ],
      )
    })

    test('Insert with single error using columns and values', async () => {
      await runAndExpectError(
        INSERT.into('sap.capire.bookshop.Books').columns(['title', 'abc']).values(['foo', 'bar']),
        400,
        'Table sap.capire.bookshop.Books has no column named abc',
      )
    })

    test('Insert with multiple errors with columns and rows', async () => {
      await runAndExpectError(
        INSERT.into('sap.capire.bookshop.Books')
          .columns(['title', 'abc', 'abc2'])
          .rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        400,
        'MULTIPLE_ERRORS',
        [
          'Table sap.capire.bookshop.Books has no column named abc',
          'Table sap.capire.bookshop.Books has no column named abc2',
        ],
      )
    })

    test('Insert with single error using columns and rows', async () => {
      await runAndExpectError(
        INSERT.into('sap.capire.bookshop.Books')
          .columns(['title', 'abc'])
          .rows(['foo', 'bar'], ['foo2', 'bar2'], ['foo3', 'bar3']),
        400,
        'Table sap.capire.bookshop.Books has no column named abc',
      )
    })
  })

  describe('UPSERT Scenarios', () => {
    test('UPSERT with single error', async () => {
      await runAndExpectError(
        UPSERT.into('sap.capire.bookshop.Books').entries({ title: 'foo', abc: 'bar' }),
        400,
        'Table sap.capire.bookshop.Books has no column named abc',
      )
    })
    test('UPSERT with multiple errors', async () => {
      await runAndExpectError(
        UPSERT.into('sap.capire.bookshop.Books').entries({ title: 'foo', abc: 'bar', abc2: 'baz' }),
        400,
        'MULTIPLE_ERRORS',
        [
          'Table sap.capire.bookshop.Books has no column named abc',
          'Table sap.capire.bookshop.Books has no column named abc2',
        ],
      )
    })
  })
})
