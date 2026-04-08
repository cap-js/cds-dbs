const { tx } = require('@sap/cds')
const cds = require('../../test/cds.js')

describe('locking', () => {
  const { expect } = cds.test(__dirname + '/../../test/bookshop')

  describe('forUpdate', async () => {

    test('wait=0', async () => {
      const { Books } = cds.entities
      let tx1, tx2
      try {
        tx1 = await cds.tx()
        tx2 = await cds.tx()
        const query = cds.ql.SELECT.from(Books).forUpdate({ wait: 0 })

        await tx1.run(query)
        await expect(tx2.run(query)).rejected
      } finally {
        await tx1?.rollback()
        await tx2?.rollback()
      }
    })

    test('wait>0', async () => {
      const { Books } = cds.entities
      let tx1, tx2
      try {
        tx1 = await cds.tx()
        tx2 = await cds.tx()
        const query = cds.ql.SELECT.from(Books).forUpdate({ wait: 1 })

        await tx2.run(INSERT({ ID: 999 }).into(Books))

        await tx1.run(query)

        await expect(tx2.run(query)).rejected

        await tx2.commit()
        await tx1.commit()

        const res = await cds.ql.SELECT.from(Books).where({ ID: 999 })
        expect(res).length(0)
      } finally {
        await tx1?.rollback()
        await tx2?.rollback()
      }
    })

  })
})