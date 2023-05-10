// remove virtual fields in most cases
'use strict'
const cqn4sql = require('../../lib/db/sql/cqn4sql')
const cds = require('../../cds')
const { expect } = cds.test

describe('virtual fields', () => {
  let model;
  beforeAll(async () => {
    model = await cds.load(__dirname + '/bookshop/db/schema').then(cds.linked);
  });

  it('remove from columns', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo { ID, virtualField }`,
      model
    );
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Foo as Foo { Foo.ID }`
    );
  });

  // If select list is empty already in input, we produce corresponding SQL.
  // But if empty select list results from removing virtual fields, we throw an error.
  it('error out if removal of virtual element leads to empty columns', () => {
    let query = CQL`SELECT from bookshop.Foo { virtualField as x, stru.v }`
    expect(() => cqn4sql(query, model)).to.throw('Queries must have at least one non-virtual column')
  });

  it('remove from columns in struc', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo { ID, stru }`, model);
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`);
  });

  it('remove from columns with path into struc', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo {
        ID,
        stru.u,
        stru.v,
        stru.nested.nu,
        stru.nested.nv
      }`,
      model
    );
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`);
  });

  it('remove from columns via wildcard', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo`, model);
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.stru_u,
        Foo.stru_nested_nu
      }`);
  });

  it('remove from GROUP BY', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo { ID } group by ID, virtualField`,
      model
    );
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Foo as Foo { Foo.ID } group by Foo.ID`
    );
  });

  it('remove from ORDER BY', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo { ID, virtualField as x }
        order by ID, x, Foo.virtualField`,
      model
    );
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo { Foo.ID }
        order by ID`);
  });

  // Virtual fields in expressions are left untouched and will cause an error in the DB.
  // The idea to replace conditions involving virtual fields by "1=1" doesn't work, as we
  // are not able to detect where the conditions start/end (-> we don't understand xpr)
  it('leave untouched in expressions', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo {
        ID,
        virtualField - 2 * stru.v + stru.nested.nv as c
      } where virtualField = 2 * stru.v + stru.nested.nv`,
      model
    );
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Foo as Foo {
        Foo.ID,
        Foo.virtualField - 2 * Foo.stru_v + Foo.stru_nested_nv as c
      } where Foo.virtualField = 2 * Foo.stru_v + Foo.stru_nested_nv`);
  });

  it('leave untouched also in simple conditions', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Foo { ID } where ID = 5 and virtualField = 6`,
      model
    );
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Foo as Foo { Foo.ID } where Foo.ID = 5 and Foo.virtualField = 6`
    );
  });
});
