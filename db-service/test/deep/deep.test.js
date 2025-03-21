const cds = require('../../../test/cds')
const { expect } = cds.test.in(__dirname) // IMPORTANT: that has to go before loading cds.env below
cds.env.features.recursion_depth = 2

const { getDeepQueries } = require('../../lib/deep-queries')

describe('test deep query generation', () => {

  cds.test()
  let model; beforeAll(() => model = cds.model)

  describe('INSERT', () => {
    test('creates sub inserts', () => {
      const query = INSERT.into(model.definitions.Root).entries([
        { ID: 1, toOneChild: { ID: 1 } },
        { ID: 2, toOneChild: { ID: 2, toManySubChild: [{ ID: 10 }] } },
        {
          ID: 3,
          toManyChild: [
            { ID: 3, toManySubChild: [{ ID: 11 }, { ID: 12 }] },
            { ID: 4, toManySubChild: [{ ID: 13 }] },
            { ID: 5, toManyChild: [{ ID: 6 }, { ID: 7 }] },
            { ID: 8, toOneChild: { ID: 9 } },
          ],
        },
      ])
      const { inserts, updates, deletes } = getDeepQueries(query, model.definitions.Root)

      const expectedInserts = {
        [model.definitions.Root.name]: INSERT.into(model.definitions.Root)
          .entries([{ ID: 1 }, { ID: 2 }, { ID: 3 }]),
        [model.definitions.Child.name]: INSERT.into(model.definitions.Child)
          .entries([{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }, { ID: 5 }, { ID: 8 }, { ID: 6 }, { ID: 7 }, { ID: 9 }]),
        [model.definitions.SubChild.name]: INSERT.into(model.definitions.SubChild)
          .entries([{ ID: 10 }, { ID: 11 }, { ID: 12 }, { ID: 13 }]),
      }

      const insertsArray = Array.from(inserts.values())
      const updatesArray = Array.from(updates.values())
      const deletesArray = Array.from(deletes.values())

      insertsArray.forEach(insert => {
        expect(insert).to.deep.containSubset(expectedInserts[insert.target.name])
      })

      expect(updatesArray.length).to.eq(0)
      expect(deletesArray.length).to.eq(0)

    })

    test('backlink keys are properly propagated', async () => {
      const entity = model.definitions['keyAssocs.Header']

      const entry = {
        uniqueName: 'PR1',
        realm: 'dummy',
        l1s: [
          {
            number: 1,
            l2s: [
              {
                percentage: 50.0,
              },
              {
                percentage: 50.0,
              },
            ],
          },
        ],
      }

      const insert = INSERT.into(entity).entries(entry)

      const result = await cds.db.run(insert)
      expect(result > 0).to.eq(true)

      const root = { uniqueName: entry.uniqueName, realm: entry.realm }

      // ensure keys are generated and propagated
      const dbState = await cds.db.run(
        SELECT.one
          .from(entity, h => {
            h`.*`,
              h.l1s(l1 => {
                l1`.*`, l1.l2s('*')
              })
          })
          .where(root),
      )

      const l1s = dbState.l1s
      const l2s = l1s[0].l2s

      expect(dbState).to.containSubset(root)

      expect(l1s).to.containSubset([
        {
          // ID: expect.any(String),
          header_realm: entry.realm,
          header_uniqueName: entry.uniqueName,
        },
      ])

      expect(l2s).to.containSubset([
        {
          // ID: expect.any(String),
          l1_ID: l1s[0].ID,
          l1_header_realm: entry.realm,
          l1_header_uniqueName: entry.uniqueName,
        },
        {
          // ID: expect.any(String),
          l1_ID: l1s[0].ID,
          l1_header_realm: entry.realm,
          l1_header_uniqueName: entry.uniqueName,
        },
      ])
    })
  })
})
