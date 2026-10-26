'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const cds = require('@sap/cds')
const Database = require('better-sqlite3')
const cqn4sql = require('../../lib/cqn4sql')
const cqn2sql = require('../../lib/cqn2sql')

const schema = [
  'entity Boss { key ID: Integer; name: String; }',
  'entity A { key ID: Integer; name: String; boss: Association to Boss;',
  'bossName = boss.name; nestedName = bossName; }',
  'entity B { key ID: Integer; a: Association to A; b: Association to A; }',
].join(' ')

function isolated(body) {
  const setup =
    'const cds = require("@sap/cds"); const model = cds.linked(cds.compile(' + JSON.stringify(schema) + '));'
  const child = spawnSync(process.execPath, ['-e', setup + body], {
    cwd: require('node:path').resolve(__dirname, '../../..'),
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(child.error, undefined, child.error?.message)
  assert.equal(child.status, 0, child.stderr)
  return child.stdout.trim()
}

describe('SQL planning regressions', () => {
  let model, db
  beforeAll(() => {
    model = cds.linked(cds.compile(schema))
    db = new Database(':memory:')
    db.exec(
      [
        'CREATE TABLE A (ID INTEGER PRIMARY KEY, name TEXT, boss_ID INTEGER);',
        'CREATE TABLE Boss (ID INTEGER PRIMARY KEY, name TEXT);',
        'CREATE TABLE B (ID INTEGER PRIMARY KEY, a_ID INTEGER, b_ID INTEGER);',
        "INSERT INTO A VALUES (1,'Worker A',11),(2,'Worker B',12);",
        "INSERT INTO Boss VALUES (11,'Boss A'),(12,'Boss B');",
        'INSERT INTO B VALUES (1,1,2);',
      ].join('\n'),
    )
  })
  afterAll(() => db.close())

  for (const field of ['bossName', 'nestedName']) {
    it('binds ' + field + ' independently on each association path', () => {
      const query = cds.ql('SELECT from B { a.' + field + ' as an, b.' + field + ' as bn }')
      const { sql, values } = cqn2sql(query, model)
      assert.deepEqual(db.prepare(sql).all(...values), [{ an: 'Boss A', bn: 'Boss B' }])
    })
  }

  it('binds calculations in inline wildcards to the associated row', () => {
    const query = cds.ql(
      'SELECT from B { a.{*} excluding {ID, name, boss, nestedName}, b.{*} excluding {ID, name, boss, nestedName} }',
    )
    const { sql, values } = cqn2sql(query, model)
    assert.deepEqual(db.prepare(sql).all(...values), [{ a_bossName: 'Boss A', b_bossName: 'Boss B' }])
  })

  it('preserves vectors and flattened FK exclusions in association wildcards', () => {
    const model = cds.linked(
      cds.compile(
        [
          'entity Other { key ID: Integer; }',
          'entity Target { key ID: Integer; vector: Vector(3); other: Association to Other; }',
          'entity Host { key ID: Integer; target: Association to Target; }',
        ].join(' '),
      ),
    )
    const query = cds.ql('SELECT from Host { target.{*} excluding {other_ID} }')
    const result = cqn4sql(query, model)
    assert.deepEqual(
      result.SELECT.columns.map(c => c.as || c.ref.at(-1)),
      ['target_ID', 'target_vector'],
    )
  })

  it('keeps filtered calculation paths independent', () => {
    const query = cds.ql('SELECT from B { a[ID=1].bossName as present, a[ID=2].bossName as absent }')
    const { sql, values } = cqn2sql(query, model)
    assert.deepEqual(db.prepare(sql).all(...values), [{ present: 'Boss A', absent: null }])
  })

  it('rejects direct and expression $self cycles without hanging', () => {
    isolated(
      [
        'const assert = require("node:assert/strict"), cqn4sql = require("./db-service/lib/cqn4sql");',
        'for (const columns of ["$self.b as a, $self.a as b", "$self.a as a", "$self.b + 1 as a, $self.a + 1 as b"])',
        'assert.throws(() => cqn4sql(cds.ql("SELECT from B { " + columns + " }"), model), /Cyclic \\$self reference/);',
      ].join('\n'),
    )
  })

  it('resolves a reverse-ordered $self dependency chain', () => {
    const columns = Array.from({ length: 200 }, (_, i) => ({ ref: ['$self', 'c' + (i + 1)], as: 'c' + i }))
    columns.push({ ref: ['ID'], as: 'c200' })
    const result = cqn4sql({ SELECT: { from: { ref: ['B'] }, columns } }, model)
    assert.equal(result.SELECT.columns.length, 201)
    assert.ok(result.SELECT.columns.every(c => c.ref.at(-1) === 'ID'))
  })

  it('transforms each nested FROM query once even when every scope needs a join', () => {
    const count = isolated(
      [
        'const path = require.resolve("./db-service/lib/cqn4sql/resolve"), resolve = require(path); let calls = 0;',
        'require.cache[path].exports = Object.assign((...args) => { calls++; return resolve(...args) }, resolve);',
        'const cqn4sql = require("./db-service/lib/cqn4sql");',
        'let q = cds.ql("SELECT from B {ID, a}");',
        'for(let i=0;i<8;i++) q = { SELECT: { from:q, columns:[{ref:["ID"]},{ref:["a"]},{ref:["a","name"],as:"n"}] } };',
        'cqn4sql(q, model); console.log(calls);',
      ].join('\n'),
    )
    assert.equal(Number(count), 9)
  })

  for (const kind of ['INSERT', 'UPSERT']) {
    for (const property of ['entries', 'rows']) {
      it('preserves opaque ' + kind + '.' + property + ' without traversing payloads', () => {
        isolated(
          [
            'const assert = require("node:assert/strict"), cqn4sql = require("./db-service/lib/cqn4sql");',
            'const payload = new Proxy([], {ownKeys() {throw new Error("payload traversed")}});',
            'const kind = ' + JSON.stringify(kind) + ', property = ' + JSON.stringify(property) + ';',
            'const input = Object.freeze({[kind]:Object.freeze({into:{ref:["B"]},[property]:payload})});',
            'const result = cqn4sql(input, model);',
            'assert.equal(result[kind][property], payload); assert.notEqual(result, input);',
          ].join('\n'),
        )
      })
    }
  }
})
