const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe('Bookshop - Read', () => {
  const { expect, GET, POST, DELETE } = cds.test(bookshop)

  test('Books', async () => {
    const res = await GET('/browse/Books', { headers: { 'accept-language': 'de' } })
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(5)
  })

  test('Books $count with $top=0', async () => {
    const res = await GET('/browse/ListOfBooks?$count=true&$top=0')
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(0)
    expect(res.data['@odata.count']).to.be.eq(5)
  })

  test('Books $count with $top=2', async () => {
    const res = await GET('/browse/ListOfBooks?$count=true&$top=2')
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
    expect(res.data['@odata.count']).to.be.eq(5)
  })

  test('Books $count with $top=1 and groupby', async () => {
    const res = await GET(
      `/browse/ListOfBooks?$apply=groupby((ID),aggregate(ID with countdistinct as countBookings))&$count=true&$top=1`,
    )
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data['@odata.count']).to.be.eq(5)
  })

  test('Path expression', async () => {
    const q = CQL`SELECT title, author.name as author FROM sap.capire.bookshop.Books where author.name LIKE '%a%'`
    const res = await cds.run(q)
    expect(res.length).to.be.eq(4)
    const columns = Object.keys(res[0])
    expect(columns).to.contain('author')
    expect(columns).to.contain('title')
  })

  test('Smart quotation', async () => {
    const q = CQL`
      SELECT FROM sap.capire.bookshop.Books as ![FROM]
      {
        ![FROM].title as group,
        ![FROM].author { name as CONSTRAINT } 
      }
      where ![FROM].title LIKE '%Wuthering%'
      order by group
    `
    const res = await cds.run(q)
    expect(res.length).to.be.eq(1)
    expect(res[0]).to.have.property('group')
    expect(res[0]).to.have.deep.property('author', { CONSTRAINT: 'Emily Brontë' })
  })

  test('Plain sql', async () => {
    const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books')
    expect(res.length).to.be.eq(5)
  })

  test('Plain sql with values', async () => {
    const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books where ID = ?', [201])
    expect(res.length).to.be.eq(1)
  })

  test('Plain sql with multiple values', async () => {
    const res = await cds.run('SELECT * FROM sap_capire_bookshop_Books where ID = ?', [[201], [252]])
    expect(res.length).to.be.eq(2)
  })

  test('reuse already executed select as subselect', async () => {
    let s = SELECT.columns('ID').from('sap.capire.bookshop.Books')
    let res = await s

    res = await SELECT.one.from('sap.capire.bookshop.Books as b')
      .join('sap.capire.bookshop.Authors as a')
      .on('a.ID = b.author_ID')
      .columns('a.name', 'b.title')
      .where('b.ID in', s)
      .orderBy('b.ID')
    expect(res).to.deep.eq({ "name": "Emily Brontë", "title": "Wuthering Heights" })
  })

  test('forUpdate query from path expression', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    const query = SELECT([{ ref: ['ID'] }])
      .from({ ref: [{ id: Books.name, where: [{ ref: ['ID'] }, '=', { val: 201 }] }, 'author'] })
      .forUpdate({
        of: ['ID'],
        wait: 0,
      })

    const forUpdateResults = await cds.run(query)
    expect(forUpdateResults).to.deep.eq([{ ID: 101 }])
  })

  test('Expand Book', async () => {
    const res = await GET(
      '/admin/Books(252)?$select=title&$expand=author($select=name;$expand=books($select=title))',
      admin,
    )
    expect(res.status).to.be.eq(200)

    expect(res.data.ID).to.be.eq(252)
    expect(res.data.title).to.be.eq('Eleonora')
    expect(res.data.author.name).to.be.eq('Edgar Allen Poe')
    expect(res.data.author.books.length).to.be.eq(2)
  })

  test('Search book', async () => {
    const res = await GET('/admin/Books?$search=cat', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(1)
    expect(res.data.value[0].title).to.be.eq('Catweazle')
  })

  test('Search book with space and quotes', async () => {
    const res = await GET('/admin/Books?$search="e R"', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
    expect(res.data.value[0].title).to.be.eq('The Raven')
    expect(res.data.value[1].descr).to.include('e r')
  })

  test('Search book with filter', async () => {
    const res = await GET('/admin/Books?$search="e R"&$filter=ID eq 251 or ID eq 271', admin)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
    expect(res.data.value[0].title).to.be.eq('The Raven')
    expect(res.data.value[1].descr).to.include('e r')
    expect(res.data.value[0].ID).to.be.eq(251)
    expect(res.data.value[1].ID).to.be.eq(271)
  })

  test.skip('Expand Book($count,$top,$orderby)', async () => {
    // REVISIT: requires changes in @sap/cds to allow $count inside expands
    const res = await GET(
      '/admin/Books?$count=true&$top=2&$orderby=title asc&$select=title&$expand=author($select=name;$expand=books($count=true;$orderby=title desc;$top=1;$select=title))',
      admin,
    )
    expect(res.status).to.be.eq(200)

    expect(res.data.ID).to.be.eq(252)
    expect(res.data.title).to.be.eq('Eleonora')
    expect(res.data.author.name).to.be.eq('Edgar Allen Poe')
    expect(res.data.author.books.length).to.be.eq(2)
  })

  test('Sorting Books', async () => {
    const res = await POST(
      '/admin/Books',
      {
        ID: 280,
        title: 'dracula',
        descr:
          "Dracula is a classic Gothic horror novel about a vampire's attempt to spread the undead curse from Transylvania to England.",
        author: { ID: 101 },
        genre: { ID: 10 },
        stock: 5,
        price: '12.05',
        currency: { code: 'USD' },
      },
      admin,
    )
    try {
      expect(res.status).to.be.eq(201)

      const res2 = await GET('/browse/Books?$orderby=title', { headers: { 'accept-language': 'de' } })
      expect(res2.status).to.be.eq(200)
      expect(res2.data.value[1].title).to.be.eq('dracula')

      const q = CQL`SELECT title FROM sap.capire.bookshop.Books ORDER BY title`
      const res3 = await cds.run(q)
      expect(res3[res3.length - 1].title).to.be.eq('dracula')

      q.SELECT.localized = true
      const res4 = await cds.run(q)
      expect(res4[1].title).to.be.eq('dracula')
    } finally {
      await DELETE('/admin/Books(280)', admin)
    }
  })

  test('Filter Books(multiple functions)', async () => {
    const res = await GET(
      `/admin/Books?$filter=contains(descr,'Edgar') or contains(descr,'Autobiography')`,
      admin,
    )
    expect(res.data.value.length).to.be.eq(3)
  })

  test('Filter Books(LargeBinary type)', async () => {
    expect(await GET(
      `/admin/Books?$filter=image ne null`,
      admin,
    )).to.have.nested.property('data.value.length', 0)

    expect(await GET(
      `/admin/Books?$filter=null ne image`,
      admin,
    )).to.have.nested.property('data.value.length', 0)


    expect(await GET(
      `/admin/Books?$filter=image eq null`,
      admin,
    )).to.have.nested.property('data.value.length', 5)

    // intentionally not tranformed `null = image` SQL which always returns `null`
    expect(await GET(
      `/admin/Books?$filter=null eq image`,
      admin,
    )).to.have.nested.property('data.value.length', 0)
  })

  test('Filter Books(complex filter in apply)', async () => {
    const res = await GET(`/browse/Books?$apply=filter(((ID eq 251 or ID eq 252) and ((contains(tolower(descr),tolower('Edgar'))))))`)
    expect(res.status).to.be.eq(200)
    expect(res.data.value.length).to.be.eq(2)
  })

  it('joins as subselect are executable', async () => {
    const subselect = {
      SELECT: {
        from: {
          join: 'inner',
          args: [
            { ref: ['sap.capire.bookshop.Books'], as: 'b' },
            { ref: ['sap.capire.bookshop.Authors'], as: 'a' },
          ],
          on: [{ ref: ['a', 'ID'] }, '=', { ref: ['b', 'author_ID'] }],
        },
        columns: [
          { ref: ['a', 'name'], as: 'aname' },
          { ref: ['b', 'title'], as: 'btitle' },
        ],
      },
    }
    subselect.as = 'ab'

    const query = {
      SELECT: {
        one: true,
        from: subselect,
        columns: [{ func: 'count', args: ['*'], as: 'count' }],
        where: [{ ref: ['ab', 'aname'] }, '=', { val: 'Edgar Allen Poe' }],
      },
    }

    expect((await cds.db.run(query)).count).to.be.eq(2)
  })

  it('joins without columns are rejected because of conflicts', async () => {
    const query = {
      SELECT: {
        from: {
          join: 'inner',
          args: [
            { ref: ['sap.capire.bookshop.Books'], as: 'b' },
            { ref: ['sap.capire.bookshop.Authors'], as: 'a' },
          ],
          on: [{ ref: ['a', 'ID'] }, '=', { ref: ['b', 'author_ID'] }],
        },
      },
    }

    return expect(cds.db.run(query)).to.be.rejectedWith(/Ambiguous wildcard elements/)
  })

  it('joins without columns are rejected in general', async () => {
    const query = {
      SELECT: {
        from: {
          join: 'inner',
          args: [
            { ref: ['AdminService.RenameKeys'], as: 'rk' },
            { ref: ['DraftService.DraftEnabledBooks'], as: 'deb' },
          ],
          on: [{ ref: ['deb', 'ID'] }, '=', { ref: ['rk', 'foo'] }],
        },
      },
    }

    return expect(cds.db.run(query)).to.be.rejectedWith(/joins must specify the selected columns/)
  })

  it.only('Object stream', async () => {
    try {
      const fs = require('fs')
      const path = require('path')
      const streamConsumers = require('stream/consumers')
      let data = fs.createReadStream(path.join(__dirname, '../../../sqlite/test/general/samples/test.jpg'))
      const originalImageData = fs.readFileSync(path.join(__dirname, '../../../sqlite/test/general/samples/test.jpg'))

      const { Books } = cds.entities('sap.capire.bookshop')

      await UPDATE(Books).with({ image: data }).where({ val: true })

      const query = SELECT(['*', { ref: ['image'] }, { ref: ['author'], expand: ['*'] }]).from(Books)
      const req = new cds.Request({ query, iterator: true })
      await cds.tx(async tx => {
        const stream = await tx.dispatch(req)
        for await (const row of stream) {
          const buffer = await streamConsumers.buffer(row.image)
          if (originalImageData.compare(buffer)) throw new Error('Blob stream does not contain the original data')
          for await (const author of row.author) {
            debugger
          }
          debugger
        }
      })
    } catch (err) {
      debugger
    }
  })

})
