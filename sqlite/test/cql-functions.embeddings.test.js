'use strict'

const cds = require('@sap/cds')
const cqn4sql = require('../../db-service/lib/cqn4sql')
const SQLiteService = require('../lib/SQLiteService')

describe('SQLite vector embedding defaults', () => {
  let requires

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

  const render = (args, func = 'cosine_similarity') =>
    new SQLiteService.CQN2SQL().render({
      SELECT: {
        from: { ref: ['Books'] },
        columns: [{ func, args, as: 'score' }],
      },
    })

  const vector = model => ({
    ref: ['embedding'],
    element: { type: 'cds.Vector', ...(model && { '@cds.embeddings.model': model }) },
  })

  const query = args => ({ func: 'vector_embedding', args })

  const model = cds.linked(
    cds.compile.to.csn(`
    entity Books {
      key ID : Integer;
      @cds.embeddings.model: 'special-embeddings'
      embedding : Vector;
      text : String;
      @cds.embeddings.model: 'special-embeddings'
      calculated : Vector = vector_embedding(text, 'DOCUMENT', 'SPECIAL.MODEL');
      @cds.embeddings.model: 'special-embeddings'
      normalized : Vector = l2normalize(vector_embedding(text, 'DOCUMENT', 'SPECIAL.MODEL'));
      related : Association to Books;
    }
  `),
  )

  const renderCql = cql => {
    const cqn = cqn4sql(cds.parse.cql(cql), model)
    return new SQLiteService.CQN2SQL({ model }).render(cqn)
  }

  test('adds QUERY and the configured default model to standalone query embeddings', () => {
    const call = query([{ val: 'needle' }])
    const { sql, values } = new SQLiteService.CQN2SQL().render({
      SELECT: {
        from: { ref: ['Books'] },
        columns: [{ ...call, as: 'embedding' }],
      },
    })

    expect(sql).toBe("SELECT vector_embedding(?,'QUERY','DEFAULT.MODEL') as embedding FROM Books")
    expect(values).toEqual(['needle'])
    expect(call.args).toEqual([{ val: 'needle' }])
  })

  test('adds QUERY and the configured default model to a query embedding', () => {
    const call = query([{ val: 'needle' }])

    const { sql, values } = render([vector(), call])

    expect(sql).toBe(
      "SELECT cosine_similarity(embedding,vector_embedding(?,'QUERY','DEFAULT.MODEL')) as score FROM Books",
    )
    expect(values).toEqual(['needle'])
    expect(call.args).toEqual([{ val: 'needle' }])
  })

  test('leaves a zero-argument nested query embedding unchanged', () => {
    const { sql, values } = render([vector(), { func: 'vector_embedding' }])

    expect(sql).toBe('SELECT cosine_similarity(embedding,vector_embedding()) as score FROM Books')
    expect(values).toEqual([])
  })

  test.each([
    [
      "cosine_similarity(embedding, vector_embedding('needle'))",
      "cosine_similarity(\"$B\".embedding,vector_embedding(?,'QUERY','SPECIAL.MODEL'))",
    ],
    [
      "cosine_similarity(vector_embedding('needle'), embedding)",
      "cosine_similarity(vector_embedding(?,'QUERY','SPECIAL.MODEL'),\"$B\".embedding)",
    ],
    [
      "l2distance(embedding, vector_embedding('needle'))",
      "l2distance(\"$B\".embedding,vector_embedding(?,'QUERY','SPECIAL.MODEL'))",
    ],
    [
      "l2distance(vector_embedding('needle'), embedding)",
      "l2distance(vector_embedding(?,'QUERY','SPECIAL.MODEL'),\"$B\".embedding)",
    ],
  ])('uses the annotated vector model for %s', (expression, expected) => {
    const { sql, values } = renderCql(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as score FROM Books as "$B"`)
    expect(values).toEqual(['needle'])
  })

  test('preserves explicit text types and fully specified query embeddings', () => {
    const { sql, values } = render([
      vector('special-embeddings'),
      query([{ val: 'needle' }, { val: 'DOCUMENT' }, { val: 'EXPLICIT.MODEL' }]),
    ])

    expect(sql).toBe('SELECT cosine_similarity(embedding,vector_embedding(?,?,?)) as score FROM Books')
    expect(values).toEqual(['needle', 'DOCUMENT', 'EXPLICIT.MODEL'])
  })

  test('preserves the remote source argument', () => {
    const { sql, values } = render([
      vector(),
      query([{ val: 'needle' }, { val: 'QUERY' }, { val: 'EXPLICIT.MODEL' }, { val: 'REMOTE.SOURCE' }]),
    ])

    expect(sql).toBe('SELECT cosine_similarity(embedding,vector_embedding(?,?,?,?)) as score FROM Books')
    expect(values).toEqual(['needle', 'QUERY', 'EXPLICIT.MODEL', 'REMOTE.SOURCE'])
  })

  test('leaves query embeddings unchanged without an applicable model', () => {
    delete cds.requires.embeddings
    delete cds.requires['special-embeddings']

    const { sql, values } = render([vector(), query([{ val: 'needle' }])])

    expect(sql).toBe('SELECT cosine_similarity(embedding,vector_embedding(?)) as score FROM Books')
    expect(values).toEqual(['needle'])
  })

  test('uses a named model without a global embeddings configuration', () => {
    delete cds.requires.embeddings

    const { sql, values } = render([vector('special-embeddings'), query([{ val: 'needle' }])])

    expect(sql).toBe(
      "SELECT cosine_similarity(embedding,vector_embedding(?,'QUERY','SPECIAL.MODEL')) as score FROM Books",
    )
    expect(values).toEqual(['needle'])
  })

  test.each(['missing-embeddings', 'special-embeddings'])(
    'falls back to the global model for %s',
    name => {
      cds.requires['special-embeddings'] = {}
      const { sql, values } = render([vector(name), query([{ val: 'needle' }, { val: 'DOCUMENT' }])])

      expect(sql).toBe(
        "SELECT cosine_similarity(embedding,vector_embedding(?,?,'DEFAULT.MODEL')) as score FROM Books",
      )
      expect(values).toEqual(['needle', 'DOCUMENT'])
    },
  )

  test('resolves the annotated model through an association', () => {
    const { sql, values } = renderCql(
      "SELECT from Books { cosine_similarity(related.embedding, vector_embedding('needle')) as score }",
    )

    expect(sql).toContain("cosine_similarity(related.embedding,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    expect(sql).toContain('left JOIN Books as related ON related.ID = "$B".related_ID')
    expect(values).toEqual(['needle'])
  })

  test('preserves reusable CQN wrapped in single-operand expressions', () => {
    const call = query([{ val: 'needle' }])
    const wrapped = { xpr: [call] }
    const compared = { xpr: [vector('special-embeddings')] }

    const { sql, values } = render([compared, wrapped])

    expect(sql).toBe(
      "SELECT cosine_similarity(embedding,vector_embedding(?,'QUERY','SPECIAL.MODEL')) as score FROM Books",
    )
    expect(values).toEqual(['needle'])
    expect(wrapped.xpr).toEqual([call])
    expect(call.args).toEqual([{ val: 'needle' }])
    expect(render([compared, wrapped])).toMatchObject({ sql, values })
  })
  test.each([
    ["cosine_similarity(embedding, l2normalize(vector_embedding('needle')))", "cosine_similarity(\"$B\".embedding,l2normalize(vector_embedding(?,'QUERY','SPECIAL.MODEL')))"],
    ["cosine_similarity(l2normalize(embedding), vector_embedding('needle'))", "cosine_similarity(l2normalize(\"$B\".embedding),vector_embedding(?,'QUERY','SPECIAL.MODEL'))"],
  ])('keeps the annotated model through normalization: %s', (expression, expected) => {
    const { sql, values } = renderCql(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as score FROM Books as "$B"`)
    expect(values).toEqual(['needle'])
  })

  test.each([
    ["L2DISTANCE(L2NORMALIZE(embedding), L2NORMALIZE(VECTOR_EMBEDDING('needle', 'DOCUMENT')))", "l2distance(L2NORMALIZE(\"$B\".embedding),L2NORMALIZE(vector_embedding(?,?,'SPECIAL.MODEL')))"],
  ])('keeps an explicit text type in normalized uppercase calls: %s', (expression, expected) => {
    const { sql, values } = renderCql(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as score FROM Books as "$B"`)
    expect(values).toEqual(['needle', 'DOCUMENT'])
  })

  test.each([
    "cosine_similarity(calculated, vector_embedding('needle'))",
    "cosine_similarity(vector_embedding('needle'), calculated)",
    "l2distance(l2normalize(calculated), vector_embedding('needle'))",
    "cosine_similarity(normalized, vector_embedding('needle'))",
  ])('uses the model of an annotated calculated vector: %s', expression => {
    const { sql, values } = renderCql(`SELECT from Books { ${expression} as score }`)

    expect(sql).toMatch(/vector_embedding\(\?,'QUERY','SPECIAL\.MODEL'\)/)
    expect(sql).toContain(",'DOCUMENT','SPECIAL.MODEL')")
    expect(values).toEqual(['needle'])
  })

})
