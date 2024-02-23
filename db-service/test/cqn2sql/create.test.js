'use strict'
const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  return _cqn2sql(q, m)
} 
const cqn = require('./cqn.js')

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
  //csn = await getTestModel('testModel')
})

describe('create with select statements', () => {
  xtest('Generate SQL from CREATE stmt with entity name + as SELECT stmt', () => {
    const cqnCreate = {
      CREATE: {
        entity: 'Foo',
        as: cqn.select,
      },
    }
    const { sql } = cqn2sql(cqnCreate)
    expect({ sql }).toMatchSnapshot()
    // as SELECT is missing in sql
  })

  test('Generate SQL from CREATE stmt with entity name ', () => {
    const cqnCreate = {
      CREATE: {
        entity: 'Foo',
      },
    }
    const { sql } = cqn2sql(cqnCreate)
    expect({ sql }).toMatchSnapshot()
  })

  xtest('Generate SQL from CREATE stmt with CSN entity', () => {
    const cqnCreate = {
      CREATE: {
        entity: cds.model.definitions['Books'],
      },
    }
    const { sql } = cqn2sql(cqnCreate)
    expect({ sql }).toMatchSnapshot()
    //TypeError: Cannot read properties of undefined (reading 'length')
  })
})
