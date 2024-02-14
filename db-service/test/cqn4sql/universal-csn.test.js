'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('Universal CSN hybrid mode - flat and structured at the same time', () => {
    let model
  beforeAll(async () => {
    cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
    cds.model = cds.compile.for.nodejs(JSON.parse(JSON.stringify(cds.model)))
  })
  it('flat and structured access to the same element', () => {
    if(!cds.model.meta.unfolded) return;
    const q = CQL`select from bookshop.Books {
            dedication.text,
            dedication_text as flat
          }`
    const res = cqn4sql(q)
    const expected = CQL`SELECT from bookshop.Books as Books {
            Books.dedication_text,
            Books.dedication_text as flat
          }`

    expect(res).to.eql(expected)
  })

  it('flattening works', () => {
    if(!cds.model.meta.unfolded) return;
    const q = CQL`select from bookshop.Books {
            dedication as bar,
            dedication_text
          }`
    const res = cqn4sql(q)
    const expected = CQL`SELECT from bookshop.Books as Books {
            Books.dedication_addressee_ID as bar_addressee_ID,
            Books.dedication_text as bar_text,
            Books.dedication_sub_foo as bar_sub_foo,
            Books.dedication_dedication as bar_dedication,        
            Books.dedication_text
          }`

    expect(res).to.eql(expected)
  })

  it('expand works, even if flat elements are accessed', () => {
    if(!cds.model.meta.unfolded) return;
    const q = CQL`select from bookshop.Books {
            author {
                address_street
            }
          }`
    const res = cqn4sql(q)
    const expected = CQL`SELECT from bookshop.Books as Books {
            (
                SELECT from bookshop.Authors as author {
                    author.address_street
                } where Books.author_ID = author.ID
            ) as author
          }`

    expect(JSON.parse(JSON.stringify(res))).to.eql(expected)
  })

  it('error out on conflict', () => {
    if(!cds.model.meta.unfolded) return;
    const q = CQL`select from bookshop.Books {
            dedication.text,
            dedication_text,
          }`

    expect(() => {
      cqn4sql(q)
    }).to.throw(/dedication_text/)
  })

  it('no duplicates or clashes upon wildcard expansion', () => {
    if(!cds.model.meta.unfolded) return;
    let res = cqn4sql(CQL`SELECT from bookshop.Books`)
    const expected = CQL`SELECT from bookshop.Books as Books
          {
          Books.createdAt,
          Books.createdBy,
          Books.modifiedAt,
          Books.modifiedBy,
          Books.ID,
          Books.anotherText,
          Books.title,
          Books.descr,
          Books.author_ID,
          Books.coAuthor_ID,
          Books.genre_ID,
          Books.stock,
          Books.price,
          Books.currency_code,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
          Books.coAuthor_ID_unmanaged,
          }
        `
    expect(res.SELECT.columns.sort(customSort)).to.eql(expected.SELECT.columns.sort(customSort))
  })
})

function customSort(a, b) {
  // Get the last values from the "ref" arrays or set them as empty strings
  const lastValueA = a.ref && a.ref.length ? a.ref[a.ref.length - 1] : ''
  const lastValueB = b.ref && b.ref.length ? b.ref[b.ref.length - 1] : ''

  // Compare the last values alphabetically
  if (lastValueA < lastValueB) {
    return -1
  }
  if (lastValueA > lastValueB) {
    return 1
  }
  // If the last values are equal, maintain their original order
  return 0
}
