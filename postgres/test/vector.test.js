const cds = require('../../test/cds.js')
const { Client } = require('pg')
const os = require('os')

describe('vector functions', () => {
  const { expect } = cds.test(__dirname + '/../../test/compliance/resources')

  // Setup pgvector extension and fake vector_embedding function
  beforeAll(async () => {
    const testDb = process.env.TRAVIS_JOB_ID || process.env.GITHUB_RUN_ID || os.userInfo().username || 'test_db'

    // First connect to postgres db to create extension in template1 and ensure test db exists
    const adminClient = new Client({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres'
    })
    await adminClient.connect()
    await adminClient.query('CREATE EXTENSION IF NOT EXISTS vector')

    // Create test database if it doesn't exist
    try {
      await adminClient.query(`CREATE DATABASE "${testDb}"`)
    } catch (e) {
      // Database might already exist
    }
    await adminClient.end()

    // Now connect to the test database and set up extension + function
    const client = new Client({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: testDb
    })
    await client.connect()
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')
    await client.query(`
      CREATE OR REPLACE FUNCTION public.vector_embedding(model text, input text)
      RETURNS text AS $$
        SELECT CASE WHEN input IS NULL THEN NULL
          ELSE (SELECT json_agg(sin(i * hashtext(input)::float8 / 1000))::text
                FROM generate_series(1, 384) i)
        END;
      $$ LANGUAGE SQL IMMUTABLE;
    `)
    await client.end()
  })

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
    test('computes embedding', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`VECTOR_EMBEDDING('model', title) as embedding`
        .limit(1)
      const embedding = JSON.parse(res[0].embedding)
      expect(Array.isArray(embedding)).to.eq(true)
      expect(embedding.length).to.eq(384)
    })
    test('deterministic', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`vector_embedding('model', 'test') as e1, vector_embedding('model', 'test') as e2`
      expect(res[0].e1).to.eq(res[0].e2)
    })
    test('different inputs different outputs', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`vector_embedding('model', 'hello') as e1, vector_embedding('model', 'world') as e2`
      expect(res[0].e1).to.not.eq(res[0].e2)
    })
    test('null returns null', async () => {
      const res = await SELECT.from('complex.associations.Books')
        .columns`vector_embedding('model', null) as embedding`
      expect(res[0].embedding).to.eq(null)
    })
  })
})
