const os = require('os')
const path = require('path')
const ort = require('onnxruntime-node')
const {
  downloadModelIfNeeded,
  forceRedownloadModel,
  loadModelAndVocab,
  preTokenize,
  wordPieceTokenize,
  validateTokenIds,
} = require('./model-utils.js')

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
const MODEL_DIR = path.join(getDataDir(), 'models', MODEL_NAME.replace('/', '_'))
const FILES = ['onnx/model.onnx', 'tokenizer.json', 'tokenizer_config.json']

async function initializeModelAndVocab() {
  try {
    const result = await loadModelAndVocab(MODEL_DIR)
    session = result.session
    vocab = result.vocab
  } catch {
    await forceRedownloadModel(MODEL_DIR, FILES)
    await downloadModelIfNeeded(MODEL_DIR, FILES, MODEL_NAME)
    const result = await loadModelAndVocab(MODEL_DIR)
    session = result.session
    vocab = result.vocab
  }
}

/**
 * Main tokenization function that combines all steps
 */
function wordPieceTokenizer(text, vocab, maxLength = 512) {
  const unkToken = '[UNK]'
  const clsToken = '[CLS]'
  const sepToken = '[SEP]'

  const clsId = vocab.get(clsToken) ?? 101
  const sepId = vocab.get(sepToken) ?? 102
  const unkId = vocab.get(unkToken) ?? 100

  if (typeof clsId !== 'number' || typeof sepId !== 'number' || typeof unkId !== 'number') {
    throw new Error('Special tokens must have numeric IDs')
  }

  const preTokens = preTokenize(text)

  const tokens = [clsToken]
  const ids = [clsId]

  for (const preToken of preTokens) {
    const lowercaseToken = preToken.toLowerCase()
    const wordPieceTokens = wordPieceTokenize(lowercaseToken, vocab, unkToken)

    for (const wpToken of wordPieceTokens) {
      const tokenId = vocab.get(wpToken) ?? unkId
      tokens.push(wpToken)
      ids.push(tokenId)
    }
  }

  tokens.push(sepToken)
  ids.push(sepId)

  if (tokens.length <= maxLength) return [{ tokens, ids }]

  // For longer texts, create overlapping chunks
  const maxContentLength = maxLength - 2
  const overlap = Math.floor(maxContentLength * 0.1)
  const chunkSize = maxContentLength - overlap

  const chunks = []
  const contentTokens = tokens.slice(1, -1)
  const contentIds = ids.slice(1, -1)

  for (let i = 0; i < contentTokens.length; i += chunkSize) {
    const chunkTokens = [clsToken, ...contentTokens.slice(i, i + maxContentLength - 1), sepToken]
    const chunkIds = [clsId, ...contentIds.slice(i, i + maxContentLength - 1), sepId]

    chunks.push({
      tokens: chunkTokens,
      ids: chunkIds
    })
  }

  return chunks
}

/**
 * Process embeddings for multiple chunks and combine them
 */
function processChunkedEmbeddings(chunks, session) {
  const embeddings = []

  for (const chunk of chunks) {
    const { ids } = chunk
    const validIds = validateTokenIds(ids)

    const inputIds = new BigInt64Array(validIds.map(i => BigInt(i)))
    const attentionMask = new BigInt64Array(validIds.length).fill(BigInt(1))
    const tokenTypeIds = new BigInt64Array(validIds.length).fill(BigInt(0))

    const inputTensor = new ort.Tensor('int64', inputIds, [1, validIds.length])
    const attentionTensor = new ort.Tensor('int64', attentionMask, [1, validIds.length])
    const tokenTypeTensor = new ort.Tensor('int64', tokenTypeIds, [1, validIds.length])

    const feeds = {
      input_ids: inputTensor,
      attention_mask: attentionTensor,
      token_type_ids: tokenTypeTensor
    }

    const results = session.run(feeds)
    const lastHiddenState = results['last_hidden_state']
    const [, sequenceLength, hiddenSize] = lastHiddenState.dims
    const embeddingData = lastHiddenState.data

    // Apply mean pooling across the sequence dimension
    const pooledEmbedding = new Float32Array(hiddenSize)
    for (let i = 0; i < hiddenSize; i++) {
      let sum = 0
      for (let j = 0; j < sequenceLength; j++) {
        sum += embeddingData[j * hiddenSize + i]
      }
      pooledEmbedding[i] = sum / sequenceLength
    }

    embeddings.push(pooledEmbedding)
  }

  // If multiple chunks, average the embeddings
  if (embeddings.length === 1) return embeddings[0]

  const hiddenSize = embeddings[0].length
  const avgEmbedding = new Float32Array(hiddenSize)

  for (let i = 0; i < hiddenSize; i++) {
    let sum = 0
    for (const embedding of embeddings) { sum += embedding[i] }
    avgEmbedding[i] = sum / embeddings.length
  }

  return avgEmbedding
}

let session = null
let vocab = null

async function createSession() {
  await downloadModelIfNeeded(MODEL_DIR, FILES, MODEL_NAME)
  await initializeModelAndVocab()
}

function embedding(text) {
  const chunks = wordPieceTokenizer(text, vocab)
  const vector = normalizeEmbedding(processChunkedEmbeddings(chunks, session))

  const chunkObj = { content: text }
  return Object.defineProperty(chunkObj, 'embedding', {
    value: vector,
    writable: true,
    configurable: true,
    enumerable: false
  })

  function normalizeEmbedding(embedding) {
    let norm = 0
    for (let i = 0; i < embedding.length; i++) { norm += embedding[i] * embedding[i] }
    norm = Math.sqrt(norm)
    for (let i = 0; i < embedding.length; i++) { embedding[i] = embedding[i] / norm }
    return embedding
  }
}

/**
 * Get the platform-specific data directory for the application
 * @param {string} appName - The application name (defaults to 'semantic-search')
 * @returns {string} The full path to the data directory
 */
function getDataDir(appName = 'semantic-search') {
  const home = os.homedir()
  const dir = os.platform() === 'win32'
    ? process.env.LOCALAPPDATA || process.env.APPDATA || path.join(home, 'AppData', 'Local')
    : process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')

  return path.join(dir, appName)
}


module.exports = embedding
module.exports.embedding = embedding
module.exports.createSession = createSession
