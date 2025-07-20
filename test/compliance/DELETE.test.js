const cds = require('../../test/cds.js')
const Root = 'complex.Root'
const Child = 'complex.Child'
const GrandChild = 'complex.GrandChild'
const RootPWithKeys = 'complex.RootPWithKeys'
const ChildPWithWhere = 'complex.ChildPWithWhere'
const recusiveData = [
  {
    ID: 10,
    fooRoot: 'Horror',
    children: [
      {
        ID: 101,
        fooChild: 'bar',
        children: [
          {
            ID: 1011,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 102,
        fooChild: 'foo',
        children: [
          {
            ID: 1021,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
    recursiveToOne: {
      ID: 103,
      fooRoot: 'Recursive to one Horror',
      children: [
        {
          ID: 1031,
          fooChild: 'bar',
          children: [
            {
              ID: 10311,
              fooGrandChild: 'bar',
            },
          ],
          recursiveToOne: {
            ID: 10312,
            fooRoot: 'Recursive to one Horror 2',
          },
        },
      ],
    },
  },
  {
    ID: 11,
    fooRoot: 'Low Horror',
    parent_ID: 10,
    children: [
      {
        ID: 111,
        fooChild: 'bar',
        children: [
          {
            ID: 1111,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 112,
        fooChild: 'foo',
        children: [
          {
            ID: 1121,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 12,
    fooRoot: 'Medium Horror',
    parent_ID: 11,
    children: [
      {
        ID: 121,
        fooChild: 'bar',
        children: [
          {
            ID: 1211,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 122,
        fooChild: 'foo',
        children: [
          {
            ID: 1221,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 13,
    fooRoot: 'Hard Horror',
    parent_ID: 11,
    children: [
      {
        ID: 131,
        fooChild: 'bar',
        children: [
          {
            ID: 1311,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 1312,
        fooChild: 'foo',
        children: [
          {
            ID: 13121,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 14,
    fooRoot: 'Very Hard Horror',
    parent_ID: 12,
    children: [
      {
        ID: 141,
        fooChild: 'bar',
        children: [
          {
            ID: 1411,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 142,
        fooChild: 'foo',
        children: [
          {
            ID: 1421,
            fooGrandChild: 'foo',
          },
        ],
      },
    ],
  },
  {
    ID: 15,
    fooRoot: 'Very Very Hard Horror',
    parent_ID: 14,
    children: [
      {
        ID: 151,
        fooChild: 'bar',
        children: [
          {
            ID: 1511,
            fooGrandChild: 'bar',
          },
        ],
      },
      {
        ID: 152,
        fooChild: 'foo',
        children: [
          {
            ID: 1521,
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
        const { RootPWithKeys: RootAPWithKeys, Root: RootA, Child: ChildA, GrandChild: GrandChildA } = cds.entities('complex.associations')
        const insertsResp = await cds.run(INSERT.into(RootA).entries(recusiveData))
        expect(insertsResp.affectedRows).to.be.eq(6)

        const deepDelete = await cds.run(DELETE.from(RootAPWithKeys).where({ ID: 10 }))
        expect(deepDelete).to.be.eq(1)

        const root = await cds.run(SELECT.from(RootA))
        expect(root.length).to.be.eq(0)

        const child = await cds.run(SELECT.from(ChildA))
        expect(child.length).to.be.eq(0)

        const grandchild = await cds.run(SELECT.from(GrandChildA).where({ ID: 8, or: { ID: 9 } }))
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
      const { Child } = cds.entities('complex.associations')
      await INSERT.into(Child).entries(new Array(9).fill().map((e, i) => ({ ID: 100 + i, fooChild: 'fooChild100' + i })))
      const changes = await cds.run(DELETE.from(Child))
      expect(changes | 0).to.be.eq(9, 'Ensure that all rows are affected')
    })
  })

  describe('where', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })

  test('affected rows', async () => {
    const affectedRows = await DELETE.from('complex.associations.Root').where('ID = 4712')
    expect(affectedRows).to.be.eq(0)
  })
})
