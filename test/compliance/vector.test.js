const cds = require('../cds.js')

const approxEq = (actual, expected, tolerance = 0.0001) =>
  Math.abs(actual - expected) < tolerance

describe('vector', () => {
  const { expect, data } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)

  describe('vector functions', () => {
    describe('COSINE_SIMILARITY', () => {
      test('identical vectors return 1', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`cosine_similarity(cast('[1, 0, 0]' as cds.Vector), cast('[1, 0, 0]' as cds.Vector)) as similarity`
        expect(res[0].similarity).to.eq(1)
      })

      test('orthogonal vectors return 0', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`cosine_similarity(cast('[1, 0, 0]' as cds.Vector), cast('[0, 1, 0]' as cds.Vector)) as similarity`
        expect(res[0].similarity).to.eq(0)
      })

      test('opposite vectors return -1', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`cosine_similarity(cast('[1, 0, 0]' as cds.Vector), cast('[-1, 0, 0]' as cds.Vector)) as similarity`
        expect(res[0].similarity).to.eq(-1)
      })

      test('null handling', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`cosine_similarity(embedding, cast('[1, 0, 0]' as cds.Vector)) as similarity`
          .where({ ID: 201 })
        expect(res[0].similarity).to.eq(null)
      })
    })

    describe('L2DISTANCE', () => {
      test('identical vectors return 0', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`l2distance(cast('[1, 0, 0]' as cds.Vector), cast('[1, 0, 0]' as cds.Vector)) as distance`
        expect(res[0].distance).to.eq(0)
      })

      test('unit vectors distance', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`l2distance(cast('[1, 0, 0]' as cds.Vector), cast('[0, 1, 0]' as cds.Vector)) as distance`
        expect(approxEq(res[0].distance, Math.sqrt(2))).to.eq(true)
      })

      test('known distance', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`l2distance(cast('[0, 0, 0]' as cds.Vector), cast('[3, 4, 0]' as cds.Vector)) as distance`
        expect(res[0].distance).to.eq(5)
      })
    })

    describe('L2NORMALIZE', () => {
      test('normalizes to unit length', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`l2normalize(cast('[3, 4, 0]' as cds.Vector)) as normalized`
        const normalized = JSON.parse(res[0].normalized)
        expect(approxEq(normalized[0], 0.6)).to.eq(true)
        expect(approxEq(normalized[1], 0.8)).to.eq(true)
        expect(normalized[2]).to.eq(0)
      })

      test('already normalized vector unchanged', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`l2normalize(cast('[1, 0, 0]' as cds.Vector)) as normalized`
        const normalized = JSON.parse(res[0].normalized)
        expect(normalized[0]).to.eq(1)
        expect(normalized[1]).to.eq(0)
        expect(normalized[2]).to.eq(0)
      })
    })

    describe('VECTOR_EMBEDDING', () => {
      test('computes embedding from text', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`vector_embedding('test-model', 'Hello world') as embedding`
        const embedding = JSON.parse(res[0].embedding)
        expect(Array.isArray(embedding)).to.eq(true)
        expect(embedding.length).to.eq(384)
      })

      test('deterministic - same input same output', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`vector_embedding('model', 'test text') as e1, vector_embedding('model', 'test text') as e2`
        expect(res[0].e1).to.eq(res[0].e2)
      })

      test('different inputs different outputs', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`vector_embedding('model', 'hello') as e1, vector_embedding('model', 'world') as e2`
        expect(res[0].e1).to.not.eq(res[0].e2)
      })

      test('null handling', async () => {
        const res = await SELECT.from('complex.vectors.Books')
          .columns`vector_embedding('model', null) as embedding`
        expect(res[0].embedding).to.eq(null)
      })
    })
  })

  describe('semantic search queries', () => {
    test('ORDER BY similarity with inline embedding', async () => {
      const { Books } = cds.entities('complex.vectors')

      await INSERT.into(Books).entries([
        { ID: 901, title: 'Book A', description: 'Programming in JavaScript', embedding: '[1,0,0]' },
        { ID: 902, title: 'Book B', description: 'Cooking Italian food', embedding: '[0,1,0]' },
        { ID: 903, title: 'Book C', description: 'JavaScript frameworks', embedding: '[0.9,0.1,0]' }
      ])

      const results = await SELECT.from(Books)
        .columns('ID', 'title')
        .columns`cosine_similarity(embedding, cast('[1,0,0]' as cds.Vector)) as similarity`
        .where`ID in (901, 902, 903)`
        .orderBy`cosine_similarity(embedding, cast('[1,0,0]' as cds.Vector)) desc`

      expect(results.length).to.eq(3)
      expect(results[0].ID).to.eq(901)
      expect(results[1].ID).to.eq(903)
    })

    test('search with dynamic VECTOR_EMBEDDING', async () => {
      const { Books } = cds.entities('complex.vectors')

      await INSERT.into(Books).entries([
        { ID: 801, title: 'Adventure Book', description: 'adventure' },
        { ID: 802, title: 'Science Book', description: 'science' }
      ])

      const results = await SELECT.from(Books)
        .columns('ID', 'title')
        .columns`cosine_similarity(vector_embedding('m', description), vector_embedding('m', 'adventure')) as similarity`
        .where`ID in (801, 802)`
        .orderBy`cosine_similarity(vector_embedding('m', description), vector_embedding('m', 'adventure')) desc`

      expect(results.length).to.eq(2)
      expect(results[0].ID).to.eq(801)
    })
  })

  describe('hash-based embedding', () => {
    test('deterministic - same input produces same embedding', async () => {
      const { hashEmbedding } = require('@cap-js/sqlite/lib/vector_handling')

      const text = 'Hello world'
      const embedding1 = hashEmbedding(text)
      const embedding2 = hashEmbedding(text)

      expect(embedding1).to.deep.eq(embedding2)
    })

    test('different inputs produce different embeddings', async () => {
      const { hashEmbedding } = require('@cap-js/sqlite/lib/vector_handling')

      const embedding1 = hashEmbedding('Hello world')
      const embedding2 = hashEmbedding('Goodbye world')

      expect(embedding1).to.not.deep.eq(embedding2)
    })

    test('embeddings are normalized', async () => {
      const { hashEmbedding } = require('@cap-js/sqlite/lib/vector_handling')

      const embedding = hashEmbedding('Test text')
      const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0))

      expect(approxEq(norm, 1.0)).to.eq(true)
    })
  })
})
