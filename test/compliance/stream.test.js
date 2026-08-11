const cds = require('../cds.js')
const { text } = require('stream/consumers')

describe('SELECT', () => {
  const { expect, data } = cds.test(__dirname + '/resources')
  data.autoReset()

  describe('foreach', () => {
    test('consume to many with single row', async () => {
      const { Authors, Books } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['name'] }, { ref: ['books'], expand: ['*'] }]).from(Authors).orderBy('ID')
      const expected =await cqn.clone()
      const authors = []
      const books = []
      await cds.tx(async () => {
          for await (const row of cqn.clone()) {
            authors.push(row)
            for await (const b of row.books) {
              books.push(b)
            }
          }
      })
      expect(books).deep.eq(expected[0].books)
    })

    test('consume to many expand with multiple rows', async () => {
      const { Authors, Books } = cds.entities('complex.associations')
      await INSERT.into(Authors).entries({ ID: 2348 })
      await INSERT.into(Books).entries([{ ID: 9001, author_ID: 1}, { ID: 9002, author_ID: 1}, { ID: 9003, author_ID: 1}, { ID: 9004, author_ID: 1}, { ID: 9005, author_ID: 1}, { ID: 9006, author_ID: 1}, { ID: 9007, author_ID: 1}])
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['name'] }, { ref: ['books'], expand: ['*'] }]).from(Authors).orderBy('ID')
      const expected =await cqn.clone()
      const authors = []
      const books = []
      await cds.tx(async () => {
          for await (const row of cqn.clone()) {
            authors.push(row)
            for await (const b of row.books) {
              books.push(b)
            }
          }
      })
      expect(books).deep.eq(expected[0].books)
    })

    test('consume to one expand', async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['author'], expand: ['*'] }]).from(Books).orderBy('ID')
      const expected =await cqn.clone()
      const authors = []
      const books = []
      await cds.tx(async () => {
          for await (const row of cqn.clone()) {
            books.push(row)
            const a = await row.author
            authors.push(a)
          }
      })
      expect(authors).deep.eq([expected[0].author])
    })
  })

  describe('raw expand streams', () => {
    test('consume to many expand stream', () => cds.tx(async () => {
      const { Authors } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['name'] }, { ref: ['books'], expand: ['*'] }]).from(Authors).orderBy('ID')
      const expected =await cqn.clone()
      const stream = await cqn.clone().stream()
      const authors = JSON.parse(await text(stream))
      expect(authors).deep.eq(expected)
    }))

    test('consume to one expand stream', () => cds.tx(async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['author'], expand: ['*'] }]).from(Books).orderBy('ID')
      const expected =await cqn.clone()
      const stream = await cqn.clone().stream()
      const authors = JSON.parse(await text(stream))
      expect(authors).deep.eq(expected)
    }))
  })
})
