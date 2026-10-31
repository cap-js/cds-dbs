'use strict'

const assert = require('node:assert/strict')
const cds = require('@sap/cds')
const { expect } = cds.test
const cqn4sql = require('../../lib/cqn4sql')
const infer = require('../../lib/infer')
const { loadModel } = require('./helpers/model')

// Inspect data descriptors without invoking linked-CSN getters. This catches
// non-enumerable SQL metadata as well as changes to ordinary query/CSN data.
function snapshot(root, freeze = false) {
  const nodes = new Map()
  function visit(value, path) {
    if (!value || typeof value !== 'object' || nodes.has(value)) return
    const descriptors = Object.getOwnPropertyDescriptors(value)
    nodes.set(value, { path, descriptors })
    for (const key of Reflect.ownKeys(descriptors)) visit(descriptors[key].value, `${path}.${String(key)}`)
    if (freeze) Object.freeze(value)
  }
  visit(root, 'input')
  return () => {
    for (const [value, { path, descriptors }] of nodes) {
      assert.deepEqual(Reflect.ownKeys(value), Reflect.ownKeys(descriptors), path)
      for (const key of Reflect.ownKeys(descriptors)) {
        const before = descriptors[key]
        const after = Object.getOwnPropertyDescriptor(value, key)
        assert.equal(after.value, before.value, `${path}.${String(key)}`)
        assert.equal(after.get, before.get, `${path}.${String(key)} getter`)
      }
    }
  }
}

describe('immutable SQL transformation', () => {
  let model
  beforeAll(async () => {
    model = await loadModel()
  })

  const queries = [
    `SELECT from bookshop.Books as B { ID, author.name } where exists author[name = 'Alice']`,
    'SELECT from bookshop.Books[order by title] { ID } order by ID',
    'SELECT from bookshop.Books { author { ID, books { title } } }',
    'SELECT from bookshop.Books as Books { ID, (SELECT from bookshop.Authors { ID } where ID = Books.author.ID) as a }',
    {
      UPDATE: {
        entity: { ref: ['bookshop.Books'] },
        with: { title: { func: 'upper', args: [{ ref: ['title'] }] } },
        where: [{ ref: ['ID'] }, '=', { val: 1 }],
      },
    },
    { DELETE: { from: { ref: ['bookshop.Books'] }, where: [{ ref: ['author', 'name'] }, '=', { val: 'Alice' }] } },
    'SELECT from booksCalc.Books { ID, area, authorFullName }',
    'SELECT from bookshop.Books as B left join bookshop.Authors as A on B.author.ID = A.ID { B.ID }',
  ]

  for (const source of queries) {
    it(`accepts a frozen query: ${typeof source === 'string' ? source : Object.keys(source)[0]}`, () => {
      const query = typeof source === 'string' ? cds.ql(source) : structuredClone(source)
      const unchanged = snapshot(query, true)
      const first = cqn4sql(query, model)
      const second = cqn4sql(query, model)
      unchanged()
      assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)))
    })
  }

  it('does not enrich the model, including calculated values and association keys', async () => {
    const freshModel = await loadModel()
    const unchanged = snapshot(freshModel)
    for (const source of queries)
      cqn4sql(typeof source === 'string' ? cds.ql(source) : structuredClone(source), freshModel)
    unchanged()
  })

  it('does not mutate input through the infer compatibility API', () => {
    const query = cds.ql`SELECT from bookshop.Books { ID, author { name } }`
    const unchanged = snapshot(query, true)
    const result = infer(query, model)
    unchanged()
    expect(result.elements.author).to.exist
    assert.notEqual(result, query)
  })

  it('accepts a frozen model, including calculated expressions', async () => {
    const frozenModel = await loadModel()
    const unchanged = snapshot(frozenModel, true)
    for (const source of queries) {
      cqn4sql(typeof source === 'string' ? cds.ql(source) : structuredClone(source), frozenModel)
    }
    unchanged()
  })

  it('preserves generator inputs without consuming them', () => {
    let consumed = false
    const entries = (function* () {
      consumed = true
      yield { ID: 1 }
    })()
    const query = { INSERT: { into: { ref: ['bookshop.Books'] }, entries } }
    const result = cqn4sql(query, model)
    assert.equal(consumed, false)
    assert.equal(result.INSERT.entries, entries)
  })

  it('does not modify runtime view definitions or their wildcard columns', () => {
    const runtimeModel = cds.linked(
      cds.compile(`
      entity Books { key ID: Integer; title: String; content: LargeBinary; }
      @cds.persistence.skip entity AvailableBooks as select from Books { * };
    `),
    )
    const unchanged = snapshot(runtimeModel, true)
    const feature = cds.env.features.runtime_views
    cds.env.features.runtime_views = true
    try {
      const query = cds.ql`SELECT from AvailableBooks { ID, title }`
      const result = cqn4sql(query, runtimeModel)
      assert.equal(result._with.length, 1)
      assert.ok(result._with[0].SELECT.columns.some(c => c.ref?.at(-1) === 'content'))
      unchanged()
    } finally {
      cds.env.features.runtime_views = feature
    }
  })

  it('preserves caller metadata accessors without evaluating them', () => {
    const query = cds.ql('SELECT from bookshop.Books { ID }')
    let reads = 0
    Object.defineProperty(query, 'extension', {
      enumerable: true,
      get() {
        reads++
        return 'metadata'
      },
    })
    const result = cqn4sql(query, model)
    assert.equal(reads, 0)
    assert.equal(result.extension, 'metadata')
    assert.equal(reads, 1)
  })

  it('materializes inherited query clauses without retaining shared data', () => {
    const base = cds.ql`SELECT from bookshop.Books as B { ID } where ID = 1`
    const query = cds.ql.clone(base)
    const unchanged = snapshot(base, true)
    const result = cqn4sql(query, model)
    result.SELECT.where[2].val = 2
    unchanged()
    assert.equal(base.SELECT.where[2].val, 1)
  })
})
