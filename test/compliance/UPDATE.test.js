'use strict'

const cds = require('../cds.js')

describe('UPDATE', () => {
  const { expect } = cds.test(__dirname + '/../bookshop')

  describe('entity', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('data', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('where', () => {
    test('path expressions', async () => {
      const updateEmilysBooks = UPDATE.entity('AdminService.RenameKeys')
                                      .where(`author.name = 'Emily Brontë'`)
                                      .set('ID = 42')
      const selectEmilysBooks = CQL`SELECT * FROM AdminService.RenameKeys where author.name = 'Emily Brontë'`

      await cds.run(updateEmilysBooks)
      const afterUpdate = await cds.run(selectEmilysBooks)
      expect(afterUpdate[0]).to.have.property('foo').that.equals(42)
    })
  })
})
