import path from 'path'
import * as ort from 'onnxruntime-web'
import { getDataDir } from './utils.js'
import {
  downloadModelIfNeeded,
  forceRedownloadModel,
  loadModelAndVocab,
  normalizeText,
  preTokenize,
  wordPieceTokenize,
  validateTokenIds
} from './model-utils.js'

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

  const normalizedText = normalizeText(text)
  const preTokens = preTokenize(normalizedText)

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

  if (tokens.length <= maxLength) {
    return [{ tokens, ids }]
  }

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
async function processChunkedEmbeddings(chunks, session) {
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

    const results = await session.run(feeds)
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
  if (embeddings.length === 1) {
    return embeddings[0]
  }

  const hiddenSize = embeddings[0].length
  const avgEmbedding = new Float32Array(hiddenSize)

  for (let i = 0; i < hiddenSize; i++) {
    let sum = 0
    for (const embedding of embeddings) {
      sum += embedding[i]
    }
    avgEmbedding[i] = sum / embeddings.length
  }

  return avgEmbedding
}

let session = null
let vocab = null
let modelInitPromise = null

export function resetSession() {
  session = null
  vocab = null
  modelInitPromise = null
}

export default async function embedding(text) {
  if (!modelInitPromise) {
    modelInitPromise = (async () => {
      try {
        await downloadModelIfNeeded(MODEL_DIR, FILES, MODEL_NAME)
        await initializeModelAndVocab()
      } catch (error) {
        modelInitPromise = null
        throw error
      }
    })()
  }

  await modelInitPromise

  if (!session || !vocab) {
    await initializeModelAndVocab()
  }

  const chunks = wordPieceTokenizer(text, vocab)

  function normalizeEmbedding(embedding) {
    let norm = 0
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i]
    }
    norm = Math.sqrt(norm)

    const normalized = new Float32Array(embedding.length)
    for (let i = 0; i < embedding.length; i++) {
      normalized[i] = embedding[i] / norm
    }
    return normalized
  }

  try {
    const pooledEmbedding = await processChunkedEmbeddings(chunks, session)
    return normalizeEmbedding(pooledEmbedding)
  } catch {
    await forceRedownloadModel(MODEL_DIR, FILES)
    await downloadModelIfNeeded(MODEL_DIR, FILES, MODEL_NAME)
    await initializeModelAndVocab()

    const retryPooledEmbedding = await processChunkedEmbeddings(chunks, session)
    return normalizeEmbedding(retryPooledEmbedding)
  }
}
