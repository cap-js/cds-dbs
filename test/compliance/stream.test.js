const assert = require('assert')
const cds = require('../cds.js')
const { text } = require('stream/consumers')
const { pipeline } = require('stream')

describe('SELECT', () => {
  const { expect } = cds.test(__dirname + '/resources')

  describe('foreach', () => {
    const process = function (row) {
      for (const prop in row) if (row[prop] != null) (this[prop] ??= []).push(row[prop])
    }

    test('consume to many expand', async () => {
      const { Authors } = cds.entities('complex.associations')
      await INSERT.into(Authors).entries({ ID: 2348 })
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
      expect(authors).deep.eq(expected)
      expect(books).deep.eq(expected[0].books)
    })

    xtest('consume to one expand through for await', async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['author'], expand: ['*'] }]).from(Books).orderBy('ID')
      const expected =await cqn.clone()
      const authors = []
      const books = []
      await cds.tx(async () => {
          for await (const row of cqn.clone()) {
            books.push(row)
            for await (const a of row.author) {
              authors.push(a)
            }
          }
      })
      expect(authors).deep.eq(expected)
      expect(books).deep.eq(expected[0].books)
    })
  })

  describe('raw expand streams', () => {
    xtest('consume to many expand stream', () => cds.tx(async () => {
      const { Authors } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['name'] }, { ref: ['books'], expand: ['*'] }]).from(Authors).orderBy('ID')
      const expected =await cqn.clone()
      const stream = await cqn.clone().stream()
      const authors = JSON.parse(await text(stream))
      expect(authors).deep.eq(expected)
    }))

    xtest('consume to one expand stream', () => cds.tx(async () => {
      const { Books } = cds.entities('complex.associations')
      const cqn = SELECT([{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['author'], expand: ['*'] }]).from(Books).orderBy('ID')
      const expected =await cqn.clone()
      const stream = await cqn.clone().stream()
      const authors = JSON.parse(await text(stream))
      expect(authors).deep.eq(expected)
    }))
  })
})

