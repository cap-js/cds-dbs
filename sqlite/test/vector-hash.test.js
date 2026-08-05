const cds = require('../../test/cds.js')

describe('VECTOR_EMBEDDING - hash implementation (mocked)', () => {
  const { expect } = cds.test(__dirname + '/../../test/compliance/resources')

  test('computes hash-based embedding', async () => {
    const res = await SELECT.from('complex.associations.Books')
      .columns`VECTOR_EMBEDDING(title, 'text', 'model') as embedding`
      .limit(1)
    const embedding = JSON.parse(res[0].embedding)
    expect(Array.isArray(embedding)).to.eq(true)
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
})
