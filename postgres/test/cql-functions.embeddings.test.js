'use strict'

const cds = require('@sap/cds')
const cqn4sql = require('../../db-service/lib/cqn4sql')
const PostgresService = require('../lib/PostgresService')

describe('PostgreSQL vector embedding defaults', () => {
  let requires

  const model = cds.linked(cds.compile.to.csn(`
    entity Books {
      key ID : Integer;
      @cds.embeddings.model: 'special-embeddings'
      embedding : Vector;
    }
  `))

  const render = cql => {
    const cqn = cqn4sql(cds.parse.cql(cql), model)
    return new PostgresService.CQN2SQL({ model }).render(cqn)
  }

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

  test('uses QUERY and the default model for standalone calls', () => {
    const { sql, values } = render("SELECT from Books { vector_embedding('needle') as embedding }")

    expect(sql).toBe("SELECT vector_embedding($1,'QUERY','DEFAULT.MODEL') as embedding FROM Books as \"$b\"")
    expect(values).toEqual(['needle'])
  })

  test.each([
    ["cosine_similarity(embedding, vector_embedding('needle'))", "1 - cosine_distance(\"$b\".embedding,vector_embedding($1,'QUERY','SPECIAL.MODEL'))"],
    ["cosine_similarity(vector_embedding('needle'), embedding)", "1 - cosine_distance(vector_embedding($1,'QUERY','SPECIAL.MODEL'),\"$b\".embedding)"],
    ["l2distance(embedding, vector_embedding('needle'))", "l2_distance(\"$b\".embedding,vector_embedding($1,'QUERY','SPECIAL.MODEL'))"],
    ["l2distance(vector_embedding('needle'), embedding)", "l2_distance(vector_embedding($1,'QUERY','SPECIAL.MODEL'),\"$b\".embedding)"],
  ])('uses the annotated vector model for %s', (expression, expected) => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as score FROM Books as "$b"`)
    expect(values).toEqual(['needle'])
  })

  test('preserves fully specified calls', () => {
    const { sql, values } = render("SELECT from Books { vector_embedding('needle', 'DOCUMENT', 'EXPLICIT.MODEL', 'REMOTE.SOURCE') as embedding }")

    expect(sql).toBe('SELECT vector_embedding($1,$2,$3,$4) as embedding FROM Books as "$b"')
    expect(values).toEqual(['needle', 'DOCUMENT', 'EXPLICIT.MODEL', 'REMOTE.SOURCE'])
  })
})
