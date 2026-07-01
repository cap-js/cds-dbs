const DIMENSIONS = 384

let embeddingService = { embedSync: hashEmbed }

module.exports = function addSQLiteVectorSupport(dbc) {
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version) => {
    if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') throw Error(`VECTOR_EMBEDDING called but text_type is ${text_type} and not DOCUMENT or QUERY`)
    return embed(text, model_and_version)
  })
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version, remote_source) => {
    if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') throw Error(`VECTOR_EMBEDDING called for ${remote_source} but text_type is ${text_type} and not DOCUMENT or QUERY`)
    return embed(text, model_and_version)
  })
  dbc.function('COSINE_SIMILARITY', { deterministic: true }, (vector1, vector2) => {
    if (vector1 == null || vector2 == null) return null

    const v1 = toFloatArray(vector1)
    const v2 = toFloatArray(vector2)
    let dot = 0,
      norm1 = 0,
      norm2 = 0
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
  dbc.function('L2NORMALIZE', { deterministic: true }, vector => {
    if (vector == null) return null

    const v = toFloatArray(vector)
    let sum = 0
    for (let i = 0; i < v.length; i++) { sum += v[i] * v[i] }
    const norm = Math.sqrt(sum)
    if (norm === 0) return fromFloatArray(v, vector)
    return fromFloatArray(v.map(x => x / norm), vector)
  })
}

module.exports.setEmbeddingService = svc => { embeddingService = svc }

function embed(text, model_and_version) {
  if (!text) return JSON.stringify(new Array(DIMENSIONS).fill(0))
  const vec = embeddingService.embedSync(text, model_and_version)
  return JSON.stringify(Array.from(vec))
}

// --- Hash-based fallback embedding (deterministic, no external deps) ---

function fnv1a(str) {
  let h = 0x811c9dc5 | 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function hashEmbed(text, model_and_version) {
  const dims = DIMENSIONS
  const vec = new Float32Array(dims)
  // Use FNV-1a seeded with model to generate sparse random projection
  const seed = fnv1a(model_and_version || 'default')
  // Split text into trigrams and accumulate hashed contributions
  const input = text.toLowerCase().trim()
  for (let i = 0; i <= input.length - 3; i++) {
    const trigram = input.substring(i, i + 3)
    const h = fnv1a(trigram)
    const idx = ((h ^ seed) >>> 0) % dims
    vec[idx] += (h & 1) ? 1 : -1
  }
  // Handle short text (fewer than 3 chars)
  if (input.length < 3) {
    const h = fnv1a(input)
    const idx = ((h ^ seed) >>> 0) % dims
    vec[idx] += 1
  }
  // L2-normalize
  let norm = 0
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < dims; i++) vec[i] /= norm
  return vec
}

// --- Vector format conversion helpers ---

function toFloatArray(vector) {
  if (vector == null) return null
  if (vector instanceof Float32Array) return Array.from(vector)
  if (Buffer.isBuffer(vector)) return JSON.parse(vector.toString('utf8'))
  if (vector instanceof Uint8Array) return JSON.parse(new global.TextDecoder().decode(vector))
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
