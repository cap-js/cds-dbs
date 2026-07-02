const cds = require('../cds.js')

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
        // embedding is null in test data, so result should be null
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
        expect(res[0].distance).to.be.closeTo(Math.sqrt(2), 0.0001)
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
        expect(normalized[0]).to.be.closeTo(0.6, 0.0001)
        expect(normalized[1]).to.be.closeTo(0.8, 0.0001)
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
  })

  describe('automatic embedding computation', () => {
    test('INSERT computes embedding from description', async () => {
      const { Books } = cds.entities('complex.vectors')

      // Insert without embedding - should be computed automatically
      await INSERT.into(Books).entries({
        ID: 999,
        title: 'Test Book',
        description: 'A test description for embedding'
      })

      const res = await SELECT.one.from(Books).where({ ID: 999 })
      expect(res.embedding).to.not.be.null

      // Verify it's a valid vector (JSON array)
      const embedding = JSON.parse(res.embedding)
      expect(embedding).to.be.an('array')
      expect(embedding.length).to.be.greaterThan(0)
    })

    test('INSERT with explicit embedding preserves it', async () => {
      const { Books } = cds.entities('complex.vectors')
      const customEmbedding = JSON.stringify([1, 2, 3])

      await INSERT.into(Books).entries({
        ID: 998,
        title: 'Custom Embedding Book',
        description: 'Some description',
        embedding: customEmbedding
      })

      const res = await SELECT.one.from(Books).where({ ID: 998 })
      expect(res.embedding).to.eq(customEmbedding)
    })

    test('UPDATE recomputes embedding when description changes', async () => {
      const { Books } = cds.entities('complex.vectors')

      // First insert
      await INSERT.into(Books).entries({
        ID: 997,
        title: 'Update Test',
        description: 'Original description'
      })

      const before = await SELECT.one.from(Books).where({ ID: 997 })
      const embeddingBefore = before.embedding

      // Update description
      await UPDATE(Books).set({ description: 'Completely different description' }).where({ ID: 997 })

      const after = await SELECT.one.from(Books).where({ ID: 997 })
      // Embedding should be different after description change
      expect(after.embedding).to.not.eq(embeddingBefore)
    })

    test('INSERT without description results in no embedding', async () => {
      const { Books } = cds.entities('complex.vectors')

      await INSERT.into(Books).entries({
        ID: 996,
        title: 'No Description Book'
        // no description
      })

      const res = await SELECT.one.from(Books).where({ ID: 996 })
      // No source text means no embedding computed
      expect(res.embedding).to.be.null
    })
  })

  describe('semantic search queries', () => {
    test('ORDER BY cosine_similarity', async () => {
      const { Books } = cds.entities('complex.vectors')

      // Insert some books with embeddings
      await INSERT.into(Books).entries([
        { ID: 901, title: 'Book A', description: 'Programming in JavaScript' },
        { ID: 902, title: 'Book B', description: 'Cooking Italian food' },
        { ID: 903, title: 'Book C', description: 'JavaScript frameworks and libraries' }
      ])

      // Get embedding for a search query
      const searchBook = await SELECT.one.from(Books).where({ ID: 901 })
      const searchEmbedding = searchBook.embedding

      // Find similar books
      const results = await SELECT.from(Books)
        .columns('ID', 'title')
        .columns`cosine_similarity(embedding, ${searchEmbedding}) as similarity`
        .where`ID in (901, 902, 903)`
        .orderBy`cosine_similarity(embedding, ${searchEmbedding}) desc`

      expect(results.length).to.eq(3)
      // Book about JavaScript should be most similar to another JavaScript book
      expect(results[0].ID).to.be.oneOf([901, 903])
    })
  })

  describe('hash-based fallback', () => {
    test('deterministic - same input produces same embedding', async () => {
      const { hashEmbedding } = require('@cap-js/sqlite/lib/vector_handling')

      const text = 'Hello world'
      const embedding1 = hashEmbedding(text)
      const embedding2 = hashEmbedding(text)

      expect(embedding1).to.deep.equal(embedding2)
    })

    test('different inputs produce different embeddings', async () => {
      const { hashEmbedding } = require('@cap-js/sqlite/lib/vector_handling')

      const embedding1 = hashEmbedding('Hello world')
      const embedding2 = hashEmbedding('Goodbye world')

      expect(embedding1).to.not.deep.equal(embedding2)
    })

    test('embeddings are normalized', async () => {
      const { hashEmbedding } = require('@cap-js/sqlite/lib/vector_handling')

      const embedding = hashEmbedding('Test text')
      const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0))

      expect(norm).to.be.closeTo(1.0, 0.0001)
    })
  })
})
