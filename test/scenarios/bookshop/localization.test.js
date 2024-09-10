const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')
const de = { locale: 'de' }

describe('Bookshop - localization', () => {
  const { expect } = cds.test(bookshop)

  test('SELECT localized.title from Books', ()=> cds.tx (de, async()=>{
    let { Books } = cds.entities, book
    book = await SELECT.from(Books, 201, b => { b.title, b.localized.title })
    expect(book.title).to.equal('Wuthering Heights')
    expect(book.localized_title).to.equal('Sturmhöhe')
    book = await SELECT.from(Books, 271, b => { b.title, b.localized.title })
    expect(book.title).to.equal('Catweazle')
    expect(book.localized_title).to.not.exist
  }))

  test('SELECT.localized Books { title }', async ()=> await cds.tx (de, async()=>{
    let { Books } = cds.entities, book
    book = await SELECT.from(Books, 201, b => b.title)
    expect(book.title).to.equal('Wuthering Heights') //> base data
    book = await SELECT.localized(Books, 201, b => b.title)
    expect(book.title).to.equal('Sturmhöhe')  //> found translation
    book = await SELECT.localized(Books, 271, b => b.title)
    expect(book.title).to.equal('Catweazle') //> fallback to default
  }))

  test('SELECT.localized Authors { books { title } }', ()=> cds.tx (de, async()=>{
    let { Authors } = cds.entities
    let emily = await SELECT.localized(Authors, 101, a => { a.name, a.books(b => b.title) })
    expect(emily.books[0].title).to.equal('Sturmhöhe') //> found translation
    let carpenter = await SELECT.localized(Authors, 170, a => { a.name, a.books(b => b.title) })
    expect(carpenter.books[0].title).to.equal('Catweazle') //> fallback to default
  }))

  test('SELECT.localized Authors { books.title }', ()=> cds.tx (de, async()=>{
    let { Authors } = cds.entities
    let emily = await SELECT.localized(Authors, 101, a => { a.name, a.books.title })
    expect(emily.books_title).to.equal('Sturmhöhe') //> found translation
    let carpenter = await SELECT.localized(Authors, 170, a => { a.name, a.books.title })
    expect(carpenter.books_title).to.equal('Catweazle') //> fallback to default
  }))

  test('SELECT.localized Authors where books.title = Sturmhöhe', ()=> cds.tx (de, async()=>{
    let { Authors } = cds.entities
    let [emily] = await SELECT.localized(Authors, a => a.name).where('books.title =','Sturmhöhe')
    expect(emily.name).to.equal('Emily Brontë')
  }))

  test('expand texts', async () => {
    const result = await cds.db.read('AdminService.Books', {ID: 201}).columns(c => { c.ID, c.title, c.texts(t => {t.locale, t.title})})
    expect(result.texts).to.deep.include({locale: 'de', title: 'Sturmhöhe'})
  })

  test('locale from context/default', async () => {
    const default_ = await SELECT.localized.from('AdminService.Books', {ID: 201}).columns('ID', 'title')
    expect(default_.title).to.be.eq('Wuthering Heights')

    await cds.tx(de, async (tx) => {
      const de = await tx.run(SELECT.localized.from('AdminService.Books', {ID: 201}).columns('ID', 'title'))
      expect(de.title).to.be.eq('Sturmhöhe')
    })
  })

  test('insert texts', async () => {
    await cds.insert({ ID: 201, locale: 'es', title: 'Cumbres borrascosas'}).into`AdminService.Books[ID=201].texts`
    await cds.tx({ locale: 'es' }, async (tx) => {
      const es = await tx.run(SELECT.localized.from('AdminService.Books', {ID: 201}).columns('ID', 'title'))
      expect(es.title).to.be.eq('Cumbres borrascosas')
    })
  })
})
