/*
If a path in a list (`columns`, `order by`, `group by`)
has either:

- one assoc step which points to a definition with `@cds.persistence.skip: true`
- the leaf of the path is `virtual`

the whole path is removed from the `list`. If the `list` is `columns` and the
`list` would be empty after such a removal, an error is emitted.

If the path exists within an `xpr` we do not filter it out, but process it as a regular path -> render joins, perform flattening, e.t.c.
*/

'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
let model
describe('not persisted', () => {
  beforeAll(async () => {
    model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('virtual fields', () => {
    it('remove from columns', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Foo as Foo { ID, virtualField }`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Foo as Foo { Foo.ID }`)
    })

    // If select list is empty already in input, we produce corresponding SQL.
    // But if empty select list results from removing virtual fields, we throw an error.
    it('error out if removal of virtual element leads to empty columns', () => {
      let query = cds.ql`SELECT from bookshop.Foo { virtualField as x, stru.v }`
      expect(() => cqn4sql(query, model)).to.throw('Queries must have at least one non-virtual column')
    })

    it('remove from columns in struc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Foo as Foo { ID, stru }`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`)
    })

    it('remove from columns with path into struc', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Foo as Foo {
        ID,
        stru.u,
        stru.v,
        stru.nested.nu,
        stru.nested.nv
      }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`)
    })

    it('remove from columns via wildcard', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Foo as Foo`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.toFoo_ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`)
    })

    it('remove from GROUP BY', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Foo as Foo { ID } group by ID, virtualField`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Foo as Foo { Foo.ID } group by Foo.ID`)
    })

    it('remove from ORDER BY', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Foo as Foo { ID, virtualField as x }
        order by ID, x, Foo.virtualField`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Foo as Foo { Foo.ID }
        order by ID`)
    })


    it('Navigation to virtual field does not cause join', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Foo as Foo {
        ID,
        toFoo.virtualField,
      }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Foo as Foo {
        Foo.ID,
      }`)
    })

    // Virtual fields in expressions are left untouched and will cause an error in the DB.
    // The idea to replace conditions involving virtual fields by "1=1" doesn't work, as we
    // are not able to detect where the conditions start/end (-> we don't understand xpr)
    it('reject virtual elements in expressions', () => {
      let query = cds.ql`SELECT from bookshop.Foo {
        ID
      } where virtualField = 2 * stru.v + stru.nested.nv and virtualField`;
      expect(() => cqn4sql(query, model)).to.throw('Virtual elements are not allowed in expressions')
    })

    it('reject virtual elements in column expressions', () => {
      let query = cds.ql`SELECT from bookshop.Foo {
        ID,
        toFoo.virtualField + 42 / 20 as virtualField,
      }`
      expect(() => cqn4sql(query, model)).to.throw('Virtual elements are not allowed in expressions')
    })

    it('reject virtual elements in simple conditions', () => {
      let query = cds.ql`SELECT from bookshop.Foo as Foo { ID } where ID = 5 and virtualField = 6`
      expect(() => cqn4sql(query, model)).to.throw('Virtual elements are not allowed in expressions')
    })

    it('reject virtual elements in order by', () => {
      let query =  cds.ql`SELECT from bookshop.Foo as Foo { ID, virtualField as x }
        order by ID, x, (Foo.toFoo.virtualField * 42)`
      expect(() => cqn4sql(query, model)).to.throw('Virtual elements are not allowed in expressions')
    })
  })

  describe('paths with @cds.persistence.skip', () => {
    it('ignores column if assoc in path expression has target ”@cds.persistence.skip”', () => {
      const q = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped {
      ID, skipped.notSkipped.text
    }`
      const qx = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped
    {
      NotSkipped.ID,
    }`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('ignores column if assoc in path expression has target ”@cds.persistence.skip” in order by / group by', () => {
      const q = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped {
      ID
    } group by skipped.notSkipped.text
      order by skipped.notSkipped.text`
      const qx = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped
    {
      NotSkipped.ID,
    }`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })

    // same as for virtual
    it('error out if removal of element leads to empty columns', () => {
      let query = cds.ql`SELECT from bookshop.NotSkipped { skipped.notSkipped.text }`
      expect(() => cqn4sql(query, model)).to.throw('Queries must have at least one non-virtual column')
    })

    // same as for virtual
    it('does not touch expression but renders the potentially wrong SQL', () => {
      const q = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped {
      ID, skipped.notSkipped.text * 2 + 5 as bar
    } where (skipped.notSkipped.text / 2 + 5) = 42`
      const qx = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped
                  left outer join bookshop.Skip as skipped on skipped.ID = NotSkipped.skipped_ID
                  left outer join bookshop.NotSkipped as notSkipped2 on notSkipped2.ID = skipped.notSkipped_ID
    {
      NotSkipped.ID,
      notSkipped2.text * 2 + 5 as bar
    } where (notSkipped2.text / 2 + 5) = 42`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('No join for a skip path within filter if outer path is not persisted', () => {
      const q = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped {
      ID, skipped[notSkipped.ID = 42].notSkipped.text
    }`
      const qx = cds.ql`SELECT from bookshop.NotSkipped as NotSkipped
    {
      NotSkipped.ID,
    }`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })

    it('Join for a skip path within filter if outer path is persisted', () => {
      const q = cds.ql`SELECT from bookshop.SkippedAndNotSkipped as SkippedAndNotSkipped {
      ID, self[skipped.ID = 42].ID
    }`
      const qx = cds.ql`SELECT from bookshop.SkippedAndNotSkipped as SkippedAndNotSkipped
      left join bookshop.SkippedAndNotSkipped as self on self.ID = SkippedAndNotSkipped.self_ID and self.skipped_ID = 42
    {
      SkippedAndNotSkipped.ID,
      self.ID as self_ID,
    }`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    it('Join for a skip path within filter if outer path is persisted in order by', () => {
      const q = cds.ql`SELECT from bookshop.SkippedAndNotSkipped as SkippedAndNotSkipped {
      ID
    } order by self[skipped.ID = 42].ID`
      const qx = cds.ql`SELECT from bookshop.SkippedAndNotSkipped as SkippedAndNotSkipped
      left join bookshop.SkippedAndNotSkipped as self on self.ID = SkippedAndNotSkipped.self_ID and self.skipped_ID = 42
    {
      SkippedAndNotSkipped.ID,
    } order by self.ID`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })

    it('do not remove from simple conditions', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.NotSkipped as NotSkipped { ID } where skipped.notSkipped.text`, model)
      expect(query).to.deep.equal(
        cds.ql`SELECT from bookshop.NotSkipped as NotSkipped
          left outer join bookshop.Skip as skipped on skipped.ID = NotSkipped.skipped_ID
          left outer join bookshop.NotSkipped as notSkipped2 on notSkipped2.ID = skipped.notSkipped_ID
      { NotSkipped.ID } where notSkipped2.text`,
      )
    })
  })
})
