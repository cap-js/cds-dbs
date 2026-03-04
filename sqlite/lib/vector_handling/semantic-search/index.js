// Main exports for semantic search functionality
const {
  embedding,
} = require('./lib/embeddings.js')

const {
  createSession
} = require('./lib/embedding.js')

module.exports = {
  embedding,
  createSession
}
