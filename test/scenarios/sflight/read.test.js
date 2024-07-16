process.env.cds_requires_db_kind = 'better-sqlite'
const cds = require('../../cds.js')

// REVISIT: @capire/sflight tests don't expect IEEE754 compliance responses, but do send the IEE754 header according to the test
// As it is not possible to configure the IEEE754 flag for @cap-js/hana it is required to inject this configurable:true
// As the cqn2sql output converter injection doesn't allow for it to be overwritten at a later stage, but configurable will stay true
Object.defineProperty(cds.builtin.types.Decimal.constructor.prototype, "CQN2HANA:convertOutput", { value: a => a, configurable: true })

// IMPORTANT: Wrapping that in beforeAll to avoid loading cds.env before cds.test()
beforeAll(() => {
  if (cds.env.fiori) cds.env.fiori.lean_draft = true
  else cds.env.features.lean_draft = true
})

describe('SFlight - Read', () => {
  // Jest require.resolve does not want to find @capire/sflight
  const { expect, GET, axios } = cds.test('@capire/sflight')
  axios.defaults.auth = { username: 'alice', password: 'admin' }

  beforeAll(async () => {
    Object.defineProperty(cds.builtin.types.Decimal.constructor.prototype, "CQN2HANA:convertOutput", { value: a => a })
  })

  const processorPaths = [
    // 'Travel?$count=true&$orderby=TravelID desc&$filter=(IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null)&$expand=DraftAdministrativeData,TravelStatus,to_Agency,to_Customer&$skip=0&$top=30',
    'Travel',
    'Currencies',
    'TravelStatus',
    'TravelAgency',
    'Passenger',
    'Countries',
    'BookingStatus',
    'Airline',
    'Flight',
    'Supplement',
    'FlightConnection',
    'SupplementType',
    'Airport',
  ]

  test.each(processorPaths)('/processor/%s', async p => {
    const res = await GET(`/processor/${p}${p.indexOf('?') > -1 ? '' : '?$top=1'}`)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
  })

  const analyticsPaths = [
    /** Requests from the initial page load */
    'Bookings?$orderby=FlightDate&$apply=groupby((FlightDate),aggregate(ID with countdistinct as countBookings))&$skip=0&$top=1',
    'Bookings?$orderby=countBookings desc&$apply=groupby((status,statusName),aggregate(ID with countdistinct as countBookings))&$skip=0&$top=1',
    'Bookings?$orderby=countBookings desc&$apply=groupby((airline,airlineName),aggregate(ID with countdistinct as countBookings))&$skip=0&$top=1',
    'Bookings?$apply=aggregate(FlightPrice,CurrencyCode_code)&$filter=FlightPrice ne 0&$skip=0&$top=1',
    // REVISIT: works in sflight not in tests
    // 'Bookings?$apply=concat(groupby((BookingID,ConnectionID,CurrencyCode_code,FlightDate,ID,TravelID,airline,status))/aggregate($count%20as%20UI5__leaves),aggregate(FlightPrice,CurrencyCode_code),groupby((airline,airlineName),aggregate(FlightPrice,CurrencyCode_code))/concat(aggregate($count%20as%20UI5__count),top(53)))',
    'Bookings?$apply=groupby((airline,airlineName),aggregate(FlightPrice with average as avgPrice,FlightPrice with max as maxPrice,FlightPrice with min as minPrice))&$skip=0&$top=1',
    `Bookings?$apply=filter(airline eq 'EA' and status eq 'B')/groupby((ID),aggregate(FlightPrice,CurrencyCode_code))&$count=true&$skip=0&$top=1`
  ]

  test.each(analyticsPaths)('/analytics/%s', async p => {
    const res = await GET(`/analytics/${p}${p.indexOf('?') > -1 ? '' : '?$top=1'}`)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
  })
})
