const cds = require('@sap/cds')

let embeddingService = null

/** Tries @xenova/transformers, falls back to hash-based embedding */
async function getEmbeddingService() {
  if (embeddingService) return embeddingService

  try {
    const { pipeline } = require('@xenova/transformers')
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    embeddingService = {
      name: 'transformers',
      embed: async (text) => Array.from((await extractor(text, { pooling: 'mean', normalize: true })).data)
    }
    cds.log('sqlite').info('Using @xenova/transformers for vector embeddings')
  } catch {
    embeddingService = {
      name: 'hash',
      embed: async (text) => hashEmbedding(text)
    }
    cds.log('sqlite').info('Using hash-based fallback for vector embeddings (install @xenova/transformers for real embeddings)')
  }
  return embeddingService
}

/** Cosine similarity of two vectors */
function cosineSimilarity(a, b) {
  if (a == null || b == null) return null
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** L2 (Euclidean) distance of two vectors */
function l2Distance(a, b) {
  if (a == null || b == null) return null
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/** L2 normalizes vector in place */
function l2Normalize(v) {
  if (v == null) return null
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  if (norm === 0) return v
  norm = Math.sqrt(norm)
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/** Deterministic hash-based embedding (port of Java's HashEmbeddingService). For testing only. */
function hashEmbedding(text, dimensions = 384, ngramSize = 3) {
  if (text == null) return null
  const vector = new Float32Array(dimensions)
  const normalized = text.toLowerCase()

  if (normalized.length >= ngramSize) {
    for (let i = 0; i <= normalized.length - ngramSize; i++)
      project(ngramHash(normalized, i, ngramSize), vector, dimensions)
  } else {
    for (let i = 0; i < normalized.length; i++)
      project(normalized.charCodeAt(i), vector, dimensions)
  }
  return Array.from(l2Normalize(vector))
}

/** FNV-1a hash for n-gram */
function ngramHash(text, start, len) {
  let hash = 0x811c9dc5
  for (let i = start; i < start + len; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash
}

/** Maps hash to sparse dimensions via 4 projection bands */
function project(hash, vector, dimensions) {
  for (let band = 0; band < 4; band++) {
    const h = rehash(hash, band)
    vector[Math.abs(h % dimensions)] += ((h >>> 16) & 1) === 0 ? 1.0 : -1.0
  }
}

/** Avalanche-mixes hash with band seed */
function rehash(hash, band) {
  let h = hash ^ Math.imul(band, 0x9e3779b9)
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return h
}

module.exports = async function addSQLiteVectorSupport(dbc) {
  dbc.function('COSINE_SIMILARITY', { deterministic: true }, (v1, v2) =>
    cosineSimilarity(toFloatArray(v1), toFloatArray(v2)))

  dbc.function('L2DISTANCE', { deterministic: true }, (v1, v2) =>
    l2Distance(toFloatArray(v1), toFloatArray(v2)))

  dbc.function('L2NORMALIZE', { deterministic: true }, (v) =>
    v == null ? null : fromFloatArray(l2Normalize(toFloatArray(v)), v))

  // VECTOR_EMBEDDING throws - embeddings are computed via CAP db.before handlers
  const err = () => { throw new Error('VECTOR_EMBEDDING cannot be called directly in SQLite. Use CAP event handlers.') }
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (a, b, c) => err())
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (a, b, c, d) => err())
}

function toFloatArray(vector) {
  if (vector == null) return null
  if (vector instanceof Float32Array) return Array.from(vector)
  if (Buffer.isBuffer(vector)) return JSON.parse(vector.toString('utf8'))
  if (vector instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(vector))
  if (typeof vector === 'string') return JSON.parse(vector)
  if (Array.isArray(vector)) return vector
  throw new Error(`Unsupported vector type: ${typeof vector}`)
}

function fromFloatArray(arr, original) {
  return original instanceof Float32Array ? new Float32Array(arr) : JSON.stringify(arr)
}

module.exports.getEmbeddingService = getEmbeddingService
module.exports.hashEmbedding = hashEmbedding
