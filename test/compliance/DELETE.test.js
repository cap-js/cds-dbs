const cds = require('../../test/cds.js')
const complex = cds.utils.path.resolve(__dirname, '../compliance/resources')
const Root = 'complex.Root'
const Child = 'complex.Child'
const GrandChild = 'complex.GrandChild'
const RootPWithKeys = 'complex.RootPWithKeys'
const RootPNoKeys = 'complex.RootPNoKeys'
const ChildPWithWhere = 'complex.ChildPWithWhere'

describe('DELETE', () => {
  const { expect } = cds.test(complex)
  describe('from', () => {
    describe('deep', () => {
      beforeEach(async () => {
        const inserts = [
          INSERT.into(Root).entries([
            {
              ID: 5,
              fooRoot: 'bar',
              children: [
                {
                  ID: 6,
                  fooChild: 'bar',
                  children: [
                    {
                      ID: 8,
                      fooGrandChild: 'foo',
                    },
                  ],
                },
                {
                  ID: 7,
                  fooChild: 'bar',
                  children: [
                    {
                      ID: 9,
                      fooGrandChild: 'foo',
                    },
                  ],
                },
              ],
            },
          ]),
        ]
        const insertsResp = await cds.run(inserts)
        expect(insertsResp[0].affectedRows).to.be.eq(1)
      })

      test('on root with keys', async () => {
        const deepDelete = await cds.run(DELETE.from(RootPWithKeys).where({ ID: 5 }))
        expect(deepDelete).to.be.eq(1)

        const root = await cds.run(SELECT.one.from(Root).where({ ID: 5 }))
        expect(root).to.not.exist

        const child = await cds.run(SELECT.from(Child).where({ ID: 6, or: { ID: 7 } }))
        expect(child.length).to.be.eq(0)

        const grandchild = await cds.run(SELECT.from(GrandChild).where({ ID: 8, or: { ID: 9 } }))
        expect(grandchild.length).to.be.eq(0)
      })

      test('on root with no keys', async () => {
        const deepDelete = await cds.run(DELETE.from(RootPNoKeys).where({ fooRoot: 'bar' }))
        expect(deepDelete).to.be.eq(1)

        const root = await cds.run(SELECT.one.from(Root).where({ ID: 5 }))
        expect(root).to.not.exist

        const child = await cds.run(SELECT.from(Child).where({ ID: 6, or: { ID: 7 } }))
        expect(child.length).to.be.eq(0)

        const grandchild = await cds.run(SELECT.from(GrandChild).where({ ID: 8, or: { ID: 9 } }))
        expect(grandchild.length).to.be.eq(0)
      })

      test('on child with where', async () => {
        // only delete entries where fooChild = 'bar'
        const deepDelete = await cds.run(DELETE.from(ChildPWithWhere).where({ ID: 6 }))
        expect(deepDelete).to.be.eq(1)

        const child = await cds.run(SELECT.from(Child).where({ ID: 6, or: { ID: 7 } }))
        expect(child[0].ID).to.be.eq(7)

        const grandchild = await cds.run(SELECT.from(GrandChild).where({ ID: 8, or: { ID: 9 } }))
        expect(grandchild[0].ID).to.be.eq(9)
      })
    })

    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  describe('where', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
})
