const cds = require('@sap/cds')

// Embedding service - will be initialized on first use
let embeddingService = null

/**
 * Initialize the embedding service.
 * Tries to use @xenova/transformers if available, falls back to hash-based embedding.
 */
async function getEmbeddingService() {
  if (embeddingService) return embeddingService

  try {
    // Try to load @xenova/transformers
    const { pipeline } = require('@xenova/transformers')
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')

    embeddingService = {
      name: 'transformers',
      embed: async (text) => {
        const result = await extractor(text, { pooling: 'mean', normalize: true })
        return Array.from(result.data)
      }
    }
    cds.log('sqlite').info('Using @xenova/transformers for vector embeddings')
  } catch {
    // Fallback to deterministic hash-based embedding (like Java's HashEmbeddingService)
    embeddingService = {
      name: 'hash',
      embed: async (text) => hashEmbedding(text)
    }
    cds.log('sqlite').info('Using hash-based fallback for vector embeddings (install @xenova/transformers for real embeddings)')
  }

  return embeddingService
}

/**
 * Deterministic hash-based embedding service.
 * Port of Java's HashEmbeddingService - uses FNV-1a hash + sparse random projection.
 * Same input always produces same output (unlike random fallback).
 *
 * Not suitable for production - limited semantic quality.
 * Use for testing when @xenova/transformers is not available.
 */
function hashEmbedding(text, dimensions = 384, ngramSize = 3) {
  if (text == null) return null

  const vector = new Float32Array(dimensions)
  const normalized = text.toLowerCase()

  // Accumulate random projections for each character n-gram
  if (normalized.length >= ngramSize) {
    for (let i = 0; i <= normalized.length - ngramSize; i++) {
      project(ngramHash(normalized, i, ngramSize), vector, dimensions)
    }
  } else {
    // Short text fallback: use individual characters
    for (let i = 0; i < normalized.length; i++) {
      project(normalized.charCodeAt(i), vector, dimensions)
    }
  }

  l2Normalize(vector)
  return Array.from(vector)
}

/**
 * FNV-1a inspired polynomial rolling hash for n-gram.
 */
function ngramHash(text, start, len) {
  let hash = 0x811c9dc5
  for (let i = start; i < start + len; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash
}

/**
 * Maps hash value to sparse dimensions via 4 independent projection bands.
 */
function project(hash, vector, dimensions) {
  for (let band = 0; band < 4; band++) {
    const h = rehash(hash, band)
    const dim = Math.abs(h % dimensions)
    const sign = ((h >>> 16) & 1) === 0 ? 1.0 : -1.0
    vector[dim] += sign
  }
}

/**
 * Avalanche-mixes hash with band seed for independent projection.
 */
function rehash(hash, band) {
  let h = hash ^ Math.imul(band, 0x9e3779b9)
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return h
}

/**
 * L2 normalize vector in place.
 */
function l2Normalize(vector) {
  let norm = 0
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i]
  }
  if (norm === 0) return
  norm = Math.sqrt(norm)
  for (let i = 0; i < vector.length; i++) {
    vector[i] /= norm
  }
}

// ============================================================================
// SQLite Vector Functions (synchronous - pure math only)
// ============================================================================

module.exports = async function addSQLiteVectorSupport(dbc) {
  // Register synchronous vector math functions
  dbc.function('COSINE_SIMILARITY', { deterministic: true }, (vector1, vector2) => {
    if (vector1 == null || vector2 == null) return null

    const v1 = toFloatArray(vector1)
    const v2 = toFloatArray(vector2)
    let dot = 0, norm1 = 0, norm2 = 0
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i]
      norm1 += v1[i] * v1[i]
      norm2 += v2[i] * v2[i]
    }
    const denom = Math.sqrt(norm1) * Math.sqrt(norm2)
    return denom === 0 ? 0 : dot / denom
  })

  dbc.function('L2DISTANCE', { deterministic: true }, (vector1, vector2) => {
    if (vector1 == null || vector2 == null) return null

    const v1 = toFloatArray(vector1)
    const v2 = toFloatArray(vector2)
    let sum = 0
    for (let i = 0; i < v1.length; i++) {
      const diff = v1[i] - v2[i]
      sum += diff * diff
    }
    return Math.sqrt(sum)
  })

  dbc.function('L2NORMALIZE', { deterministic: true }, (vector) => {
    if (vector == null) return null

    const v = toFloatArray(vector)
    let sum = 0
    for (let i = 0; i < v.length; i++) {
      sum += v[i] * v[i]
    }
    const norm = Math.sqrt(sum)
    if (norm === 0) return fromFloatArray(v, vector)
    return fromFloatArray(v.map(x => x / norm), vector)
  })

  // VECTOR_EMBEDDING is handled via CAP db.before handlers (see SQLiteService)
  // We register a stub that throws an error if called directly in SQL
  // This ensures embeddings are pre-computed at the CAP level where async is allowed
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version) => {
    throw new Error(
      'VECTOR_EMBEDDING cannot be called directly in SQLite SQL. ' +
      'Embeddings are computed automatically via CAP event handlers. ' +
      'Ensure your entity has a vector field and the source text field is populated.'
    )
  })
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version, remote_source) => {
    throw new Error(
      'VECTOR_EMBEDDING cannot be called directly in SQLite SQL. ' +
      'Embeddings are computed automatically via CAP event handlers. ' +
      'Ensure your entity has a vector field and the source text field is populated.'
    )
  })
}

// ============================================================================
// Vector Format Utilities
// ============================================================================

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
  if (original instanceof Float32Array) {
    return new Float32Array(arr)
  }
  return JSON.stringify(arr)
}

// ============================================================================
// Exports for CAP handlers
// ============================================================================

module.exports.getEmbeddingService = getEmbeddingService
module.exports.hashEmbedding = hashEmbedding
