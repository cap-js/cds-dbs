const cds = require('@sap/cds')
const { Object_keys } = cds.utils
const { compareJson } = require('@sap/cds/libx/_runtime/cds-services/services/utils/compareJson')
const { _target_name4 } = require('./SQLService')

const handledDeep = Symbol('handledDeep')

/**
 * @callback nextCallback
 * @param {Error|undefined} error
 * @returns {Promise<unknown>}
 */

/**
 * @param {import('@sap/cds/apis/services').Request} req
 * @param {nextCallback} next
 * @returns {Promise<number>}
 */
async function onDeep(req, next) {
  const { query } = req
  if (handledDeep in query) return next()

  // REVISIT: req.target does not match the query.INSERT target for path insert
  // const target = query.sources[Object.keys(query.sources)[0]]
  if (!this.model?.definitions[_target_name4(req.query)]) return next()

  const { target } = this.infer(query)
  if (!hasDeep(query, target)) return next()

  let queries
  if (query.DELETE) {
    queries = _deepDelete(query, target)
  } else {
    queries = _deepUpsert(query, target)
  }

  const res = await Promise.all(
    queries.map(query => {
      if (query.DELETE) return this.onSIMPLE({ query })
      if (query.UPSERT) return this.onUPSERT({ query })
      debugger
    }),
  )
  return res[0] ?? 0 // TODO what todo with multiple result responses?
}

const hasDeep = (q, target) => {
  const data = q.INSERT?.entries || (q.UPDATE?.data && [q.UPDATE.data]) || (q.UPDATE?.with && [q.UPDATE.with])
  if (data)
    for (const c in target.compositions) {
      for (const row of data) if (row[c] !== undefined) return true
    }
}

// unofficial config!
const DEEP_DELETE_MAX_RECURSION_DEPTH =
  (cds.env.features.recursion_depth && Number(cds.env.features.recursion_depth)) || 4 // we use 4 here as our test data has a max depth of 3

// IMPORTANT: Skip only if @cds.persistence.skip is `true` → e.g. this skips skipping targets marked with @cds.persistence.skip: 'if-unused'
const _hasPersistenceSkip = target => target?.['@cds.persistence.skip'] === true

const getColumnsFromDataOrKeys = (data, target) => {
  if (Array.isArray(data)) {
    // loop and get all columns from current level
    const columns = new Set()
    data.forEach(row =>
      Object.keys(row || target.keys)
        .filter(propName => !target.elements[propName]?.isAssociation)
        .forEach(entry => {
          columns.add(entry)
        }),
    )
    return Array.from(columns).map(c => ({ ref: [c] }))
  } else {
    // get all columns from current level
    return Object.keys(data || target.keys)
      .filter(propName => target.elements[propName] && !target.elements[propName].isAssociation)
      .map(c => ({ ref: [c] }))
  }
}

const _calculateExpandColumns = (target, data, expandColumns = [], elementMap = new Map()) => {
  const compositions = target.compositions || {}

  if (expandColumns.length === 0) {
    // REVISIT: ensure that all keys are included in the expand columns
    expandColumns.push(...getColumnsFromDataOrKeys(data, target))
  }

  for (const compName in compositions) {
    let compositionData
    if (data === null || (Array.isArray(data) && !data.length)) {
      compositionData = null
    } else {
      compositionData = data[compName]
    }

    // ignore not provided compositions as nothing happens with them (expect deep delete)
    if (compositionData === undefined) {
      // fill columns in case
      continue
    }

    const composition = compositions[compName]

    const fqn = composition.parent.name + ':' + composition.name
    const seen = elementMap.get(fqn)
    if (seen && seen >= DEEP_DELETE_MAX_RECURSION_DEPTH) {
      // recursion -> abort
      return expandColumns
    }

    let expandColumn = expandColumns.find(expandColumn => expandColumn.ref[0] === composition.name)
    if (!expandColumn) {
      expandColumn = {
        ref: [composition.name],
        expand: getColumnsFromDataOrKeys(compositionData, composition._target),
      }

      expandColumns.push(expandColumn)
    }

    // expand deep
    // Make a copy and do not share the same map among brother compositions
    // as we're only interested in deep recursions, not wide recursions.
    const newElementMap = new Map(elementMap)
    newElementMap.set(fqn, (seen && seen + 1) || 1)

    if (composition.is2many) {
      // expandColumn.expand = getColumnsFromDataOrKeys(compositionData, composition._target)
      if (compositionData === null || compositionData.length === 0) {
        // deep delete, get all subitems until recursion depth
        _calculateExpandColumns(composition._target, null, expandColumn.expand, newElementMap)
        continue
      }

      for (const row of compositionData) {
        _calculateExpandColumns(composition._target, row, expandColumn.expand, newElementMap)
      }
    } else {
      // to one
      _calculateExpandColumns(composition._target, compositionData, expandColumn.expand, newElementMap)
    }
  }
  return expandColumns
}

/**
 * @param {import('@sap/cds/apis/cqn').Query} query
 * @param {import('@sap/cds/apis/csn').Definition} target
 */
const getExpandForDeep = (query, target) => {
  const { entity, data = null, where } = query.UPDATE
  const columns = _calculateExpandColumns(target, data)
  return SELECT(columns).from(entity).where(where)
}

const getDeleteQuery = (target, data, compName) => {
  const notInKeys = whereIn(target.elements[compName]._target, data[compName], true)

  const keys = entity_keys(target)
  const _where = keys.reduce((where, key) => {
    if (where.length) where.push('and')
    where.push({ ref: [key] }, '=', { val: data[key] })
    return where
  }, [])

  return DELETE.from({
    ref: [{ id: target.name, where: _where }, compName],
  }).where(notInKeys)
}

/**
 * @param {import('@sap/cds/apis/cqn').Query} query
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @returns {import('@sap/cds/apis/cqn').Query[]}
 */
const _deepDelete = async (query, target) => {
  const dbData = await this.run(getExpandForDeep(query, target, true))
  let diff = compareJson([], dbData, target)
  if (!Array.isArray(diff)) {
    diff = [diff]
  }

  return _getDeepDeleteQueries(diff, target, true)
}

/**
 * @param {import('@sap/cds/apis/cqn').Query} query
 * @param {unknown[]} dbData
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @returns {import('@sap/cds/apis/cqn').Query[]}
 */
const _deepUpsert = (query, target) => {
  let queryData
  if (query.INSERT) {
    queryData = query.INSERT.entries
  }
  if (query.UPDATE) {
    queryData = [query.UPDATE.data]
  }

  return _getDeepUpsertQueries(queryData, target)
}

/**
 * @param {unknown[]} data
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @returns {import('@sap/cds/apis/cqn').Query[]}
 */
const _getDeepUpsertQueries = (data, target) => {
  const queries = []

  for (const dataEntry of data) {
    if (dataEntry === undefined) continue
    const subQueries = []

    const toBeIgnoredProps = []
    for (const prop in dataEntry) {
      // handle deep operations
      const propData = dataEntry[prop]

      if (target.elements[prop] && _hasPersistenceSkip(target.elements[prop]._target)) {
        toBeIgnoredProps.push(prop)
      } else if (target.compositions?.[prop]) {
        const arrayed = Array.isArray(propData) ? propData : [propData]
        arrayed.forEach(subEntry => {
          subQueries.push(..._getDeepUpsertQueries([subEntry], target.elements[prop]._target))
        })
        const deleteQuery = getDeleteQuery(target, dataEntry, prop)
        queries.push(deleteQuery)
        toBeIgnoredProps.push(prop)
      } else if (dataEntry[prop] === undefined) {
        // restore current behavior, if property is undefined, not part of payload
        toBeIgnoredProps.push(prop)
      }
    }

    const dataCopy = {}
    for (const key in dataEntry) {
      if (toBeIgnoredProps.includes(key)) continue
      dataCopy[key] = dataEntry[key]
    }
    // first calculate subqueries and rm their properties, then build root query
    queries.push(UPSERT.into(target).entries(dataCopy))
    queries.push(...subQueries)
  }

  queries.forEach(q => {
    Object.defineProperty(q, handledDeep, { value: true })
  })
  return queries
}

/**
 * @param {unknown[]} diff
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @returns {import('@sap/cds/apis/cqn').Query[]}
 */
const _getDeepDeleteQueries = (diff, target) => {
  const queries = []

  for (const diffEntry of diff) {
    if (diffEntry === undefined) continue
    const subQueries = []

    for (const prop in diffEntry) {
      // handle deep operations

      const propData = diffEntry[prop]

      if (target.elements[prop] && _hasPersistenceSkip(target.elements[prop]._target)) {
        delete diffEntry[prop]
      } else if (target.compositions?.[prop]) {
        const arrayed = Array.isArray(propData) ? propData : [propData]
        arrayed.forEach(subEntry => {
          subQueries.push(..._getDeepDeleteQueries([subEntry], target.elements[prop]._target))
        })
        delete diffEntry[prop]
      } else if (diffEntry[prop] === undefined) {
        // restore current behavior, if property is undefined, not part of payload
        delete diffEntry[prop]
      }
    }

    // handle current entity level
    const op = diffEntry._op
    delete diffEntry._op

    if (diffEntry._old != null) {
      delete diffEntry._old
    }

    // first calculate subqueries and rm their properties, then build root query
    if (op === 'delete') {
      queries.push(DELETE.from(target).where(diffEntry))
    }

    queries.push(...subQueries)
  }

  queries.forEach(q => {
    Object.defineProperty(q, handledDeep, { value: true })
  })
  return queries
}

const entity_keys = entity =>
  Object_keys(entity.keys).filter(key => key !== 'IsActiveEntity' && !entity.keys[key].isAssociation)

const whereIn = (target, data, not = false) => {
  const keys = entity_keys(target)
  const dataArray = data ? (Array.isArray(data) ? data : [data]) : []
  if (not && !dataArray.length) return []
  const left = { list: keys.map(k => ({ ref: [k] })) }
  const op = not ? ['not', 'in'] : ['in']
  const right = { list: dataArray.map(r => ({ list: keys.map(k => ({ val: r[k] })) })) }
  return [left, ...op, right]
}

module.exports = {
  onDeep,
  getExpandForDeep,
}
