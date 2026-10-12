'use strict'

const cds = require('@sap/cds')
const CQN2SQL = require('../lib/cqn2sql').class

describe('vector embedding defaults', () => {
  let embeddings

  beforeEach(() => {
    embeddings = cds.requires.embeddings
    cds.requires.embeddings = { model: 'CUSTOM.MODEL' }
  })

  afterEach(() => {
    cds.requires.embeddings = embeddings
  })

  const render = column => new CQN2SQL().render({
    SELECT: {
      from: { ref: ['Books'] },
      columns: [{ ...column, as: 'embedding' }],
    },
  })

  test('adds query type and configured model to one-argument calls', () => {
    const call = { func: 'vector_embedding', args: [{ val: 'needle' }] }

    const { sql, values } = render(call)

    expect(sql).toBe("SELECT vector_embedding(?,'QUERY','CUSTOM.MODEL') as embedding FROM Books")
    expect(values).toEqual(['needle'])
    expect(call.args).toEqual([{ val: 'needle' }])
  })

  test('preserves an explicit text type and adds the configured model', () => {
    const { sql, values } = render({
      func: 'vector_embedding',
      args: [{ val: 'needle' }, { val: 'DOCUMENT' }],
    })

    expect(sql).toBe("SELECT vector_embedding(?,?,'CUSTOM.MODEL') as embedding FROM Books")
    expect(values).toEqual(['needle', 'DOCUMENT'])
  })

  test('preserves fully specified calls', () => {
    const { sql, values } = render({
      func: 'vector_embedding',
      args: [{ val: 'needle' }, { val: 'DOCUMENT' }, { val: 'EXPLICIT.MODEL' }],
    })

    expect(sql).toBe('SELECT vector_embedding(?,?,?) as embedding FROM Books')
    expect(values).toEqual(['needle', 'DOCUMENT', 'EXPLICIT.MODEL'])
  })

  test('preserves calls with a remote source', () => {
    const { sql, values } = render({
      func: 'vector_embedding',
      args: [
        { val: 'needle' },
        { val: 'QUERY' },
        { val: 'EXPLICIT.MODEL' },
        { val: 'REMOTE.SOURCE' },
      ],
    })

    expect(sql).toBe('SELECT vector_embedding(?,?,?,?) as embedding FROM Books')
    expect(values).toEqual(['needle', 'QUERY', 'EXPLICIT.MODEL', 'REMOTE.SOURCE'])
  })

  test('handles uppercase nested calls', () => {
    const { sql, values } = render({
      func: 'cosine_similarity',
      args: [
        { func: 'VECTOR_EMBEDDING', args: [{ val: 'needle' }] },
        { ref: ['embedding'] },
      ],
    })

    expect(sql).toBe(
      "SELECT cosine_similarity(VECTOR_EMBEDDING(?,'QUERY','CUSTOM.MODEL'),embedding) as embedding FROM Books",
    )
    expect(values).toEqual(['needle'])
  })

  test('leaves calls unchanged without an embeddings configuration', () => {
    cds.requires.embeddings = undefined

    const { sql, values } = render({ func: 'vector_embedding', args: [{ val: 'needle' }] })

    expect(sql).toBe('SELECT vector_embedding(?) as embedding FROM Books')
    expect(values).toEqual(['needle'])
  })
})
