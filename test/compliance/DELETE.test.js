'use strict'

const cds = require('../cds.js')

describe('DELETE', () => {
  cds.test(__dirname + '/resources')

  describe('from', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('where', () => {
    test('path expressions', async () => {
      const deleteEmilysBooks = DELETE.from('complex.RenameKeys').where(`author.name = 'Emily'`)
      const selectEmilysBooks = CQL`SELECT * FROM complex.Books where author.name = 'Emily'`

      const beforeDelete = await cds.run(selectEmilysBooks)
      await cds.run(deleteEmilysBooks)
      const afterDelete = await cds.run(selectEmilysBooks)

      expect(beforeDelete).toHaveLength(1)
      expect(afterDelete).toHaveLength(0)
    })
  })
})
