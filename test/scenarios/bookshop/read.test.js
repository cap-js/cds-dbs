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

  test('Delete Book', async () => {
    const res = await DELETE('/admin/Books(271)', admin)
    expect(res.status).to.be.eq(204)
  })
})
