const { resolve } = require('path')
const cds = require('../../test/cds.js')
if (cds.env.fiori) cds.env.fiori.lean_draft = true
else cds.env.features.lean_draft = true

const project = resolve(__dirname, 'beershop')

process.env.DEBUG && jest.setTimeout(100000)

const guidRegEx = /\b[0-9a-f]{8}\b-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-\b[0-9a-f]{12}\b/

// run test suite with different sets of data
describe('OData to Postgres dialect', () => {
  const { GET, POST, PUT, PATCH, DELETE, expect, data } = cds.test('serve', '--project', project).verbose()

  data.autoIsolation(true)
  data.autoReset(true)

  // making sure we're running the beershop
  // no db connection required
  test('$metadata document', async () => {
    const response = await GET('/beershop/$metadata')

    expect(response.status).to.equal(200)
    const expectedVersion = '<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">'
    const expectedBeersEntitySet = '<EntitySet Name="Beers" EntityType="BeershopService.Beers">'
    expect(response.data.includes(expectedVersion)).to.be.true
    expect(response.data.includes(expectedBeersEntitySet)).to.be.true
  })

  test('List of entities exposed by the service', async () => {
    const response = await GET('/beershop/')

    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(4)
  })

  describe('odata: GET -> sql: SELECT', () => {
    test('odata: entityset Beers -> sql: select all beers', async () => {
      const response = await GET('/beershop/Beers')
      expect(response.status).to.equal(200)
      expect(response.data.value.length).to.equal(11)
      expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
    })

    test('odata: entityset Beers -> sql: select all beers ORDER BY "virtual field"', async () => {
      const response = await GET('/beershop/Beers?$orderby=rating')
      expect(response.status).to.equal(200)
      expect(response.data.value.length).to.equal(11)
      expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
      expect(response.data.value.map(beer => beer.rating)).to.include(undefined)
    })

    test('odata: entityset Beers -> sql: select all beers and count', async () => {
      const response = await GET('/beershop/Beers?$count=true')
      expect(response.status).to.equal(200)
      expect(response.data['@odata.count']).to.equal(11)
    })

    test('odata: entityset Beers -> count only', async () => {
      const response = await GET('/beershop/Beers/$count')
      expect(response.status).to.equal(200)
      expect(response.data).to.equal(11)
    })

    test('odata: single entity -> sql: select record', async () => {
      const response = await GET('/beershop/Beers(9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b)')
      // http response code
      expect(response.status).to.equal(200)
      // the beer
      expect(response.data.ID).to.equal('9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b')
      expect(response.data.name).to.equal('Schönramer Hell')
    })

    test('odata: single entity -> sql: select record containing all entity field keys', async () => {
      // const response = await GET('/beershop/Beers(9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b)')
      await GET('/beershop/Beers(9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b)')
      ;['ID', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy', 'name', 'abv', 'ibu', 'brewery'].forEach(
        property => {
          expect(property).to.exist
          // REVISIT: this ^^^ looks like a pretty useless test
          //> did you mean this?:
          // expect(response).to.have(property)
        },
      )
    })

    test('odata: $select -> sql: select record', async () => {
      const response = await GET('/beershop/Beers(9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b)?$select=name,ibu')
      // http response code
      expect(response.status).to.equal(200)
      // the beer
      expect(response.data.abv).to.be.undefined
      expect(response.data.name).to.equal('Schönramer Hell')
    })

    test('odata: $filter -> sql: select record', async () => {
      const response = await GET("/beershop/Beers?$filter=name eq 'Lagerbier Hell'")

      expect(response.status).to.equal(200)
      expect(response.data.value.length).to.equal(1)
      expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
    })

    test('odata: $filter -> Lambda Operator any', async () => {
      const response = await GET('/beershop/Breweries?$count=true&$filter=beers/any(d:d/abv ge 5)')

      expect(response.status).to.equal(200)
      expect(response.data.value.length).to.equal(4)
      expect(response.data['@odata.count']).to.equal(4)
    })

    // -- wip marker: all of the above work

    test('odata: $filter -> Lambda Operator all', async () => {
      const response = await GET('/beershop/Breweries?$count=true&$filter=beers/all(d:d/abv ge 5)')

      expect(response.status).to.equal(200)
      expect(response.data.value.length).to.equal(2)
      expect(response.data['@odata.count']).to.equal(2)
    })

    test('odata: $expand single entity on 1:1 rel -> sql: sub-select single record from expand-target table', async () => {
      const response = await GET(
        '/beershop/Beers/9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b?$expand=brewery($select=ID,name)',
      )
      expect(response.status).to.equal(200)
      expect(response.data.brewery.ID).to.equal('fa6b959e-3a01-40ef-872e-6030ee4de4e5')
    })
    test('odata: $expand entityset on 1:1 rel -> sql: sub-select from expand-target table', async () => {
      const response = await GET('/beershop/Beers?$expand=brewery($select=ID,name)')
      expect(response.status).to.equal(200)

      const expected = {
        ID: 'fa6b959e-3a01-40ef-872e-6030ee4de4e5',
        name: 'Private Landbrauerei Schönram GmbH & Co. KG',
      }
      const breweries = response.data.value.map(results => results.brewery)
      const found = breweries.filter(brewery => {
        return brewery.ID === expected.ID && brewery.name === expected.name
      })
      expect(found.length).to.equal(1)
    })
    test('odata: $expand entityset on 1:n rel -> sql: sub-select multiple records from expand-target table', async () => {
      const response = await GET('/beershop/Breweries?$expand=beers')
      expect(response.status).to.equal(200)
      expect(response.data.value.length).to.be.greaterThanOrEqual(2) // we have 2 beers
      response.data.value.map(brewery => {
        expect(brewery.beers.length).to.be.greaterThanOrEqual(1) // every brewery has at least 1 beer
        expect(brewery.beers[0].ID).to.match(guidRegEx) // guid
        expect(brewery.beers[0].name).to.match(/\w+/)
      })
    })
    test('odata: $filter on $expand (1:n) -> sql: sub-select matching records from expand-target table', async () => {
      const response = await GET(
        `/beershop/Breweries?$expand=beers($filter=name eq '${encodeURIComponent('Schönramer Hell')}')`,
      )
      expect(response.status).to.equal(200)
      const data = response.data.value
      const augustiner = data.find(brewery => brewery.name.includes('Augustiner'))
      expect(augustiner.beers.length).to.equal(0) // Augustiner doesn't produce Schönramer Hell
      const schoenram = data.find(brewery => brewery.name.includes('Private Landbrauerei'))
      expect(schoenram.beers.length).to.equal(1) // that's where Schönramer Hell is produced
      expect(schoenram.beers.map(beer => beer.name)).to.include('Schönramer Hell')
    })
    test('odata: multiple $ combined: $expand, $filter, $select -> sql: sub-select only selected fields matching records from expand-target table', async () => {
      const response = await GET(
        `/beershop/Breweries?$expand=beers($filter=name eq '${encodeURIComponent(
          'Schönramer Hell',
        )}';$select=name,ibu)`,
      )
      expect(response.status).to.equal(200)
      const data = response.data.value
      const augustiner = data.find(brewery => brewery.name.includes('Augustiner'))
      expect(augustiner.beers.length).to.equal(0) // Augustiner doesn't produce Schönramer Hell
      const schoenram = data.find(brewery => brewery.name.includes('Private Landbrauerei'))
      expect(schoenram.beers.length).to.equal(1) // that's where Schönramer Hell is produced
      // we expect only these fields
      expect(schoenram.beers[0]).to.deep.include({
        name: 'Schönramer Hell',
        ibu: 20,
      })
      expect(schoenram.beers[0].ID).to.match(guidRegEx)
    })
  })

  describe('odata: GET on Draft enabled Entity -> sql: SELECT', () => {
    test('odata: entityset TypeChecksWithDraft -> select all', async () => {
      const response = await GET('/beershop/TypeChecksWithDraft')
      expect(response.status).to.equal(200)
    })
    test('odata: entityset TypeChecksWithDraft -> select all and count', async () => {
      const response = await GET('/beershop/TypeChecksWithDraft?$count=true')
      expect(response.status).to.equal(200)
      expect(response.data['@odata.count']).to.equal(1)
    })
    test('odata: entityset TypeChecksWithDraft -> select like Fiori Elements UI', async () => {
      const response = await GET(
        '/beershop/TypeChecksWithDraft?$count=true&$expand=DraftAdministrativeData&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)&$select=HasActiveEntity,ID,IsActiveEntity,type_Boolean,type_Date,type_Int32&$skip=0&$top=30',
      )
      expect(response.status).to.equal(200)
      expect(response.data['@odata.count']).to.equal(1)
    })

    // REVISIT: Inserts the draft data into the actual table and reads from the _drafts table
    test('odata: create new entityset TypeChecksWithDraft -> create like Fiori Elements UI', async () => {
      const response = await POST(
        '/beershop/TypeChecksWithDraft',
        {},
        {
          headers: {
            Accept: 'application/json;odata.metadata=minimal;IEEE754Compatible=true',
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )

      // Creates:
      // sql > SELECT * FROM BeershopService_TypeChecksWithDraft_drafts ALIAS_1 WHERE ID = $1
      // values >  [ 'c436a286-6d1e-44ad-9630-b09e55b9a61e' ]
      // But this fails with:
      // The key 'ID' does not exist in the given entity
      // the column is created with lowercase id
      expect(response.status).to.equal(201)
    })
  })

  describe('odata: POST -> sql: INSERT', () => {
    test('odata: entityset Beers -> sql: insert into beers', async () => {
      const response = await POST(
        '/beershop/Beers',
        {
          name: 'Schlappe Seppel',
          ibu: 10,
          abv: '16.2',
        },
        {
          headers: {
            Accept: 'application/json;odata.metadata=minimal;IEEE754Compatible=true',
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )

      expect(response.data.createdAt).to.be.a.string
      expect(response.data.modifiedAt).to.be.a.string
      expect(response.data.createdBy).to.be.a.string
      expect(response.data.modifiedBy).to.be.a.string
      expect(response.status).to.equal(201)
    })
  })

  describe('odata: POST -> DEEP INSERT', () => {
    test('odata: deep insert Brewery and beers -> sql: deep insert into Breweries', async () => {
      const response = await POST(
        '/beershop/Breweries',
        {
          name: 'Gluck Fabrik',
          beers: [
            {
              name: 'Glucks Pils',
              ibu: 101,
              abv: '5.2',
            },
            {
              name: 'Glucks Pils Herb',
              ibu: 101,
              abv: '6.2',
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )
      expect(response.data.createdAt).to.be.a.string
      expect(response.data.modifiedAt).to.be.a.string
      expect(response.data.createdBy).to.be.a.string
      expect(response.data.modifiedBy).to.be.a.string
      expect(response.data.beers.length).to.equal(2)
      expect(response.data.beers[0].name).to.equal('Glucks Pils')
      expect(response.data.beers[1].name).to.equal('Glucks Pils Herb')
      expect(response.status).to.equal(201)
    })
  })

  describe('odata: PUT -> sql: UPDATE', () => {
    test('odata: entityset Beers -> sql: update beers', async () => {
      const response = await PUT(
        '/beershop/Beers/9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b',
        {
          name: 'Changed name',
          ibu: 10,
        },
        {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )

      expect(response.status).to.equal(200)

      const getResponse = await GET('/beershop/Beers/9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b')
      expect(getResponse.data).to.include({
        name: 'Changed name',
        ibu: 10,
      })
    })

    test('odata: entityset Beers -> sql: create beer', async () => {
      const initial = await GET(`/beershop/Beers`)
      const guid = initial.data.value[0].ID
      const newBeer = { name: 'Testbier created with PUT', ibu: 15 }
      const response = await PUT(`/beershop/Beers/${guid}`, newBeer, {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
        },
      })
      expect(response.status).to.equal(200)

      const getResponse = await GET(`/beershop/Beers/${guid}`)
      expect(getResponse.data).to.include(newBeer)
      // Cleanup created entry
      await DELETE(`/beershop/Beers/${guid}`)
    })
  })

  describe('odata: DELETE -> sql: DELETE', () => {
    const guid = '9e1704e3-6fd0-4a5d-bfb1-13ac47f7976b'
    test('odata: delete single beer -> sql: delete record', async () => {
      const response = await DELETE(`/beershop/Beers(${guid})`)
      expect(response.status).to.equal(204)

      // make sure the deleted beer doesn't exist anymore
      try {
        await GET(`/beershop/Beers(${guid})`)
      } catch (err) {
        expect(err.message).to.contain('404')
      }
    })
    // reinsert deleted entry to allow further test to run
    afterEach(async () => {
      await POST(
        `/beershop/Beers`,
        {
          ID: guid,
          name: 'Schönramer Hell',
          abv: '5.0',
          ibu: 20,
          brewery_ID: 'fa6b959e-3a01-40ef-872e-6030ee4de4e5',
        },
        {
          headers: {
            Accept: 'application/json;odata.metadata=minimal;IEEE754Compatible=true',
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )
    })
  })
  //> REVISIT: how to do this with cds.test?
  describe.skip('odata: SCHEMAS -> Test user-defined-schema functionality', () => {
    test('odata: entityset Beers -> sql: delete 1 entry from superbeers & confirm 11 entries in public schema', async () => {
      let response = await GET(`/beershop/Beers?$count=true`, { headers: { schema: 'superbeer' } })
      expect(response.status).to.equal(200)
      expect(response.data['@odata.count']).to.equal(11)

      const guid = response.data.value[0].ID
      response = await DELETE(`/beershop/Beers(${guid})`, { headers: { schema: 'superbeer' } })
      expect(response.status).to.equal(204)

      response = await GET(`/beershop/Beers?$count=true`, { headers: { schema: 'superbeer' } })
      expect(response.status).to.equal(200)
      expect(response.data['@odata.count']).to.equal(10)

      response = await GET(`/beershop/Beers?$count=true`, { headers: { schema: 'public' } })
      expect(response.status).to.equal(200)
      expect(response.data['@odata.count']).to.equal(11)
    })
  })
  describe('odata: PATCH -> DEEP UPDATE', () => {
    test('odata: deep update Brewery and beers -> sql: deep update into Breweries', async () => {
      const response = await PATCH(
        '/beershop/Breweries/4aeebbed-90c2-4bdd-aa70-d8eecb8eaebb',
        {
          name: 'Rittmayer Hallerndorfz',
          beers: [
            {
              name: 'Weissen',
              ibu: 55,
              abv: '5.2',
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )
      expect(response.status).to.equal(200)
      // deep update deletes the other beers from Rittmayer Hallerndorf - they have to be restored, otherwise the user-defined-schema test fails
      const restoreReponse = await PATCH(
        '/beershop/Breweries/4aeebbed-90c2-4bdd-aa70-d8eecb8eaebb',
        {
          name: 'Rittmayer Hallerndorf',
          beers: [
            {
              name: 'Hallerndorfer Landbier Hell',
              abv: 4.9,
              ibu: 0,
            },
            {
              name: 'Hallerndorfer Hausbrauerbier',
              abv: 5,
              ibu: 0,
            },
            {
              name: 'Bitter 42',
              abv: 5.5,
              ibu: 42,
            },
            {
              name: 'Summer 69',
              abv: 5.9,
              ibu: 12,
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
        },
      )
      expect(restoreReponse.status).to.equal(200)
    })
  })
})
