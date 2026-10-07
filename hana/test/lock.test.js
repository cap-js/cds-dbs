const { tx } = require('@sap/cds')
const cds = require('../../test/cds.js')

describe('locking', () => {
  const { expect } = cds.test(__dirname + '/../../test/compliance/resources')

  describe('forUpdate', async () => {
    test('wait=0', async () => {
      const { Books } = cds.entities('complex.associations.unmanaged')
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
      const { Books } = cds.entities('complex.associations.unmanaged')
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

    describe('ignoreLocked', async () => {
      test('skips rows locked by another transaction, returns the rest', async () => {
        const { Books } = cds.entities('complex.associations.unmanaged')
        await INSERT.into(Books).entries([
          { ID: 8001, title: 'Locked' },
          { ID: 8002, title: 'Free' },
        ])

        let tx1
        try {
          tx1 = cds.tx()
          await tx1.run(SELECT.from(Books).where({ ID: 8001 }).forUpdate({ wait: 0 }))

          const res = await SELECT.from(Books)
            .where({ ID: { in: [8001, 8002] } })
            .forUpdate({ ignoreLocked: true })

          expect(res).length(1)
          expect(res[0].ID).equal(8002)
        } finally {
          await tx1?.rollback()
          await DELETE.from(Books).where({ ID: { in: [8001, 8002] } })
        }
      })

      describe('when the target entity uses a composite key', () => {
        test('returns empty array when all rows are locked', async () => {
          const { keys } = cds.entities('basic.common')

          // Guarantee at least one item is present
          await INSERT.into(keys).entries({ id: 42 })

          let tx1
          try {
            tx1 = cds.tx()
            await tx1.run(SELECT.from(keys).forUpdate({ wait: 0 }))

            const res = await SELECT.from(keys).forUpdate({ ignoreLocked: true })
            expect(res).length(0)
          } finally {
            await tx1?.rollback()
            await DELETE.from(keys).where({ id: 42 })
          }
        })

        test('returns undefined when select does not yield any results ', async () => {
          const { keys } = cds.entities('basic.common')

          // Guarantee no item with id 42 can be found
          await DELETE.from(keys).where({ id: 42 })
          const res = await SELECT.one.from(keys).where({ id: 42 }).forUpdate({ ignoreLocked: true })

          expect(res).undefined
        })
      })
    })
  })
})
