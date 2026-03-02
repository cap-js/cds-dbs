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

const MODEL_NAME = 'cross-encoder/ms-marco-TinyBERT-L-2-v2'
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
 * Tokenize a pair of texts (query and document) for reranking
 * The format is: [CLS] query [SEP] document [SEP]
 */
function tokenizePair(query, document, vocab, maxLength = 512) {
  const unkToken = '[UNK]'
  const clsToken = '[CLS]'
  const sepToken = '[SEP]'

  const clsId = vocab.get(clsToken) ?? 101
  const sepId = vocab.get(sepToken) ?? 102
  const unkId = vocab.get(unkToken) ?? 100

  if (typeof clsId !== 'number' || typeof sepId !== 'number' || typeof unkId !== 'number') {
    throw new Error('Special tokens must have numeric IDs')
  }

  const normalizedQuery = normalizeText(query)
  const normalizedDoc = normalizeText(document)

  const queryPreTokens = preTokenize(normalizedQuery)
  const docPreTokens = preTokenize(normalizedDoc)

  // Build token IDs for query
  const queryIds = []
  for (const preToken of queryPreTokens) {
    const lowercaseToken = preToken.toLowerCase()
    const wordPieceTokens = wordPieceTokenize(lowercaseToken, vocab, unkToken)
    for (const wpToken of wordPieceTokens) {
      const tokenId = vocab.get(wpToken) ?? unkId
      queryIds.push(tokenId)
    }
  }

  // Build token IDs for document
  const docIds = []
  for (const preToken of docPreTokens) {
    const lowercaseToken = preToken.toLowerCase()
    const wordPieceTokens = wordPieceTokenize(lowercaseToken, vocab, unkToken)
    for (const wpToken of wordPieceTokens) {
      const tokenId = vocab.get(wpToken) ?? unkId
      docIds.push(tokenId)
    }
  }

  // Calculate available space (subtract 3 for [CLS], [SEP], [SEP])
  const availableSpace = maxLength - 3
  
  // Allocate space: give more to document if needed, but ensure query gets some space
  const queryMaxLen = Math.min(queryIds.length, Math.floor(availableSpace / 2))
  const docMaxLen = Math.min(docIds.length, availableSpace - queryMaxLen)

  // Build final sequence: [CLS] query [SEP] document [SEP]
  const inputIds = [
    clsId,
    ...queryIds.slice(0, queryMaxLen),
    sepId,
    ...docIds.slice(0, docMaxLen),
    sepId
  ]

  // Token type IDs: 0 for query part, 1 for document part
  const tokenTypeIds = [
    0, // [CLS]
    ...Array(queryIds.slice(0, queryMaxLen).length).fill(0), // query
    0, // [SEP]
    ...Array(docIds.slice(0, docMaxLen).length).fill(1), // document
    1  // [SEP]
  ]

  return { inputIds, tokenTypeIds }
}

let session = null
let vocab = null
let modelInitPromise = null

export function resetSession() {
  session = null
  vocab = null
  modelInitPromise = null
}

/**
 * Rerank a single query-document pair
 * @param {string} query - The search query
 * @param {string} document - The document to score
 * @returns {Promise<number>} Relevance score (higher is more relevant)
 */
export default async function rerank(query, document) {
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

  const { inputIds, tokenTypeIds } = tokenizePair(query, document, vocab)

  try {
    const validIds = validateTokenIds(inputIds)

    const inputIdsBigInt = new BigInt64Array(validIds.map(i => BigInt(i)))
    const attentionMask = new BigInt64Array(validIds.length).fill(BigInt(1))
    const tokenTypeIdsBigInt = new BigInt64Array(tokenTypeIds.map(i => BigInt(i)))

    const inputTensor = new ort.Tensor('int64', inputIdsBigInt, [1, validIds.length])
    const attentionTensor = new ort.Tensor('int64', attentionMask, [1, validIds.length])
    const tokenTypeTensor = new ort.Tensor('int64', tokenTypeIdsBigInt, [1, validIds.length])

    const feeds = {
      input_ids: inputTensor,
      attention_mask: attentionTensor,
      token_type_ids: tokenTypeTensor
    }

    const results = await session.run(feeds)
    const outputName = Object.keys(results)[0]
    const output = results[outputName]
    
    return output.data[0]
  } catch {
    await forceRedownloadModel(MODEL_DIR, FILES)
    await downloadModelIfNeeded(MODEL_DIR, FILES, MODEL_NAME)
    await initializeModelAndVocab()

    const { inputIds: retryInputIds, tokenTypeIds: retryTokenTypeIds } = tokenizePair(query, document, vocab)
    
    const inputIdsBigInt = new BigInt64Array(retryInputIds.map(i => BigInt(i)))
    const attentionMask = new BigInt64Array(retryInputIds.length).fill(BigInt(1))
    const tokenTypeIdsBigInt = new BigInt64Array(retryTokenTypeIds.map(i => BigInt(i)))

    const inputTensor = new ort.Tensor('int64', inputIdsBigInt, [1, retryInputIds.length])
    const attentionTensor = new ort.Tensor('int64', attentionMask, [1, retryInputIds.length])
    const tokenTypeTensor = new ort.Tensor('int64', tokenTypeIdsBigInt, [1, retryInputIds.length])

    const feeds = {
      input_ids: inputTensor,
      attention_mask: attentionTensor,
      token_type_ids: tokenTypeTensor
    }

    const results = await session.run(feeds)
    const outputName = Object.keys(results)[0]
    const output = results[outputName]
    return output.data[0]
  }
}
