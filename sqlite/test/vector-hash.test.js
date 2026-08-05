const cds = require('../../test/cds.js')

describe('VECTOR_EMBEDDING - hash implementation (mocked)', () => {
  const { expect } = cds.test(__dirname + '/../../test/compliance/resources')

  let SQLiteService
  let originalAIEmbedding
  let originalChecked

  before(async () => {
    // Get reference to SQLiteService class
    SQLiteService = require('../lib/SQLiteService.js')

    // Save original state
    originalAIEmbedding = SQLiteService._aiEmbedding
    originalChecked = SQLiteService._aiEmbeddingChecked

    // Force hash implementation by simulating AI plugin unavailability
    SQLiteService._aiEmbeddingChecked = true  // Mark as checked
    SQLiteService._aiEmbedding = null         // Force null (no AI plugin)
  })

  after(() => {
    // Restore original state
    if (SQLiteService) {
      SQLiteService._aiEmbedding = originalAIEmbedding
      SQLiteService._aiEmbeddingChecked = originalChecked
    }
  })

  test('computes hash-based embedding', async () => {
    const res = await SELECT.from('complex.associations.Books')
      .columns`VECTOR_EMBEDDING(title, 'text', 'model') as embedding`
      .limit(1)
    const embedding = JSON.parse(res[0].embedding)
    expect(Array.isArray(embedding)).to.eq(true)
    expect(embedding.length).to.eq(384)
  })

  test('hash-based embeddings are deterministic', async () => {
    const res = await SELECT.from('complex.associations.Books')
      .columns`
        vector_embedding('test', 'text', 'model') as e1,
        vector_embedding('test', 'text', 'model') as e2`
    expect(res[0].e1).to.eq(res[0].e2)
  })

  test('different inputs produce different hash embeddings', async () => {
    const res = await SELECT.from('complex.associations.Books')
      .columns`
        vector_embedding('hello', 'text', 'model') as e1,
        vector_embedding('world', 'text', 'model') as e2`
    expect(res[0].e1).to.not.eq(res[0].e2)
  })

  test('hash embeddings have poor semantic similarity', async () => {
    // This test verifies we're actually using hash, not ONNX
    const res = await SELECT.from('complex.associations.Books')
      .columns`
        vector_embedding('I love programming', 'DOCUMENT', 'model') as e1,
        vector_embedding('I enjoy coding', 'DOCUMENT', 'model') as e2,
        vector_embedding('Quantum physics', 'DOCUMENT', 'model') as e3`

    const v1 = JSON.parse(res[0].e1)
    const v2 = JSON.parse(res[0].e2)
    const v3 = JSON.parse(res[0].e3)

    const sim12 = cosineSimilarity(v1, v2) // Similar meaning
    const sim13 = cosineSimilarity(v1, v3) // Different meaning

    // Hash-based embeddings don't capture semantics
    // So similar sentences won't have notably higher similarity
    // Both should be relatively low (< 0.3)
    expect(sim12).to.be.lessThan(0.3)
    expect(sim13).to.be.lessThan(0.3)

    // And the difference between them should be small
    expect(Math.abs(sim12 - sim13)).to.be.lessThan(0.2)
  })

  test('hash embeddings are normalized', async () => {
    const res = await SELECT.from('complex.associations.Books')
      .columns`vector_embedding('test text', 'DOCUMENT', 'model') as embedding`

    const embedding = JSON.parse(res[0].embedding)

    // Calculate L2 norm
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))

    // Hash embeddings are also normalized
    expect(Math.abs(norm - 1)).to.be.lessThan(0.001)
  })

  test('null returns null with hash implementation', async () => {
    const res = await SELECT.from('complex.associations.Books')
      .columns`vector_embedding(null, 'text', 'model') as embedding`
    expect(res[0].embedding).to.eq(null)
  })

  test('verifies hash produces different results than ONNX would', async () => {
    // This is the key test - semantically similar sentences should have LOW similarity
    // with hash, but would have HIGH similarity with ONNX
    const res = await SELECT.from('complex.associations.Books')
      .columns`
        vector_embedding('I love cats', 'DOCUMENT', 'model') as e1,
        vector_embedding('I adore felines', 'DOCUMENT', 'model') as e2`

    const v1 = JSON.parse(res[0].e1)
    const v2 = JSON.parse(res[0].e2)
    const similarity = cosineSimilarity(v1, v2)

    // With hash: similar meaning = low similarity (< 0.3)
    // With ONNX: similar meaning = high similarity (> 0.7)
    // This confirms we're using hash, not ONNX
    expect(similarity).to.be.lessThan(0.3)
  })
})

// Helper function
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
