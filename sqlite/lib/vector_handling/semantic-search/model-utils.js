const fs = require('fs/promises')
const { constants } = require('fs')
const path = require('path')
const { InferenceSession } = require('./InferenceSession')

// File operations
async function fileExists(filePath) {
  try {
    await fs.access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function downloadFile(url, outputPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url}, status ${res.status} (${res.statusText})`)
  await fs.writeFile(outputPath, await res.arrayBuffer())
}

// Model management
async function downloadModelIfNeeded(modelDir, files, modelName) {
  await fs.mkdir(modelDir, { recursive: true })
  for (const file of files) {
    const filePath = path.join(modelDir, path.basename(file))
    if (!(await fileExists(filePath))) await downloadFile(`https://huggingface.co/${modelName}/resolve/main/${file}`, filePath)
  }
}

async function forceRedownloadModel(modelDir, files) {
  for (const file of files) {
    const filePath = path.join(modelDir, path.basename(file))
    if (await fileExists(filePath)) await fs.unlink(filePath).catch(() => { })
  }
}

async function loadModelAndVocab(modelDir) {
  const modelPath = path.join(modelDir, 'model.onnx')
  const vocabPath = path.join(modelDir, 'tokenizer.json')

  const session = await InferenceSession.create(await fs.readFile(modelPath))
  const tokenizerJson = JSON.parse(await fs.readFile(vocabPath, 'utf-8'))

  if (!tokenizerJson.model || !tokenizerJson.model.vocab) throw new Error('Invalid tokenizer structure: missing model.vocab')

  const cleanVocab = new Map()
  for (const [token, id] of Object.entries(tokenizerJson.model.vocab)) {
    if (typeof id === 'number') cleanVocab.set(token, id)
  }

  return { session, vocab: cleanVocab }
}

// Tokenization helpers
function preTokenize(text) {
  return text
    .normalize('NFD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/[!\s]\p{P}[!\s]/ug, p => ` ${p} `)
    .split(/\s/g)
    .filter(a => a)
}

function wordPieceTokenize(token, vocab, unkToken = '[UNK]', maxInputCharsPerWord = 200) {
  if (token.length > maxInputCharsPerWord) return [unkToken]

  const outputTokens = []
  let start = 0
  while (start < token.length) {
    let end = token.length
    let currentSubstring = null

    while (start < end) {
      let substring = token.substring(start, end)
      if (start > 0) substring = '##' + substring
      if (vocab.has(substring)) {
        currentSubstring = substring
        break
      }
      end -= 1
    }

    if (currentSubstring === null) return [unkToken]

    outputTokens.push(currentSubstring)
    start = end
  }

  return outputTokens
}

// Validate token IDs before conversion to BigInt
function validateTokenIds(ids) {
  const validIds = ids.forEach(id => {
    if (typeof id !== 'number' || isNaN(id) || !isFinite(id)) throw new Error(`Invalid token ID detected: ${id} (type: ${typeof id})`)
  })
  return ids
}

module.exports = {
  downloadModelIfNeeded,
  forceRedownloadModel,
  loadModelAndVocab,
  preTokenize,
  wordPieceTokenize,
  validateTokenIds,
}
