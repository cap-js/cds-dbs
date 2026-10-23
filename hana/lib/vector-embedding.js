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
  const elements = args.map(vectorElement)
  const vector = elements.find(element => element?.['@cds.embeddings.model'] !== undefined)
    || elements.find(element => element?.type === 'cds.Vector')
  const model = requires[vector?.['@cds.embeddings.model']]?.model || requires.embeddings?.model
  return args.map(arg => completeQueryVector(arg, model))
}

// Normalization and parentheses preserve the embedding model of their operand.
function vectorWrapper(arg) {
  if (arg.func?.toLowerCase() === 'l2normalize' && arg.args?.length === 1) return 'args'
  if (!arg.func && arg.xpr?.length === 1) return 'xpr'
}

function vectorElement(arg) {
  // Calculated vector expressions can carry their original reference as element metadata.
  const element = arg.element?.$refLinks?.at(-1)?.definition || arg.element
  if (element?.['@cds.embeddings.model'] !== undefined) return element
  const property = vectorWrapper(arg)
  return property ? vectorElement(arg[property][0]) || element : element
}

function completeQueryVector(arg, model) {
  let property = vectorWrapper(arg)
  let completed
  if (property) {
    const operand = arg[property][0]
    const queryVector = completeQueryVector(operand, model)
    if (queryVector === operand) return arg
    completed = [queryVector]
  } else if (arg.func?.toLowerCase() === 'vector_embedding') {
    property = 'args'
    completed = completeVectorEmbedding(arg.args, model)
  }
  if (!completed) return arg

  // Keep casts and inference metadata while leaving reusable CQN untouched.
  return Object.assign(Object.create(arg), { [property]: completed })
}

module.exports = { completeVectorEmbedding, completeVectorSimilarity }
