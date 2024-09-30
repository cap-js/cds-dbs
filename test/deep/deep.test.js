const cds = require('../cds.js')
cds.test.in(__dirname)

const existsOnDB = async () => {

}

describe('deep operations - expected behavior', () => {
  const { POST, PATCH, DELETE: DEL } = cds.test()

  describe('INSERT', () => {
    test('exposed db entity allows deep insert', async () => {
      const res = await POST('/standard/Travel', {})
      expect(res.status).toBe(201)

      // check complete insertion
    })

    test.todo('on condition manipulation is rejected on db')
    test.todo('additional projections are rejected on db')
    test.todo('mixins are rejected on db')

    test.todo('on condition manipulation can be handled in custom code')
    test.todo('additional projections can be handled in custom code')
    test.todo('mixins can be handled in custom code')
  })

  describe('DELETE', () => {
    test('exposed db entity allows deep delete', async () => {
      const res = await DEL('/standard/Travel/xxx', {})
      expect(res.status).toBe(204)

      // check complete deletion
    })

    test.todo('on condition manipulation is rejected on db')
    test.todo('additional projections are rejected on db')
    test.todo('mixins are rejected on db')

    test.todo('on condition manipulation can be handled in custom code')
    test.todo('additional projections can be handled in custom code')
    test.todo('mixins can be handled in custom code')
  })

  describe('UPDATE', () => {
    test('exposed db entity allows deep insert', async () => {
      const res = await PATCH('/standard/Travel/xxx', {})
      expect(res.status).toBe(200)

      // check complete update
    })

    test.todo('on condition manipulation is rejected on db')
    test.todo('additional projections are rejected on db')
    test.todo('mixins are rejected on db')

    test.todo('on condition manipulation can be handled in custom code')
    test.todo('additional projections can be handled in custom code')
    test.todo('mixins can be handled in custom code')
  })
})