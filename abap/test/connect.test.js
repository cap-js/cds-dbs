const cds = require('../../test/cds.js')

describe('DEBUG', () => {
  // const { data, expect } = cds.test(__dirname + '/../../test/compliance/resources')

  test('...', async () => {
    cds.env.requires.db = require('@cap-js/abap/test/service')
    await cds.connect.to('db')

    const airline = await SELECT.from({ ref: ['Airline'] })
    const passenger = await SELECT.from({ ref: ['Passenger'] })
    const travelAgency = await SELECT.from({ ref: ['TravelAgency'] })

    const limit = await SELECT.from({ ref: ['Airline'] }).limit(1)
    const offset = await SELECT.from({ ref: ['Airline'] })
      .orderBy('AirlineID')
      .limit(1, 1) // offset is only allowed when an oder by clause is provided

    const notnull = await SELECT.from({ ref: ['Airline'] })
      .where`AirlineID != ${{ val: null }}`

    const whereid = await SELECT.from({ ref: ['Airline'] })
      .where`AirlineID = ${'GA'}`

    for (const res of [airline, passenger, travelAgency, limit, offset, notnull, whereid]) {
      for (const row of res) {
        console.log(row)
      }
    }
  })

})
