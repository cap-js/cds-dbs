import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import embedding from './embedding.js'
import reranker from './reranker.js'
import { getDataDir } from './utils.js'

// Export the root data directory as a constant
export const rootDir = getDataDir()
export const embeddingsDir = path.join(rootDir, 'embeddings')

// Cache for loaded embeddings by ID
const embeddingsCache = new Map()

/**
 * Search for similar content using semantic similarity with automatic reranking
 * 
 * Algorithm when limit is specified:
 * 1. Calculate similarity for all chunks
 * 2. Take top N × 10 candidates
 * 3. Rerank those candidates using cross-encoder model
 * 4. Return top N results sorted by rerank score
 * 
 * @param {string} query - Search query text
 * @param {EmbeddedChunk[] | EmbeddedChunk[][] | object | object[]} embeddings - Array of embedded chunks, array of arrays, wrapper object, or array of wrapper objects to search through
 * @param {object} [options] - Search options
 * @param {number} [options.limit] - Maximum number of results to return (defaults to all results)
 * @param {object} [options.weights] - ID-based weights map { wrapperId: weight } to boost/reduce results from specific embedding sources
 * @param {boolean} [options.rerank=true] - Whether to apply reranking for improved accuracy (default: true when limit is specified, can be disabled by setting to false)
 * @returns {Promise<SearchResult[]>} Promise that resolves to chunks sorted by relevance (highest first)
 */
export async function search(query, embeddings, options = {}) {
  const { limit, weights, rerank: shouldRerank = limit !== undefined } = options
  const searchEmbedding = await embedding(query)

  // Handle wrapper object or array of wrapper objects
  let searchData = embeddings
  
  // If it's a single wrapper object with embeddings property, extract the embeddings array
  if (embeddings && !Array.isArray(embeddings) && embeddings.embeddings) {
    searchData = embeddings.embeddings
  }
  // If it's an array of wrapper objects (from load()), extract all embeddings arrays
  else if (Array.isArray(embeddings) && embeddings.length > 0 && embeddings[0].embeddings) {
    searchData = embeddings.map(wrapper => wrapper.embeddings)
  }

  // Handle array of arrays (multiple datasets)
  if (searchData.length > 0 && Array.isArray(searchData[0])) {
    const allScoredChunks = []

    for (const dataset of searchData) {
      const wrapperId = getWrapperIdForDataset(embeddings, dataset)
      const weight = getWeight(wrapperId, weights)

      const scoredChunks = dataset.map(chunk => {
        // Create new object with all enumerable properties
        const result = { ...chunk, similarity: cosineSimilarity(searchEmbedding, chunk.embedding) * weight }

        // Copy non-enumerable properties
        if (chunk.embedding) {
          Object.defineProperty(result, 'embedding', {
            value: chunk.embedding,
            writable: true,
            configurable: true,
            enumerable: false
          })
        }
        
        // Store wrapperId for later weight lookup during reranking
        if (wrapperId) {
          Object.defineProperty(result, '_wrapperId', {
            value: wrapperId,
            writable: true,
            configurable: true,
            enumerable: false
          })
        }

        return result
      })
      allScoredChunks.push(...scoredChunks)
    }

    // Sort all results by similarity descending
    allScoredChunks.sort((a, b) => b.similarity - a.similarity)

    // Apply reranking if requested and limit is specified
    if (shouldRerank && limit !== undefined) {
      const candidateCount = Math.min(limit * 10, allScoredChunks.length)
      const candidates = allScoredChunks.slice(0, candidateCount)
      
      // Rerank candidates
      const rerankedCandidates = await Promise.all(
        candidates.map(async (result) => {
          const content = result.content || ''
          const rerankScore = await reranker(query, content)
          
          // Get weight from the stored wrapperId
          const wrapperId = result._wrapperId || null
          const weight = getWeight(wrapperId, weights)
          
          // Apply weight to the reranked score
          const score = rerankScore * weight
          
          const newResult = { ...result, score }
          
          if (result.embedding) {
            Object.defineProperty(newResult, 'embedding', {
              value: result.embedding,
              writable: true,
              configurable: true,
              enumerable: false
            })
          }
          
          if (result._wrapperId) {
            Object.defineProperty(newResult, '_wrapperId', {
              value: result._wrapperId,
              writable: true,
              configurable: true,
              enumerable: false
            })
          }
          
          return newResult
        })
      )
      
      // Sort by weighted rerank score and return top N
      rerankedCandidates.sort((a, b) => b.score - a.score)
      
      return rerankedCandidates.slice(0, limit)
    }

    // Apply limit if specified (without reranking)
    return limit !== undefined ? allScoredChunks.slice(0, limit) : allScoredChunks
  }

  // Handle single array (existing functionality)
  const wrapperId = embeddings?.id || null
  const weight = getWeight(wrapperId, weights)

  const scoredChunks = searchData.map(chunk => {
    // Create new object with all enumerable properties
    const result = { ...chunk, similarity: cosineSimilarity(searchEmbedding, chunk.embedding) * weight }

    // Copy non-enumerable properties
    if (chunk.embedding) {
      Object.defineProperty(result, 'embedding', {
        value: chunk.embedding,
        writable: true,
        configurable: true,
        enumerable: false
      })
    }
    
    // Store wrapperId for later weight lookup during reranking
    if (wrapperId) {
      Object.defineProperty(result, '_wrapperId', {
        value: wrapperId,
        writable: true,
        configurable: true,
        enumerable: false
      })
    }

    return result
  })
  // Sort by similarity descending
  scoredChunks.sort((a, b) => b.similarity - a.similarity)

  // Apply reranking if requested and limit is specified
  if (shouldRerank && limit !== undefined) {
    const candidateCount = Math.min(limit * 10, scoredChunks.length)
    const candidates = scoredChunks.slice(0, candidateCount)
    
    // Rerank candidates
    const rerankedCandidates = await Promise.all(
      candidates.map(async (result) => {
        const content = result.content || ''
        const rerankScore = await reranker(query, content)
        
        // Get weight from the stored wrapperId
        const resultWrapperId = result._wrapperId || null
        const resultWeight = getWeight(resultWrapperId, weights)
        
        // Apply weight to the reranked score
        const score = rerankScore * resultWeight
        
        const newResult = { ...result, score }
        
        if (result.embedding) {
          Object.defineProperty(newResult, 'embedding', {
            value: result.embedding,
            writable: true,
            configurable: true,
            enumerable: false
          })
        }
        
        if (result._wrapperId) {
          Object.defineProperty(newResult, '_wrapperId', {
            value: result._wrapperId,
            writable: true,
            configurable: true,
            enumerable: false
          })
        }
        
        return newResult
      })
    )
    
    // Sort by rerank score and return top N
    rerankedCandidates.sort((a, b) => b.score - a.score)
    
    return rerankedCandidates.slice(0, limit)
  }

  // Apply limit if specified (without reranking)
  return limit !== undefined ? scoredChunks.slice(0, limit) : scoredChunks
}

/**
 * Internal function: Rerank search results using a cross-encoder model for improved accuracy
 * This is a two-stage process: first use embeddings for fast retrieval, then rerank with a more accurate model
 * 
 * Note: Reranking is automatically applied within search() when limit is specified.
 * Use the rerank option in search() to control this behavior.
 * 
 * @param {string} query - Search query text
 * @param {SearchResult[]} results - Array of search results from search() function
 * @param {object} [options] - Reranking options
 * @param {number} [options.limit] - Maximum number of results to return after reranking (defaults to all)
 * @param {number} [options.topK] - Only rerank the top K results from initial search (for performance)
 * @returns {Promise<SearchResult[]>} Promise that resolves to chunks sorted by reranker score (highest first)
 */
async function rerank(query, results, options = {}) {
  const { limit, topK } = options
  
  // If topK is specified, only rerank the top K results
  const resultsToRerank = topK ? results.slice(0, topK) : results
  
  // Score each result with the reranker
  const rerankedResults = await Promise.all(
    resultsToRerank.map(async (result) => {
      const content = result.content || ''
      const score = await reranker(query, content)
      
      // Create new object with reranker score
      const newResult = { ...result, score }
      
      // Preserve non-enumerable embedding property
      if (result.embedding) {
        Object.defineProperty(newResult, 'embedding', {
          value: result.embedding,
          writable: true,
          configurable: true,
          enumerable: false
        })
      }
      
      return newResult
    })
  )
  
  // Sort by reranker score descending
  rerankedResults.sort((a, b) => b.score - a.score)
  
  // If we only reranked topK, append the rest of the results
  const finalResults = topK && topK < results.length
    ? [...rerankedResults, ...results.slice(topK)]
    : rerankedResults
  
  // Apply limit if specified
  return limit !== undefined ? finalResults.slice(0, limit) : finalResults
}

/**
 * Generate embeddings for text chunks
 * @param {string[] | object[]} chunks - Array of strings or objects with content property
 * @param {object} [config] - Optional config object with id, description, and other metadata
 * @returns {Promise<object>} Returns wrapper object { embeddings, id?, ...metadata }
 */
export async function embeddings(chunks, config) {
  const result = []

  for (const chunk of chunks) {
    // Handle both string and object formats
    if (typeof chunk === 'string') {
      const embeddingVector = await embedding(chunk)
      const chunkObj = { content: chunk }
      Object.defineProperty(chunkObj, 'embedding', {
        value: embeddingVector,
        writable: true,
        configurable: true,
        enumerable: false
      })
      result.push(chunkObj)
    } else if (chunk && typeof chunk === 'object' && typeof chunk.content === 'string') {
      const content = chunk.content
      const embeddingVector = await embedding(content)
      // Preserve all original properties and add embedding
      const chunkObj = { ...chunk }
      Object.defineProperty(chunkObj, 'embedding', {
        value: embeddingVector,
        writable: true,
        configurable: true,
        enumerable: false
      })
      result.push(chunkObj)
    } else {
      // Handle edge case where content is undefined - preserve original behavior
      const content = chunk?.content
      const embeddingVector = await embedding(content)
      const chunkObj = { content }
      Object.defineProperty(chunkObj, 'embedding', {
        value: embeddingVector,
        writable: true,
        configurable: true,
        enumerable: false
      })
      result.push(chunkObj)
    }
  }

  // Always return wrapper object with embeddings
  return {
    embeddings: result,
    ...(config || {})
  }
}


/**
 * Store embeddings to disk
 * @param {string} dir - Directory where to store the embeddings
 * @param {object} config - Wrapper object from embeddings() with {id, embeddings, ...metadata}
 * @returns {Promise<void>}
 */
export async function store(dir, config) {
  // Validate config format
  if (!config || !config.id || !config.embeddings || !Array.isArray(config.embeddings)) {
    throw new Error('Invalid config format: must have id and embeddings array')
  }

  // Create directory if it doesn't exist
  await fs.mkdir(dir, { recursive: true })

  const basePath = path.join(dir, config.id)

  // Extract metadata (everything except embeddings)
  const metadata = { ...config }
  delete metadata.embeddings

  // Add dimensions and count if not already present
  if (config.embeddings.length > 0 && config.embeddings[0].embedding) {
    metadata.dimensions = config.embeddings[0].embedding.length
  }
  metadata.count = config.embeddings.length

  // Write metadata file
  await fs.writeFile(
    `${basePath}.meta.json`,
    JSON.stringify(metadata, null, 2)
  )

  // Write JSON file with content (enumerable properties only)
  await fs.writeFile(
    `${basePath}.json`,
    JSON.stringify(config.embeddings, null, 2)
  )

  // Write binary file with embeddings
  const embeddingCount = config.embeddings.length
  const embeddingDim = config.embeddings[0]?.embedding?.length || 0
  const totalFloats = embeddingCount * embeddingDim
  const buffer = new Float32Array(totalFloats)

  for (let i = 0; i < embeddingCount; i++) {
    const embedding = config.embeddings[i].embedding
    if (embedding) {
      buffer.set(embedding, i * embeddingDim)
    }
  }

  await fs.writeFile(`${basePath}.bin`, Buffer.from(buffer.buffer))
}

/**
 * Load embeddings from disk
 * @param {string} dir - Directory where to search for embeddings
 * @param {object} [config] - Optional config object for filtering for metadata
 * @returns {Promise<object[]>} Array of wrapper objects {id, embeddings, ...metadata}
 */
export async function load(dir, config) {
  // Check if path exists
  try {
    await fs.access(dir)
  } catch {
    throw new Error('Path does not exist')
  }

  // Find all .meta.json files
  const files = await fs.readdir(dir)
  const metaFiles = files.filter(f => f.endsWith('.meta.json'))

  if (metaFiles.length === 0) {
    return []
  }

  // Load and filter metadata
  const results = []

  for (const metaFile of metaFiles) {
    const baseName = metaFile.replace('.meta.json', '')
    const basePath = path.join(dir, baseName)

    // Always load metadata from disk first
    const metaContent = await fs.readFile(`${basePath}.meta.json`, 'utf-8')
    const metadata = JSON.parse(metaContent)

    // Apply filtering if config is provided
    if (config && !matchesFilter(metadata, config)) {
      continue
    }

    // Check cache by ID
    const cachedEntry = embeddingsCache.get(metadata.id)
    
    if (cachedEntry) {
      // Cache hit - use cached data
      results.push(cachedEntry)
      continue
    }

    // Cache miss - load from disk
    // Load JSON data
    const jsonContent = await fs.readFile(`${basePath}.json`, 'utf-8')
    const jsonData = JSON.parse(jsonContent)

    // Load binary data
    const binBuffer = await fs.readFile(`${basePath}.bin`)
    const float32Array = new Float32Array(binBuffer.buffer, binBuffer.byteOffset, binBuffer.byteLength / 4)

    // Reconstruct embeddings
    const embeddingDim = metadata.dimensions
    const embeddings = []

    for (let i = 0; i < jsonData.length; i++) {
      const chunk = jsonData[i]
      const embeddingStart = i * embeddingDim
      const embeddingEnd = embeddingStart + embeddingDim
      const embeddingVector = float32Array.slice(embeddingStart, embeddingEnd)

      // Create chunk object with all properties from JSON
      const chunkObj = { ...chunk }
      
      // Add non-enumerable embedding property
      Object.defineProperty(chunkObj, 'embedding', {
        value: embeddingVector,
        writable: true,
        configurable: true,
        enumerable: false
      })

      embeddings.push(chunkObj)
    }

    // Build result object
    const loadedData = {
      ...metadata,
      embeddings
    }

    // Store in cache
    embeddingsCache.set(metadata.id, loadedData)

    results.push(loadedData)
  }

  return results
}

/**
 * Clear the embeddings cache
 * @param {string} [id] - Optional ID to clear specific entry, or clear all if omitted
 */
export function clearCache(id) {
  if (id) {
    embeddingsCache.delete(id)
  } else {
    embeddingsCache.clear()
  }
}

/**
 * Register embeddings by creating a symlink in embeddingsDir
 * @param {string} embeddingPath - Path to the embedding files to register
 * @param {string} [registryDir] - Optional registry directory (defaults to embeddingsDir)
 * @returns {Promise<void>}
 */
export async function register(embeddingPath, registryDir = embeddingsDir) {
  // Ensure registry directory exists
  await fs.mkdir(registryDir, { recursive: true })
  
  // Get the absolute path
  const absolutePath = path.isAbsolute(embeddingPath) 
    ? embeddingPath 
    : path.resolve(embeddingPath)
  
  // Check if the source path exists
  try {
    await fs.access(absolutePath)
  } catch {
    throw new Error(`Path does not exist: ${absolutePath}`)
  }
  
  // Create unique symlink name from hash of the absolute path
  const symlinkName = hashPath(absolutePath)
  const symlinkPath = path.join(registryDir, symlinkName)
  
  // Check if symlink already exists
  try {
    await fs.access(symlinkPath)
    // If it exists, remove it first
    await fs.unlink(symlinkPath)
  } catch {
    // Symlink doesn't exist, which is fine
  }
  
  // Create the symlink
  await fs.symlink(absolutePath, symlinkPath, 'dir')
}

/**
 * Process all registered embeddings (from symlinks in embeddingsDir)
 * @param {object} [config] - Optional config object for filtering metadata
 * @param {string} [registryDir] - Optional registry directory (defaults to embeddingsDir)
 * @param {boolean} [metadataOnly] - If true, only load metadata without embeddings
 * @returns {Promise<object[]>} Array of wrapper objects or metadata objects
 */
async function processRegistered(config, registryDir = embeddingsDir, metadataOnly = false) {
  // Ensure registry directory exists
  try {
    await fs.mkdir(registryDir, { recursive: true })
  } catch {
    // Directory might already exist
  }
  
  // Read all items in registry directory
  let items
  try {
    items = await fs.readdir(registryDir)
  } catch {
    return []
  }
  
  const results = []
  
  // Process each item
  for (const item of items) {
    const itemPath = path.join(registryDir, item)
    
    // Check if it's a symlink
    let stats
    try {
      stats = await fs.lstat(itemPath)
    } catch {
      continue
    }
    
    if (stats.isSymbolicLink()) {
      // Resolve the symlink target
      let targetPath
      try {
        targetPath = await fs.readlink(itemPath)
        // Make it absolute if it's relative
        if (!path.isAbsolute(targetPath)) {
          targetPath = path.resolve(path.dirname(itemPath), targetPath)
        }
      } catch {
        continue
      }
      
      // Load data from the target path
      try {
        if (metadataOnly) {
          // Load only metadata
          const files = await fs.readdir(targetPath)
          const metaFiles = files.filter(f => f.endsWith('.meta.json'))
          
          for (const metaFile of metaFiles) {
            const metaPath = path.join(targetPath, metaFile)
            const metaContent = await fs.readFile(metaPath, 'utf-8')
            const metadata = JSON.parse(metaContent)
            
            // Apply filtering if config is provided
            if (config && !matchesFilter(metadata, config)) {
              continue
            }
            
            results.push(metadata)
          }
        } else {
          // Load full embeddings
          const loaded = await load(targetPath, config)
          results.push(...loaded)
        }
      } catch {
        // Skip if loading fails
        continue
      }
    }
  }
  
  return results
}

/**
 * Get metadata for all registered embeddings without loading the actual embeddings
 * @param {object} [config] - Optional config object for filtering metadata (same as load())
 * @param {string} [registryDir] - Optional registry directory (defaults to embeddingsDir)
 * @returns {Promise<object[]>} Array of metadata objects from all registered embeddings
 */
export async function registered(config, registryDir = embeddingsDir) {
  return processRegistered(config, registryDir, true)
}

/**
 * Load all registered embeddings (from symlinks in embeddingsDir)
 * @param {object} [config] - Optional config object for filtering metadata (same as load())
 * @param {string} [registryDir] - Optional registry directory (defaults to embeddingsDir)
 * @returns {Promise<object[]>} Array of wrapper objects from all registered embeddings
 */
export async function loadRegistered(config, registryDir = embeddingsDir) {
  return processRegistered(config, registryDir, false)
}

/**
 * Check if metadata matches filter config
 * @param {object} metadata - Metadata to check
 * @param {object} filterConfig - Filter configuration
 * @returns {boolean} True if matches
 */
function matchesFilter(metadata, filterConfig) {
  // For each property in filter config
  for (const key in filterConfig) {
    const filterValue = filterConfig[key]
    const metaValue = metadata[key]

    // If filter value is an array, check if at least one element matches
    if (Array.isArray(filterValue)) {
      // Meta value should be an array and have at least one common element
      if (!Array.isArray(metaValue)) {
        return false
      }
      const hasMatch = filterValue.some(fv => metaValue.includes(fv))
      if (!hasMatch) {
        return false
      }
    } else {
      // Direct comparison
      if (metaValue !== filterValue) {
        return false
      }
    }
  }

  return true
}


/**
 * @param {Float32Array} a - First vector
 * @param {Float32Array} b - Second vector
 * @returns {number} Cosine similarity between vectors (0-1)
 */
function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  return dot / (normA * normB)
}

/**
 * Create a hash from a path for unique symlink naming
 * @param {string} targetPath - Path to hash
 * @returns {string} Short hash string
 */
function hashPath(targetPath) {
  return crypto.createHash('sha256').update(targetPath).digest('hex').substring(0, 12)
}

/**
 * Get weight for a wrapper ID
 * @param {string} wrapperId - The wrapper object ID
 * @param {object} weights - Weights map { wrapperId: weight }
 * @returns {number} Weight value (defaults to 1.0)
 */
function getWeight(wrapperId, weights) {
  if (!weights || !wrapperId) return 1.0
  return weights[wrapperId] || 1.0
}

/**
 * Map dataset back to its wrapper ID
 * @param {any} embeddings - Original embeddings input
 * @param {array} dataset - Dataset to find ID for
 * @returns {string|null} Wrapper ID or null
 */
function getWrapperIdForDataset(embeddings, dataset) {
  if (Array.isArray(embeddings)) {
    for (const wrapper of embeddings) {
      if (wrapper.embeddings === dataset) {
        return wrapper.id
      }
    }
  }
  return null
}
