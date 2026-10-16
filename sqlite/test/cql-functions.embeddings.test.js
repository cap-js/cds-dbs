'use strict'

const cds = require('@sap/cds')
const cqn4sql = require('../../db-service/lib/cqn4sql')
const SQLiteService = require('../lib/SQLiteService')

describe('SQLite vector embedding defaults', () => {
  let requires

  beforeEach(() => {
    requires = cds.requires
    cds.requires = {
      embeddings: { model: 'DEFAULT.MODEL' },
      'special-embeddings': { model: 'SPECIAL.MODEL' },
    }
  })

  afterEach(() => {
    cds.requires = requires
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
    cds.requires = {}

    const { sql, values } = render([vector(), query([{ val: 'needle' }])])

    expect(sql).toBe('SELECT cosine_similarity(embedding,vector_embedding(?)) as score FROM Books')
    expect(values).toEqual(['needle'])
  })
})
