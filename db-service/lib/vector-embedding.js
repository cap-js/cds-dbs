'use strict'

function completeVectorEmbedding(args = [], model) {
  if (!args.length || args.length >= 3 || !model) return

  const completed = [...args]
  if (completed.length < 2) completed.push({ val: 'QUERY', param: false })
  completed.push({ val: model, param: false })
  return completed
}

function completeVectorSimilarity(left, right, requires) {
  const args = [left, right]
  const embedding = args.find(arg => arg.func?.toLowerCase() === 'vector_embedding')
  const vector = args.find(arg => arg.element?.['@cds.embeddings.model'] !== undefined)
    || args.find(arg => arg.element?.type === 'cds.Vector')
  const model = requires[vector?.element?.['@cds.embeddings.model']]?.model || requires.embeddings?.model
  const embeddingArgs = embedding && completeVectorEmbedding(embedding.args, model)

  if (!embeddingArgs) return args

  // Keep casts and inference metadata available while replacing only the completed arguments.
  const queryEmbedding = Object.assign(Object.create(embedding), { args: embeddingArgs })
  return left === embedding ? [queryEmbedding, right] : [left, queryEmbedding]
}

module.exports = { completeVectorEmbedding, completeVectorSimilarity }
