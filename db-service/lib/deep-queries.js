const cds = require('@sap/cds')
const { _target_name4 } = require('./SQLService')
const InsertResult = require('../lib/InsertResults')

// REVISIT: remove old path with cds^8
let _compareJson
const compareJson = (...args) => {
  if (!_compareJson) {
    try {
      // new path
      _compareJson = require('@sap/cds/libx/_runtime/common/utils/compareJson').compareJson
    } catch {
      // old path
      _compareJson = require('@sap/cds/libx/_runtime/cds-services/services/utils/compareJson').compareJson
    }
  }
  return _compareJson(...args)
}

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

  const beforeData = query.INSERT ? [] : await this.run(getExpandForDeep(query, target, true))
  if (query.UPDATE && !beforeData.length) return 0

  const queries = getDeepQueries(query, beforeData, target)
  const res = await Promise.all(queries.map(query => {
    if (query.INSERT) return this.onINSERT({ query })
    if (query.UPDATE) return this.onUPDATE({ query })
    if (query.DELETE) return this.onSIMPLE({ query })
  }))
  return (
    beforeData.length ||
    new InsertResult(query, [
      {
        changes: Array.isArray(req.data) ? req.data.length : 1,
        ...(res[0]?.results[0]?.lastInsertRowid ? { lastInsertRowid: res[0].results[0].lastInsertRowid } : {}),
      },
    ])
  )
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

/**
 * @param {import('@sap/cds/apis/cqn').Query} query
 * @param {unknown[]} dbData
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @returns
 */
const getDeepQueries = (query, dbData, target) => {
  let queryData
  if (query.INSERT) {
    queryData = query.INSERT.entries
  }
  if (query.DELETE) {
    queryData = []
  }
  if (query.UPDATE) {
    queryData = [query.UPDATE.data]
  }

  let diff = compareJson(queryData, dbData, target)
  if (!Array.isArray(diff)) {
    diff = [diff]
  }

  return _getDeepQueries(diff, target, true)
}

const _hasManagedElements = target => {
  return Object.keys(target.elements).filter(elementName => target.elements[elementName]['@cds.on.update']).length > 0
}

/**
 * @param {unknown[]} diff
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @param {boolean} [root=false]
 * @returns {import('@sap/cds/apis/cqn').Query[]}
 */
const _getDeepQueries = (diff, target, root = false) => {
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
          subQueries.push(..._getDeepQueries([subEntry], target.elements[prop]._target))
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
    if (op === 'create') {
      queries.push(INSERT.into(target).entries(diffEntry))
    } else if (op === 'delete') {
      queries.push(DELETE.from(target).where(diffEntry))
    } else if (op === 'update' || (op === undefined && (root || subQueries.length) && _hasManagedElements(target))) {
      // TODO do we need the where here?
      const keys = target.keys
      const cqn = UPDATE(target).with(diffEntry)
      for (const key in keys) {
        if (keys[key].virtual) continue
        if (!keys[key].isAssociation) {
          cqn.where(key + '=', diffEntry[key])
        }
        delete diffEntry[key]
      }
      cqn.with(diffEntry)
      queries.push(cqn)
    }

    for (const q of subQueries) queries.push(q)
  }

  const insertQueries = new Map()

  return queries.map(q => {
    // Merge all INSERT statements for each target
    if (q.INSERT) {
      const target = q.target
      if (insertQueries.has(target)) {
        insertQueries.get(target).INSERT.entries.push(...q.INSERT.entries)
        return
      } else {
        insertQueries.set(target, q)
      }
    }
    Object.defineProperty(q, handledDeep, { value: true })
    return q
  })
    .filter(a => a)
}

module.exports = {
  onDeep,
  getDeepQueries,
  getExpandForDeep,
  hasDeep,
}
