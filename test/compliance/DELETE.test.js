'use strict'

const cds = require('../cds.js')
const assert = require('assert')

describe('DELETE', () => {
  cds.test(__dirname + '/../bookshop')

  describe('from', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('where', () => {
    test.skip('path expressions', async () => {
      const deleteEmilysBooks = DELETE.from('AdminService.RenameKeys').where(`author.name = 'Emily Brontë'`)
      const selectEmilysBooks = CQL`SELECT * FROM sap.capire.bookshop.Books where author.name = 'Emily Brontë'`

      const beforeDelete = await cds.run(selectEmilysBooks)
      await cds.run(deleteEmilysBooks)
      const afterDelete = await cds.run(selectEmilysBooks)

      expect(beforeDelete).toHaveLength(1)
      expect(afterDelete).toHaveLength(0)
    })
  })
})
