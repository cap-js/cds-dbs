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

  test('Books $count in expand', async () => {
    const res = await GET(
      `/admin/Authors?$select=name&$expand=books($count=true)`, admin
    )
    expect(res.status).to.be.eq(200)
    for (const row of res.data.value) {
      expect(row['books@odata.count']).to.be.eq(row.books.length + '')
    }
  })

  test.skip('Books $count in orderby', async () => {
    await GET(`/admin/Authors?$select=name&$expand=books($count=true)&$orderby=books/$count desc`, admin)
  })

  test.skip('Books $count in filter', async () => {
    await GET(`/admin/Authors?$select=name&$expand=books($count=true)&$filter=books/$count eq 2`, admin)
  })

  test('Books with groupby with path expression and expand result', async () => {
    const res = await GET(
      '/admin/Books?$apply=filter(title%20ne%20%27bar%27)/groupby((author/name),aggregate(price with sum as totalAmount))',
      admin,
    )
    expect(res.data.value.length).to.be.eq(4) // As there are two books which have the same author
  })

  test('same as above, with foreign key optimization', async () => {
    const res = await GET(
      '/admin/Books?$apply=filter(title%20ne%20%27bar%27)/groupby((author/name, author/ID),aggregate(price with sum as totalAmount))',
      admin,
    )
    expect(res.data.value.length).to.be.eq(4) // As there are two books which have the same author
    expect(
      res.data.value.every(
        item =>
          'author' in item &&
          'ID' in item.author && // foreign key is renamed to element name in target
          !('author_ID' in item.author),
      ),
    ).to.be.true
  })

  test('same as above, with more depth', async () => {
    const res = await GET(
      '/admin/Books?$apply=filter(title%20ne%20%27bar%27)/groupby((genre/parent/name),aggregate(price with sum as totalAmount))',
      admin,
    )
    expect(res.data.value[0].genre.parent.name).to.be.eq('Fiction')
  })

  test('pseudo expand using groupby and orderby on same column', async () => {
    const res = await GET(
      '/admin/Books?$apply=groupby((author/name))&$orderby=author/name',
      admin,
    )
    expect(res.data.value.every(row => row.author.name)).to.be.true
  })

  test('groupby with multiple path expressions', async () => {
    const res = await GET('/admin/A?$apply=groupby((toB/toC/ID,toC/toB/ID))', admin)
    expect(res.status).to.be.eq(200)
  })

  test('groupby with multiple path expressions and orderby', async () => {
    const res = await GET('/admin/A?$apply=groupby((toB/toC/ID,toB/toC/ID))&$orderby=toB/toC/ID', admin)
    expect(res.status).to.be.eq(200)
  })

  test('groupby combining simple properties and path expressions', async () => {
    const res = await GET('/admin/Books?$apply=groupby((ID,author/ID,author/placeOfBirth))', admin)
    expect(res.status).to.be.eq(200)
  })

  // creates having null = 1 in the SQL statement
  test.skip('groupby with multiple path expressions and filter', async () => {
    const res = await GET('/admin/A?$apply=groupby((toB/toC/ID,toB/toC/ID))&$filter=ID eq 1', admin)
    expect(res.status).to.be.eq(200)
  })

  // REVISIT: un skip when SELECT[async iterator] is merged into @sap/cds
  test.skip('Books aggregation using for await', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    let total = 0
    for await (const row of cds.ql`SELECT price FROM ${Books}`) {
      total += Number.parseFloat(row.price)
    }
    expect(total).gt(200)
  })

  // REVISIT: un skip when SELECT.pipe is merged into @sap/cds
  test.skip('Books download using pipe', async () => {
    const { json } = require('stream/consumers')
    const { Books } = cds.entities('sap.capire.bookshop')
    let result
    await cds.ql`SELECT FROM ${Books}`.pipe(async stream => { result = await json(stream) })
    expect(result).length(5)
  })

  test('Path expression', async () => {
    const q = cds.ql`SELECT title, author.name as author FROM sap.capire.bookshop.Books where author.name LIKE '%a%'`
    const res = await cds.run(q)
    expect(res.length).to.be.eq(4)
    const columns = Object.keys(res[0])
    expect(columns).to.contain('author')
    expect(columns).to.contain('title')
  })

  test('Smart quotation', async () => {
    const q = cds.ql`
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

  test('order by computed result column', async () => {
    const { Authors } = cds.entities('sap.capire.bookshop')
    const res = await SELECT
      .columns`ID,sum(books_price) as price :Decimal`
      .from(cds.ql`SELECT ID,books.price from ${Authors}`)
      .groupBy`ID`
      .orderBy`price desc`
    expect(res.length).to.be.eq(4)
    expect(res[0].price).to.be.eq('150')
  })

  test('select distinct order by selected result column with alias', async () => {
    const { Authors } = cds.entities('sap.capire.bookshop')
    const res = await SELECT.distinct
      .columns`ID`
      .from`${Authors} as a`
      .orderBy`a.ID`

    expect(res.length).to.be.eq(4)
    expect(res[0].ID).to.be.eq(101)
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

  test('reuse already executed select as subselect in from with custom join', async () => {
    let inner = {
      SELECT: {
        from: {
          join: 'inner',
          args: [
            { ref: ['sap.capire.bookshop.Books'], as: 'b' },
            { ref: ['sap.capire.bookshop.Authors'], as: 'a' },
          ],
          on: [{ ref: ['a', 'ID'] }, '=', { ref: ['b', 'author_ID'] }],
        },
        columns: [{ ref: ['a', 'ID'], as: 'author_ID' }, { ref: ['b', 'title'] }],
      },
    }
    inner.as = 'booksAndAuthors'

    let firstUsage = {
      SELECT: {
        from: inner,
        columns: [{ func: 'count', args: ['*'], as: 'count' }],
        where: [{ ref: ['booksAndAuthors', 'author_ID'] }, '=', { val: 201 }],
      },
    }
    let secondUsage = {
      SELECT: {
        from: {
          join: 'inner',
          args: [
            inner, // alias must not be overwritten
            { ref: ['sap.capire.bookshop.Authors'], as: 'otherAuthor' },
          ],
          on: [{ ref: ['otherAuthor', 'ID'] }, '=', { ref: ['booksAndAuthors', 'author_ID'] }],
        },
        columns: [{ func: 'count', args: ['*'], as: 'count' }],
        where: [{ ref: ['booksAndAuthors', 'author_ID'] }, '=', { val: 201 }]
      },
    }

    expect(async () => {
      await cds.run(firstUsage)
      await cds.run(secondUsage)
    }).to.not.throw()
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

  test('Expand Book with alias', async () => {
    const { Books } = cds.entities('sap.capire.bookshop')
    const res = await SELECT.one`ID as i, title as t, author as a { name as n, books as b { title as t } }`.from`${Books}[ID=252]`

    expect(res.i).to.be.eq(252)
    expect(res.t).to.be.eq('Eleonora')
    expect(res.a.n).to.be.eq('Edgar Allen Poe')
    expect(res.a.b.length).to.be.eq(2)
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

  test('recursively expand children of Generes to exceed MAX_LENGTH_OF_IDENTIFIER (127)', async () => {
    const { Genres } = cds.entities('sap.capire.bookshop')

    const columns = Array.from({ length: 16 }).reduce(cols => {
        const nestedCols = cols.pop()
        cols.push([{ ref: ['ID'] }, { ref: ['children'], expand: nestedCols }])
        return cols
      }, [])

    const cqn = SELECT.from(Genres).columns(...columns)

    const res = await cds.run(cqn)
    expect(res).to.not.be.undefined
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

      const q = cds.ql`SELECT title FROM sap.capire.bookshop.Books ORDER BY title`
      const res3 = await cds.run(q)
      expect(res3.at(-1).title).to.be.eq('dracula')

      // If no locale is set, we do not sort by default locale, standard sorting applies
      q.SELECT.localized = true
      const res4 = await cds.run(q)
      expect(res4.at(-1).title).to.be.eq('dracula')
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

  test('Books $count with $top=0 and group by', async () => {
    // top=0 to force count subquery
    const res = await GET(`/admin/Books?$apply=groupby((author/name))&$top=0&$count=true`, admin)
    expect(res.data['@odata.count']).to.be.eq(4)
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

  it('allows filtering with between operator', async () => {
    const query = SELECT.from('sap.capire.bookshop.Books', ['ID', 'stock']).where({ stock: { between: 0, and: 100 } })

    return expect((await query).every(row => row.stock >= 0 && row.stock <= 100)).to.be.true
  })

  it('allows various mechanisms for expressing "not in"', async () => {
    const results = await cds.db.run([
      SELECT.from('sap.capire.bookshop.Books', ['ID']).where({ ID: { 'not in': [201, 251] } }).orderBy('ID'),
      SELECT.from('sap.capire.bookshop.Books', ['ID']).where({ ID: { not: { in: [201, 251] } } }).orderBy('ID'),
      SELECT.from('sap.capire.bookshop.Books', ['ID']).where('ID not in', [201, 251]).orderBy('ID'),
    ])

    for (const row of results) expect(row).to.deep.eq([{ ID: 207 }, { ID: 252 }, { ID: 271 }])
  })

  it('select all authors which have written books that have genre.name = null', async () => {
    await insertTemporaryData()

    // the path expression inside the filter after the exists predicate must not
    // be transformed to a left outer join but to an inner join
    // if not, we would also get all authors which have books which have no genre at all (like Lord of the Rings in our example)
    const { Authors } = cds.entities('sap.capire.bookshop')
    const query = SELECT`from ${Authors} where exists books[ genre.name = null ]`
    const equivalentQuery = SELECT`from ${Authors} where exists books[ exists genre [ name = null ] ]`
    const results = await cds.db.run(query)
    const equivalentReults = await cds.db.run(equivalentQuery)
    expect(results).to.have.length(1)
    expect(results.length).to.equal(equivalentReults.length) // only J.K. Rowling has written a book with genre.name = null


    async function insertTemporaryData() {
      await cds.run(INSERT.into('sap.capire.bookshop.Books').entries([
        { ID: 272, title: 'Harry Potter', descr: 'The genre of this book has no name', author_ID: 171, genre_ID: 25 },
        { ID: 273, title: 'Lord of the Rings', descr: 'This book has no genre', author_ID: 172, genre_ID: null }
      ]))
      await cds.run(INSERT.into('sap.capire.bookshop.Authors').entries([
        { ID: 171, name: 'J.K. Rowling', dateOfBirth: '1965-07-31', placeOfBirth: 'Yate, Gloucestershire', city: 'Edinburgh', street: '3 Main Street' },
        { ID: 172, name: 'J.R.R. Tolkien', dateOfBirth: '1892-01-03', placeOfBirth: 'Bloemfontein, South Africa', dateOfDeath: '1973-09-02', placeOfDeath: 'Bournemouth, England', city: 'Oxford', street: '20 Northmoor Road' }
      ]))
      await cds.run(INSERT.into('sap.capire.bookshop.Genres').entries([
        { ID: 25, parent_ID: 20, name: null }
      ]))
    }
  })

  it('cross joins without on condition', async () => {
    const query = cds.ql`SELECT from sap.capire.bookshop.Books as Books, sap.capire.bookshop.Authors as Authors {
      Books.title, Authors.name as author
    } where Books.author_ID = Authors.ID`
    const pathExpressionQuery = SELECT.from('sap.capire.bookshop.Books').columns('title', 'author.name as author')
    const crossJoinResult = await cds.db.run(query)
    const pathExpressionResult = await cds.db.run(pathExpressionQuery)
    expect(crossJoinResult).to.deep.eq(pathExpressionResult)
  })

  it('special $main variable', async () => {
    // INSERT a second Harry Potter book
    // this one already exists: `{ ID: 272, title: 'Harry Potter', … }`
    await INSERT.into('sap.capire.bookshop.Books').entries([
      { ID: 678, title: 'Harry Potter and the Chamber of Secrets', author_ID: 171, stock: 10 }
    ])
    // with the $main syntax, we can check if the author of a given book
    // has already written other books with a similar title
    const thereExistsASimilarBook = cds.ql`
      SELECT from sap.capire.bookshop.Books as Books
      {
        ID,
        ( (
          exists author.books[
            (contains(title, $main.title) or contains($main.title, title)) and ID != $main.ID
          ]) ?
          'This author has already written similar books' :
          'No similar books by the books author'
        ) as hasSimilarBooks
      }`
    const allBooks = await cds.run(thereExistsASimilarBook)
    for( const book of allBooks ) {
      if([272, 678].includes(book.ID))
        expect(book.hasSimilarBooks).to.equal('This author has already written similar books')
      else
        expect(book.hasSimilarBooks).to.equal('No similar books by the books author')
    }
  })
})
