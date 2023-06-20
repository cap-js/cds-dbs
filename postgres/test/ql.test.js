const cds = require('../../test/cds.js')
if (cds.env.fiori) cds.env.fiori.lean_draft = true
else cds.env.features.lean_draft = true

const project = require('path').resolve(__dirname, 'beershop')

process.env.DEBUG && jest.setTimeout(100000)

describe('QL to PostgreSQL', () => {
  const { expect, data } = cds.test('serve', '--project', project).verbose()

  data.autoIsolation(true)
  data.autoReset(true)

  describe('SELECT', () => {
    test('-> with from', async () => {
      const { Beers } = cds.entities('csw')
      const beers = await cds.run(SELECT.from(Beers))
      expect(beers.length).to.equal(11)
      expect(beers.map(beer => beer.name)).to.include('Lagerbier Hell')
    })

    test('-> with from and limit', async () => {
      const { Beers } = cds.entities('csw')
      const beers = await cds.run(SELECT.from(Beers).limit(1))
      expect(beers.length).to.equal(1)
    })

    test('-> with one and where', async () => {
      const { Beers } = cds.entities('csw')
      const beer = await cds.run(SELECT.one(Beers).where({ ID: '9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b' }))
      expect(beer).to.have.property('ID', '9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b')
    })

    test('-> with one, columns and where', async () => {
      const { Beers } = cds.entities('csw')
      const beer = await cds.run(
        SELECT.one(Beers).columns(['ID', 'name']).where({ ID: '9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b' }),
      )
      expect(beer).to.have.property('ID', '9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b')
      expect(beer).not.to.have.property('abv')
    })

    test('-> with one - no result returns undefined not empty array', async () => {
      const { Beers } = cds.entities('csw')
      const beer = await cds.run(SELECT.one(Beers).where({ name: 'does not exist' }))
      expect(beer).to.not.be.an.instanceof(Array)
      expect(beer).to.be.undefined
    })

    test('-> with distinct', async () => {
      const { Beers } = cds.entities('csw')
      const results = await cds.run(SELECT.distinct.from(Beers).columns('abv'))
      expect(results.length).to.equal(6)
      const otherResults = await cds.run(SELECT.distinct.from(Beers).columns('abv', 'ibu'))
      expect(otherResults.length).to.equal(9)
    })

    test('-> with orderBy', async () => {
      const { Beers } = cds.entities('csw')
      const beers = await cds.run(
        SELECT.from(Beers)
          .where({ abv: { '>': 1.0 } })
          .orderBy({ abv: 'desc' }),
      )
      expect(beers[0].abv).to.equal(5.9)
      const reverseBeers = await cds.run(
        SELECT.from(Beers)
          .where({ abv: { '>': 1.0 } })
          .orderBy({ abv: 'asc' }),
      )
      expect(reverseBeers[0].abv).to.equal(4.9)
    })

    test('-> with groupBy', async () => {
      const { Beers } = cds.entities('csw')
      const results = await cds.run(SELECT.from(Beers).columns('count(*) as count', 'brewery_ID').groupBy('brewery_ID'))
      expect(results.length).to.equal(6)
    })

    test('-> with having', async () => {
      const { Beers } = cds.entities('csw')
      const results = await cds.run(
        SELECT.from(Beers).columns('brewery_ID').groupBy('brewery_ID').having('count(*) >=', 2),
      )
      expect(results.length).to.equal(3)
    })

    test('-> with joins', async () => {
      const { Beers } = cds.entities('csw')
      const results = await cds.run(
        SELECT.from(Beers, b => {
          b`.*`,
            b.brewery(br => {
              br`.*`
            })
        }).where({ brewery_ID: '4aeebbed-90c2-4bdd-aa70-d8eecb8eaebb' }),
      )
      expect(results[0].brewery).to.have.property('name', 'Rittmayer Hallerndorf')
      expect(results.length).to.equal(4)
    })
    test('-> case of the query result', async () => {
      const { TypeChecks } = cds.entities('csw')
      const results = await cds.run(SELECT.one.from(TypeChecks))
      expect(results).to.have.property('type_Boolean')
    })
  })

  describe('INSERT', () => {
    test('-> by using entries', async () => {
      const { Beers } = cds.entities('csw')

      const beers = await cds.run(INSERT.into(Beers).entries([{ name: 'Test' }, { name: 'Test1' }]))

      expect(beers.affectedRows).to.equal(2)

      const beer = await cds.run(SELECT.one(Beers).where({ name: 'Test1' }))
      expect(beer).to.have.property('name', 'Test1')
    })

    test('-> by using columns and rows', async () => {
      const { Beers } = cds.entities('csw')

      const beers = await cds.run(
        INSERT.into(Beers)
          .columns(['ID', 'name'])
          .rows([cds.utils.uuid(), 'Beer 1'], [cds.utils.uuid(), 'Beer 2'], [cds.utils.uuid(), 'Beer 3']),
      )

      expect(beers.affectedRows).to.equal(3)

      const beer = await cds.run(SELECT.one(Beers).where({ name: 'Beer 2' }))
      expect(beer).to.have.property('name', 'Beer 2')
    })

    test('-> by using columns and values', async () => {
      const { Beers } = cds.entities('csw')

      const beers = await cds.run(INSERT.into(Beers).columns(['ID', 'name']).values([cds.utils.uuid(), 'Test']))

      expect(beers.affectedRows).to.equal(1)

      const beer = await cds.run(SELECT.one(Beers).where({ name: 'Test' }))
      expect(beer).to.have.property('name', 'Test')
    })

    // see https://cap.cloud.sap/docs/node.js/databases#insertresult-beta and https://answers.sap.com/questions/13569793/api-of-insert-query-results-for-cap-nodejs.html
    test('-> with InsertResult Beta API', async () => {
      const { Beers } = cds.entities('csw')

      const entries = [
        { name: 'Beer1', abv: 1.0, ibu: 1, brewery_ID: '0465e9ca-6255-4f5c-b8ba-7439531f8d28' },
        { name: 'Beer2', abv: 2.0, ibu: 2, brewery_ID: '0465e9ca-6255-4f5c-b8ba-7439531f8d28' },
        { name: 'Beer3', abv: 3.0, ibu: 3, brewery_ID: '0465e9ca-6255-4f5c-b8ba-7439531f8d28' },
      ]

      const uuidRegex = /[\d|a-f]{8}-[\d|a-f]{4}-[\d|a-f]{4}-[\d|a-f]{4}-[\d|a-f]{12}/

      const insertResult = await cds.run(INSERT.into(Beers).entries(entries))
      expect(insertResult.affectedRows).to.equal(3)
      expect(insertResult == 3).to.equal(true)
      expect(insertResult.valueOf()).to.equal(insertResult.affectedRows)

      const beers = [...insertResult] //> this calls the [Symbol.iterator] method of the insert result
      expect(beers.length).to.equal(3)
      beers.forEach(beer => {
        expect(beer.ID).to.match(uuidRegex)
      })
    })
  })

  describe('UPDATE', () => {
    test('-> Get affected rows ', async () => {
      const { Beers } = cds.entities('csw')
      const affectedRows = await cds.run(
        UPDATE(Beers).set({ name: 'TEST' }).where({ ID: '9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b' }),
      )
      expect(affectedRows).to.equal(1)
    })

    test('-> multiple rows', async () => {
      const { Beers } = cds.entities('csw')
      const affectedRows = await cds.run(UPDATE(Beers).set({ abv: 1.0 }))
      expect(affectedRows).to.equal(11)
    })
  })
})
