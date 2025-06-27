const cds = require('../../test/cds')

describe('search', () => {
  const { expect } = cds.test(__dirname, 'fuzzy.cds')

  beforeEach (() => {
    delete cds.env.hana.fuzzy
  })

  describe('fuzzy', () => {
    test('default', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobio"').columns('1')
      const {sql} = cqn.toSQL()
      expect(sql).to.include('FUZZY MINIMAL TOKEN SCORE 0.7')
      const res = await cqn
      expect(res.length).to.be(2) // Eleonora and Jane Eyre
    })
    
    //HCE returns different result than HXE
    test.skip('multiple search terms', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobio" "jane"').columns('1')
      const {sql, values} = cqn.toSQL()
      expect(sql).to.include('FUZZY MINIMAL TOKEN SCORE 0.7')
      expect(values[0]).to.eq('"autobio" "jane"') // taken as is
      const res = await cqn
      expect(res.length).to.be(2) // Eleonora and Jane Eyre
    })
    
    test('global config', async () => {
      cds.env.hana.fuzzy = 1
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobiography"').columns('1')
      const {sql} = cqn.toSQL()
      expect(sql).to.include('EXACT MINIMAL SCORE 1')
      const res = await cqn
      expect(res.length).to.be(1) // Jane Eyre
    })

    test('global config', async () => {
      cds.env.hana.fuzzy = 1
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('is often').columns('1')
      const {sql} = cqn.toSQL()
      expect(sql).to.include('EXACT MINIMAL SCORE 1')
      const res = await cqn
      expect(res.length).to.be(2) // Eleonora and Raven
    })

    test('annotations', async () => {
      const { BooksAnnotated } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(BooksAnnotated).search('"first-person"').columns('1')
      const {sql} = cqn.toSQL()
      expect(sql).to.include('title FUZZY WEIGHT 0.8 MINIMAL TOKEN SCORE 0.9')
      expect(sql).to.include('code FUZZY WEIGHT 0.5 MINIMAL TOKEN SCORE 0.7')
      expect(sql).to.include('descr FUZZY WEIGHT 0.3 MINIMAL TOKEN SCORE 0.9')
      
      const res = await cqn
      expect(res.length).to.be(1) // jane eyre
    })

    test('annotations with score 1', async () => {
      const { BooksAnnotatedScore1 } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(BooksAnnotatedScore1).search('is often').columns('1')
      const {sql} = cqn.toSQL()
      expect(sql).to.include('title FUZZY WEIGHT 0.8 MINIMAL TOKEN SCORE 0.9')
      expect(sql).to.include('code FUZZY WEIGHT 0.5 MINIMAL TOKEN SCORE 0.7')
      expect(sql).to.include('descr EXACT WEIGHT 0.3 MINIMAL SCORE 1')
      
      const res = await cqn
      expect(res.length).to.be(2) // Eleonora and Raven
    })
  })

  describe('like', () => {
    beforeEach (() => cds.env.hana.fuzzy = false)
    test('fallback - 1 search term', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobio"').columns('1')
      const {sql} = cqn.toSQL()
      // 5 columns to be searched createdBy, modifiedBy, title, descr, currency_code
      expect(sql.match(/(like)/g).length).to.be(5)
      const res = await cqn
      expect(res.length).to.be(2) // Eleonora and Jane Eyre
    })

    test('fallback - 2 search terms', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobio"', '"Jane"').columns('1')
      const {sql, values} = cqn.toSQL()
      // 5 columns to be searched createdBy, modifiedBy, title, descr, currency_code
      expect(sql.match(/(like)/g).length).to.be(10)
      expect(values).to.include('%autobio%')
      expect(values).to.include('%jane%')
      const res = await cqn
      expect(res.length).to.be(1) // Jane Eyre
    })

    test('fallback - 3 search terms with special characters', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"1847"', '1846', '"\\"Ellis Bell\\""').columns('1')
      const { sql, values } = cqn.toSQL()
      // 5 columns to be searched createdBy, modifiedBy, title, descr, currency_code
      expect(sql.match(/(like)/g).length).to.be(15)
      expect(values).to.include('%1847%')
      expect(values).to.include('%1846%')
      expect(values).to.include('%"ellis bell"%')
      const res = await cqn
      expect(res.length).to.be(1) // Emily Brontë
    })
  })
})