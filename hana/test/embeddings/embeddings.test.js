const cds = require('../../../test/cds')

describe('HANA vector embedding shorthand and model selection', () => {
  const { expect, data } = cds.test(__dirname, 'embeddings.cds')
  data.autoIsolation(false)

  describe('vector_embedding', () => {
    test("vector_embedding('string')", () => {
      const query = cds.ql`SELECT from Books as B { vector_embedding(${'string'}) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("vector_embedding(?,'QUERY','TEST.MODEL')")
    })
  })

  describe('cosine_similarity', () => {
    test("cosine_similarity(embedding, vector_embedding('string'))", () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(embedding, vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("cosine_similarity(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
    })

    test("cosine_similarity(embedding, 'string')", () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(embedding, ${'string'}) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("cosine_similarity(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
    })

    test('cosine_similarity uses @cds.embeddings.model for a vector_embedding query', () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(annotated, vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("cosine_similarity(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('cosine_similarity uses @cds.embeddings.model from a stored calculated vector', () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(calculated, vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("cosine_similarity(B.calculated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('cosine_similarity uses @cds.embeddings.model for a string query', () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(annotated, ${'string'}) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("cosine_similarity(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('cosine_similarity uses the default model when both operands are normalized', () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(l2normalize(embedding), l2normalize(vector_embedding(${'string'}))) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include(
        "cosine_similarity(l2normalize(B.embedding),l2normalize(vector_embedding(?,'QUERY','TEST.MODEL')))"
      )
    })

    test('cosine_similarity uses @cds.embeddings.model through the normalized left operand', () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(l2normalize(annotated), vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("cosine_similarity(l2normalize(B.annotated),vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('cosine_similarity uses @cds.embeddings.model for the normalized query embedding', () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(annotated, l2normalize(vector_embedding(${'string'}))) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("cosine_similarity(B.annotated,l2normalize(vector_embedding(?,'QUERY','SPECIAL.MODEL')))")
    })

    test('cosine_similarity uses @cds.embeddings.model when both operands are normalized', () => {
      const query = cds.ql`SELECT from Books as B { cosine_similarity(l2normalize(annotated), l2normalize(vector_embedding(${'string'}))) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include(
        "cosine_similarity(l2normalize(B.annotated),l2normalize(vector_embedding(?,'QUERY','SPECIAL.MODEL')))"
      )
    })
  })

  describe('l2distance', () => {
    test("l2distance(embedding, vector_embedding('string'))", () => {
      const query = cds.ql`SELECT from Books as B { l2distance(embedding, vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("l2distance(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
    })

    test("l2distance(embedding, 'string')", () => {
      const query = cds.ql`SELECT from Books as B { l2distance(embedding, ${'string'}) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("l2distance(B.embedding,vector_embedding(?,'QUERY','TEST.MODEL'))")
    })

    test('l2distance uses @cds.embeddings.model for a vector_embedding query', () => {
      const query = cds.ql`SELECT from Books as B { l2distance(annotated, vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("l2distance(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('l2distance uses @cds.embeddings.model from a stored calculated vector', () => {
      const query = cds.ql`SELECT from Books as B { l2distance(calculated, vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("l2distance(B.calculated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('l2distance uses @cds.embeddings.model for a string query', () => {
      const query = cds.ql`SELECT from Books as B { l2distance(annotated, ${'string'}) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("l2distance(B.annotated,vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('l2distance uses the default model when both operands are normalized', () => {
      const query = cds.ql`SELECT from Books as B { l2distance(l2normalize(embedding), l2normalize(vector_embedding(${'string'}))) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include(
        "l2distance(l2normalize(B.embedding),l2normalize(vector_embedding(?,'QUERY','TEST.MODEL')))"
      )
    })

    test('l2distance uses @cds.embeddings.model through the normalized left operand', () => {
      const query = cds.ql`SELECT from Books as B { l2distance(l2normalize(annotated), vector_embedding(${'string'})) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("l2distance(l2normalize(B.annotated),vector_embedding(?,'QUERY','SPECIAL.MODEL'))")
    })

    test('l2distance uses @cds.embeddings.model for the normalized query embedding', () => {
      const query = cds.ql`SELECT from Books as B { l2distance(annotated, l2normalize(vector_embedding(${'string'}))) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include("l2distance(B.annotated,l2normalize(vector_embedding(?,'QUERY','SPECIAL.MODEL')))")
    })

    test('l2distance uses @cds.embeddings.model when both operands are normalized', () => {
      const query = cds.ql`SELECT from Books as B { l2distance(l2normalize(annotated), l2normalize(vector_embedding(${'string'}))) as result }`
      const { sql } = cds.db.cqn2sql(query)
      expect(sql).to.include(
        "l2distance(l2normalize(B.annotated),l2normalize(vector_embedding(?,'QUERY','SPECIAL.MODEL')))"
      )
    })
  })
})
