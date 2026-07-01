const DIMENSIONS = 384

let embeddingService = { embedSync: hashEmbed }

module.exports = function addSQLiteVectorSupport(dbc) {
  // TO_REAL_VECTOR(text) — accepts a JSON array literal like '[0.1, 0.2, 0.3]'
  // and returns the binary representation. Mirrors the HANA function of the same
  // name; used by cds-dbs' Vector InputConverter and by explicit CAST expressions.
  dbc.function('TO_REAL_VECTOR', { deterministic: true }, jsonStrOrBuf => {
    if (jsonStrOrBuf == null) return null
    if (Buffer.isBuffer(jsonStrOrBuf)) return jsonStrOrBuf // already binary
    return toBinary(parseJsonArray(jsonStrOrBuf))
  })

  // TO_NVARCHAR(vector) — the inverse: decodes binary to a JSON string.
  // Mirrors the HANA cast. Used by the OutputConverter.
  dbc.function('TO_NVARCHAR', { deterministic: true }, buf => {
    if (buf == null) return null
    return jsonStringOf(toFloatArray(buf))
  })

  // VECTOR_EMBEDDING(text, textType, model[, remoteSource])
  // Returns a binary vector produced by the registered embedding service.
  const embedFn = (text, textType, model /*, remoteSource */) => {
    if (textType !== 'DOCUMENT' && textType !== 'QUERY') {
      throw Error(`VECTOR_EMBEDDING called but text_type is ${textType} and not DOCUMENT or QUERY`)
    }
    return embed(text, model)
  }
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (t, tt, m) => embedFn(t, tt, m))
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (t, tt, m, rs) => embedFn(t, tt, m, rs))

  dbc.function('COSINE_SIMILARITY', { deterministic: true }, (v1, v2) => {
    if (v1 == null || v2 == null) return null
    const a = toFloatArray(v1)
    const b = toFloatArray(v2)
    if (a.length !== b.length) throw Error(`Vector dimension mismatch: ${a.length} != ${b.length}`)
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na += a[i] * a[i]
      nb += b[i] * b[i]
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb)
    return denom === 0 ? 0 : dot / denom
  })

  dbc.function('L2DISTANCE', { deterministic: true }, (v1, v2) => {
    if (v1 == null || v2 == null) return null
    const a = toFloatArray(v1)
    const b = toFloatArray(v2)
    if (a.length !== b.length) throw Error(`Vector dimension mismatch: ${a.length} != ${b.length}`)
    let sum = 0
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i]
      sum += d * d
    }
    return Math.sqrt(sum)
  })

  dbc.function('L2NORMALIZE', { deterministic: true }, v => {
    if (v == null) return null
    const arr = toFloatArray(v)
    let sum = 0
    for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i]
    const norm = Math.sqrt(sum)
    if (norm === 0) return toBinary(arr)
    const out = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] / norm
    return toBinary(out)
  })
}

module.exports.setEmbeddingService = svc => { embeddingService = svc }

// Exposed for tests and for the InputConverter emitting an inline call.
module.exports.toBinary = toBinary
module.exports.toFloatArray = toFloatArray
module.exports.jsonStringOf = jsonStringOf

function embed(text, model) {
  if (!text) return toBinary(new Float32Array(DIMENSIONS)) // zero vector
  const vec = embeddingService.embedSync(text, model)
  return toBinary(vec)
}

// --- Binary codec — layout: [int32 dim, LE][float32 × dim, LE] ---

function toBinary(floats) {
  if (floats == null) return null
  const dim = floats.length
  const buf = Buffer.alloc(4 + dim * 4)
  buf.writeInt32LE(dim, 0)
  for (let i = 0; i < dim; i++) buf.writeFloatLE(floats[i], 4 + i * 4)
  return buf
}

function toFloatArray(v) {
  if (v == null) return null
  if (v instanceof Float32Array) return v
  if (Array.isArray(v)) return new Float32Array(v)
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    const buf = Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength)
    if (buf.length < 4) throw Error('Unsupported binary format for cds.Vector')
    const dim = buf.readInt32LE(0)
    const out = new Float32Array(dim)
    for (let i = 0; i < dim; i++) out[i] = buf.readFloatLE(4 + i * 4)
    return out
  }
  if (typeof v === 'string') return new Float32Array(parseJsonArray(v))
  throw Error(`Unsupported vector type: ${typeof v}`)
}

function jsonStringOf(floats) {
  if (floats == null) return null
  // Match HANA's TO_NVARCHAR(REAL_VECTOR) output: "[0.1,0.2,0.3]" (no spaces).
  const parts = new Array(floats.length)
  for (let i = 0; i < floats.length; i++) parts[i] = String(floats[i])
  return '[' + parts.join(',') + ']'
}

function parseJsonArray(str) {
  // Trim brackets and split — faster than JSON.parse for the flat-array shape
  // we always emit, and tolerant of both '[1,2]' and '[1, 2]' inputs.
  const s = String(str).trim()
  if (s === '' || s === '[]') return []
  const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s
  return inner.split(',').map(x => parseFloat(x))
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
  const input = String(text).toLowerCase().trim()
  for (let i = 0; i <= input.length - 3; i++) {
    const trigram = input.substring(i, i + 3)
    const h = fnv1a(trigram)
    const idx = ((h ^ seed) >>> 0) % dims
    vec[idx] += (h & 1) ? 1 : -1
  }
  if (input.length > 0 && input.length < 3) {
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
