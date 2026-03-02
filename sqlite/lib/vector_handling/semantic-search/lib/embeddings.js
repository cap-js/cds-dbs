const embedding = require('./embedding.js')

/**
 * Generate embeddings for text chunks
 * @param {string[] | object[]} chunks - Array of strings or objects with content property
 * @param {object} [config] - Optional config object with id, description, and other metadata
 * @returns {Promise<object>} Returns wrapper object { embeddings, id?, ...metadata }
 */
async function embeddings(chunks, config) {
  const result = []

  for (const chunk of chunks) {
    // Handle both string and object formats
    if (typeof chunk === 'string') {
      const embeddingVector = await embedding(chunk)
      const chunkObj = { content: chunk }
      Object.defineProperty(chunkObj, 'embedding', {
        value: embeddingVector,
        writable: true,
        configurable: true,
        enumerable: false
      })
      result.push(chunkObj)
    } else if (chunk && typeof chunk === 'object' && typeof chunk.content === 'string') {
      const content = chunk.content
      const embeddingVector = await embedding(content)
      // Preserve all original properties and add embedding
      const chunkObj = { ...chunk }
      Object.defineProperty(chunkObj, 'embedding', {
        value: embeddingVector,
        writable: true,
        configurable: true,
        enumerable: false
      })
      result.push(chunkObj)
    } else {
      // Handle edge case where content is undefined - preserve original behavior
      const content = chunk?.content
      const embeddingVector = await embedding(content)
      const chunkObj = { content }
      Object.defineProperty(chunkObj, 'embedding', {
        value: embeddingVector,
        writable: true,
        configurable: true,
        enumerable: false
      })
      result.push(chunkObj)
    }
  }

  // Always return wrapper object with embeddings
  return {
    embeddings: result,
    ...(config || {})
  }
}

module.exports = {
  embeddings,
}
