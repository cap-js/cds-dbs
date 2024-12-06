/**
 * Transformations of infix filter expressions
 * TODO: Move cluttered tests on filters to this file
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('filter expressions', () => {
  let model
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('on entity ref in from clause', () => {
    it.only('flatten managed assoc to foreign key in filter', () => {
      expect(
        cqn4sql(
          CQL`
          SELECT from bookshop.Books[genre = 1 and genre = ID and ID = genre] { ID }
          `,
          model,
        ),
      ).to.deep.equal(
        CQL`
        SELECT from bookshop.Books as Books { Books.ID }
        where (Books.genre_ID = 1) and Books.genre_ID = Books.ID and Books.ID = Books.genre_ID
        `,
      )
    })
  })
})
