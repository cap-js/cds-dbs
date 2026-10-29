const cds = require('@sap/cds')
const { expect } = cds.test.in(__dirname + '/embeddings')
const cqn4sql = require('../../db-service/lib/cqn4sql')
const { CQN2SQL } = require('../lib/HANAService')

describe('HANA vector embedding shorthand and model selection', () => {
  let model

  beforeAll(async () => {
    model = await cds.load('schema').then(cds.linked)
  })

  test("vector_embedding('string')", () => {
    const query = cds.ql`SELECT from Books as B { vector_embedding(${'string'}) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("vector_embedding(?,'QUERY','TEST.MODEL')")
  })

  test("cosine_similarity(embedding, 'string')", () => {
    const query = cds.ql`SELECT from Books as B { cosine_similarity(embedding, ${'string'}) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("cosine_similarity(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
  })

  test("l2distance(embedding, 'string')", () => {
    const query = cds.ql`SELECT from Books as B { l2distance(embedding, ${'string'}) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("l2distance(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
  })

  test("cosine_similarity(embedding, vector_embedding('string'))", () => {
    const query = cds.ql`SELECT from Books as B { cosine_similarity(embedding, vector_embedding(${'string'})) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("cosine_similarity(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
  })

  test("l2distance(embedding, vector_embedding('string'))", () => {
    const query = cds.ql`SELECT from Books as B { l2distance(embedding, vector_embedding(${'string'})) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("l2distance(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
  })

  test('cosine_similarity uses @cds.embeddings.model for a string query', () => {
    const query = cds.ql`SELECT from Books as B { cosine_similarity(annotated, ${'string'}) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("cosine_similarity(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
  })

  test('l2distance uses @cds.embeddings.model for a string query', () => {
    const query = cds.ql`SELECT from Books as B { l2distance(annotated, ${'string'}) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("l2distance(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
  })

  test('cosine_similarity uses @cds.embeddings.model for a vector_embedding query', () => {
    const query = cds.ql`SELECT from Books as B { cosine_similarity(annotated, vector_embedding(${'string'})) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("cosine_similarity(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
  })

  test('l2distance uses @cds.embeddings.model for a vector_embedding query', () => {
    const query = cds.ql`SELECT from Books as B { l2distance(annotated, vector_embedding(${'string'})) as result }`
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include("l2distance(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
  })
})
