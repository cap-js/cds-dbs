const { resolve } = require('path')
const cds = require('../../test/cds.js')

const project = resolve(__dirname, 'beershop')

process.env.DEBUG && jest.setTimeout(100000)

describe('OData to Postgres dialect', () => {
  const { GET, POST, DELETE, expect, data } = cds.test('serve', '--project', project).verbose()

  data.autoIsolation(true)
  data.autoReset(true)

  test('OData: List of entities exposed by the admin service', async () => {
    const response = await GET('/beershop-admin/', {
      auth: {
        username: 'bob',
        password: '',
      },
    })

    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(3)
  })

  test('OData: List of entities exposed by the service', async () => {
    const response = await GET('/beershop/')

    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(4)
  })

  describe('OData admin: CREATE', () => {
    test('odata: entityset Beers -> sql: insert into beers', async () => {
      const response = await POST(
        '/beershop-admin/Beers',
        {
          name: 'Schlappe Seppel',
          ibu: 10,
          abv: '16.2',
        },
        {
          headers: {
            'content-type': 'application/json;charset=UTF-8;IEEE754Compatible=true',
          },
          auth: {
            username: 'bob',
            password: '',
          },
        },
      )

      const now = new Date().toISOString().substring(0, 10)
      expect(response.data.createdAt).to.contain(now)
      expect(response.data.modifiedAt).to.contain(now)
      expect(response.data.createdBy).to.equal('bob')
      expect(response.data.modifiedBy).to.equal('bob')
      expect(response.status).to.equal(201)

      const responseGet = await GET(`/beershop-admin/Beers(${response.data.ID})`, {
        auth: {
          username: 'bob',
          password: '',
        },
      })

      expect(responseGet.status).to.equal(200)
      expect(responseGet.data.createdBy).to.equal('bob')
      expect(responseGet.data.modifiedBy).to.equal('bob')

      const responseDelete = await DELETE(`/beershop-admin/Beers(${response.data.ID})`, {
        auth: {
          username: 'bob',
          password: '',
        },
      })
      expect(responseDelete.status).to.equal(204)
    })
  })
})
