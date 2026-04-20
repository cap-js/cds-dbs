let embedding
try { embedding = require('./semantic-search/embedding.js') } catch { }

module.exports = async function addSQLiteVectorSupport(dbc) {
  let genVector = generateVector
  try { await embedding.createSession() } catch { genVector = randomVector }

  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version) => {
    if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') throw Error(`VECOTR_EMBEDDING called but text_type is ${text_type} and not DOCUMENT or QUERY`)
    return genVector(text, text_type, model_and_version)
  })
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version, remote_source) => {
    if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') throw Error(`VECOTR_EMBEDDING called for ${remote_source} but text_type is ${text_type} and not DOCUMENT or QUERY`,)
    return genVector(text, text_type, model_and_version)
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

function toFloatArray(vector) {
  if (vector == null) return null
  if (vector instanceof Float32Array) return Array.from(vector)
  if (Buffer.isBuffer(vector)) return JSON.parse(vector.toString('utf8'))
  if (vector instanceof Uint8Array) return JSON.parse(new global.TextDecoder().decode(vector))
  if (typeof vector === 'string') return JSON.parse(vector)
  if (Array.isArray(vector)) return vector
  throw new Error(`Unsupported vector type: ${typeof vector}`)
}

/**
 * Converts a plain Array of numbers back into the same format as the original input.
 */
function fromFloatArray(arr, original) {
  if (original instanceof Float32Array) {
    return new Float32Array(arr)
  }
  // Default: return as JSON string (also for Buffer/BLOB inputs)
  return JSON.stringify(arr)
}

const model_dimensions = {
  'SAP_GXY.20250407': 384, // 768 actually
  'SAP_GXY.20240715': 384, // 768 actually
}
function generateVector(text, _, model_and_version) {
  if (text) return JSON.stringify(Array.from(embedding.embedding(text).embedding))
  return JSON.stringify(new Array(model_dimensions[model_and_version] ?? 384).fill(0))
}
function randomVector(text, _, model_and_version) {
  if (text) return JSON.stringify(new Array(model_dimensions[model_and_version] ?? 384).fill(null).map(() => Math.random()))
  return JSON.stringify(new Array(model_dimensions[model_and_version] ?? 384).fill(0))
}
