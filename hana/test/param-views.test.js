const cds = require('../../test/cds')

describe('Parameterized view', () => {
  const { expect } = cds.test(__dirname, 'param-views.cds')

  beforeAll(async () => {
    const db = await cds.connect.to('db')

    // Deploy calculation view that uses an placeholder.$$NAME$$ argument
    const xml = cds.utils.fs.readFileSync(__dirname + '/authors.hdbcalc', 'utf-8')
    await db.run(`CREATE ANALYTIC MODEL SAP_CAPIRE_BOOKSHOP_CALCAUTHORS USING '${xml.replaceAll("'", "''")}'`)

    // Extend current model with calcview that is based upon already deployed Authors table
    const model = await cds.load('./param-view-calc.cds').then(cds.linked)

    for (const entity in cds.model.definitions) {
      if (model.definitions[entity]) model.definitions[entity]['@cds.persistence.skip'] = true
    }

    await cds.deploy(model).to('db')

    for (const entity in model.definitions) {
      if (model.definitions[entity]['@cds.persistence.skip']) continue
      db.model.definitions[entity] = model.definitions[entity]
    }

    // Flatten foreign key path expression in CalcAuthors books associations
    db.model.definitions['sap.capire.bookshop.PublicCalcAuthors'].elements.books.on[2] = { ref: ['books', 'author_ID'] }
  })

  test('calcview', async () => {
    const { Authors, PublicCalcAuthors } = cds.entities('sap.capire.bookshop')

    const authors = await SELECT.from(Authors)
    const root = {
      id: PublicCalcAuthors.name,
      args: { name: { val: authors[0].name } },
    }

    const result = await SELECT.from({ ref: [root] })
    const expand = await SELECT`ID,books{ID}`.from({ ref: [root] })

    expect(result.length).to.eq(1)
    expect(expand[0].books.length).to.be.defined
  })

  const tests = [
    // ===== required queries =====
    {
      available: { val: 0 },
      books: 0,
    }, {
      // all books with <= 12 stock
      available: { val: 12 },
      books: 2,
    }, {
      // all books (with <= 1000 stock)
      available: { val: 1000 },
      books: 5,
    },
    // ===== just works queries =====
    {
      // cast is required as the SQL becomes (? * ?)
      // all books with <= 22 stock
      available: CXL`cast(11 * 2 as cds.Integer)`,
      books: 3,
    }, {
      // the book with the least stock
      available: SELECT`min(stock)`.from('sap.capire.bookshop.Books'),
      books: 1,
    }
  ]

  test.each(tests)('select', async ({ available, books }) => {
    const { ParamBooks, Books } = cds.entities('sap.capire.bookshop')

    // Apply author association to parameterized view
    ParamBooks.elements.author = Books.elements.author

    const root = {
      id: ParamBooks.name,
      args: { available }
    }

    const [booksRes, authorsRes, expandRes] = await Promise.all([
      SELECT.from({ ref: [root] }),
      SELECT.from({ ref: [root, 'author'] }),
      SELECT`ID,stock,author{ID}`.from({ ref: [root] }),
    ])

    expect(booksRes).to.have.property('length').to.be.eq(books)
    const authorKeys = expandRes.map(r => r.author.ID)
    expect(authorsRes.filter(r => authorKeys.includes(r.ID))).to.have.property('length').to.be.eq(authorsRes.length)
  })
})