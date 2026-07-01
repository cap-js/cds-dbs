'use strict'

const cds = require('../../test/cds.js')
const assert = require('assert')

describe('SQLite Vector: storage + cosine_similarity', () => {
  const { expect } = cds.test(__dirname, 'vector.cds')

  test('INSERT rows with explicit embedding JSON strings', async () => {
    const { Books } = cds.entities('test.vector')

    await INSERT.into(Books).entries([
      { ID: 1, title: 'Book A', description: 'First book', embedding: '[1, 0, 0, 0]' },
      { ID: 2, title: 'Book B', description: 'Second book', embedding: '[0, 1, 0, 0]' },
      { ID: 3, title: 'Book C', description: 'Third book', embedding: '[0.9, 0.1, 0, 0]' },
    ])

    const result = await SELECT.from(Books)
    assert.strictEqual(result.length, 3, 'All 3 rows should be inserted')
  })

  test('SELECT with cosine_similarity - identical vectors yield 1.0', async () => {
    const { Books } = cds.entities('test.vector')

    await INSERT.into(Books).entries({ ID: 10, title: 'Exact', description: 'test', embedding: '[1, 0, 0, 0]' })

    const res = await SELECT.from(Books)
      .columns`ID, cosine_similarity(embedding, cast('[1, 0, 0, 0]' as cds.Vector)) as sim`
      .where({ ID: 10 })

    assert.strictEqual(res.length, 1)
    assert(Math.abs(res[0].sim - 1.0) < 0.0001, `Expected similarity ~1.0, got ${res[0].sim}`)
  })

  test('SELECT with cosine_similarity - orthogonal vectors yield 0', async () => {
    const { Books } = cds.entities('test.vector')

    await INSERT.into(Books).entries({ ID: 20, title: 'Ortho', description: 'test', embedding: '[1, 0, 0, 0]' })

    const res = await SELECT.from(Books)
      .columns`ID, cosine_similarity(embedding, cast('[0, 1, 0, 0]' as cds.Vector)) as sim`
      .where({ ID: 20 })

    assert.strictEqual(res.length, 1)
    assert(Math.abs(res[0].sim) < 0.0001, `Expected similarity ~0, got ${res[0].sim}`)
  })

  test('ORDER BY cosine_similarity returns rows sorted by relevance', async () => {
    const { Books } = cds.entities('test.vector')

    // Insert vectors with known similarities to query [1, 0, 0, 0]:
    // [1, 0, 0, 0] → cos = 1.0
    // [0.9, 0.1, 0, 0] → cos ≈ 0.994
    // [0, 1, 0, 0] → cos = 0.0
    await INSERT.into(Books).entries([
      { ID: 100, title: 'Identical', description: 'a', embedding: '[1, 0, 0, 0]' },
      { ID: 101, title: 'Similar', description: 'b', embedding: '[0.9, 0.1, 0, 0]' },
      { ID: 102, title: 'Orthogonal', description: 'c', embedding: '[0, 1, 0, 0]' },
    ])

    // Order by cosine_similarity DESC — most similar first
    const res = await cds.run(
      SELECT.from(Books)
        .columns`ID, title, cosine_similarity(embedding, cast('[1, 0, 0, 0]' as cds.Vector)) as sim`
        .where`ID >= 100 AND ID <= 102`
        .orderBy`cosine_similarity(embedding, cast('[1, 0, 0, 0]' as cds.Vector)) desc`
    )

    assert.strictEqual(res.length, 3)
    // First should be the identical vector (sim = 1.0)
    assert.strictEqual(res[0].ID, 100, `Expected ID 100 first (identical), got ${res[0].ID}`)
    // Second should be the similar vector (sim ≈ 0.994)
    assert.strictEqual(res[1].ID, 101, `Expected ID 101 second (similar), got ${res[1].ID}`)
    // Third should be the orthogonal vector (sim = 0)
    assert.strictEqual(res[2].ID, 102, `Expected ID 102 third (orthogonal), got ${res[2].ID}`)

    // Verify the actual similarity values are mathematically correct
    assert(res[0].sim > 0.999, `Identical sim should be ~1.0, got ${res[0].sim}`)
    assert(res[1].sim > 0.99 && res[1].sim < 1.0, `Similar sim should be ~0.994, got ${res[1].sim}`)
    assert(Math.abs(res[2].sim) < 0.0001, `Orthogonal sim should be ~0, got ${res[2].sim}`)
  })

  test('l2distance with identical vectors returns 0', async () => {
    const { Books } = cds.entities('test.vector')

    await INSERT.into(Books).entries({ ID: 30, title: 'L2 test', description: 'test', embedding: '[0.5, 0.5, 0.5, 0.5]' })

    const res = await SELECT.from(Books)
      .columns`ID, l2distance(embedding, cast('[0.5, 0.5, 0.5, 0.5]' as cds.Vector)) as dist`
      .where({ ID: 30 })

    assert.strictEqual(res.length, 1)
    assert(Math.abs(res[0].dist) < 0.0001, `Expected distance ~0, got ${res[0].dist}`)
  })

  test('vector round-trip: INSERT and SELECT returns parseable vector string', async () => {
    const { Books } = cds.entities('test.vector')

    await INSERT.into(Books).entries({ ID: 40, title: 'Roundtrip', description: 'test', embedding: '[0.1, 0.2, 0.3, 0.4]' })

    const result = await SELECT.one.from(Books).where({ ID: 40 })
    assert(result, 'Row should exist')
    assert(result.embedding, 'Embedding should be non-null')

    // The stored value should be parseable as JSON array
    const parsed = JSON.parse(result.embedding)
    assert(Array.isArray(parsed), 'Embedding should parse as array')
    assert.strictEqual(parsed.length, 4, 'Vector dimension should be 4')
    assert(Math.abs(parsed[0] - 0.1) < 0.001)
    assert(Math.abs(parsed[1] - 0.2) < 0.001)
    assert(Math.abs(parsed[2] - 0.3) < 0.001)
    assert(Math.abs(parsed[3] - 0.4) < 0.001)
  })

  // --- Default hashEmbed determinism tests (no service override) ---

  test('VECTOR_EMBEDDING is deterministic: same input produces identical output', async () => {
    const { Books } = cds.entities('test.vector')
    await INSERT.into(Books).entries({ ID: 50, title: 'det', description: 'x', embedding: '[1,0,0,0]' })

    // TO_NVARCHAR converts the binary vector to a JSON string so it can flow
    // through the SELECT's JSON projection. Mirrors HANA's OutputConverter.
    const [r1] = await SELECT.from(Books)
      .columns`TO_NVARCHAR(VECTOR_EMBEDDING('the quick brown fox jumps', 'DOCUMENT', 'test-model')) as vec`
      .where({ ID: 50 })
    const [r2] = await SELECT.from(Books)
      .columns`TO_NVARCHAR(VECTOR_EMBEDDING('the quick brown fox jumps', 'DOCUMENT', 'test-model')) as vec`
      .where({ ID: 50 })

    assert.strictEqual(r1.vec, r2.vec, 'Same input must produce identical vector strings')
    const parsed = JSON.parse(r1.vec)
    assert.strictEqual(parsed.length, 384, 'Default hashEmbed produces 384-dim vectors')
  })

  test('VECTOR_EMBEDDING: different text produces different vectors', async () => {
    const { Books } = cds.entities('test.vector')
    await INSERT.into(Books).entries({ ID: 51, title: 'diff', description: 'x', embedding: '[1,0,0,0]' })

    const [r1] = await SELECT.from(Books)
      .columns`TO_NVARCHAR(VECTOR_EMBEDDING('alice in wonderland is great', 'DOCUMENT', 'test-model')) as vec`
      .where({ ID: 51 })
    const [r2] = await SELECT.from(Books)
      .columns`TO_NVARCHAR(VECTOR_EMBEDDING('bob builds bridges in boston', 'DOCUMENT', 'test-model')) as vec`
      .where({ ID: 51 })

    assert.notStrictEqual(r1.vec, r2.vec, 'Different text must produce different vectors')
  })

  test('VECTOR_EMBEDDING: different model produces different vectors', async () => {
    const { Books } = cds.entities('test.vector')
    await INSERT.into(Books).entries({ ID: 52, title: 'model', description: 'x', embedding: '[1,0,0,0]' })

    const [r1] = await SELECT.from(Books)
      .columns`TO_NVARCHAR(VECTOR_EMBEDDING('hello world this is a test', 'DOCUMENT', 'model-A')) as vec`
      .where({ ID: 52 })
    const [r2] = await SELECT.from(Books)
      .columns`TO_NVARCHAR(VECTOR_EMBEDDING('hello world this is a test', 'DOCUMENT', 'model-B')) as vec`
      .where({ ID: 52 })

    assert.notStrictEqual(r1.vec, r2.vec, 'Different model must produce different vectors (model is part of hash seed)')
  })

  test('VECTOR_EMBEDDING self-similarity via cosine_similarity equals 1.0', async () => {
    const { Books } = cds.entities('test.vector')
    await INSERT.into(Books).entries({ ID: 53, title: 'self-sim', description: 'x', embedding: '[1,0,0,0]' })

    const [res] = await SELECT.from(Books)
      .columns`cosine_similarity(VECTOR_EMBEDDING('the quick brown fox', 'DOCUMENT', 'test-model'), VECTOR_EMBEDDING('the quick brown fox', 'DOCUMENT', 'test-model')) as sim`
      .where({ ID: 53 })

    assert(Math.abs(res.sim - 1.0) < 0.0001, `Self-similarity should be 1.0, got ${res.sim}`)
  })

  test('storage is HANA-compatible binary format, not JSON string', async () => {
    // Use the built-in sqlite driver directly to read the raw BLOB bytes.
    // The declared cds.Vector(4) column must be stored as exactly 4+4*4=20 bytes:
    // [int32 dim=4, LE][float32 × 4, LE].
    const { Books } = cds.entities('test.vector')
    await INSERT.into(Books).entries({ ID: 60, title: 'binary', description: 'x', embedding: '[0.25, 0.5, 0.75, 1.0]' })

    // Round-trip via the OutputConverter still yields a JSON string
    const row = await SELECT.one.from(Books).where({ ID: 60 })
    assert.strictEqual(typeof row.embedding, 'string', 'App-facing shape is still JSON string')
    const parsed = JSON.parse(row.embedding)
    assert.strictEqual(parsed.length, 4)

    // Inspect the raw storage bytes via an escape hatch: select length() of the BLOB.
    // If storage is JSON string ('[0.25, 0.5, 0.75, 1.0]' = 22 chars), length() = 22.
    // If storage is binary (int32 dim + 4×float32), length() = 20 bytes.
    const raw = await cds.run({
      SELECT: {
        from: { ref: ['test.vector.Books'] },
        columns: [{ func: 'length', args: [{ ref: ['embedding'] }], as: 'nbytes' }],
        where: [{ ref: ['ID'] }, '=', { val: 60 }]
      }
    })
    assert.strictEqual(raw[0].nbytes, 20,
      `Vector(4) must occupy exactly 20 bytes (4 dim + 4×4 f32), got ${raw[0].nbytes}. ` +
      `A JSON-string storage would be ~22 bytes.`)
  })
})
