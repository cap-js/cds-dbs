import cqn4sql from '../../lib/cqn4sql.js'
import cds from '@sap/cds'
const { expect } = cds.test

describe('Pseudo Variables', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  // let { cqn, elements } = cqn4sql (cqn,model,context)
  // let context = {
  //   $user: { id, locale, '<attr>':1 },
  //   $now,
  //   $at,
  //   $from, $to
  // }

  it('stay untouched in SELECT', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books {
      ID,
      $user,
      $user.id,
      $user.locale,
      $user.tenant,
      $user.unknown.foo.bar,

      $now,
      $at,
      $to,
      $from,
      $locale,
      $tenant
    }`,
      model,
    )

    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
      Books.ID,
      $user,
      $user.id,
      $user.locale,
      $user.tenant,
      $user.unknown.foo.bar,

      $now,
      $at,
      $to,
      $from,
      $locale,
      $tenant
    }`)
  })

  it('stay untouched in WHERE/GROUP BY/ORDER BY', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books {
      ID
    } WHERE $user = 'karl' and $user.locale = 'DE' and $user.unknown.foo.bar = 'foo'
      GROUP BY $user.id, $to
      ORDER BY $user.locale, $now
    `,
      model,
    )

    expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
      Books.ID,
    } WHERE $user = 'karl' and $user.locale = 'DE' and $user.unknown.foo.bar = 'foo'
      GROUP BY $user.id, $to
      ORDER BY $user.locale, $now
    `)
  })

  it('stay untouched in filter', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books as Books {
      ID,
      author[name = $user.name or dateOfDeath < $now].dateOfBirth
    }`,
      model,
    )

    const expected = cds.ql`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID
                                                 and ( author.name = $user.name or author.dateOfDeath < $now )
      { Books.ID, author.dateOfBirth as author_dateOfBirth }
    `
    expect(query).to.deep.equal(expected)
  })

  it('stay untouched in generated join', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.SimpleBook as SimpleBook {
      ID
    } where activeAuthors.name = $user.name`,
      model,
    )

    const expected = cds.ql`SELECT from bookshop.SimpleBook as SimpleBook
      left outer join bookshop.Authors as activeAuthors on activeAuthors.ID = SimpleBook.author_ID and $now = $now and $user.id = $user.tenant
      { SimpleBook.ID }
      where activeAuthors.name = $user.name
    `
    expect(query).to.deep.equal(expected)
  })

  it('stay untouched in where exists', () => {
    let query = cqn4sql(
      cds.ql`SELECT from bookshop.Books {
      ID
    } where exists author[$user.name = 'towald'] `,
      model,
    )

    const expected = cds.ql`SELECT from bookshop.Books as $B
      { $B.ID }
       where exists (
          SELECT 1 from bookshop.Authors as $a where $a.ID = $B.author_ID and $user.name = 'towald'
       )
    `
    expect(query).to.deep.equal(expected)
  })

  it('must not be prefixed by table alias', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID, Books.$now }`, model)).to.throw(
      '"$now" not found in "bookshop.Books"',
    )
  })

  it('must not be prefixed by struc or assoc', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, author.$user }`, model)).to.throw(
      '"$user" not found in "author"',
    )
  })
  it('only well defined pseudo variables are allowed', () => {
    expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID, $whatever }`, model)).to.throw(
      '"$whatever" not found in the elements of "bookshop.Books"',
    )
  })
})
