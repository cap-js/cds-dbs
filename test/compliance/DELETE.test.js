const cds = require('../../test/cds.js')
const Root = 'complex.Root'
const Child = 'complex.Child'
const GrandChild = 'complex.GrandChild'
const RootPWithKeys = 'complex.RootPWithKeys'
const ChildPWithWhere = 'complex.ChildPWithWhere'
const recusiveData = [
  {
    ID: 10,
    fooRoot: 'Another Low Horror',
    parent_ID: 5,
    children: [
      {
        ID: 101,
        fooChild: 'bar',
        children: [
          {
            ID: 102,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 103,
        fooChild: 'foo',
        children: [
          {
            ID: 104,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 11,
    fooRoot: 'Another Medium Horror',
    parent_ID: 10,
    children: [
      {
        ID: 111,
        fooChild: 'bar',
        children: [
          {
            ID: 112,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 113,
        fooChild: 'foo',
        children: [
          {
            ID: 114,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 12,
    fooRoot: 'Another Hard Horror',
    parent_ID: 11,
    children: [
      {
        ID: 121,
        fooChild: 'bar',
        children: [
          {
            ID: 122,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 123,
        fooChild: 'foo',
        children: [
          {
            ID: 124,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 13,
    fooRoot: 'Another Very Hard Horror',
    parent_ID: 11,
    children: [
      {
        ID: 131,
        fooChild: 'bar',
        children: [
          {
            ID: 132,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 133,
        fooChild: 'foo',
        children: [
          {
            ID: 134,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 14,
    fooRoot: 'Another Very Very Hard Horror',
    parent_ID: 12,
    children: [
      {
        ID: 141,
        fooChild: 'bar',
        children: [
          {
            ID: 142,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 143,
        fooChild: 'foo',
        children: [
          {
            ID: 144,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
]

describe('DELETE', () => {
  const { data, expect } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)
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

      test('on root with keys with recursive composition', async () => {
        const insertsResp = await cds.run(INSERT.into(Root).entries(recusiveData))
        expect(insertsResp.affectedRows).to.be.eq(5)

        const deepDelete = await cds.run(DELETE.from(RootPWithKeys).where({ ID: 5 }))
        expect(deepDelete).to.be.eq(1)

        const root = await cds.run(SELECT.from(Root))
        expect(root.length).to.be.eq(0)

        const child = await cds.run(SELECT.from(Child))
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
