const cds = require('../../test/cds.js')
const complex = cds.utils.path.resolve(__dirname, '../compliance/resources')
const Root = 'complex.Root'
const GrandChild = 'complex.GrandChild'

describe('DELETE', () => {
  const { expect, GET, DELETE } = cds.test(complex)
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

      const deepDelete = await DELETE('/comp/RootP(5)')
      expect(deepDelete.status).to.be.eq(204)

      const root2 = await GET('/comp/RootP')
      expect(root2.status).to.be.eq(200)
      expect(root2.data.value.length).to.be.eq(0)

      const child2 = await GET('/comp/ChildP')
      expect(child2.status).to.be.eq(200)
      expect(child2.data.value.length).to.be.eq(0)

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
