const cds = require('../../test/cds.js')

describe('DEBUG', async () => {
  const { expect } = cds.test(__dirname +'/resources')

  cds.env.requires.db = require('@cap-js/abap/test/service')
  await cds.connect.to('db')
  
  
  test('simple select', async () => {
    const  { Airline } = cds.entities
    const airline = await SELECT.from(Airline)
    expect(airline).to.exist
  })

  test('with limit', async () => {
    const  { Airline } = cds.entities
    const offset = await SELECT.from(Airline)
      .orderBy('AirlineID')
      .limit(1, 1) // offset is only allowed when an oder by clause is provided
    expect(offset.length).to.equal(1)
  })

  test('where not null', async () => {
    const  { Airline } = cds.entities
    const notnull = await SELECT.from(Airline)
      .where`AirlineID != ${{ val: null }}`
    expect(notnull.length).to.equal(5)
  })

  test('where id', async () => {
    const  { Airline } = cds.entities
    const whereid = await SELECT.from(Airline)
      .where`AirlineID = ${'GA'}`
    expect(whereid.length).to.equal(1)
  })


})
