'use strict'
const { text } = require('stream/consumers')

const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  return _cqn2sql(q, m)
} 

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
})

describe('upsert', () => {
  test('test with keys only', async () => {
    const cqnUpsert = {
      UPSERT: {
        into: 'Foo2',
        columns: ['ID'],
        rows: [[1], [9]],
      },
    }

    const { sql, entries } = cqn2sql(cqnUpsert)
    expect({ sql, entries:  [[await text(entries[0][0])]] }).toMatchSnapshot()
  })

  test('test with entries', async () => {
    const cqnUpsert = {
      UPSERT: {
        into: 'Foo2',
        entries: [
          { ID: 1, name: null, a: 2 },
          { ID: null, name: "'asd'", a: 6 },
        ],
      },
    }

    const { sql, entries } = cqn2sql(cqnUpsert)
    expect({ sql, entries: [[await text(entries[0][0])]] }).toMatchSnapshot()
  })
})
