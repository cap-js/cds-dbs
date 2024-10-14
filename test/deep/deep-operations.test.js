const cds = require('../cds.js')
cds.test.in(__dirname)

describe('deep operations - expected behavior', () => {
  const { POST, PATCH, DELETE: DEL, test: t } = cds.test()

  beforeEach(t.data.reset)

  // What do we expect? Convenience vs. Surprise
  test.todo('inserts/updates/deletes without deep for all projections')
  test.todo('inserts/updates/deletes with deep but excluding changed compositions')
  
  describe('INSERT', () => {
    test('exposed db entity allows deep insert', async () => {
      const res = await POST('/standard/Travel', { to_Booking: [{ BookingDate: '2050-01-01' }, { BookingDate: '2000-01-01' } ]})
      expect(res.status).toBe(201)

      const { Travel, Booking } = cds.db.entities
      expect(await cds.db.run(SELECT.from(Travel).where({ID: res.data.ID}))).toHaveLength(1)
      expect(await cds.db.run(SELECT.from(Booking).where({to_Travel_ID: res.data.ID}))).toHaveLength(2)
    })

    test('on condition manipulation is rejected on db', async () => {
      const res = await POST('/on-cond/Travel', { to_Booking: [{ BookingDate: '2050-01-01' }], to_Past_Booking: [{ BookingDate: '2000-01-01' }]})
      expect(res.status).toBe(400)
    })
    test('additional projections are rejected on db', async () => {
      const res = await POST('/add-projection/Travel', { to_Booking: [{ BookingDate: '2050-01-01' }], to_Past_Booking: [{ BookingDate: '2000-01-01' }]})
      expect(res.status).toBe(400)
    })
    test('mixins are rejected on db', async () => {
      const res = await POST('/mixin/Travel', { to_Booking: [{ BookingDate: '2050-01-01' }], to_Invoice: [{ total: '1000' }]})
      expect(res.status).toBe(400)
    })
    test('plain travel without compositions - leads to flat insert on db, rejects deep', async () => {
      let res = await POST('/plain-travel/Travel', { Description: 'new trip to moon' })
      expect(res.status).toBe(200)

      res = await POST('/plain-travel/Travel', { to_Booking: [{ BookingDate: '2050-01-01' }]})
      expect(res.status).toBe(400)
    })

    test.todo('on condition manipulation can be handled in custom code')
    test.todo('additional projections can be handled in custom code')
    test.todo('mixins can be handled in custom code')
  })

  describe('DELETE', () => {
    test('exposed db entity allows deep delete', async () => {
      const { Travel, Booking, BookingSupplement } = cds.db.entities
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const IDs = await SELECT.from(Travel).where({ ID: TravelID }).columns('ID', 'to_Booking.ID as bID', 'to_Booking.to_BookSupplement.ID as bsID')


      const res = await DEL('/standard/Travel/' + TravelID, {})
      expect(res.status).toBe(204)

      expect(await SELECT.from(Travel).where({ ID: TravelID })).toHaveLength(0)
      expect(await SELECT.from(Booking).where('ID in', [ ... new Set(IDs.map(x => x.bID)) ])).toHaveLength(0)
      expect(await SELECT.from(BookingSupplement).where('ID in', [ ... new Set(IDs.map(x => x.bsID)) ])).toHaveLength(0)
    })

    test('on condition manipulation is rejected on db', async () => {
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const res = await DEL('/on-cond/Travel/' + TravelID, {})
      expect(res.status).toBe(400)
    })
    test('additional projections are rejected on db', async () => {
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const res = await DEL('/add-projection/Travel/' + TravelID, {})
      expect(res.status).toBe(400)
    })
    test('mixins are rejected on db', async () => {
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const res = await DEL('/mixin/Travel/' + TravelID, {})
      expect(res.status).toBe(400)
    })
    test('plain travel without compositions - leads to deep delete on db', async () => {
      const { Travel, Booking, BookingSupplement } = cds.db.entities
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const IDs = await SELECT.from(Travel).where({ ID: TravelID }).columns('ID', 'to_Booking.ID as bID', 'to_Booking.to_BookSupplement.ID as bsID')


      const res = await DEL('/plain-travel/Travel/' + TravelID, {})
      expect(res.status).toBe(204)

      expect(await SELECT.from(Travel).where({ ID: TravelID })).toHaveLength(0)
      expect(await SELECT.from(Booking).where('ID in', [ ... new Set(IDs.map(x => x.bID)) ])).toHaveLength(0)
      expect(await SELECT.from(BookingSupplement).where('ID in', [ ... new Set(IDs.map(x => x.bsID)) ])).toHaveLength(0)
    })

    test.todo('on condition manipulation can be handled in custom code')
    test.todo('additional projections can be handled in custom code')
    test.todo('mixins can be handled in custom code')
  })

  describe('UPDATE', () => {
    test('exposed db entity allows deep insert', async () => {
      const { Travel, Booking, BookingSupplement } = cds.db.entities
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const res = await PATCH('/standard/Travel/' + TravelID, {
        Description: 'new trip to moon',
        to_Booking: [
          { ID: '004c192d-08ab-44d6-ac42-40120c0e46f4',
            BookingDate: '2090-12-04', // updated
            to_BookSupplement: [] // all booking supplements are deleted
          },
          { ID: '177c1e59-0152-4dd5-9f2f-a4f8ed5c53e3' }, // referenced to stay
          { ID: '11111111-0000-4444-9999-777777777777' } // new booking
        ]
      })
      expect(res.status).toBe(200)

      expect(await SELECT.one.from(Travel).where({ ID: TravelID }).columns('Description')).toMatchObject({ Description: 'new trip to moon'})
      const bookings = await SELECT.from(Booking).where({to_Travel_ID: TravelID})
      expect(bookings).toHaveLength(3)
      expect(bookings.filter(b => b.BookingDate === '2090-12-04')).toHaveLength(1)
      expect(await SELECT.from(BookingSupplement).where({to_Booking_ID: '004c192d-08ab-44d6-ac42-40120c0e46f4'})).toHaveLength(0)
    })

    test('on condition manipulation is rejected on db', async () => {
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const res = await PATCH('/on-cond/Travel/' + TravelID, { to_Booking: [{ BookingDate: '2050-01-01' }], to_Past_Booking: [{ BookingDate: '2000-01-01' }]})
      expect(res.status).toBe(400)
    })
    test('additional projections are rejected on db', async () => {
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const res = await PATCH('/add-projection/Travel/' + TravelID, { to_Booking: [{ BookingDate: '2050-01-01' }], to_Past_Booking: [{ BookingDate: '2000-01-01' }]})
      expect(res.status).toBe(400)
    })
    test('mixins are rejected on db', async () => {
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'
      const res = await PATCH('/mixin/Travel/' + TravelID, { to_Booking: [{ BookingDate: '2050-01-01' }], to_Invoice: [{ total: '1000' }]})
      expect(res.status).toBe(400)
    })
    test('plain travel without compositions - leads to flat update on db, rejects deep', async () => {
      const TravelID = 'e2bf2e81-9077-4771-80c0-03da5f3c6282'

      let res = await PATCH('/plain-travel/Travel/' + TravelID, { Description: 'new trip to moon' })
      expect(res.status).toBe(200)

      res = await PATCH('/plain-travel/Travel/' + TravelID, { to_Booking: [{ BookingDate: '2050-01-01' }]})
      expect(res.status).toBe(400)
    })

    test.todo('on condition manipulation can be handled in custom code')
    test.todo('additional projections can be handled in custom code')
    test.todo('mixins can be handled in custom code')
  })
})