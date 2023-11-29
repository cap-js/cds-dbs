const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - localization', () => {
  const { expect } = cds.test(bookshop)

  test('expand texts', async () => {
    const result = await cds.db.read('AdminService.Books', {ID: 201}).columns(c => { c.ID, c.title, c.texts(t => {t.locale, t.title})})
    expect(result.texts).to.deep.include({locale: 'de', title: 'Sturmhöhe'})
  })

  test('locale from context/default', async () => {
    const default_ = await SELECT.localized.from('AdminService.Books', {ID: 201}).columns('ID', 'title')
    expect(default_.title).to.be.eq('Wuthering Heights')

    await cds.tx({ locale: 'de' }, async (tx) => {
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
