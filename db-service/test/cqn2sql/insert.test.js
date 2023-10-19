'use strict'
const cds = require('@sap/cds/lib')
const cqn2sql = require('../../lib/cqn2sql')

beforeAll(async () => {
  cds.model = await cds.load(__dirname + '/testModel').then(cds.compile.for.nodejs)
})

describe('insert', () => {
  describe('insert only', () => {
    // Values are missing
    test('test with insert values into columns', () => {
      const cqnInsert = {
        INSERT: {
          into: { ref: ['Foo'] },
          columns: ['ID', 'b', 'x'],
          values: [1, "'asd'", 2],
        },
      }

      const { sql, entries } = cqn2sql(cqnInsert)
      expect({ sql, entries }).toMatchSnapshot()
    })

    test('test with insert rows into columns', () => {
      const cqnInsert = {
        INSERT: {
          into: { ref: ['Foo'] },
          columns: ['ID', 'b', 'a'],
          rows: [
            [1, "'asd'", 2],
            [9, "mmm'", 77],
          ],
        },
      }
      const { sql, entries } = cqn2sql(cqnInsert)
      expect({ sql, entries }).toMatchSnapshot()
    })

    // no filtering in INSERT
    xtest('test filter in insert rows into columns with not existing column', () => {
      const cqnInsert = {
        INSERT: {
          into: { ref: ['Foo2'] },
          columns: ['ID', 'not_existing', 'something'],
          rows: [
            [1, "'asd'", 2],
            [9, "mmm'", 77],
          ],
        },
      }
      const { sql, entries } = cqn2sql(cqnInsert)
      expect({ sql, entries }).toMatchSnapshot()
    })

    test('test with insert entries', () => {
      const cqnInsert = {
        INSERT: {
          into: 'Foo2',
          entries: [
            { ID: 1, name: null, a: 2 },
            { ID: null, name: "'asd'", a: 6 },
          ],
        },
      }

      const { sql, entries } = cqn2sql(cqnInsert)
      expect({ sql, entries }).toMatchSnapshot()
    })

    test('test with insert with alias', () => {
      const cqnInsert = {
        INSERT: {
          into: { ref: ['Foo2'], as: 'Fooooo2' },
          entries: [
            { ID: 1, name: null, a: 2 },
            { ID: null, name: "'asd'", a: 6 },
          ],
        },
      }

      const { sql, entries } = cqn2sql(cqnInsert)
      expect({ sql, entries }).toMatchSnapshot()
    })
  })

  describe('insert into ... select from ...', () => {
    // sql is generated correctly, but not valid since number of columns is different in both tables
    test('no columns', () => {
      const cqnInsert = {
        INSERT: {
          into: 'Foo',
          as: { SELECT: { from: { ref: ['Foo2'] } } },
        },
      }

      const { sql } = cqn2sql(cqnInsert)
      expect(sql).toEqual('INSERT INTO Foo (ID,a,b,c,x) SELECT Foo2.ID,Foo2.name,Foo2.a FROM Foo2 as Foo2')
    })

    test('with columns', () => {
      const cqnInsert = {
        INSERT: {
          into: 'Foo',
          columns: ['ID'],
          as: { SELECT: { from: { ref: ['Foo2'] }, columns: [{ ref: ['ID'] }] } },
        },
      }

      const { sql } = cqn2sql(cqnInsert)
      expect(sql).toEqual('INSERT INTO Foo (ID) SELECT Foo2.ID FROM Foo2 as Foo2')
    })
  })
})
