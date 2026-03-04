const embedding = require('./embedding.js')

/**
 * Generate embedding for text
 * @param {string} chunk
 * @returns {Promise<object>} Returns wrapper object { embeddings, id?, ...metadata }
 */
function embeddingWrapper(chunk) {
  const embeddingVector = embedding(chunk)
  const chunkObj = { content: chunk }
  return Object.defineProperty(chunkObj, 'embedding', {
    value: embeddingVector,
    writable: true,
    configurable: true,
    enumerable: false
  })
}

module.exports = {
  embedding: embeddingWrapper,
}
