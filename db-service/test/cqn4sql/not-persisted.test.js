// remove virtual fields in most cases
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
let model
beforeAll(async () => {
  model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
})
describe('virtual fields', () => {
  it('remove from columns', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo { ID, virtualField }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo { Foo.ID }`)
  })

  // If select list is empty already in input, we produce corresponding SQL.
  // But if empty select list results from removing virtual fields, we throw an error.
  it('error out if removal of virtual element leads to empty columns', () => {
    let query = CQL`SELECT from bookshop.Foo { virtualField as x, stru.v }`
    expect(() => cqn4sql(query, model)).to.throw('Queries must have at least one non-virtual column')
  })

  it('remove from columns in struc', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo { ID, stru }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`)
  })

  it('remove from columns with path into struc', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo {
        ID,
        stru.u,
        stru.v,
        stru.nested.nu,
        stru.nested.nv
      }`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`)
  })

  it('remove from columns via wildcard', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.toFoo_ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`)
  })

  it('remove from GROUP BY', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo { ID } group by ID, virtualField`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo { Foo.ID } group by Foo.ID`)
  })

  it('remove from ORDER BY', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo { ID, virtualField as x }
        order by ID, x, Foo.virtualField`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo { Foo.ID }
        order by ID`)
  })

  it('dont remove in xpr in ORDER BY', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo { ID, virtualField as x }
        order by ID, x, (Foo.toFoo.virtualField * 42)`,
      model,
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Foo as Foo left join bookshop.Foo as toFoo on toFoo.ID = Foo.toFoo_ID
        {
          Foo.ID
        }
        order by ID, (toFoo.virtualField * 42)`,
    )
  })

  it('Navigation to virtual field does not cause join', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo {
        ID,
        toFoo.virtualField,
      }`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
      }`)
  })

  // Virtual fields in expressions are left untouched and will cause an error in the DB.
  // The idea to replace conditions involving virtual fields by "1=1" doesn't work, as we
  // are not able to detect where the conditions start/end (-> we don't understand xpr)
  it('leave untouched in expressions', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo {
        ID,
        virtualField - 2 * stru.v + stru.nested.nv as c
      } where virtualField = 2 * stru.v + stru.nested.nv`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.virtualField - 2 * Foo.stru_v + Foo.stru_nested_nv as c
      } where Foo.virtualField = 2 * Foo.stru_v + Foo.stru_nested_nv`)
  })

  it('Navigation to virtual field does cause join in expression', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo {
        ID,
        toFoo.virtualField + 42 / 20 as virtualField,
      }`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo 
        left join bookshop.Foo as toFoo on toFoo.ID = Foo.toFoo_ID
      {
        Foo.ID,
        toFoo.virtualField + 42 / 20 as virtualField
      }`)
  })

  it('leave untouched also in simple conditions', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo { ID } where ID = 5 and virtualField = 6`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Foo as Foo { Foo.ID } where Foo.ID = 5 and Foo.virtualField = 6`,
    )
  })
})

describe('@cds.persistence.skip', () => {
  it('ignores column if assoc in path expression has target ”@cds.persistence.skip”', () => {
    const q = CQL`SELECT from bookshop.NotSkipped {
      ID, skipped.notSkipped.text
    }`
    const qx = CQL`SELECT from bookshop.NotSkipped as NotSkipped
    {
      NotSkipped.ID,
    }`
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })
  it('ignores column if assoc in path expression has target ”@cds.persistence.skip” in order by / group by', () => {
    const q = CQL`SELECT from bookshop.NotSkipped {
      ID
    } group by skipped.notSkipped.text 
      order by skipped.notSkipped.text`
    const qx = CQL`SELECT from bookshop.NotSkipped as NotSkipped
    {
      NotSkipped.ID,
    }`
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  // same as for virtual
  it('error out if removal of element leads to empty columns', () => {
    let query = CQL`SELECT from bookshop.NotSkipped { skipped.notSkipped.text }`
    expect(() => cqn4sql(query, model)).to.throw('Queries must have at least one non-virtual column')
  })

  // same as for virtual
  it('does not touch expression but renders the potentially wrong SQL', () => {
    const q = CQL`SELECT from bookshop.NotSkipped {
      ID, skipped.notSkipped.text * 2 + 5 as bar
    } where (skipped.notSkipped.text / 2 + 5) = 42`
    const qx = CQL`SELECT from bookshop.NotSkipped as NotSkipped
                  left outer join bookshop.Skip as skipped on skipped.ID = NotSkipped.skipped_ID
                  left outer join bookshop.NotSkipped as notSkipped2 on notSkipped2.ID = skipped.notSkipped_ID
    {
      NotSkipped.ID,
      notSkipped2.text * 2 + 5 as bar
    } where (notSkipped2.text / 2 + 5) = 42`
    const res = cqn4sql(q, model)
    expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
  })

  it('do not remove from simple conditions', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.NotSkipped { ID } where skipped.notSkipped.text`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.NotSkipped as NotSkipped
          left outer join bookshop.Skip as skipped on skipped.ID = NotSkipped.skipped_ID
          left outer join bookshop.NotSkipped as notSkipped2 on notSkipped2.ID = skipped.notSkipped_ID
      { NotSkipped.ID } where notSkipped2.text`,
    )
  })
})
