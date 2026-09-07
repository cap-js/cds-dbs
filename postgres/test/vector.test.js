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
  })
})
