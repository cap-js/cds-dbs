'use strict'

const cds = require('../../test/cds.js')

describe('Vector round-trip on HANA', () => {
  const { expect } = cds.test(__dirname, 'vector.cds')

  test('INSERT and SELECT a vector value', async () => {
    const { TestVec } = cds.entities('hana.vector.test')

    await INSERT({ id: 1, v: '[0.1, 0.2, 0.3]' }).into(TestVec)

    const result = await SELECT.one.from(TestVec).where({ id: 1 })
    expect(result).to.exist
    // HANA OutputConverters.Vector returns TO_NVARCHAR(vector_col) → string like "[0.1,0.2,0.3]"
    expect(result.v).to.be.a('string')
    // Parse and verify approximate values
    const parsed = JSON.parse(result.v)
    expect(parsed).to.have.lengthOf(3)
    expect(parsed[0]).to.be.closeTo(0.1, 0.001)
    expect(parsed[1]).to.be.closeTo(0.2, 0.001)
    expect(parsed[2]).to.be.closeTo(0.3, 0.001)
  })

  test('cosine_similarity with identical vectors returns 1', async () => {
    const { TestVec } = cds.entities('hana.vector.test')

    await INSERT.into(TestVec).entries({ id: 10, v: '[0.1, 0.2, 0.3]' })

    // Use CQN with param:false to inline the vector literal (hdb cannot bind strings to REAL_VECTOR params)
    const res = await SELECT.from(TestVec).columns(
      { func: 'cosine_similarity', args: [{ ref: ['v'] }, { val: '[0.1, 0.2, 0.3]', param: false, cast: { type: 'cds.Vector' } }], as: 'sim' }
    ).where({ id: 10 })

    expect(res).to.have.lengthOf(1)
    expect(res[0].sim).to.be.closeTo(1.0, 0.0001)
  })

  test('l2_distance with identical vectors returns 0', async () => {
    const { TestVec } = cds.entities('hana.vector.test')

    await INSERT.into(TestVec).entries({ id: 20, v: '[0.1, 0.2, 0.3]' })

    const res = await SELECT.from(TestVec).columns(
      { func: 'l2distance', args: [{ ref: ['v'] }, { val: '[0.1, 0.2, 0.3]', param: false, cast: { type: 'cds.Vector' } }], as: 'dist' }
    ).where({ id: 20 })

    expect(res).to.have.lengthOf(1)
    expect(res[0].dist).to.be.closeTo(0, 0.0001)
  })

  test('cosine_similarity with orthogonal vectors returns 0', async () => {
    const { TestVec } = cds.entities('hana.vector.test')

    await INSERT.into(TestVec).entries({ id: 30, v: '[1, 0, 0]' })

    const res = await SELECT.from(TestVec).columns(
      { func: 'cosine_similarity', args: [{ ref: ['v'] }, { val: '[0, 1, 0]', param: false, cast: { type: 'cds.Vector' } }], as: 'sim' }
    ).where({ id: 30 })

    expect(res).to.have.lengthOf(1)
    expect(res[0].sim).to.be.closeTo(0, 0.0001)
  })

  // vector_embedding() requires a HANA instance with NLP / remote source configured.
  // This is NOT available on trial or HXE instances, so we skip unconditionally here.
  // To enable: set HANA_NLP_REMOTE_SOURCE env var and configure cds.env.ai.embeddings.remoteSource.
  test.skip('vector_embedding - requires NLP remote source', () => {
    // Placeholder: would test vector_embedding(description, 'DOCUMENT', 'MODEL_NAME')
  })
})
