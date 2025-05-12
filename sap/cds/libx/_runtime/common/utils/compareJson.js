const cds = require('../../cds')
const { DRAFT_COLUMNS_MAP } = require('../constants/draft')

const _deepEqual = (val1, val2) => {
  if (Buffer.isBuffer(val1) && Buffer.isBuffer(val2)) return val1.equals(val2)
  if (val1 && typeof val1 === 'object' && val2 && typeof val2 === 'object') {
    for (const key in val1) {
      if (!_deepEqual(val1[key], val2[key])) return false
    }
    return true
  }
  return val1 === val2
}

const _getCorrespondingEntryWithSameKeys = (source, entry, keys) => {
  const idx = _getIdxCorrespondingEntryWithSameKeys(source, entry, keys)
  return idx !== -1 ? source[idx] : undefined
}

const _getIdxCorrespondingEntryWithSameKeys = (source, entry, keys) =>
  source.findIndex(sourceEntry => keys.every(key => _deepEqual(sourceEntry[key], entry[key])))

const _createToBeDeletedEntries = (oldEntry, entity, keys, compositions, metaCache) => {
  const toBeDeletedEntry = {
    _op: 'delete'
  }

  for (const prop in oldEntry) {
    if (prop in DRAFT_COLUMNS_MAP) {
      continue
    }
    if (keys.includes(prop)) {
      toBeDeletedEntry[prop] = oldEntry[prop]
    } else if (compositions.includes(prop) && oldEntry[prop]) {
      const target = entity.elements[prop]._target
      const cache = metaCache.get(target)
      toBeDeletedEntry[prop] = entity.elements[prop].is2one
        ? _createToBeDeletedEntries(
            oldEntry[prop],
            entity.elements[prop]._target,
            cache.keys,
            cache.compositions,
            metaCache
          )
        : oldEntry[prop].map(entry =>
            _createToBeDeletedEntries(entry, target, cache.keys, cache.compositions, metaCache)
          )
    } else {
      toBeDeletedEntry._old = toBeDeletedEntry._old || {}
      toBeDeletedEntry._old[prop] = oldEntry[prop]
    }
  }

  return toBeDeletedEntry
}

const _hasOpDeep = (entry, element) => {
  const entryArray = Array.isArray(entry) ? entry : [entry]
  for (const entry_ of entryArray) {
    if (entry_._op) return true

    if (element && element.isComposition) {
      const target = element._target
      for (const prop in entry_) {
        if (_hasOpDeep(entry_[prop], target.elements[prop])) {
          return true
        }
      }
    }
  }

  return false
}

const _addCompositionsToResult = (result, entity, prop, newValue, oldValue, opts, buckets, metaCache) => {
  /*
   * REVISIT: the current impl results in {} instead of keeping null for compo to one.
   *          unfortunately, many follow-up errors occur (e.g., prop in null checks) if changed.
   */
  let composition
  if (
    newValue[prop] &&
    typeof newValue[prop] === 'object' &&
    !Array.isArray(newValue[prop]) &&
    Object.keys(newValue[prop]).length === 0
  ) {
    composition = compareJsonDeep(
      entity.elements[prop]._target,
      undefined,
      oldValue && oldValue[prop],
      opts,
      buckets,
      metaCache
    )
  } else {
    composition = compareJsonDeep(
      entity.elements[prop]._target,
      newValue[prop],
      oldValue && oldValue[prop],
      opts,
      buckets,
      metaCache
    )
  }
  if (composition.some(c => _hasOpDeep(c, entity.elements[prop]))) {
    result[prop] = entity.elements[prop].is2one ? composition[0] : composition
  }
}

const _addPrimitiveValuesAndOperatorToResult = (result, prop, newValue, oldValue) => {
  result[prop] = newValue[prop]

  if (!result._op) {
    result._op = oldValue ? 'update' : 'create'
  }

  if (result._op === 'update') {
    result._old = result._old || {}
    result._old[prop] = oldValue[prop]
  }
}

const _addKeysToResult = (result, prop, newValue, oldValue) => {
  result[prop] = newValue[prop]
  if (!oldValue) {
    result._op = 'create'
  }
}

const _addToBeDeletedEntriesToResult = (results, entity, keys, newValues, oldValues, newBucketMap, metaCache) => {
  const cache = metaCache.get(entity)
  // add to be deleted entries
  for (const oldEntry of oldValues) {
    const entry = cds.env.features.diff_optimization
      ? _getCorrespondingEntryWithSameKeysFromBucket(newBucketMap, oldEntry, entity, keys, cache)
      : _getCorrespondingEntryWithSameKeys(newValues, oldEntry, keys)

    if (!entry) {
      // prepare to be deleted (deep) entry without manipulating oldData
      const toBeDeletedEntry = _createToBeDeletedEntries(oldEntry, entity, keys, cache.compositions, metaCache)
      results.push(toBeDeletedEntry)
    }
  }
}

const _normalizeToArray = value => (Array.isArray(value) ? value : value === null ? [] : [value])

const _isUnManaged = element => {
  return element.on && !element._isSelfManaged
}

const _skip = (entity, prop) => entity.elements[prop]._target._hasPersistenceSkip

const _skipToOne = (entity, prop) => {
  return (
    entity.elements[prop] && entity.elements[prop].is2one && _skip(entity, prop) && _isUnManaged(entity.elements[prop])
  )
}

const _skipToMany = (entity, prop) => {
  return entity.elements[prop] && entity.elements[prop].is2many && _skip(entity, prop)
}

const _iteratePropsInNewEntry = (newEntry, keys, result, oldEntry, entity, opts, buckets, metaCache) => {
  const cache = metaCache.get(entity)

  // On app-service layer, generated foreign keys are not enumerable,
  // include them here too.
  for (const prop of cache.props) {
    if (cache.keys.includes(prop)) {
      _addKeysToResult(result, prop, newEntry, oldEntry)
      continue
    }

    if (newEntry[prop] === undefined && !cache.onUpdate.includes(prop)) continue

    if (cache.compositions.includes(prop)) {
      _addCompositionsToResult(result, entity, prop, newEntry, oldEntry, opts, buckets, metaCache)
      continue
    }

    // if value did not change --> ignored
    if (
      (Buffer.isBuffer(newEntry[prop]) &&
        oldEntry &&
        Buffer.isBuffer(oldEntry[prop]) &&
        newEntry[prop].equals(oldEntry[prop])) ||
      newEntry[prop] === oldEntry?.[prop]
    ) {
      continue
    }

    // existing immutable --> ignored
    if (oldEntry && cache.immutables.includes(prop)) continue

    _addPrimitiveValuesAndOperatorToResult(result, prop, newEntry, oldEntry)
  }
}

const _isSimpleKey = element => !element._isStructured && element.type != 'cds.Binary'

const _getMetaCache = (entity, metaCache, opts) => {
  if (metaCache.get(entity)) return

  const cache = { keys: [], props: [], compositions: [], immutables: [], onUpdate: [] }
  metaCache.set(entity, cache)
  for (let prop in entity.elements) {
    const element = entity.elements[prop] || {}
    if (prop in entity.keys && !(prop in DRAFT_COLUMNS_MAP) && !element.isAssociation) cache.keys.push(prop)
    if (_skipToMany(entity, prop) || _skipToOne(entity, prop)) continue
    if (opts.ignoreDraftColumns && prop in DRAFT_COLUMNS_MAP) continue

    if (element?.isComposition) {
      cache.compositions.push(prop)
      _getMetaCache(element._target, metaCache, opts)
    }

    if (element?.['@Core.Immutable']) cache.immutables.push(prop)
    if (element?.['@cds.on.update']) cache.onUpdate.push(prop)

    cache.props.push(prop)
  }

  let getKeyHash
  if (cache.keys.length === 1 && _isSimpleKey(entity.elements[cache.keys[0]])) {
    getKeyHash = (entry, keys) => entry[keys[0]].toString()
  } else if (cache.keys.map(key => entity.elements[key]).every(key => _isSimpleKey(key))) {
    getKeyHash = (entry, keys) => keys.reduce((hash, key) => `${hash},${key}=${entry[key].toString()}`, '')
  } else {
    getKeyHash = (entry, keys) => {
      const keyObj = keys.reduce((hash, key) => {
        hash[key] = entry[key]
        return hash
      }, {})

      return JSON.stringify(keyObj)
    }
  }
  cache.getKeyHash = getKeyHash
}

const _addBucket = (entity, entry, bucketMap, metaCache) => {
  if (!entry) return
  const entries = _normalizeToArray(entry)
  const cache = metaCache.get(entity)

  entries.forEach(e => {
    const keyHash = cache.getKeyHash(e, cache.keys)
    let entityMap = bucketMap.get(entity)
    if (!entityMap) {
      entityMap = new Map()
      bucketMap.set(entity, entityMap)
    }
    entityMap.set(keyHash, e)

    for (const prop of cache.props) {
      if (cache.compositions.includes(prop)) _addBucket(entity.elements[prop]._target, e[prop], bucketMap, metaCache)
    }
  })
}

const _getBucketMap = (value, entity, metaCache) => {
  const bucketMap = new Map()
  _addBucket(entity, value, bucketMap, metaCache)

  return bucketMap
}

const _getCorrespondingEntryWithSameKeysFromBucket = (bucketMap, entry, entity, keys, cache) => {
  const bucket = bucketMap.get(entity)
  if (!bucket) return

  const keyHash = cache.getKeyHash(entry, keys)
  return bucket.get(keyHash)
}

const compareJsonDeep = (entity, newValue = [], oldValue = [], opts, buckets, metaCache) => {
  const resultsArray = []
  const cache = metaCache.get(entity)
  const keys = cache.keys

  // normalize input
  const newValues = _normalizeToArray(newValue)
  const oldValues = _normalizeToArray(oldValue)

  // add to be created and to be updated entries
  for (const newEntry of newValues) {
    const result = {}
    let oldEntry
    if (oldValues.length) {
      oldEntry = cds.env.features.diff_optimization
        ? _getCorrespondingEntryWithSameKeysFromBucket(buckets.oldBucketMap, newEntry, entity, keys, cache)
        : _getCorrespondingEntryWithSameKeys(oldValues, newEntry, keys)
    }
    _iteratePropsInNewEntry(newEntry, keys, result, oldEntry, entity, opts, buckets, metaCache)
    resultsArray.push(result)
  }

  _addToBeDeletedEntriesToResult(resultsArray, entity, keys, newValues, oldValues, buckets.newBucketMap, metaCache)

  return resultsArray
}

/**
 * Compares newValue with oldValues in a deep fashion.
 * Output format is newValue with additional administrative properties.
 * - "_op" provides info about the CRUD action to perform
 * - "_old" provides info about the current DB state
 *
 * Unchanged values are not part of the result.
 *
 * Output format is:
 * {
 *   _op: 'update',
 *   _old: { orderedAt: 'DE' },
 *   ID: 1,
 *   orderedAt: 'EN',
 *   items: [
 *     {
 *       _op: 'update',
 *       _old: { amount: 7 },
 *       ID: 7,
 *       amount: 8
 *     },
 *     {
 *       _op: 'create',
 *       ID: 8,
 *       amount: 8
 *     },
 *     {
 *       _op: 'delete',
 *       _old: {
 *         amount: 6
 *       },
 *       ID: 6
 *     }
 *   ]
 * }
 *
 *
 * If there is no change in an UPDATE, result is an object containing only the keys of the entity.
 *
 * @example
 * compareJson(csnEntity, [{ID: 1, col1: 'A'}], [{ID: 1, col1: 'B'}])
 *
 * @param oldValue
 * @param {object} entity
 * @param {Array | object} newValue
 * @param {Array} oldValues
 *
 * @returns {Array}
 */
const compareJson = (newValue, oldValue, entity, opts = {}) => {
  const options = Object.assign({ ignoreDraftColumns: false }, opts)

  let newBucketMap,
    oldBucketMap,
    metaCache = new Map()
  _getMetaCache(entity, metaCache, opts)
  if (oldValue && (!Array.isArray(oldValue) || oldValue.length) && cds.env.features.diff_optimization) {
    newBucketMap = _getBucketMap(newValue, entity, metaCache)
    oldBucketMap = _getBucketMap(oldValue, entity, metaCache)
  }
  const result = compareJsonDeep(entity, newValue, oldValue, options, { newBucketMap, oldBucketMap }, metaCache)
  // in case of batch insert, result is an array
  // in all other cases it is an array with just one entry
  return Array.isArray(newValue) ? result : result[0] // Drops all but the first entry !!!
}

module.exports = {
  compareJson
}
