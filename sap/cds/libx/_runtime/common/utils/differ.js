const cds = require('../../cds')
const { SELECT } = cds.ql

const { DRAFT_COLUMNS_MAP } = require('../constants/draft')
const { enrichDataWithKeysFromWhere } = require('./keys')

// unofficial config!
const DEEP_EXPAND_MAX_RECURSION_DEPTH =
  (cds.env.features.recursion_depth && Number(cds.env.features.recursion_depth)) || 4 // we use 4 here as our test data has a max depth of 3

const columnRefs = (data, target) => {
  // select all columns if removed
  if (data == null || (Array.isArray(data) && data.length === 0)) {
    return Object.keys(target.elements)
      .filter(e => !target.elements[e].isAssociation && !target.elements[e].virtual)
      .map(c => ({ ref: [c] }))
  }
  const columns = new Set()
  // ensure keys are selected
  Object.values(target.keys)
    .filter(k => !k.isAssociation && !k.virtual)
    .forEach(k => columns.add(k.name))

  if (!Array.isArray(data)) data = [data]
  // loop and get all columns from current level
  for (const row of data) {
    for (const e in row) {
      if (target.elements[e] && !target.elements[e].isAssociation) {
        columns.add(e)
      }
    }
  }

  return Array.from(columns).map(c => ({ ref: [c] }))
}

const expandColumns = (target, data, columns = [], elementMap = new Map()) => {
  const compositions = target.compositions || {}

  if (columns.length === 0) {
    // REVISIT: ensure that all keys are included in the expand columns
    columns.push(...columnRefs(data, target))
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
    if (seen && seen >= DEEP_EXPAND_MAX_RECURSION_DEPTH) {
      // recursion -> abort
      return columns
    }

    let expandColumn = columns.find(expandColumn => expandColumn.ref[0] === composition.name)
    if (!expandColumn) {
      expandColumn = {
        ref: [composition.name],
        expand: columnRefs(compositionData, composition._target)
      }

      columns.push(expandColumn)
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
        expandColumns(composition._target, null, expandColumn.expand, newElementMap)
        continue
      }

      for (const row of compositionData) {
        expandColumns(composition._target, row, expandColumn.expand, newElementMap)
      }
    } else {
      // to one
      expandColumns(composition._target, compositionData, expandColumn.expand, newElementMap)
    }
  }
  return columns
}

/**
 * @param {import('@sap/cds/apis/cqn').Query} query
 * @param {import('@sap/cds/apis/csn').Definition} target
 */
const getExpandForDeep = (query, target) => {
  const { entity, data = null, where } = query.UPDATE
  const columns = expandColumns(target, data)
  return SELECT.one(columns).from(entity).where(where)
}

const { compareJson } = require('./compareJson')

module.exports = class Differ {
  constructor(srv) {
    this._srv = srv
  }

  _createSelectColumnsForDelete(entity) {
    const columns = []
    for (const element of Object.values(entity.elements)) {
      // Don't take into account virtual or computed properties to make the diff result
      // consistent with the ones for UPDATE/CREATE (where we don't have access to that
      // information).
      if (!element.key && (element.virtual || element._isReadOnly)) continue
      if (element.isComposition) {
        if (element._target._hasPersistenceSkip) continue
        columns.push({
          ref: [element.name],
          expand: this._createSelectColumnsForDelete(element._target)
        })
      } else if (!element._isAssociationStrict && !(element.name in DRAFT_COLUMNS_MAP)) {
        columns.push({ ref: [element.name] })
      }
    }

    return columns
  }

  async _diffDelete(req) {
    const { DELETE } = req.query
    const target = req.target
    const query = SELECT.from(DELETE.from).columns(this._createSelectColumnsForDelete(target))
    if (DELETE.where) query.where(DELETE.where)
    const dbState = await cds.run(query)
    const diff = compareJson(undefined, dbState, target, { ignoreDraftColumns: true })
    return diff
  }

  async _diffUpdate(req, providedData) {
    // prepare before data
    let dbState
    if (cds.db) {
      // does the code below ever work without partialPersistentState?
      const q = getExpandForDeep(req.query, req.target) // REVISIT: cds.context.model?
      dbState = await cds.run(q)
    }

    // prepare after data
    const combinedData = providedData || Object.assign({}, req.query.UPDATE.data, req.query.UPDATE.with) // REVISIT: .with contains expressions -> does that make sense?
    enrichDataWithKeysFromWhere(combinedData, req, this._srv)

    const diff = compareJson(combinedData, dbState, req.target, { ignoreDraftColumns: true })
    return diff
  }

  _diffCreate(req, providedData) {
    const originalData =
      providedData || (req.query.INSERT.entries && req.query.INSERT.entries.length === 1)
        ? req.query.INSERT.entries[0]
        : req.query.INSERT.entries
    enrichDataWithKeysFromWhere(originalData, req, this._srv)
    const diff = compareJson(originalData, undefined, req.target, { ignoreDraftColumns: true })
    return diff
  }

  async calculate(req, providedData) {
    if (req.event === 'CREATE') return this._diffCreate(req, providedData)
    if (req.target._hasPersistenceSkip) return
    if (req.event === 'DELETE') return this._diffDelete(req)
    if (req.event === 'UPDATE') return this._diffUpdate(req, providedData)
  }

  // is used as a req instance method
  static reqDiff(req = this, data) {
    const { _service: d } = req.target
    if (!d) return Promise.resolve([])
    const srv = cds.services[d.name]
    if (!srv) return Promise.resolve([])
    return new Differ(srv).calculate(req, data)
  }
}
