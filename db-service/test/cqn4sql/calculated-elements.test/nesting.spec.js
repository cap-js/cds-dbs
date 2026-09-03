'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('Unfolding calculated elements - nesting (calc element references calc element)', () => {
  before(async () => {
    const model = await loadModel()
    const orig = cqn4sql
    cqn4sql = (q, m) => orig(q, m ?? model)
  })

  it('nested calc elems', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, volume, storageVolume }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        (Books.length * Books.width) * Books.height as volume,
        Books.stock * ((Books.length * Books.width) * Books.height) as storageVolume
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('nested calc elems, nested in direct expression', () => {
    const transformed = cqn4sql(cds.ql`SELECT from booksCalc.Books as Books { ID, storageVolume / volume as f }`)
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books {
        Books.ID,
        (Books.stock * ((Books.length * Books.width) * Books.height))
          / ((Books.length * Books.width) * Books.height) as f
      }`
    expectCqn(transformed).to.equal(expected)
  })

  it('calc elem contains other calculated element in xpr with nested joins', () => {
    const transformed = cqn4sql(
      cds.ql`SELECT from booksCalc.Books as Books { ID, authorFullNameWithAddress } where authorFullNameWithAddress = 'foo'`,
    )
    // intermediate:
    // SELECT from booksCalc.Books { ID, author.name, author.lastName }
    const expected = cds.ql`
      SELECT from booksCalc.Books as Books
      left outer join booksCalc.Authors as author on author.ID = Books.author_ID
      left outer join booksCalc.Addresses as address on address.ID = author.address_ID
      {
        Books.ID,
        (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city)
         as authorFullNameWithAddress,
      } where ( (author.firstName || ' ' || author.lastName) || ' ' || (address.street || ', ' || address.city) ) = 'foo'`
    expectCqn(transformed).to.equal(expected)
  })
})
