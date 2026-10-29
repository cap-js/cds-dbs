const cds = require('@sap/cds')
const { expect } = cds.test.in(__dirname + '/embeddings')
const cqn4sql = require('../../db-service/lib/cqn4sql')
const { CQN2SQL } = require('../lib/HANAService')

describe('HANA vector embedding shorthand', () => {
  let model

  beforeAll(async () => {
    model = await cds.load('schema').then(cds.linked)
  })

  test.each([
    [
      "vector_embedding('string')",
      cds.ql`SELECT from Books as B { vector_embedding(${'string'}) as result }`,
      "vector_embedding(?,'QUERY','TEST.MODEL')",
    ],
    [
      "cosine_similarity(embedding, 'string')",
      cds.ql`SELECT from Books as B { cosine_similarity(embedding, ${'string'}) as result }`,
      "cosine_similarity(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))",
    ],
    [
      "l2distance(embedding, 'string')",
      cds.ql`SELECT from Books as B { l2distance(embedding, ${'string'}) as result }`,
      "l2distance(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))",
    ],
    [
      "cosine_similarity(embedding, vector_embedding('string'))",
      cds.ql`SELECT from Books as B { cosine_similarity(embedding, vector_embedding(${'string'})) as result }`,
      "cosine_similarity(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))",
    ],
    [
      "l2distance(embedding, vector_embedding('string'))",
      cds.ql`SELECT from Books as B { l2distance(embedding, vector_embedding(${'string'})) as result }`,
      "l2distance(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))",
    ],
  ])('%s', (_, query, expected) => {
    const { sql } = new CQN2SQL({ model }).render(cqn4sql(query, model))
    expect(sql).to.include(expected)
  })
})
