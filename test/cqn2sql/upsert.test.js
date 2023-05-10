
'use strict'
const cds = require ('@cap-js/core-sql/cds')
const cqn2sql = require('@cap-js/core-sql/lib/sql/cqn2sql')

beforeAll (async ()=>{
  cds.model = await cds.load(__dirname+'/testModel') .then (cds.linked)
})

describe('upsert', () => {

  test('test with keys only', () => {
    const cqnUpsert = {
      UPSERT: {
        into: 'Foo2',
        columns: ['ID'],
        rows: [
          [1],
          [9]
        ]
      }
    }

    const {sql, entries} = cqn2sql(cqnUpsert)
    expect({sql, entries}).toMatchSnapshot()
  })

  test('test with entries', () => {
    const cqnInsert = {
      UPSERT: {
        into: 'Foo2',
        entries: [
          { ID: 1, name: null, a: 2 },
          { ID: null, name: "'asd'", a: 6 }
        ]
      }
    }

    const {sql, entries} = cqn2sql(cqnInsert)
    expect({sql, entries}).toMatchSnapshot()
  })
})
