const cds = require('../../test/cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../test/bookshop')

describe('column order', () => {
  const { expect } = cds.test(bookshop)

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

  describe('when selecting - regardless of column order specifed in query', () => {
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
  })

  describe('when inserting from select - regardless of column order specifed in query', () => {
    test('should insert and select from columns in the same order', async () => {
      const query1 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['ID', 'title', 'descr', 'stock', 'price'])
        .from(SELECT.from('sap.capire.bookshop.Books').columns(['ID', 'title', 'descr', 'stock', 'price']))
      const query2 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['stock', 'title', 'price', 'ID', 'descr'])
        .from(SELECT.from('sap.capire.bookshop.Books').columns(['stock', 'title', 'price', 'ID', 'descr']))

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should throw when selected columns are not specified', async () => {
      const query1 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['ID', 'title', 'descr', 'stock', 'price'])
        .from(SELECT.from('sap.capire.bookshop.Books'))

      expect(() => hanaService.cqn2sql(query1)).to.throw(/selected columns must be specified/i)
    })

    test('should throw when selected columns include *', async () => {
      const query1 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['ID', 'title'])
        .from(SELECT.from('sap.capire.bookshop.Books').columns(['ID', '*']))

      expect(() => hanaService.cqn2sql(query1)).to.throw(/columns were automatially expanded/i)
    })

    test('should insert and select from navigation columns in the same order', async () => {
      const query1 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['ID', 'author_ID', 'title'])
        .from(
          SELECT.from('sap.capire.bookshop.Books').columns([
            { ref: ['ID'] },
            { ref: ['author', 'ID'] },
            { ref: ['title'] },
          ]),
        )
      const query2 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['title', 'ID', 'author_ID'])
        .from(
          SELECT.from('sap.capire.bookshop.Books').columns([
            { ref: ['title'] },
            { ref: ['ID'] },
            { ref: ['author', 'ID'] },
          ]),
        )

      expectSqlScriptToBeEqual(query1, query2)
    })

    test('should throw when trying to insert from inlined expands', async () => {
      const query1 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['ID', 'descr'])
        .from(
          SELECT.from('sap.capire.bookshop.Books').columns([
            { ref: ['ID'] },
            { ref: ['author'], inline: [{ ref: ['street'] }, { ref: ['city'] }] },
          ]),
        )
      
        expect(() => hanaService.cqn2sql(query1)).to.throw(/columns were automatially expanded/i)
    })

    test('should throw when trying to insert and select from expanded column', async () => {
      const query1 = INSERT.into('sap.capire.bookshop.Books')
        .columns(['ID', 'author_ID', 'author_name'])
        .from(
          SELECT.from('sap.capire.bookshop.Books').columns([
            { ref: ['ID'] },
            { ref: ['author', 'ID'] },
            { ref: ['author', 'name'] },
          ]),
        )

      expect(() => hanaService.cqn2sql(query1)).to.throw(/insert does not match/i)
    })
  })
})
