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

function l2Distance(a, b) {
  if (a == null || b == null) return null
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

function l2Normalize(v) {
  if (v == null) return null
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  if (norm === 0) return v
  norm = Math.sqrt(norm)
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/**
 * Deterministic synchronous hash-based embedding function for SQLite.
 * NOTE: If a synchronous embedding library becomes available for Node.js,
 * it can be integrated here to replace the hash-based implementation.
 */
function hashEmbedding(text, dimensions = 384) {
  if (text == null) return null
  const vector = new Float32Array(dimensions)
  const normalized = text.toLowerCase()
  const ngramSize = 3

  if (normalized.length >= ngramSize) {
    for (let i = 0; i <= normalized.length - ngramSize; i++)
      project(ngramHash(normalized, i, ngramSize), vector, dimensions)
  } else {
    for (let i = 0; i < normalized.length; i++)
      project(normalized.charCodeAt(i), vector, dimensions)
  }
  return Array.from(l2Normalize(vector))
}

function ngramHash(text, start, len) {
  let hash = 0x811c9dc5
  for (let i = start; i < start + len; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash
}

function project(hash, vector, dimensions) {
  for (let band = 0; band < 4; band++) {
    const h = rehash(hash, band)
    vector[Math.abs(h % dimensions)] += ((h >>> 16) & 1) === 0 ? 1.0 : -1.0
  }
}

function rehash(hash, band) {
  let h = hash ^ Math.imul(band, 0x9e3779b9)
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return h
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

module.exports = { cosineSimilarity, l2Distance, l2Normalize, hashEmbedding, toFloatArray, fromFloatArray }
