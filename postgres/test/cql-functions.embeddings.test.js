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
      text : String;
      @cds.embeddings.model: 'special-embeddings'
      calculated : Vector = vector_embedding(text, 'DOCUMENT', 'SPECIAL.MODEL');
      @cds.embeddings.model: 'special-embeddings'
      normalized : Vector = l2normalize(vector_embedding(text, 'DOCUMENT', 'SPECIAL.MODEL'));
    }
  `))

  const render = cql => {
    const cqn = cqn4sql(cds.parse.cql(cql), model)
    return new PostgresService.CQN2SQL({ model }).render(cqn)
  }

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

  test('preserves PostgreSQL named arguments', () => {
    const { sql, values } = render("SELECT from Books { vector_embedding(input => 'needle', text_type => 'DOCUMENT', model_and_version => 'EXPLICIT.MODEL') as embedding }")

    expect(sql).toBe('SELECT vector_embedding(input => $1,text_type => $2,model_and_version => $3) as embedding FROM Books as "$b"')
    expect(values).toEqual(['needle', 'DOCUMENT', 'EXPLICIT.MODEL'])
  })

  test('preserves casts on completed query embeddings', () => {
    const { sql, values } = render("SELECT from Books { cosine_similarity(embedding, cast(vector_embedding('needle') as Vector)) as score }")

    expect(sql).toBe("SELECT 1 - cosine_distance(\"$b\".embedding,cast(vector_embedding($1,'QUERY','SPECIAL.MODEL') as VECTOR)) as score FROM Books as \"$b\"")
    expect(values).toEqual(['needle'])
  })
  test.each([
    ["cosine_similarity(embedding, l2normalize(vector_embedding('needle')))", "1 - cosine_distance(\"$b\".embedding,l2_normalize(vector_embedding($1,'QUERY','SPECIAL.MODEL')))"],
    ["cosine_similarity(l2normalize(embedding), vector_embedding('needle'))", "1 - cosine_distance(l2_normalize(\"$b\".embedding),vector_embedding($1,'QUERY','SPECIAL.MODEL'))"],
  ])('keeps the annotated model through normalization: %s', (expression, expected) => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as score FROM Books as "$b"`)
    expect(values).toEqual(['needle'])
  })

  test.each([
    ["L2DISTANCE(L2NORMALIZE(embedding), L2NORMALIZE(VECTOR_EMBEDDING('needle', 'DOCUMENT')))", "l2_distance(l2_normalize(\"$b\".embedding),l2_normalize(vector_embedding($1,$2,'SPECIAL.MODEL')))"],
  ])('keeps an explicit text type in normalized uppercase calls: %s', (expression, expected) => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as score FROM Books as "$b"`)
    expect(values).toEqual(['needle', 'DOCUMENT'])
  })

  test.each([
    "cosine_similarity(calculated, vector_embedding('needle'))",
    "cosine_similarity(vector_embedding('needle'), calculated)",
    "l2distance(l2normalize(calculated), vector_embedding('needle'))",
    "cosine_similarity(normalized, vector_embedding('needle'))",
  ])('uses the model of an annotated calculated vector: %s', expression => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toMatch(/vector_embedding\(\$\d,'QUERY','SPECIAL\.MODEL'\)/)
    expect(sql).toContain(",'DOCUMENT','SPECIAL.MODEL')")
    expect(values).toEqual(['needle'])
  })

})
