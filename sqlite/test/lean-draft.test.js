const NEW_DRAFT_TRAVELUUID = '11111111111111111111111111111111'
const EDIT_DRAFT_TRAVELUUID = '71657221A8E4645C17002DF03754AB66'
const cds = require('../../test/cds.js')

describe('draft tests', () => {

  const { GET, POST, PATCH, DELETE, expect } = cds.test('@capire/sflight')

  process.env.cds_requires_db_kind = 'better-sqlite'
  process.env.cds_requires_auth_kind = 'mocked-auth'

  if (cds.env.fiori) cds.env.fiori.lean_draft = cds.env.fiori.draft_compat = true
  else cds.env.features.lean_draft = cds.env.features.lean_draft_compatibility = true

  cds.requires.auth.users = {
    user1: { password: 'user1', roles: ['processor'] },
    user2: { password: 'user2', roles: ['processor'] },
  }

  beforeEach(async () => {
    await Promise.allSettled([
      DELETE(`/processor/Travel(TravelUUID='${NEW_DRAFT_TRAVELUUID}',IsActiveEntity=false)`, {
        auth: { username: 'user1', password: 'user1' },
      }),
      DELETE(`/processor/Travel(TravelUUID='${NEW_DRAFT_TRAVELUUID}',IsActiveEntity=false)`, {
        auth: { username: 'user2', password: 'user2' },
      }),
    ])
    await Promise.allSettled([
      DELETE(`/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=false)`, {
        auth: { username: 'user1', password: 'user1' },
      }),
      DELETE(`/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=false)`, {
        auth: { username: 'user2', password: 'user2' },
      }),
    ])
  })

  test('all', async () => {
    const res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data['@odata.count']).to.be.greaterThan(100)
    res.data.value.forEach(row => {
      expect(row.IsActiveEntity).to.be.eq(true)
      expect(row.HasActiveEntity).to.be.eq(false)
      expect(row.HasDraftEntity).to.be.eq(false)
      expect(row.DraftAdministrativeData).to.be.eq(null)
    })
  })

  test('forbidden orderby and filter in all', async () => {
    const res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=HasDraftEntity,HasActiveEntity,IsActiveEntity,TravelID%20desc&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null) and HasActiveEntity eq true and IsActiveEntity eq false and HasDraftEntity eq true&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data['@odata.count']).to.be.greaterThan(100)
    res.data.value.forEach(row => {
      expect(row.IsActiveEntity).to.be.eq(true)
      expect(row.HasActiveEntity).to.be.eq(false)
      expect(row.HasDraftEntity).to.be.eq(false)
      expect(row.DraftAdministrativeData).to.be.eq(null)
    })
  })

  test('new then all', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data['@odata.count']).to.be.greaterThan(100)
  })

  test('edit then all', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data['@odata.count']).to.be.greaterThan(100)
  })

  test('edit user2 then all', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user2', password: 'user2' } },
    )
    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data['@odata.count']).to.be.greaterThan(100)
    let firstRow = res.data.value[0]
    expect(firstRow.IsActiveEntity).to.be.eq(true)
    expect(firstRow.HasActiveEntity).to.be.eq(false)
    expect(firstRow.HasDraftEntity).to.be.eq(false)

    res = await GET(
      `/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)%20and%20TravelUUID%20eq%20'${EDIT_DRAFT_TRAVELUUID}'&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30`,
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data['@odata.count']).to.be.eq(1)
    firstRow = res.data.value[0]
    expect(firstRow.IsActiveEntity).to.be.eq(true)
    expect(firstRow.HasActiveEntity).to.be.eq(false)
    expect(firstRow.HasDraftEntity).to.be.eq(true)
    expect(firstRow.DraftAdministrativeData.DraftUUID).to.be.a('string')
  })

  test('all hiding drafts', async () => {
    const res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    res.data.value.forEach(row => {
      expect(row.IsActiveEntity).to.be.eq(true)
      expect(row.HasActiveEntity).to.be.eq(false)
      expect(row.HasDraftEntity).to.be.eq(false)
      expect(row.DraftAdministrativeData).to.be.eq(null)
    })
    expect(res.data.value.length).to.be.eq(30)
  })

  test('new then all hiding drafts', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    res.data.value.forEach(row => {
      expect(row.IsActiveEntity).to.be.eq(true)
      expect(row.HasActiveEntity).to.be.eq(false)
      expect(row.HasDraftEntity).to.be.eq(false)
      expect(row.DraftAdministrativeData).to.be.eq(null)
    })
    expect(res.data.value.length).to.be.eq(30)
  })

  test('edit then all hiding drafts', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    res.data.value.forEach(row => {
      expect(row.IsActiveEntity).to.be.eq(true)
      expect(row.HasActiveEntity).to.be.eq(false)
      expect(row.HasDraftEntity).to.be.eq(false)
      expect(row.DraftAdministrativeData).to.be.eq(null)
    })
    expect(res.data.value.length).to.be.eq(30)
  })

  test('own draft', async () => {
    const res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20false&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('new then own draft', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )

    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20false&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0]).to.containSubset({
      BeginDate: null,
      BookingFee: null,
      CurrencyCode_code: null,
      Description: null,
      EndDate: null,
      HasActiveEntity: false,
      TotalPrice: null,
      TravelID: 0,
      TravelStatus_code: 'O',
      TravelUUID: '11111111111111111111111111111111',
      to_Agency_AgencyID: null,
      to_Customer_CustomerID: null,
      DraftAdministrativeData: {
        InProcessByUser: 'user1',
        LastChangedByUser: 'user1',
      },
      TravelStatus: { code: 'O', name: 'Open' },
      to_Agency: null,
      to_Customer: null,
      IsActiveEntity: false,
      HasDraftEntity: false,
    })
    expect(res.data.value[0].DraftAdministrativeData.DraftUUID).to.be.a('string')
  })

  test('edit then own draft', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )

    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20false&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0]).to.containSubset({
      BeginDate: '2023-08-04',
      BookingFee: 90,
      CurrencyCode_code: 'USD',
      Description: 'Vacation to USA',
      EndDate: '2024-05-31',
      HasActiveEntity: true,
      // TotalPrice: 5624,
      // TravelID: 32,
      TravelStatus_code: 'O',
      TravelUUID: '71657221A8E4645C17002DF03754AB66',
      to_Agency_AgencyID: '070022',
      to_Customer_CustomerID: '000506',
      DraftAdministrativeData: {
        InProcessByUser: 'user1',
        LastChangedByUser: 'user1',
      },
      TravelStatus: { code: 'O', name: 'Open' },
      to_Agency: { AgencyID: '070022', Name: 'Caribian Dreams' },
      to_Customer: { CustomerID: '000506', LastName: 'Moyano' },
      IsActiveEntity: false,
      HasDraftEntity: false,
    })
    expect(res.data.value[0].DraftAdministrativeData.DraftUUID).to.be.a('string')
  })

  test('new user2 then own draft', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user2', password: 'user2' } },
    )

    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20false&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('edit user2 then own draft', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user2', password: 'user2' } },
    )

    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20false&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('locked by another user', async () => {
    const res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20ne%20''%20and%20DraftAdministrativeData/InProcessByUser%20ne%20null&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('new then locked by another user', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20ne%20''%20and%20DraftAdministrativeData/InProcessByUser%20ne%20null&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('new user2 then locked by another user', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user2', password: 'user2' } },
    )
    res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20ne%20''%20and%20DraftAdministrativeData/InProcessByUser%20ne%20null&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('edit then locked by another user', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20ne%20''%20and%20DraftAdministrativeData/InProcessByUser%20ne%20null&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('edit user2 then locked by another user', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user2', password: 'user2' } },
    )
    res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20ne%20''%20and%20DraftAdministrativeData/InProcessByUser%20ne%20null&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0]).to.containSubset({
      BeginDate: '2023-08-04',
      BookingFee: 90,
      CurrencyCode_code: 'USD',
      Description: 'Vacation to USA',
      EndDate: '2024-05-31',
      TotalPrice: 5624,
      TravelID: 32,
      TravelStatus_code: 'O',
      TravelUUID: EDIT_DRAFT_TRAVELUUID,
      to_Agency_AgencyID: '070022',
      to_Customer_CustomerID: '000506',
      TravelStatus: { code: 'O', name: 'Open' },
      to_Agency: { AgencyID: '070022', Name: 'Caribian Dreams' },
      to_Customer: { CustomerID: '000506', LastName: 'Moyano' },
      DraftAdministrativeData: {
        InProcessByUser: 'user2',
        LastChangedByUser: 'user2',
      },
      IsActiveEntity: true,
      HasDraftEntity: true,
      HasActiveEntity: false,
    })
    expect(res.data.value[0].DraftAdministrativeData.DraftUUID).to.be.a('string')
  })

  test('unsaved changes by another user', async () => {
    const res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20eq%20''&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('new user2 then unsaved changes by another user', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user2', password: 'user2' } },
    )
    res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20eq%20''&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)
  })

  test('edit user2 then unsaved changes by another user', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user2', password: 'user2' } },
    )
    const DraftUUID = res.data.DraftAdministrativeData.DraftUUID

    res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20eq%20''&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(0)

    // age the draft to simulate lock timeout
    await cds.db
      .update('DRAFT.DraftAdministrativeData')
      .set({ LastChangeDateTime: '1970-01-01T00:00:00.000Z' })
      .where({ DraftUUID })

    res = await GET(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=false)/DraftAdministrativeData`,
      { auth: { username: 'user2', password: 'user2' } },
    )
    expect(res.data.InProcessByUser).to.be.eq('')
    res = await GET(
      "/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20SiblingEntity/IsActiveEntity%20eq%20null%20and%20DraftAdministrativeData/InProcessByUser%20eq%20''&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.value.length).to.be.eq(1)
  })

  test('unchanged', async () => {
    const res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20HasDraftEntity%20eq%20false&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data.value[0]).to.containSubset({
      BeginDate: '2024-05-30',
      BookingFee: 20,
      CurrencyCode_code: 'USD',
      Description: 'Sightseeing in New York City, New York',
      EndDate: '2024-05-30',
      TotalPrice: 7375,
      TravelID: 4133,
      TravelStatus_code: 'A',
      TravelUUID: '76757221A8E4645C17002DF03754AB66',
      to_Agency_AgencyID: '070028',
      to_Customer_CustomerID: '000115',
      TravelStatus: { code: 'A', name: 'Accepted' },
      to_Agency: { AgencyID: '070028', Name: 'Aussie Travel' },
      to_Customer: { CustomerID: '000115', LastName: 'Benz' },
      IsActiveEntity: true,
      HasActiveEntity: false,
      HasDraftEntity: false,
      DraftAdministrativeData: null,
    })
    for (const row of res.data.value.slice(1)) {
      expect(row.IsActiveEntity).to.be.eq(true)
      expect(row.HasActiveEntity).to.be.eq(false)
      expect(row.HasDraftEntity).to.be.eq(false)
    }
  })

  test('new then unchanged', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await GET(
      '/processor/Travel?$count=true&$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$orderby=TravelID%20desc&$filter=IsActiveEntity%20eq%20true%20and%20HasDraftEntity%20eq%20false&$expand=DraftAdministrativeData($select=DraftUUID,InProcessByUser,LastChangedByUser),TravelStatus($select=code,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=30',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    for (const row of res.data.value) {
      expect(row.IsActiveEntity).to.be.eq(true)
      expect(row.HasActiveEntity).to.be.eq(false)
      expect(row.HasDraftEntity).to.be.eq(false)
    }
  })

  test('refresh on object page', async () => {
    const res = await GET(
      '/processor/Travel?$filter=TravelID%20eq%204133%20and%20(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)&$skip=0&$top=2',
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0].IsActiveEntity).to.be.eq(true)
    expect(res.data.value[0].HasDraftEntity).to.be.eq(false)
    expect(res.data.value[0].HasActiveEntity).to.be.eq(false)
  })

  test('direct access active', async () => {
    const res = await GET(
      "/processor/Travel(TravelUUID='52657221A8E4645C17002DF03754AB66',IsActiveEntity=true)?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data).to.containSubset({
      BeginDate: '2023-08-04',
      BookingFee: 20,
      CurrencyCode_code: 'USD',
      Description: 'Business Trip for Christine, Pierre',
      EndDate: '2023-08-04',
      TotalPrice: 900,
      TravelID: 1,
      TravelStatus_code: 'O',
      TravelUUID: '52657221A8E4645C17002DF03754AB66',
      to_Agency_AgencyID: '070007',
      to_Customer_CustomerID: '000608',
      TravelStatus: { code: 'O', createDeleteHidden: false, fieldControl: 7, name: 'Open' },
      to_Agency: { AgencyID: '070007', Name: 'Hot Socks Travel' },
      to_Customer: { CustomerID: '000608', LastName: 'Prinz' },
      IsActiveEntity: true,
      HasActiveEntity: false,
      HasDraftEntity: false,
      DraftAdministrativeData: null,
    })
  })

  test('direct access active with navigation', async () => {
    const res = await GET(
      "/processor/Travel(TravelUUID='76757221A8E4645C17002DF03754AB66',IsActiveEntity=true)/TravelStatus",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data).to.containSubset({
      name: 'Accepted',
      descr: null,
      code: 'A',
      fieldControl: 1,
      createDeleteHidden: true,
      insertDeleteRestriction: false,
    })
  })

  test('direct access active with DraftAdministrativeData navigation', async () => {
    try {
      await GET(
        "/processor/Travel(TravelUUID='76757221A8E4645C17002DF03754AB66',IsActiveEntity=true)/DraftAdministrativeData",
        { auth: { username: 'user1', password: 'user1' } },
      )
      expect('should not be found').to.be.eq(true)
    } catch (e) {
      expect(e.message).to.be.eq('404 - Not Found')
    }
  })

  test('nested direct access', async () => {
    const res = await GET(
      "/processor/Travel(TravelUUID='76757221A8E4645C17002DF03754AB66',IsActiveEntity=true)/to_Booking(BookingUUID='3A997221A8E4645C17002DF03754AB66',IsActiveEntity=true)/to_BookSupplement?$count=true&$select=BookSupplUUID,BookingSupplementID,CurrencyCode_code,IsActiveEntity,Price,to_Supplement_SupplementID&$orderby=BookingSupplementID&$expand=to_Supplement($select=Description,SupplementID),to_Travel($select=IsActiveEntity,TravelUUID;$expand=TravelStatus($select=code,fieldControl))&$skip=0&$top=10",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0]).to.containSubset({
      BookSupplUUID: '85D87221A8E4645C17002DF03754AB66',
      BookingSupplementID: 1,
      CurrencyCode_code: 'EUR',
      Price: 20,
      to_Supplement_SupplementID: 'ML-0023',
      to_Supplement: { Description: 'Trout Meuniere', SupplementID: 'ML-0023' },
      to_Travel: { TravelStatus: { code: 'A', fieldControl: 1 }, TravelUUID: '76757221A8E4645C17002DF03754AB66' },
      IsActiveEntity: true,
    })
  })

  test('nested list of direct access', async () => {
    const res = await GET(
      "/processor/Travel(TravelUUID='76757221A8E4645C17002DF03754AB66',IsActiveEntity=true)/to_Booking?$count=true&$select=BookingDate,BookingID,BookingStatus_code,BookingUUID,ConnectionID,CurrencyCode_code,FlightDate,FlightPrice,HasActiveEntity,HasDraftEntity,IsActiveEntity,to_Carrier_AirlineID,to_Customer_CustomerID&$orderby=BookingID&$expand=BookingStatus($select=code,name),to_Carrier($select=AirlineID,AirlinePicURL,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=10",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data.value[0]).to.containSubset({
      BookingDate: '2024-05-13',
      BookingID: 1,
      BookingStatus_code: 'N',
      BookingUUID: '3A997221A8E4645C17002DF03754AB66',
      ConnectionID: '0018',
      CurrencyCode_code: 'USD',
      FlightDate: '2024-05-30',
      FlightPrice: 3657,
      to_Carrier_AirlineID: 'GA',
      to_Customer_CustomerID: '000115',
      BookingStatus: { code: 'N', name: 'New' },
      to_Carrier: {
        AirlineID: 'GA',
        AirlinePicURL:
          'https://raw.githubusercontent.com/SAP-samples/fiori-elements-opensap/main/week1/images/airlines/Green-Albatross-logo.png',
        Name: 'Green Albatros',
      },
      to_Customer: { CustomerID: '000115', LastName: 'Benz' },
      IsActiveEntity: true,
      HasActiveEntity: false,
      HasDraftEntity: false,
    })
  })

  test('direct access active child', async () => {
    const res = await GET(
      "/processor/Travel(TravelUUID='52657221A8E4645C17002DF03754AB66',IsActiveEntity=true)/to_Booking(BookingUUID='7A757221A8E4645C17002DF03754AB66',IsActiveEntity=true)?$select=BookingStatus_code,to_Carrier_AirlineID,to_Customer_CustomerID",
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data).to.containSubset({
      BookingStatus_code: 'N',
      to_Carrier_AirlineID: 'SW',
      to_Customer_CustomerID: '000099',
      IsActiveEntity: true,
    })
  })

  test('new', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(201)
    expect(res.data).to.containSubset({
      TravelUUID: '11111111111111111111111111111111',
      TravelID: 0,
      BeginDate: null,
      EndDate: null,
      BookingFee: null,
      TotalPrice: null,
      CurrencyCode_code: null,
      Description: null,
      TravelStatus_code: 'O',
      to_Agency_AgencyID: null,
      to_Customer_CustomerID: null,
      HasActiveEntity: false,
      IsActiveEntity: false,
      HasDraftEntity: false,
    })
    const TravelUUID = res.data.TravelUUID
    res = await POST(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/to_Booking`,
      {},
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(201)
    expect(res.data).to.containSubset({
      '@odata.context': '../$metadata#Booking/$entity',
      // BookingID: 1,
      ConnectionID: null,
      FlightDate: null,
      FlightPrice: null,
      CurrencyCode_code: null,
      // BookingStatus_code: 'N',
      to_Carrier_AirlineID: null,
      to_Customer_CustomerID: null,
      to_Travel_TravelUUID: '11111111111111111111111111111111',
      HasActiveEntity: false,
      IsActiveEntity: false,
      HasDraftEntity: false,
    })
    const BookingUUID = res.data.BookingUUID
    expect(BookingUUID).to.be.a('string')

    res = await GET(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/to_Booking(BookingUUID='${BookingUUID}',IsActiveEntity=false)?$select=BookingDate,BookingID,BookingStatus_code,BookingUUID,ConnectionID,CurrencyCode_code,FlightDate,FlightPrice,HasActiveEntity,HasDraftEntity,IsActiveEntity,to_Carrier_AirlineID,to_Customer_CustomerID&$expand=BookingStatus($select=code,name),to_Carrier($select=AirlineID,Name),to_Customer($select=CustomerID,LastName),to_Travel($select=IsActiveEntity,TravelUUID;$expand=TravelStatus($select=code,createDeleteHidden,fieldControl,insertDeleteRestriction))`,
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data).to.containSubset({
      // BookingID: 1,
      // BookingStatus_code: 'N',
      BookingUUID,
      ConnectionID: null,
      CurrencyCode_code: null,
      FlightDate: null,
      FlightPrice: null,
      HasActiveEntity: false,
      to_Carrier_AirlineID: null,
      to_Customer_CustomerID: null,
      // BookingStatus: { code: 'N', name: 'New' },
      to_Carrier: null,
      to_Customer: null,
      to_Travel: {
        TravelStatus: { code: 'O', createDeleteHidden: false, fieldControl: 7, insertDeleteRestriction: true },
        TravelUUID,
      },
      IsActiveEntity: false,
      HasDraftEntity: false,
    })
    res = await POST(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/to_Booking(BookingUUID='${BookingUUID}',IsActiveEntity=false)/to_BookSupplement`,
      {},
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data).to.containSubset({
      '@odata.context': '../../$metadata#BookingSupplement/$entity',
      // BookingSupplementID: 1,
      Price: null,
      CurrencyCode_code: null,
      to_Booking_BookingUUID: BookingUUID,
      to_Travel_TravelUUID: null, // Should be TravelUUID!
      to_Supplement_SupplementID: null,
      HasActiveEntity: false,
      IsActiveEntity: false,
      HasDraftEntity: false,
    })
    const BookSupplUUID = res.data.BookSupplUUID
    expect(BookSupplUUID).to.be.a('string')
  })

  test('edit then sibling of active', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(201)
    const TravelUUID = res.data.TravelUUID
    res = await GET(`/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/SiblingEntity`, {
      auth: { username: 'user1', password: 'user1' },
    })
    expect(res.status).to.be.eq(200)
    const row = res.data
    expect(row.IsActiveEntity).to.be.eq(true)
    expect(row.TravelUUID).to.be.eq(TravelUUID)
    expect(row.HasDraftEntity).to.be.eq(true)
  })

  test('direct access drafts with navigation and expand to DraftAdministrativeData and SiblingEntity', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    const TravelUUID = res.data.TravelUUID
    expect(res.status).to.be.eq(201)
    res = await GET(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/DraftAdministrativeData?$select=DraftUUID,LastChangeDateTime`,
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data.DraftUUID).to.be.a('string')
    expect(res.data.LastChangeDateTime).to.be.a('string')
    res = await GET(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=true)/DraftAdministrativeData?$select=DraftUUID,LastChangeDateTime`,
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data.DraftUUID).to.be.a('string')
    expect(res.data.LastChangeDateTime).to.be.a('string')
    expect(res.status).to.be.eq(200)
    res = await GET(`/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/SiblingEntity`, {
      auth: { username: 'user1', password: 'user1' },
    })
    expect(res.status).to.be.eq(204)
    res = await GET(`/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=true)/DraftAdministrativeData`, {
      auth: { username: 'user1', password: 'user1' },
    })
    expect(res.data).to.containSubset({
      LastChangedByUser: 'user1',
      CreatedByUser: 'user1',
      DraftIsCreatedByMe: true,
      DraftIsProcessedByMe: true,
    })
  })

  test('new then patch then prepare then activate', async () => {
    const srv = await cds.connect.to('TravelService')
    // REVISIT: make dummy because DB doesn't support this statement
    srv._update_totals4 = () => {}
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    const TravelUUID = res.data.TravelUUID
    expect(res.status).to.be.eq(201)
    res = await PATCH(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)`,
      {
        to_Agency_AgencyID: '070003',
      },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data).to.containSubset({
      to_Agency_AgencyID: '070003',
      TravelUUID,
      IsActiveEntity: false,
    })
    res = await PATCH(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)`,
      {
        BookingFee: '12',
      },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data).to.containSubset({
      BookingFee: 12,
      TravelUUID,
      IsActiveEntity: false,
    })
    expect(res.status).to.be.eq(200)
    res = await PATCH(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)`,
      {
        BeginDate: '2032-10-22',
        EndDate: '2032-12-22',
        to_Customer_CustomerID: '000008',
      },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    res = await POST(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/TravelService.draftPrepare`,
      {},
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    expect(res.data).to.containSubset({
      TravelUUID,
      TravelID: 0,
      BeginDate: '2032-10-22',
      EndDate: '2032-12-22',
      BookingFee: 12,
      TotalPrice: null,
      CurrencyCode_code: null,
      Description: null,
      TravelStatus_code: 'O',
      to_Agency_AgencyID: '070003',
      to_Customer_CustomerID: '000008',
      HasActiveEntity: false,
      IsActiveEntity: false,
      HasDraftEntity: false,
    })
    res = await POST(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/TravelService.draftActivate?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      {},
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(201)
    res = await GET(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=true)?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.data).to.containSubset({
      '@odata.context':
        '$metadata#Travel(BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID,DraftAdministrativeData(DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus(code,createDeleteHidden,fieldControl,name),to_Agency(AgencyID,Name),to_Customer(CustomerID,LastName))/$entity',
      BeginDate: '2032-10-22',
      BookingFee: 12,
      CurrencyCode_code: null,
      Description: null,
      EndDate: '2032-12-22',
      TotalPrice: null,
      TravelStatus_code: 'O',
      TravelUUID,
      to_Agency_AgencyID: '070003',
      to_Customer_CustomerID: '000008',
      TravelStatus: { code: 'O', createDeleteHidden: false, fieldControl: 7, name: 'Open' },
      to_Agency: { AgencyID: '070003', Name: 'Happy Hopping' },
      to_Customer: { CustomerID: '000008', LastName: 'Buchholm' },
      IsActiveEntity: true,
      HasDraftEntity: false,
      HasActiveEntity: false,
      DraftAdministrativeData: null,
    })
    const afterActBooking = await GET(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=true)/to_Booking?$count=true&$select=BookingDate,BookingID,BookingStatus_code,BookingUUID,ConnectionID,CurrencyCode_code,FlightDate,FlightPrice,HasActiveEntity,HasDraftEntity,IsActiveEntity,to_Carrier_AirlineID,to_Customer_CustomerID&$orderby=BookingID&$expand=BookingStatus($select=code,name),to_Carrier($select=AirlineID,AirlinePicURL,Name),to_Customer($select=CustomerID,LastName)&$skip=0&$top=10`,
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(afterActBooking.data.value.length).to.be.eq(0)
  })

  test('edit then patch then prepare then activate', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )
    const TravelUUID = res.data.TravelUUID
    expect(res.status).to.be.eq(201)
    res = await PATCH(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)`,
      {
        BeginDate: '2032-10-22',
        EndDate: '2032-12-22',
        to_Customer_CustomerID: '000008',
      },
      { auth: { username: 'user1', password: 'user1' } },
    )
    res = await POST(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/TravelService.draftPrepare`,
      {},
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(200)
    res = await POST(
      `/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)/TravelService.draftActivate?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      {},
      { auth: { username: 'user1', password: 'user1' } },
    )
    // 200 in cds 7, 201 in cds 6
    expect(res.status).to.be.oneOf([200, 201])
  })

  test('edit then discard', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(201)
    const TravelUUID = res.data.TravelUUID
    res = await DELETE(`/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)`, {
      auth: { username: 'user1', password: 'user1' },
    })
    expect(res.status).to.be.eq(204)
    res = await GET(`/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=true)`, {
      auth: { username: 'user1', password: 'user1' },
    })
    expect(res.status).to.be.eq(200)
    expect(res.data).to.containSubset({
      TravelUUID,
      // TravelID: 32,
      // BookingFee: 90,
      // TotalPrice: 5624,
      CurrencyCode_code: 'USD',
      Description: 'Vacation to USA',
      TravelStatus_code: 'O',
      to_Agency_AgencyID: '070022',
      IsActiveEntity: true,
      HasActiveEntity: false,
      HasDraftEntity: false,
    })
    expect(res.data.LastChangedAt).to.be.a('string')
    expect(res.data.LastChangedBy).to.be.a('string')
  })

  test('new then discard', async () => {
    let res = await POST(
      '/processor/Travel',
      { TravelUUID: NEW_DRAFT_TRAVELUUID },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(201)
    const TravelUUID = res.data.TravelUUID
    res = await DELETE(`/processor/Travel(TravelUUID='${TravelUUID}',IsActiveEntity=false)`, {
      auth: { username: 'user1', password: 'user1' },
    })
    expect(res.status).to.be.eq(204)
  })

  test('discard active', async () => {
    const res = await DELETE("/processor/Travel(TravelUUID='3C757221A8E4645C17002DF03754AB66',IsActiveEntity=true)", {
      auth: { username: 'user1', password: 'user1' },
    })
    expect(res.status).to.be.eq(204)
  })

  test('edit with an existing draft must fail', async () => {
    let res = await POST(
      `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
      { PreserveChanges: true },
      { auth: { username: 'user1', password: 'user1' } },
    )
    expect(res.status).to.be.eq(201)
    try {
      res = await POST(
        `/processor/Travel(TravelUUID='${EDIT_DRAFT_TRAVELUUID}',IsActiveEntity=true)/TravelService.draftEdit?$select=BeginDate,BookingFee,CurrencyCode_code,Description,EndDate,HasActiveEntity,HasDraftEntity,IsActiveEntity,TotalPrice,TravelID,TravelStatus_code,TravelUUID,to_Agency_AgencyID,to_Customer_CustomerID&$expand=DraftAdministrativeData($select=DraftIsCreatedByMe,DraftUUID,InProcessByUser),TravelStatus($select=code,createDeleteHidden,fieldControl,name),to_Agency($select=AgencyID,Name),to_Customer($select=CustomerID,LastName)`,
        { PreserveChanges: true },
        { auth: { username: 'user1', password: 'user1' } },
      )
      expect(1).to.be.eq('Editing an active entity with an existing draft must fail')
    } catch (e) {
      expect(e.message).to.be.eq('409 - A draft for this entity already exists')
    }
  })
})
