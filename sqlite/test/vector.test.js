const cds = require('../../test/cds.js')

describe('vector functions', () => {
  const { expect } = cds.test(__dirname + '/../../test/compliance/resources')

  describe('COSINE_SIMILARITY', () => {
    test('identical vectors return 1', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`cosine_similarity(cast('[1, 0, 0]' as cds.Vector), cast('[1, 0, 0]' as cds.Vector)) as similarity`
      expect(res[0].similarity).to.eq(1)
    })
    test('orthogonal vectors return 0', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`cosine_similarity(cast('[1, 0, 0]' as cds.Vector), cast('[0, 1, 0]' as cds.Vector)) as similarity`
      expect(res[0].similarity).to.eq(0)
    })
    test('opposite vectors return -1', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`cosine_similarity(cast('[1, 0, 0]' as cds.Vector), cast('[-1, 0, 0]' as cds.Vector)) as similarity`
      expect(res[0].similarity).to.eq(-1)
    })
  })

  describe('L2DISTANCE', () => {
    test('identical vectors return 0', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`l2distance(cast('[1, 0, 0]' as cds.Vector), cast('[1, 0, 0]' as cds.Vector)) as distance`
      expect(res[0].distance).to.eq(0)
    })
    test('unit vectors distance', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`l2distance(cast('[1, 0, 0]' as cds.Vector), cast('[0, 1, 0]' as cds.Vector)) as distance`
      expect(Math.abs(res[0].distance - Math.SQRT2) < 0.0001).to.eq(true)
    })
    test('known distance', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`l2distance(cast('[0, 0, 0]' as cds.Vector), cast('[3, 4, 0]' as cds.Vector)) as distance`
      expect(res[0].distance).to.eq(5)
    })
  })

  describe('L2NORMALIZE', () => {
    test('normalizes to unit length', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`l2normalize(cast('[3, 4, 0]' as cds.Vector)) as normalized`
      const normalized = JSON.parse(res[0].normalized)
      expect(Math.abs(normalized[0] - 0.6) < 0.0001).to.eq(true)
      expect(Math.abs(normalized[1] - 0.8) < 0.0001).to.eq(true)
      expect(normalized[2]).to.eq(0)
    })
    test('already normalized unchanged', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`l2normalize(cast('[1, 0, 0]' as cds.Vector)) as normalized`
      const normalized = JSON.parse(res[0].normalized)
      expect(normalized[0]).to.eq(1)
      expect(normalized[1]).to.eq(0)
    })
  })

  describe('VECTOR_EMBEDDING', () => {
    let hasAIPlugin = false
    try { hasAIPlugin = !!require.resolve('@cap-js/ai/vector_embedding') } catch { /* optional plugin */ }

    test('computes embedding', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`VECTOR_EMBEDDING(title, 'DOCUMENT', 'model') as embedding`
        .limit(1)
      const embedding = JSON.parse(res[0].embedding)
      expect(Array.isArray(embedding)).to.eq(true)
    })

    test('deterministic', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`vector_embedding('test', 'DOCUMENT', 'model') as e1, vector_embedding('test', 'DOCUMENT', 'model') as e2`
      expect(res[0].e1).to.eq(res[0].e2)
    })

    test('different inputs different outputs', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`vector_embedding('hello', 'DOCUMENT', 'model') as e1, vector_embedding('world', 'DOCUMENT', 'model') as e2`
      expect(res[0].e1).to.not.eq(res[0].e2)
    })

    test('null returns null', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`vector_embedding(null, 'DOCUMENT', 'model') as embedding`
      expect(res[0].embedding).to.eq(null)
    })

    // AI plugin specific tests
    if (hasAIPlugin) {
      describe('with AI plugin', () => {
        test('produces semantic embeddings', async () => {
          const res = await SELECT.from('complex.associations.Books')
            .columns`
              vector_embedding('I love programming', 'DOCUMENT', 'SAP_GXY.20250407') as e1,
              vector_embedding('I enjoy coding', 'DOCUMENT', 'SAP_GXY.20250407') as e2,
              vector_embedding('The weather is nice today', 'DOCUMENT', 'SAP_GXY.20250407') as e3`

          const v1 = JSON.parse(res[0].e1)
          const v2 = JSON.parse(res[0].e2)
          const v3 = JSON.parse(res[0].e3)

          const sim12 = cosineSimilarity(v1, v2) // Similar sentences
          const sim13 = cosineSimilarity(v1, v3) // Different topics

          expect(sim12).to.be.greaterThan(sim13)
          expect(sim12).to.be.greaterThan(0.7)
          expect(sim13).to.be.lessThan(0.2)
        })

        test('embeddings are normalized', async () => {
          const res = await SELECT.from('complex.associations.Books')
            .columns`vector_embedding('test text', 'DOCUMENT', 'SAP_GXY.20250407') as embedding`

          const embedding = JSON.parse(res[0].embedding)

          // Calculate L2 norm
          const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))

          // Should be very close to 1 (normalized)
          expect(Math.abs(norm - 1)).to.be.lessThan(0.001)
        })
      })
    }
  })
})

// Helper function to calculate cosine similarity
function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Vectors must have same length')

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}
