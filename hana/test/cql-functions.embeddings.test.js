const cds = require('@sap/cds')
const cqn4sql = require('../../db-service/lib/cqn4sql')
const HANAService = require('../lib/HANAService')

describe('HANA vector embedding defaults', () => {
  let requires

  const model = cds.linked(cds.compile.to.csn(`
    entity Books {
      key ID : Integer;
      @cds.embeddings.model: 'special-embeddings'
      embedding : Vector;
      plain : Vector;
      text : String;
      @cds.embeddings.model: 'special-embeddings'
      calculated : Vector = vector_embedding(text, 'DOCUMENT', 'SPECIAL.MODEL');
      @cds.embeddings.model: 'special-embeddings'
      normalized : Vector = l2normalize(vector_embedding(text, 'DOCUMENT', 'SPECIAL.MODEL'));
    }
  `))

  const render = cql => {
    const cqn = cqn4sql(cds.parse.cql(cql), model)
    return new HANAService.CQN2SQL({ model }).render(cqn)
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

    expect(sql).toBe("SELECT vector_embedding(?,'QUERY','DEFAULT.MODEL') as embedding FROM Books as \"$B\"")
    expect(values).toEqual(['needle'])
  })

  test.each([
    ["cosine_similarity(embedding, vector_embedding('needle'))", "cosine_similarity(\"$B\".embedding,vector_embedding(?,'QUERY','SPECIAL.MODEL'))"],
    ["cosine_similarity(vector_embedding('needle'), embedding)", "cosine_similarity(vector_embedding(?,'QUERY','SPECIAL.MODEL'),\"$B\".embedding)"],
    ["l2distance(embedding, vector_embedding('needle'))", "l2distance(\"$B\".embedding,vector_embedding(?,'QUERY','SPECIAL.MODEL'))"],
    ["l2distance(vector_embedding('needle'), embedding)", "l2distance(vector_embedding(?,'QUERY','SPECIAL.MODEL'),\"$B\".embedding)"],
  ])('uses the annotated vector model for %s', (expression, expected) => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as "SCORE" FROM Books as "$B"`)
    expect(values).toEqual(['needle'])
  })

  test('preserves fully specified calls', () => {
    cds.requires.embeddings.remote = 'CONFIGURED.REMOTE'
    const cqn = cqn4sql(cds.parse.cql("SELECT from Books { vector_embedding('needle', 'DOCUMENT', 'EXPLICIT.MODEL') as embedding }"), model)
    cqn.SELECT.columns[0].args.push({ ref: ['EXPLICIT', 'SOURCE'] })
    const { sql, values } = new HANAService.CQN2SQL({ model }).render(cqn)

    expect(sql).toBe('SELECT vector_embedding(?,?,?,"EXPLICIT"."SOURCE") as embedding FROM Books as "$B"')
    expect(values).toEqual(['needle', 'DOCUMENT', 'EXPLICIT.MODEL'])
  })

  test.each([
    ["'needle'", `?,'QUERY','DEFAULT.MODEL',"DEFAULT"."REMOTE"`, ['needle']],
    ["'needle', 'DOCUMENT'", `?,?,'DEFAULT.MODEL',"DEFAULT"."REMOTE"`, ['needle', 'DOCUMENT']],
    ["'needle', 'DOCUMENT', 'EXPLICIT.MODEL'", `?,?,?,"DEFAULT"."REMOTE"`, ['needle', 'DOCUMENT', 'EXPLICIT.MODEL']],
  ])('appends the configured remote to standalone arguments: %s', (args, expected, values) => {
    cds.requires.embeddings.remote = 'DEFAULT.REMOTE'
    const result = render(`SELECT from Books { vector_embedding(${args}) as embedding }`)

    expect(result.sql).toBe(`SELECT vector_embedding(${expected}) as embedding FROM Books as "$B"`)
    expect(result.values).toEqual(values)
  })

  test.each([
    "cosine_similarity(embedding, vector_embedding('needle'))",
    "cosine_similarity(vector_embedding('needle'), embedding)",
    "l2distance(embedding, vector_embedding('needle'))",
    "l2distance(vector_embedding('needle'), embedding)",
    "cosine_similarity(embedding, l2normalize(vector_embedding('needle')))",
    "L2DISTANCE(L2NORMALIZE(embedding), VECTOR_EMBEDDING('needle'))",
    "cosine_similarity(calculated, vector_embedding('needle'))",
    "cosine_similarity(normalized, vector_embedding('needle'))",
  ])('uses the annotated model and remote for %s', expression => {
    cds.requires.embeddings.remote = 'DEFAULT.REMOTE'
    cds.requires['special-embeddings'].remote = 'SPECIAL.REMOTE'
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toContain(`vector_embedding(?,'QUERY','SPECIAL.MODEL',"SPECIAL"."REMOTE")`)
    expect(sql).not.toContain('"DEFAULT"."REMOTE"')
    expect(values).toEqual(['needle'])
  })

  test.each(["'needle'", "'needle', 'DOCUMENT', 'EXPLICIT.MODEL'"])('keeps a named model without a remote independent of the global remote: %s', args => {
    cds.requires.embeddings.remote = 'DEFAULT.REMOTE'
    const { sql } = render(`SELECT from Books { cosine_similarity(embedding, vector_embedding(${args})) as score }`)

    expect(sql).toContain(args.includes('EXPLICIT.MODEL') ? 'vector_embedding(?,?,?)' : "vector_embedding(?,'QUERY','SPECIAL.MODEL')")
    expect(sql).not.toContain('"DEFAULT"."REMOTE"')
  })

  test.each(['embedding', 'plain'])('uses the global remote when no named configuration is available: %s', element => {
    delete cds.requires['special-embeddings']
    cds.requires.embeddings.remote = 'DEFAULT.REMOTE'
    const { sql } = render(`SELECT from Books { cosine_similarity(${element}, vector_embedding('needle')) as score }`)

    expect(sql).toContain(`vector_embedding(?,'QUERY','DEFAULT.MODEL',"DEFAULT"."REMOTE")`)
  })

  test('keeps the model fallback with a remote-only named configuration', () => {
    cds.requires['special-embeddings'] = { remote: 'SPECIAL.REMOTE' }
    const { sql } = render("SELECT from Books { l2distance(embedding, vector_embedding('needle')) as score }")

    expect(sql).toContain(`vector_embedding(?,'QUERY','DEFAULT.MODEL',"SPECIAL"."REMOTE")`)
  })

  test('completes a remote-only configuration when the model is explicit', () => {
    cds.requires.embeddings = { remote: 'DEFAULT.REMOTE' }
    const { sql, values } = render("SELECT from Books { vector_embedding('needle', 'DOCUMENT', 'EXPLICIT.MODEL') as embedding }")

    expect(sql).toContain('vector_embedding(?,?,?,"DEFAULT"."REMOTE")')
    expect(values).toEqual(['needle', 'DOCUMENT', 'EXPLICIT.MODEL'])
  })

  test('does not shift arguments when the model is unavailable', () => {
    cds.requires.embeddings = { remote: 'DEFAULT.REMOTE' }
    const { sql, values } = render("SELECT from Books { vector_embedding('needle') as embedding, vector_embedding() as empty }")

    expect(sql).toContain('vector_embedding(?) as embedding')
    expect(sql).toContain('vector_embedding() as "EMPTY"')
    expect(values).toEqual(['needle'])
  })

  test('escapes the configured remote as an SQL identifier', () => {
    cds.requires.embeddings.remote = 'REMOTE"SOURCE'
    const { sql, values } = render("SELECT from Books { vector_embedding('needle') as embedding }")

    expect(sql).toContain(`vector_embedding(?,'QUERY','DEFAULT.MODEL',"REMOTE""SOURCE")`)
    expect(values).toEqual(['needle'])
  })

  test('preserves the spelling of external schema and remote source identifiers', () => {
    cds.requires.embeddings.remote = 'My-Schema.MySource'
    const { sql } = render("SELECT from Books { vector_embedding('needle') as embedding }")

    expect(sql).toContain(`vector_embedding(?,'QUERY','DEFAULT.MODEL',"My-Schema"."MySource")`)
  })

  test('keeps configured remotes stable when reusing CQN', () => {
    cds.requires['special-embeddings'].remote = 'SPECIAL.REMOTE'
    const cqn = cqn4sql(cds.parse.cql("SELECT from Books { cosine_similarity(embedding, vector_embedding('needle')) as score }"), model)
    const original = JSON.stringify(cqn)
    const first = new HANAService.CQN2SQL({ model }).render(cqn)
    const second = new HANAService.CQN2SQL({ model }).render(cqn)

    expect(first.sql).toContain(`vector_embedding(?,'QUERY','SPECIAL.MODEL',"SPECIAL"."REMOTE")`)
    expect(second.sql).toBe(first.sql)
    expect(second.values).toEqual(first.values)
    expect(JSON.stringify(cqn)).toBe(original)
  })

  test.each([
    ["cosine_similarity(embedding, l2normalize(vector_embedding('needle')))", "cosine_similarity(\"$B\".embedding,l2normalize(vector_embedding(?,'QUERY','SPECIAL.MODEL')))"],
    ["cosine_similarity(l2normalize(embedding), vector_embedding('needle'))", "cosine_similarity(l2normalize(\"$B\".embedding),vector_embedding(?,'QUERY','SPECIAL.MODEL'))"],
  ])('keeps the annotated model through normalization: %s', (expression, expected) => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as "SCORE" FROM Books as "$B"`)
    expect(values).toEqual(['needle'])
  })

  test.each([
    ["L2DISTANCE(L2NORMALIZE(embedding), L2NORMALIZE(VECTOR_EMBEDDING('needle', 'DOCUMENT')))", "l2distance(L2NORMALIZE(\"$B\".embedding),L2NORMALIZE(vector_embedding(?,?,'SPECIAL.MODEL')))"],
  ])('keeps an explicit text type in normalized uppercase calls: %s', (expression, expected) => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toBe(`SELECT ${expected} as "SCORE" FROM Books as "$B"`)
    expect(values).toEqual(['needle', 'DOCUMENT'])
  })

  test.each([
    "cosine_similarity(calculated, vector_embedding('needle'))",
    "cosine_similarity(vector_embedding('needle'), calculated)",
    "l2distance(l2normalize(calculated), vector_embedding('needle'))",
    "cosine_similarity(normalized, vector_embedding('needle'))",
  ])('uses the model of an annotated calculated vector: %s', expression => {
    const { sql, values } = render(`SELECT from Books { ${expression} as score }`)

    expect(sql).toMatch(/vector_embedding\(\?,'QUERY','SPECIAL\.MODEL'\)/)
    expect(sql).toContain(",'DOCUMENT','SPECIAL.MODEL')")
    expect(values).toEqual(['needle'])
  })
})
