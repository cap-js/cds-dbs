const fs = require('fs/promises')
const { constants } = require('fs')
const path = require('path')
const { InferenceSession } = require('./InferenceSession')

// File operations
async function saveFile(buffer, outputPath) {
  await fs.writeFile(outputPath, Buffer.from(buffer))
}

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
  if (!res.ok) throw new Error(`Failed to download ${url}, status ${res.status}`)

  if (url.endsWith('.onnx')) {
    const arrayBuffer = await res.arrayBuffer()
    await saveFile(arrayBuffer, outputPath)
  } else if (url.endsWith('.json')) {
    const json = await res.json()
    await saveFile(JSON.stringify(json, null, 2), outputPath)
  } else {
    const text = await res.text()
    await saveFile(text, outputPath)
  }
}

// Model management
async function downloadModelIfNeeded(modelDir, files, modelName) {
  try {
    await fs.access(modelDir)
  } catch {
    await fs.mkdir(modelDir, { recursive: true })
  }

  for (const file of files) {
    const filePath = path.join(modelDir, path.basename(file))
    if (!(await fileExists(filePath))) {
      const url = `https://huggingface.co/${modelName}/resolve/main/${file}`
      await downloadFile(url, filePath)
    }
  }
}

async function forceRedownloadModel(modelDir, files) {
  for (const file of files) {
    const filePath = path.join(modelDir, path.basename(file))
    if (await fileExists(filePath)) {
      await fs.unlink(filePath).catch(() => {})
    }
  }
}

async function loadModelAndVocab(modelDir) {
  const modelPath = path.join(modelDir, 'model.onnx')
  const vocabPath = path.join(modelDir, 'tokenizer.json')

  const modelBuffer = await fs.readFile(modelPath)
  
  const session = await InferenceSession.create(modelBuffer)

  const tokenizerJson = JSON.parse(await fs.readFile(vocabPath, 'utf-8'))

  if (!tokenizerJson.model || !tokenizerJson.model.vocab) {
    throw new Error('Invalid tokenizer structure: missing model.vocab')
  }

  const cleanVocab = new Map()
  for (const [token, id] of Object.entries(tokenizerJson.model.vocab)) {
    if (typeof id === 'number') {
      cleanVocab.set(token, id)
    }
  }

  return { session, vocab: cleanVocab }
}

// Text normalization
function normalizeText(text) {
  text = text.normalize('NFD')
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

// Tokenization helpers
function isPunctuation(char) {
  const cp = char.codePointAt(0)

  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
    return true
  }

  const unicodeCat = getUnicodeCategory(char)
  return unicodeCat && /^P[cdfipeos]$/.test(unicodeCat)
}

function getUnicodeCategory(char) {
  if (/\p{P}/u.test(char)) return 'P'
  if (/\p{N}/u.test(char)) return 'N'
  if (/\p{L}/u.test(char)) return 'L'
  if (/\p{M}/u.test(char)) return 'M'
  if (/\p{S}/u.test(char)) return 'S'
  if (/\p{Z}/u.test(char)) return 'Z'
  return null
}

function preTokenize(text) {
  const tokens = []
  let currentToken = ''

  for (const char of text) {
    if (/\s/.test(char)) {
      if (currentToken) {
        tokens.push(currentToken)
        currentToken = ''
      }
    } else if (isPunctuation(char)) {
      if (currentToken) {
        tokens.push(currentToken)
        currentToken = ''
      }
      tokens.push(char)
    } else {
      currentToken += char
    }
  }

  if (currentToken) {
    tokens.push(currentToken)
  }

  return tokens.filter(token => token.length > 0)
}

function wordPieceTokenize(token, vocab, unkToken = '[UNK]', maxInputCharsPerWord = 200) {
  if (token.length > maxInputCharsPerWord) {
    return [unkToken]
  }

  const outputTokens = []
  let start = 0

  while (start < token.length) {
    let end = token.length
    let currentSubstring = null

    while (start < end) {
      let substring = token.substring(start, end)

      if (start > 0) {
        substring = '##' + substring
      }

      if (vocab.has(substring)) {
        currentSubstring = substring
        break
      }
      end -= 1
    }

    if (currentSubstring === null) {
      return [unkToken]
    }

    outputTokens.push(currentSubstring)
    start = end
  }

  return outputTokens
}

// Validate token IDs before conversion to BigInt
function validateTokenIds(ids) {
  const validIds = ids.filter(id => {
    const isValid = typeof id === 'number' && !isNaN(id) && isFinite(id)
    if (!isValid) {
      throw new Error(`Invalid token ID detected: ${id} (type: ${typeof id})`)
    }
    return isValid
  })

  if (validIds.length !== ids.length) {
    throw new Error(`Found ${ids.length - validIds.length} invalid token IDs`)
  }

  return validIds
}

module.exports = {
  saveFile,
  fileExists,
  downloadFile,
  downloadModelIfNeeded,
  forceRedownloadModel,
  loadModelAndVocab,
  normalizeText,
  isPunctuation,
  getUnicodeCategory,
  preTokenize,
  wordPieceTokenize,
  validateTokenIds
}
