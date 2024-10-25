/* eslint-disable no-unused-vars */
/* global cds */ ;async () => {
  // Run the following line by line in
  //$ npm add git+https://github.com/cap-js/cds-dbs.git
  //$ cds watch --profile better-sqlite
  //$ cds repl --profile better-sqlite
  var { server } = await cds.test('@capire/bookshop'),
    { Books, Authors } = cds.entities
  await INSERT.into(Books).entries({ title: 'Unwritten Book' })
  await INSERT.into(Authors).entries({ name: 'Upcoming Author' })
  await SELECT`from ${Books} { title as book, author.name as author, genre.name as genre }`
  await SELECT`from ${Authors} { books.title as book, name as author, books.genre.name as genre }`
  await SELECT`from ${Books} { title as book, author[ID<170].name as author, genre.name as genre }`
  await SELECT`from ${Books} { title as book, author.name as author, genre.name as genre }`.where({
    'author.name': { like: 'Ed%' },
    or: { 'author.ID': 170 },
  })
  await SELECT`from ${Books} { title as book, author.name as author, genre.name as genre } where author.name like 'Ed%' or author.ID=170`
  await SELECT`from ${Books}:author[name like 'Ed%' or ID=170] { books.title as book, name as author, books.genre.name as genre }`
  await SELECT`from ${Books}:author[150] { books.title as book, name as author, books.genre.name as genre }`
  await SELECT`from ${Authors} { ID, name, books { ID, title }}`
  await SELECT`from ${Authors} { ID, name, books { ID, title, genre { ID, name }}}`
  await SELECT`from ${Authors} { ID, name, books.genre { ID, name }}`
  await SELECT`from ${Authors} { ID, name, books as some_books { ID, title, genre.name as genre }}`
  await SELECT`from ${Authors} { ID, name, books[genre.ID=11] as dramatic_books { ID, title, genre.name as genre }}`
  await SELECT`from ${Authors} { ID, name, books.genre[name!='Drama'] as no_drama_books_count { count(*) as sum }}`
  await SELECT`from ${Authors} { books.genre.ID }`
  await SELECT`from ${Authors} { books.genre }`
  await SELECT`from ${Authors} { books.genre.name }`

  await SELECT.localized('ID', 'title', 'author.name', 'descr').from(Books)
  await INSERT({ title: 'Boo', foo: 'bar' }).into(Books)

  await UPSERT.into(Books).columns('ID', 'title').rows([201, 'Sturmhöhe'])
  await SELECT.from(Books, b => {
    b.ID, b.title
  })
  server.close()

  let q = {
    SELECT: {
      localized: true,
      from: {
        join: 'left',
        args: [
          { ref: ['sap.capire.bookshop.Books'], as: 'Books' },
          { ref: ['sap.capire.bookshop.Authors'], as: 'author' },
        ],
        on: [{ ref: ['author', 'ID'] }, '=', { ref: ['Books', 'author_ID'] }],
      },
      columns: [{ ref: ['Books', 'ID'] }, { ref: ['Books', 'title'] }, { ref: ['author', 'name'], as: 'author_name' }],
    },
  }

  let lq1 = {
    SELECT: {
      localized: true,
      from: {
        join: 'left',
        args: [
          { ref: ['localized.sap.capire.bookshop.Books'], as: 'Books' },
          { ref: ['localized.sap.capire.bookshop.Authors'], as: 'author' },
        ],
        on: [{ ref: ['author', 'ID'] }, '=', { ref: ['Books', 'author_ID'] }],
      },
      columns: [{ ref: ['Books', 'ID'] }, { ref: ['Books', 'title'] }, { ref: ['author', 'name'], as: 'author_name' }],
    },
  }
}
