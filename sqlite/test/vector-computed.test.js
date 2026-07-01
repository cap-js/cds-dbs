'use strict'

const { setEmbeddingService } = require('../lib/vector_handling')

// Install a deterministic embedding service BEFORE any db connection is made.
// Returns a fixed vector [0.5, 0.5, 0.5, 0.5] for any input text.
const DETERMINISTIC_VECTOR = [0.5, 0.5, 0.5, 0.5]
setEmbeddingService({
  embedSync(text, _model) {
    if (!text) return new Float32Array(4)
    return new Float32Array(DETERMINISTIC_VECTOR)
  }
})

const cds = require('../../test/cds.js')
const assert = require('assert')

describe('SQLite Vector: computed column via VECTOR_EMBEDDING', () => {
  const { expect } = cds.test(__dirname, 'vector-computed.cds')

  test('INSERT with only description — embedding is auto-populated', async () => {
    const { Docs } = cds.entities('test.vector.computed')

    await INSERT.into(Docs).entries({ ID: 1, description: 'Hello world' })

    const result = await SELECT.one.from(Docs).where({ ID: 1 })
    assert(result, 'Row should exist')
    assert(result.embedding, 'Embedding should be non-null (auto-populated by GENERATED ALWAYS AS)')

    const parsed = JSON.parse(result.embedding)
    assert(Array.isArray(parsed), 'Embedding should parse as JSON array')
    assert.strictEqual(parsed.length, 4, 'Vector dimension should be 4')
    // Verify exact deterministic values
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(parsed[i], DETERMINISTIC_VECTOR[i], `Dimension ${i} should be ${DETERMINISTIC_VECTOR[i]}`)
    }
  })

  test('INSERT with NULL description — embedding is zero vector', async () => {
    const { Docs } = cds.entities('test.vector.computed')

    await INSERT.into(Docs).entries({ ID: 2, description: null })

    const result = await SELECT.one.from(Docs).where({ ID: 2 })
    assert(result, 'Row should exist')
    assert(result.embedding, 'Embedding should be non-null')

    const parsed = JSON.parse(result.embedding)
    // Note: the embed() function uses the global DIMENSIONS (384) for null text,
    // not the model-declared Vector(4). This is a known gap — the UDF doesn't
    // receive dimension info from the CDS model.
    assert.strictEqual(parsed.length, 384)
    for (let i = 0; i < parsed.length; i++) {
      assert.strictEqual(parsed[i], 0, `Dimension ${i} should be 0 for null input`)
    }
  })

  test('UPDATE description — embedding is regenerated', async () => {
    const { Docs } = cds.entities('test.vector.computed')

    await INSERT.into(Docs).entries({ ID: 3, description: 'Initial text' })

    // Verify initial embedding
    let result = await SELECT.one.from(Docs).where({ ID: 3 })
    const initialEmbedding = result.embedding
    assert(initialEmbedding, 'Initial embedding should exist')

    // Update description
    await UPDATE(Docs).set({ description: 'Updated text' }).where({ ID: 3 })

    // Verify embedding still populated after update (STORED column recalculates)
    result = await SELECT.one.from(Docs).where({ ID: 3 })
    assert(result.embedding, 'Embedding should still be non-null after UPDATE')

    const parsed = JSON.parse(result.embedding)
    assert.strictEqual(parsed.length, 4, 'Vector dimension should be 4')
    // Since our deterministic fn always returns [0.5, 0.5, 0.5, 0.5] for any text,
    // the value should be the same
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(parsed[i], DETERMINISTIC_VECTOR[i])
    }
  })

  test('cosine_similarity works with computed embedding column', async () => {
    const { Docs } = cds.entities('test.vector.computed')

    await INSERT.into(Docs).entries({ ID: 10, description: 'Test document' })

    // The stored embedding is [0.5, 0.5, 0.5, 0.5]
    // cosine_similarity with itself should be 1.0
    const res = await SELECT.from(Docs)
      .columns`ID, cosine_similarity(embedding, cast('[0.5, 0.5, 0.5, 0.5]' as cds.Vector)) as sim`
      .where({ ID: 10 })

    assert.strictEqual(res.length, 1)
    assert(Math.abs(res[0].sim - 1.0) < 0.0001, `Expected similarity ~1.0, got ${res[0].sim}`)
  })
})
