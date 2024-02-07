const cds = require('../../test/cds.js')
const complex = cds.utils.path.resolve(__dirname, '../compliance/resources')
const Root = 'complex.Root'
const GrandChild = 'complex.GrandChild'
const RootWithKeys = 'complex.RootWithKeys'
const RootNoKeys = 'complex.RootNoKeys'
const ChildP = 'complex.ChildP'

describe('DELETE', () => {
  const { expect } = cds.test(complex)
  describe('from', () => {
    describe('deep', () => {

      beforeEach(async () => {
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
      })

      test('on root with keys', async () => {
        const deepDelete = await cds.run(DELETE.from(RootWithKeys).where({ ID: 5 }))
        expect(deepDelete).to.be.eq(1)
  
        const root = await cds.run(SELECT.one.from(RootWithKeys).where({ ID: 5 }))
        expect(root).to.not.exist
  
        const child = await cds.run(SELECT.one.from(ChildP).where({ ID: 6 }))
        expect(child).to.not.exist
  
        const grandchild2 = await cds.run(SELECT.one.from(GrandChild).where({ ID: 7 }))
        expect(grandchild2).to.not.exist
      })
  
      test('on root with no keys', async () => {
        const deepDelete = await cds.run(DELETE.from(RootNoKeys).where({ ID: 5 }))
        expect(deepDelete).to.be.eq(1)
  
        const root = await cds.run(SELECT.one.from(RootNoKeys).where({ ID: 5 }))
        expect(root).to.not.exist
  
        const child = await cds.run(SELECT.one.from(ChildP).where({ ID: 6 }))
        expect(child).to.not.exist
  
        const grandchild2 = await cds.run(SELECT.one.from(GrandChild).where({ ID: 7 }))
        expect(grandchild2).to.not.exist
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
