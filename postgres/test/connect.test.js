const { Client } = require('pg')
const PgService = require('../lib/PostgresService')
const { expect } = require('chai')

const cds = require('../../test/cds.js')

process.env.DEBUG && jest.setTimeout(100000)

// fake the manifestation of the db connection
Client.prototype.connect = jest.fn(() => Promise.resolve({}))

describe('connect to pg db', () => {
  test('in docker', async () => {
    cds.env.requires.db = require('@cap-js/postgres/test/service.json')
    const pgService = new PgService()
    pgService.options.credentials = cds.env.requires.db.credentials
    const con = await pgService.factory.create()
    expect(con.host).to.equal(cds.env.requires.db.credentials.host)
    expect(con.user).to.equal(cds.env.requires.db.credentials.user)
    expect(con.database).to.equal(cds.env.requires.db.credentials.database)
    expect(con.ssl).to.equal(false)
  })
  test('for btp pg hyperscaler', async () => {
    cds.env.requires.db = require('@cap-js/postgres/test/service-btp.json')
    const pgService = new PgService()
    pgService.options.credentials = cds.env.requires.db.credentials
    const con = await pgService.factory.create()
    expect(con.host).to.equal(cds.env.requires.db.credentials.hostname)
    expect(con.user).to.equal(cds.env.requires.db.credentials.username)
    expect(con.database).to.equal(cds.env.requires.db.credentials.dbname)
    expect(con.ssl.ca).to.equal(cds.env.requires.db.credentials.sslrootcert)
    expect(con.ssl.rejectUnauthorized).to.be.false
  })
  test('with azure pg compatible settings', async () => {
    cds.env.requires.db = require('@cap-js/postgres/test/service-az.json')
    const pgService = new PgService()
    pgService.options.credentials = cds.env.requires.db.credentials
    const con = await pgService.factory.create()
    expect(con.ssl).to.equal(true)
  })
})
