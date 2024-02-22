'use strict'
const cds = require('@sap/cds/lib')
const _cqn2sql = require('../../lib/cqn2sql')
function cqn2sql(q, m = cds.model) {
  return _cqn2sql(q, m)
} 

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.linked)
})
describe('drop', () => {
  test('test drop table with string entity', () => {
    const { sql } = cqn2sql({
      DROP: {
        entity: 'Foo',
      },
    })
    expect({ sql }).toMatchSnapshot()
  })
  test('test drop table with string table', () => {
    const { sql } = cqn2sql({
      DROP: {
        entity: 'Foo',
        table: 'Foo',
      },
    })
    expect({ sql }).toMatchSnapshot()
  })

  xtest('test drop table with ref', () => {
    const { sql } = cqn2sql({
      DROP: {
        table: { ref: ['Foo'] },
      },
    })
    expect({ sql }).toMatchSnapshot()
    // Cannot destructure property 'ref' of 'from' as it is undefined.
  })

  xtest('test drop table with ref', () => {
    const { sql } = cqn2sql({
      DROP: {
        view: { ref: ['Foo'] },
      },
    })
    expect({ sql }).toMatchSnapshot()
    // Cannot destructure property 'ref' of 'from' as it is undefined.
  })

  xtest('test drop view with string view', () => {
    const { sql } = cqn2sql({
      DROP: {
        view: 'Foo',
      },
    })
    expect({ sql }).toMatchSnapshot()
    //TypeError: Cannot destructure property 'ref' of 'from' as it is undefined.
  })

  xtest('test drop table with CQN entity', () => {
    const { sql } = cqn2sql({
      DROP: {
        entity: { ref: 'Books' },
      },
    })
    expect({ sql }).toMatchSnapshot()
    //"B" not found in the definitions of your model
  })
})
