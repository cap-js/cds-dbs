const cds = require('../../test/cds.js')
const Root = 'complex.Root'
const Child = 'complex.Child'
const GrandChild = 'complex.GrandChild'
const RootPWithKeys = 'complex.RootPWithKeys'
const ChildPWithWhere = 'complex.ChildPWithWhere'

describe('DELETE', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoReset()

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
                      fooGrandChild: 'bar',
                    },
                  ],
                },
                {
                  ID: 7,
                  fooChild: 'foo',
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

      test('on child with where', async () => {
        // only delete entries where fooChild = 'bar'
        const deepDelete = await cds.run(DELETE.from(ChildPWithWhere))
        expect(deepDelete).to.be.eq(1)

        const child = await cds.run(SELECT.from(Child).where({ ID: 6, or: { ID: 7 } }))
        expect(child[0].ID).to.be.eq(7)

        const grandchild = await cds.run(SELECT.from(GrandChild).where({ ID: 8, or: { ID: 9 } }))
        expect(grandchild[0].ID).to.be.eq(9)
      })
    })

    test('ref', async () => {
      const { Authors } = cds.entities('complex.associations')
      await INSERT.into(Authors).entries(new Array(9).fill().map((e, i) => ({ ID: 100 + i, name: 'name' + i })))
      const changes = await cds.run(DELETE.from(Authors))
      expect(changes | 0).to.be.eq(10, 'Ensure that all rows are affected') // 1 from csv, 9 newly added
    })
  })

  describe('where', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  test('affected rows', async () => {
    const affectedRows = await DELETE.from('complex.associations.Books').where('ID = 4712')
    expect(affectedRows).to.be.eq(0)
  })
})
