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

  test('Insert Book', async () => {
    const res = await POST(
      '/admin/Books',
      {
        ID: 2,
        title: 'Poems : Pocket Poets',
        descr:
          "The Everyman's Library Pocket Poets hardcover series is popular for its compact size and reasonable price which does not compromise content. Poems: Bronte contains poems that demonstrate a sensibility elemental in its force with an imaginative discipline and flexibility of the highest order. Also included are an Editor's Note and an index of first lines.",
        author: { ID: 101 },
        genre: { ID: 12 },
        stock: 5,
        price: '12.05',
        currency: { code: 'USD' },
      },
      admin,
    )
    expect(res.status).to.be.eq(201)
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
  })

  test('Filter Books(multiple functions)', async () => {
    const res = await GET(
      `/admin/Books?$filter=contains(descr,'Edgar') or contains(descr,'Autobiography')`,
      admin,
    )
    expect(res.data.value.length).to.be.eq(3)
  })

  test.skip('Insert Booky', async () => {
    const res = await POST(
      '/admin/Booky',
      {
        ID: 2000,
        totle: 'Poems : Pocket Poets',
        description:
          "The Everyman's Library Pocket Poets hardcover series is popular for its compact size and reasonable price which does not compromise content. Poems: Bronte contains poems that demonstrate a sensibility elemental in its force with an imaginative discipline and flexibility of the highest order. Also included are an Editor's Note and an index of first lines.",
        author: { ID: 101 },
        genre: { ID: 12 },
        stock: 5,
        price: '12.05',
        currency: { code: 'USD' },
      },
      admin,
    )
    expect(res.status).to.be.eq(201)
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

  test('Delete Book', async () => {
    const res = await DELETE('/admin/Books(271)', admin)
    expect(res.status).to.be.eq(204)
  })

})
