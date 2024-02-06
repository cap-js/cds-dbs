const cds = require('../../test/cds.js')
const complex = cds.utils.path.resolve(__dirname, '../compliance/resources')
const Root = 'complex.Root'
const GrandChild = 'complex.GrandChild'
const RootP = 'complex.RootP'
const ChildP = 'complex.ChildP'

describe('DELETE', () => {
  const { expect } = cds.test(complex)
  describe('from', () => {
    test('deep delete', async () => {
      const inserts = [
        INSERT.into(Root).entries([
          {
            ID: 5,
            children: [
              {
                ID: 6,
                children: [
                  {
                    ID: 7,
                  },
                ],
              },
            ],
          },
        ]),
      ]
      const insertsResp = await cds.run(inserts)
      expect(insertsResp[0].affectedRows).to.be.eq(1)

      //const deepDelete = await DELETE('/comp/RootP(5)')
      const deepDelete = await cds.run(DELETE.from(RootP).where({ ID: 5 }))
      expect(deepDelete).to.be.eq(1)

      //const root2 = await GET('/comp/RootP')
      const root = await cds.run(SELECT.one.from(RootP).where({ ID: 5 }))
      expect(root).to.be.eq(undefined)

      //const child2 = await GET('/comp/ChildP')
      const child = await cds.run(SELECT.one.from(ChildP).where({ ID: 6 }))
      expect(child).to.be.eq(undefined)

      const grandchild2 = await cds.run(SELECT.from(GrandChild))
      expect(grandchild2.length).to.be.eq(0)
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
