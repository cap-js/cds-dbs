const cds = require('../../test/cds.js')

describe('ABAP', async () => {

  cds.env.requires.db = require('@cap-js/abap/test/service')
  const { expect } = cds.test(__dirname + '/resources')
  await cds.connect.to('db')

  
  
  test('simple select', async () => {
    const { Passenger } = cds.entities
    const res = await SELECT.from(Passenger);
    expect(res).to.exist
  })

  test('with limit', async () => {
    const { Airline } = cds.entities
    const offset = await SELECT.from(Airline)
      .orderBy('AirlineID')
      .limit(1, 1) // offset is only allowed when an oder by clause is provided
    expect(offset.length).to.equal(1)
  })

  test('where not null', async () => {
    const { TravelAgency } = cds.entities
    const notnull = await SELECT.from(TravelAgency)
      .where`AgencyID != ${{ val: null }}`
    expect(notnull.length).to.equal(50)
  })

  test('where id', async () => {
    const { Airline } = cds.entities
    const whereid = await SELECT.from(Airline)
      .where`AirlineID = ${'GA'}`
    expect(whereid.length).to.equal(1)
  })

  test('join', async () => {
    const { Passenger } = cds.entities
    const res = await SELECT.from(Passenger).columns(
      'CustomerID',
      'FirstName',
      'AgenciesInMyCity.Name as nearbyAgency',
      'City as myCity'
    )
    .where('AgenciesInMyCity.Name is not null')

    expect(res).to.exist
  })

  test('exists', async () => {
    const { Passenger } = cds.entities
    const exists = await SELECT.from(Passenger)
      .where("exists AgenciesInMyCity[City = 'Rome']")
      // TODO: check if we can actually get something useful from the db
    expect(exists).to.exist
  })
})
