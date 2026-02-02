const cds = require('../../test/cds')

describe('search', () => {
  const { expect } = cds.test(__dirname, 'fuzzy.cds')

  beforeEach(() => {
    delete cds.env.hana.fuzzy
  })

  describe('fuzzy', () => {
    test('default', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobio"')
      const { sql } = cqn.toSQL()
      expect(sql).to.include('FUZZY MINIMAL SCORE 0.7')
      await cqn
    })

    test('multiple search terms', async () => {
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobio" "jane"').columns('1')
      const { sql, values } = cqn.toSQL()
      expect(sql).to.include('FUZZY MINIMAL SCORE 0.7')
      expect(values[0]).to.eq('"autobio" "jane"') // taken as is
      await cqn
    })

    test('global config', async () => {
      cds.env.hana.fuzzy = 1
      const { Books } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(Books).search('"autobio"').columns('1')
      const { sql } = cqn.toSQL()
      expect(sql).to.include('FUZZY MINIMAL SCORE 1')
      await cqn
    })

    test('list of elements - annotations', async () => {
      const { BooksAnnotated } = cds.entities('sap.capire.bookshop')
      const cqn = SELECT.from(BooksAnnotated).search('"first-person"').columns('1')
      const { sql } = cqn.toSQL()
      expect(sql).to.include('title FUZZY WEIGHT 0.8 MINIMAL SCORE 0.9')
      expect(sql).to.include('code FUZZY WEIGHT 0.5 MINIMAL SCORE 0.7')
      expect(sql).to.include('descr FUZZY WEIGHT 0.3 MINIMAL SCORE 0.9')

      const res = await cqn
      expect(res.length).to.be(1) // jane eyre
    })

    test('single element - annotations', async () => {
      const { BooksSingleAnnotated } = cds.entities
      const cqn = SELECT.from(BooksSingleAnnotated).search('"first-person"').columns('1')
      const { sql } = cqn.toSQL()
      expect(sql).to.include('descr FUZZY WEIGHT 0.3 MINIMAL SCORE 0.9')

      const res = await cqn
      expect(res.length).to.be(1) // jane eyre
    })
  })
})