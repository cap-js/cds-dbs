'use strict'

const cds = require('@sap/cds')
const cqn4sql = require('../../db-service/lib/cqn4sql')
const SQLiteService = require('../lib/SQLiteService')

describe('SQLite vector embedding defaults', () => {
  let requires

  const model = cds.linked(
    cds.compile.to.csn(`
    entity Books {
      key ID : Integer;
      @cds.embeddings.model: 'special-embeddings'
      embedding : Vector;
      text : String;
      @cds.embeddings.model: 'special-embeddings'
      calculated : Vector = vector_embedding(text, 'DOCUMENT', 'SPECIAL.MODEL');
      related : Association to Books;
    }
  `),
  )

  const prepare = expression => cqn4sql(cds.parse.cql(`SELECT from Books { ${expression} as result }`), model)
  const render = expression => new SQLiteService.CQN2SQL({ model }).render(prepare(expression))

  beforeEach(() => {
    requires = {
      embeddings: cds.requires.embeddings,
      'special-embeddings': cds.requires['special-embeddings'],
    }
    Object.assign(cds.requires, {
      embeddings: { model: 'DEFAULT.MODEL' },
      'special-embeddings': { model: 'SPECIAL.MODEL' },
    })
  })

  afterEach(() => {
    for (const [name, config] of Object.entries(requires)) {
      if (config === undefined) delete cds.requires[name]
      else cds.requires[name] = config
    }
  })

  test.each([true, false])('defaults standalone embeddings to QUERY with configuration present: %s', configured => {
    if (!configured) {
      delete cds.requires.embeddings
      delete cds.requires['special-embeddings']
    }

    const { sql, values } = render("vector_embedding('needle')")

    expect(sql).toBe('SELECT vector_embedding(?,\'QUERY\') as result FROM Books as "$B"')
    expect(values).toEqual(['needle'])
  })

  test.each([
    [
      "cosine_similarity(embedding, vector_embedding('needle'))",
      'cosine_similarity("$B".embedding,vector_embedding(?,\'QUERY\'))',
    ],
    [
      "cosine_similarity(vector_embedding('needle'), embedding)",
      'cosine_similarity(vector_embedding(?,\'QUERY\'),"$B".embedding)',
    ],
    ["l2distance(embedding, vector_embedding('needle'))", 'l2distance("$B".embedding,vector_embedding(?,\'QUERY\'))'],
    ["l2distance(vector_embedding('needle'), embedding)", 'l2distance(vector_embedding(?,\'QUERY\'),"$B".embedding)'],
    [
      "cosine_similarity(embedding, l2normalize(vector_embedding('needle')))",
      'cosine_similarity("$B".embedding,l2normalize(vector_embedding(?,\'QUERY\')))',
    ],
    [
      "L2DISTANCE(L2NORMALIZE(embedding), VECTOR_EMBEDDING('needle'))",
      'L2DISTANCE(L2NORMALIZE("$B".embedding),vector_embedding(?,\'QUERY\'))',
    ],
  ])('defaults nested embeddings without using the annotated HANA model: %s', (expression, expected) => {
    const { sql, values } = render(expression)

    expect(sql).toBe(`SELECT ${expected} as result FROM Books as "$B"`)
    expect(values).toEqual(['needle'])
  })

  test('defaults nested embeddings without any embeddings configuration', () => {
    delete cds.requires.embeddings
    delete cds.requires['special-embeddings']

    const { sql, values } = render("cosine_similarity(embedding, vector_embedding('needle'))")

    expect(sql).toBe(
      'SELECT cosine_similarity("$B".embedding,vector_embedding(?,\'QUERY\')) as result FROM Books as "$B"',
    )
    expect(values).toEqual(['needle'])
  })

  test.each([
    ["vector_embedding('needle', 'DOCUMENT')", ['needle', 'DOCUMENT']],
    ["VECTOR_EMBEDDING('needle', 'DOCUMENT', 'EXPLICIT.MODEL')", ['needle', 'DOCUMENT', 'EXPLICIT.MODEL']],
    [
      "vector_embedding('needle', 'QUERY', 'EXPLICIT.MODEL', 'REMOTE.SOURCE')",
      ['needle', 'QUERY', 'EXPLICIT.MODEL', 'REMOTE.SOURCE'],
    ],
  ])('preserves supplied arguments: %s', (call, expectedValues) => {
    const { sql, values } = render(`cosine_similarity(embedding, ${call})`)

    expect(sql).toBe(
      `SELECT cosine_similarity("$B".embedding,vector_embedding(${expectedValues.map(() => '?')})) as result FROM Books as "$B"`,
    )
    expect(values).toEqual(expectedValues)
  })

  test('preserves the explicit arguments of an annotated calculated vector', () => {
    const { sql, values } = render("cosine_similarity(calculated, vector_embedding('needle'))")

    expect(sql).toBe(
      "SELECT cosine_similarity(vector_embedding(\"$B\".text,'DOCUMENT','SPECIAL.MODEL'),vector_embedding(?,'QUERY')) as result FROM Books as \"$B\"",
    )
    expect(values).toEqual(['needle'])
  })

  test('defaults embeddings beside an annotated association target', () => {
    const { sql, values } = render("cosine_similarity(related.embedding, vector_embedding('needle'))")

    expect(sql).toContain("cosine_similarity(related.embedding,vector_embedding(?,'QUERY'))")
    expect(sql).toContain('left JOIN Books as related ON related.ID = "$B".related_ID')
    expect(values).toEqual(['needle'])
  })

  test('preserves casts and reusable CQN while defaulting to QUERY', () => {
    const cqn = prepare("cosine_similarity(embedding, cast(vector_embedding('needle') as Vector))")
    const original = JSON.stringify(cqn)
    const { sql, values } = new SQLiteService.CQN2SQL({ model }).render(cqn)

    expect(sql).toBe(
      'SELECT cosine_similarity("$B".embedding,cast(vector_embedding(?,\'QUERY\') as BINARY_BLOB(5000))) as result FROM Books as "$B"',
    )
    expect(values).toEqual(['needle'])
    expect(JSON.stringify(cqn)).toBe(original)
    expect(new SQLiteService.CQN2SQL({ model }).render(cqn)).toMatchObject({ sql, values })
  })

  test.each(['vector_embedding()', 'cosine_similarity(embedding, vector_embedding())'])(
    'leaves zero-argument embeddings unchanged: %s',
    expression => {
      const { sql, values } = render(expression)

      expect(sql).toContain('vector_embedding()')
      expect(sql).not.toContain('QUERY')
      expect(values).toEqual([])
    },
  )
})
