const cds = require('../../test/cds')

describe('Parameterized view', () => {
  const { expect } = cds.test(__dirname, 'param-views.cds')

  const tests = [
    // ===== required queries =====
    {
      available: { val: 0 },
      books: 0,
    }, {
      // all books with <= 12 stock
      available: { val: 12 },
      books: 3,
    }, {
      // all books (with <= 1000 stock)
      available: { val: 1000 },
      books: 6,
    },
    // ===== just works queries =====
    {
      // cast is required as the SQL becomes (? * ?)
      // all books with <= 22 stock
      available: CXL`cast(11 * 2 as cds.Integer)`,
      books: 4,
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