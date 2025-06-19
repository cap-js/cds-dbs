import cqn4sql from '../../lib/cqn4sql.js'
import cds from '@sap/cds'
const { expect } = cds.test
describe('functions', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })
  describe('general', () => {
    it('function in filter of expand', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
          author[substring(placeOfBirth, 0, 2) = 'DE'] { name }
        }`
      const qx = cds.ql`SELECT from bookshop.Books as Books {
          (
            SELECT $a.name
             from bookshop.Authors as $a
             where Books.author_ID = $a.ID and
             substring($a.placeOfBirth, 0, 2) = 'DE'

          ) as author
        }`
      const res = cqn4sql(q, model)
      expect(res.SELECT.columns[0].SELECT).to.have.property('expand').that.equals(true)
      expect(res.SELECT.columns[0].SELECT).to.have.property('one').that.equals(true)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('function val in func.args must not be expanded to fk comparison', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         1
        } where not exists author[contains(toLower('foo'))]`
      const qx = cds.ql`SELECT from bookshop.Books as Books {
          1
        } where not exists (
          SELECT 1 from bookshop.Authors as $a where $a.ID = Books.author_ID and contains(toLower('foo'))
        )`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
    it('function with dot operator', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         func1(ID, 'bar').func2(author.name, 'foo') as dotOperator
        } `
      const qx = cds.ql`
        SELECT from bookshop.Books as Books left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          func1(Books.ID, 'bar').func2(author.name, 'foo') as dotOperator
        }`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
  })

  describe('with named parameters', () => {
    it('in column', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         getAuthorsName( author => author.name, book => title ) as foo
        } `
      const qx = cds.ql`
        SELECT from bookshop.Books as Books left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          getAuthorsName( author => author.name, book => Books.title ) as foo
        }`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
    it('in infix filter', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         author[ 'King' = getAuthorsName( author => ID ) ].ID as foo
        } `
      const qx = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author on author.ID = Books.author_ID and
          'King' = getAuthorsName( author => author.ID )
        {
          author.ID as foo
        }`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
    it('in where', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         ID
        } where getAuthorsName( author => author.name ) = 'King'`
      const qx = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        } where getAuthorsName( author => author.name ) = 'King'`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })

    it('in order by', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         ID
        } order by getAuthorsName( author => author.name )`
      const qx = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        } order by getAuthorsName( author => author.name )`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })

    it('in group by', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         ID
        } group by getAuthorsName( author => author.name )`
      const qx = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        } group by getAuthorsName( author => author.name )`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })

    it('in having', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         ID
        } having getAuthorsName( author => author.name ) = 'King'`
      const qx = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        } having getAuthorsName( author => author.name ) = 'King'`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })

    it('in xpr', () => {
      const q = cds.ql`SELECT from bookshop.Books as Books {
         ID
        } where ('Stephen ' + getAuthorsName( author => author.name )) = 'Stephen King'`
      const qx = cds.ql`
        SELECT from bookshop.Books as Books
          left join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.ID
        } where ('Stephen ' + getAuthorsName( author => author.name )) = 'Stephen King'`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
    it('in from', () => {
      const q = cds.ql`SELECT from bookshop.Books[getAuthorsName( author => author.ID ) = 1] as Books {
         ID
        }`
      const qx = cds.ql`
        SELECT from bookshop.Books as Books
        {
          Books.ID
        } where getAuthorsName( author => Books.author_ID ) = 1`
      const res = cqn4sql(q, model)
      expect(res).to.deep.equal(qx)
    })
  })

  describe('without arguments', () => {
    it('function in filter in order by', () => {
      let query = {
        SELECT: {
          from: { ref: ['bookshop.Books'], as: 'Books'},
          columns: [{ ref: ['ID'] }],
          where: [{ func: 'current_date' }, '=', { val: 'today' }],
        },
      }
      let expected = cds.ql`
        SELECT Books.ID from bookshop.Books as Books
       where current_date = 'today'
      `

      let result = cqn4sql(query, model)
      expect(result).to.deep.equal(expected)
    })
  })
})
