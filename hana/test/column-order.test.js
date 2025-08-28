const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

describe('column order', () => {
  const { expect } = cds.test(bookshop)

  describe('regardless of column order specifed in query', () => {
    let hanaService

    beforeAll(async () => {
      hanaService = await cds.connect.to('db')
    })

    const expectSqlScriptToBeEqual = (query1, query2) => {
      const sql1 = hanaService.cqn2sql(query1)
      const sql2 = hanaService.cqn2sql(query2)
      expect(sql1.sql).to.equal(sql2.sql)

      const sqlScript1 = hanaService.wrapTemporary(sql1.temporary, sql1.withclause, sql1.blobs)
      const sqlScript2 = hanaService.wrapTemporary(sql2.temporary, sql2.withclause, sql2.blobs)
      expect(sqlScript1).to.equal(sqlScript2)
    }

    test('should select columns in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns(['ID', 'title', 'descr', 'stock', 'price'])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns(['stock', 'title', 'price', 'ID', 'descr'])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select expands in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns([
        { ref: ['author'], expand: [{ ref: ['name'] }] },
        { ref: ['genre'], expand: [{ ref: ['ID'] }] },
      ])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([
        { ref: ['genre'], expand: [{ ref: ['ID'] }] },
        { ref: ['author'], expand: [{ ref: ['name'] }] },
      ])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select flat expands in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns([
        'ID',
        { ref: ['author', 'ID'] },
        { ref: ['genre', 'ID'] },
        { ref: ['author', 'name'] },
      ])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([
        { ref: ['genre', 'ID'] },
        { ref: ['author', 'name'] },
        { ref: ['author', 'ID'] },
        'ID',
      ])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select columns and expands in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns([
        'ID',
        { ref: ['author'], expand: [{ ref: ['ID'] }, { ref: ['name'] }] },
        { ref: ['genre', 'ID'] },
      ])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([
        { ref: ['genre', 'ID'] },
        { ref: ['author'], expand: [{ ref: ['ID'] }, { ref: ['name'] }] },
        'ID',
      ])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select columns from expands in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns([
        'ID',
        { ref: ['author'], expand: [{ ref: ['ID'] }, { ref: ['name'] }] },
      ])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([
        { ref: ['author'], expand: [{ ref: ['name'] }, { ref: ['ID'] }] },
        'ID',
      ])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select functions in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns(['ID', { xpr: ['1=1'], as: 'always_true' }])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([{ xpr: ['1=1'], as: 'always_true' }, 'ID'])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select expressions in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns([
        'ID',
        { func: 'max', args: [{ ref: ['price'] }] },
      ])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([
        { func: 'max', args: [{ ref: ['price'] }] },
        'ID',
      ])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select values in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns(['ID', { val: 'some-static-value' }])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([{ val: 'some-static-value' }, 'ID'])

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should select numeric values in the same order', async () => {
      const query1 = SELECT.from('sap.capire.bookshop.Books').columns(['ID', { val: 1 }])
      const query2 = SELECT.from('sap.capire.bookshop.Books').columns([{ val: 1 }, 'ID'])

      expectSqlScriptToBeEqual(query1, query2)
    })
  })
})
