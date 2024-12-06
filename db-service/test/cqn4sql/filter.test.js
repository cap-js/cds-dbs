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
    it.skip('flatten managed assoc; rhs is the assoc', () => {
      expect(
        cqn4sql(
          CQL`
          SELECT from bookshop.Books[ID = genre] { ID }
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
    it.skip('flatten managed assoc lhs; rhs is val', () => {
      expect(
        cqn4sql(
          CQL`
          SELECT from bookshop.Books[genre = 1] { ID }
          `,
          model,
        ),
      ).to.deep.equal(
        CQL`
        SELECT from bookshop.Books as Books { Books.ID }
        where Books.genre_ID = 1
        `,
      )
    })
    it.skip('flatten managed assoc lhs; rhs is ref', () => {
      expect(
        cqn4sql(
          CQL`
          SELECT from bookshop.Books[genre = ID] { ID }
          `,
          model,
        ),
      ).to.deep.equal(
        CQL`
        SELECT from bookshop.Books as Books { Books.ID }
        where Books.genre_ID = Books.ID
        `,
      )
    })
  })
})
