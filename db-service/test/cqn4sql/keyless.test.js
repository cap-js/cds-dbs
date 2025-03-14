/**
 * Make sure we issue proper errors in case of path expression along keyless entities
 */
'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
describe('keyless entities', () => {
  let model

  beforeAll(async () => {
    model = await cds.load(__dirname + '/model/keyless').then(cds.linked)
  })
  describe('managed assocs', () => {
    it('no foreign keys for join', () => {
      const { Books } = model.entities
      const q = SELECT.columns('ID').from(Books).where(`author[ID = 42].book[ID = 42].author.name LIKE 'King'`)
      expect(() => cqn4sql(q, model)).to.throw(
        'Path step “author” of “author[…].book[…].author.name” has no foreign keys',
      )
      // ok if explicit foreign key is used
      const qOk = SELECT.columns('ID').from(Books).where(`authorWithExplicitForeignKey[ID = 42].name LIKE 'King'`)
      expect(cqn4sql(qOk, model)).to.eql(
        cds.ql`SELECT $B.ID FROM Books as $B 
        left join Authors as authorWithExplicitForeignKey
          on authorWithExplicitForeignKey.ID = $B.authorWithExplicitForeignKey_ID
          and authorWithExplicitForeignKey.ID = 42
        where authorWithExplicitForeignKey.name LIKE 'King'`,
      )
    })
    it('no foreign keys for join (2)', () => {
      const { Authors } = model.entities
      const q = SELECT.from(Authors).where(`book.authorWithExplicitForeignKey.book.my.author LIKE 'King'`)
      expect(() => cqn4sql(q, model)).to.throw(
        'Path step “author” of “book.authorWithExplicitForeignKey.book.my.author” has no foreign keys',
      )
    })
    it('scoped query leading to where exists subquery cant be constructed', () => {
      const q = SELECT.from('Books:author')
      expect(() => cqn4sql(q, model)).to.throw(`Path step “author” of “Books:author” has no foreign keys`)

      // ok if explicit foreign key is used
      const qOk = SELECT.from('Books:authorWithExplicitForeignKey').columns('ID')
      expect(cqn4sql(qOk, model)).to.eql(
        cds.ql`SELECT $a.ID FROM Authors as $a 
        where exists (
          SELECT 1 from Books as $B where $B.authorWithExplicitForeignKey_ID = $a.ID
        )`,
      )
    })
    it('where exists predicate cant be transformed to subquery', () => {
      const q = SELECT.columns('ID').from('Books').where('exists author')
      expect(() => cqn4sql(q, model)).to.throw(`Path step “author” of “author” has no foreign keys`)
      // ok if explicit foreign key is used
      const qOk = SELECT.from('Books').columns('ID').where('exists authorWithExplicitForeignKey')
      expect(cqn4sql(qOk, model)).to.eql(
        cds.ql`SELECT $B.ID FROM Books as $B 
        where exists (
          SELECT 1 from Authors as $a where $a.ID = $B.authorWithExplicitForeignKey_ID
        )`,
      )
    })
    it('correlated subquery for expand cant be constructed', () => {
      const q = cds.ql`SELECT author { name } from Books`
      expect(() => cqn4sql(q, model)).to.throw(`Can't expand “author” as it has no foreign keys`)
      // ok if explicit foreign key is used
      const qOk = cds.ql`SELECT authorWithExplicitForeignKey { name } from Books`
      expect(JSON.parse(JSON.stringify(cqn4sql(qOk, model)))).to.eql(
        cds.ql`
      SELECT
        (
          SELECT $a.name from Authors as $a
          where $B.authorWithExplicitForeignKey_ID = $a.ID
        ) as authorWithExplicitForeignKey
      from Books as $B`,
      )
    })

    it('calculated element navigates along keyless assoc', () => {
      const q = SELECT.from('Books').columns('authorName')
      expect(() => cqn4sql(q, model)).to.throw(`Path step “author” of “author.name” has no foreign keys`)
    })
  })
  describe('managed assocs as backlinks', () => {
    it('backlink has no foreign keys for join', () => {
      const { Authors } = model.entities
      const q = SELECT.from(Authors).where(`bookWithBackLink.title LIKE 'Potter'`)
      expect(() => cqn4sql(q, model)).to.throw(
        `Path step “bookWithBackLink” is a self comparison with “author” that has no foreign keys`,
      )
    })
    it('backlink has no foreign keys for scoped query', () => {
      const q = SELECT.columns('ID').from('Authors:bookWithBackLink')
      expect(() => cqn4sql(q, model)).to.throw(
        `Path step “bookWithBackLink” is a self comparison with “author” that has no foreign keys`,
      )
    })
    it('backlink has no foreign keys for where exists subquery', () => {
      const q = SELECT.from('Authors').where('exists bookWithBackLink')
      expect(() => cqn4sql(q, model)).to.throw(
        `Path step “bookWithBackLink” is a self comparison with “author” that has no foreign keys`,
      )
    })
    it('backlink has no foreign keys for expand subquery', () => {
      const q = cds.ql`SELECT bookWithBackLink { title } from Authors as Authors`
      expect(() => cqn4sql(q, model)).to.throw(
        `Path step “bookWithBackLink” is a self comparison with “author” that has no foreign keys`,
      )
    })
  })
})
