const { createSession } = require('./semantic-search')
const { embedding } = require('./semantic-search')

/**
 * Converts a vector from any supported input format to a plain Array of numbers.
 * Supported formats:
 *  - Buffer: BLOB from SQLite containing JSON-encoded array of floats
 *  - Float32Array: typed array of floats
 *  - string: JSON-encoded array of floats, e.g. "[0.1, 0.2, 0.3]"
 */
function toFloatArray(vector) {
  if (vector == null) return null
  if (vector instanceof Float32Array) {
    return Array.from(vector)
  }
  if (Buffer.isBuffer(vector)) {
    return JSON.parse(vector.toString('utf8'))
  }
  if (typeof vector === 'string') {
    return JSON.parse(vector)
  }
  if (Array.isArray(vector)) {
    return vector
  }
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

module.exports = async function addSQLiteVectorSupport(dbc) {
  await createSession()
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version) => {
    if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') {
      throw Error(`VECOTR_EMBEDDING called but text_type is ${text_type} and not DOCUMENT or QUERY`)
    }
    const result = generateVector(text, text_type, model_and_version)
    return JSON.stringify(result)
  })
  dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version, remote_source) => {
    if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') {
      throw Error(
        `VECOTR_EMBEDDING called for ${remote_source} but text_type is ${text_type} and not DOCUMENT or QUERY`,
      )
    }
    const result = generateVector(text, text_type, model_and_version)
    return JSON.stringify(result)
  })
  dbc.function('COSINE_SIMILARITY', { deterministic: true }, (vector1, vector2) => {
    const v1 = toFloatArray(vector1)
    const v2 = toFloatArray(vector2)
    if (v1 == null || v2 == null) return null
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
    const v1 = toFloatArray(vector1)
    const v2 = toFloatArray(vector2)
    if (v1 == null || v2 == null) return null
    let sum = 0
    for (let i = 0; i < v1.length; i++) {
      const diff = v1[i] - v2[i]
      sum += diff * diff
    }
    return Math.sqrt(sum)
  })
  dbc.function('L2NORMALIZE', { deterministic: true }, vector => {
    const v = toFloatArray(vector)
    if (v == null) return null
    let sum = 0
    for (let i = 0; i < v.length; i++) {
      sum += v[i] * v[i]
    }
    const norm = Math.sqrt(sum)
    if (norm === 0) return fromFloatArray(v, vector)
    const result = v.map(x => x / norm)
    return fromFloatArray(result, vector)
  })
}

function generateVector(text, _, model_and_version) {
  if (text) {
    const res = embedding(text)
    return Array.from(res.embedding)
  }
  let dimensions;
  switch (model_and_version) {
    case 'SAP_GXY.20250407':
    case 'SAP_GXY.20240715':
      dimensions = 384 //768 actually
      break
    default:
      dimensions = 384
  }
  return getEmptyVector(dimensions)
}

function getEmptyVector(dimensions) {
  const result = []
  for (let i = 0; i < dimensions; i++) {
    result.push(0)
  }
  return result
}
