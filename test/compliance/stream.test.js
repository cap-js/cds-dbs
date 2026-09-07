const cds = require('../cds.js')
const { json } = require('stream/consumers')

describe('SELECT', () => {
  const { expect, data } = cds.test(__dirname + '/resources')

  describe('foreach', () => {
    test('consume to many', async () => {
      const { Authors } = cds.entities('complex.associations')
      const cqn = cds.ql`SELECT ID, name, books[order by ID asc]{*} FROM ${Authors} order by ID asc`
      const authors = []
      await cds.tx(async () => {
        for await (const author of cqn.clone()) {
          authors.push(author)
          const books = author.books
          author.books = []
          for await (const book of books) author.books.push(book)
        }
      })
      expect(authors).deep.eq(await cqn.clone())
    })

    test('consume to one expand', async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = cds.ql`SELECT ID, title, author{*} FROM ${Books} order by ID asc`
      const books = []
      await cds.tx(async () => {
        for await (const book of cqn.clone()) {
          book.author = await book.author
          books.push(book)
        }
      })
      expect(books).deep.eq(await cqn.clone())
    })
  })

  describe('raw expand streams', () => {
    test('consume to many expand stream', () => cds.tx(async () => {
      const { Authors } = cds.entities('complex.associations')
      const cqn = cds.ql`SELECT ID, name, books {*} FROM ${Authors} order by ID asc`
      expect(await json(await cqn.clone().stream())).deep.eq(await cqn.clone())
    }))

    test('consume to one expand stream', () => cds.tx(async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = cds.ql`SELECT ID, title, author {*} FROM ${Books} order by ID asc`
      expect(await json(await cqn.clone().stream())).deep.eq(await cqn.clone())
    }))
  })
})
