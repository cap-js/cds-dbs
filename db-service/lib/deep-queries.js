const { _target_name4 } = require('./SQLService')

const ROOT = Symbol('root')

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

  // REVISIT: req.target does not match the query.INSERT target for path insert
  // const target = query.sources[Object.keys(query.sources)[0]]
  if (!this.model?.definitions[_target_name4(req.query)]) return next()

  const { target } = this.infer(query)
  if (!hasDeep(query, target)) return next()

  const queries = getDeepQueries.call(this, query, target)

  // first delete, then update, then insert because of potential unique constraints:
  // - deletes never trigger unique constraints, but can prevent them -> execute first
  // - updates can trigger and prevent unique constraints -> execute second
  // - inserts can only trigger unique constraints -> execute last
  await Promise.all(Array.from(queries.deletes.values()).map(query => this.onDELETE({ query })))
  await Promise.all(Array.from(queries.updates.values()).map(query => this.onUPDATE({ query })))
  await Promise.all(Array.from(queries.upserts.values()).map(query => this.onUPSERT({ query })))

  // TODO: return root UPDATE or UPSERT results when not doing an INSERT
  const rootQuery = queries.inserts.get(ROOT)
  queries.inserts.delete(ROOT)
  const [rootResult] = await Promise.all([
    rootQuery && this.onINSERT({ query: rootQuery }),
    ...Array.from(queries.inserts.values()).map(query => this.onINSERT({ query })),
  ])

  return rootResult ?? 1
}

const hasDeep = (q, target) => {
  const data = q.INSERT?.entries || (q.UPDATE?.data && [q.UPDATE.data]) || (q.UPDATE?.with && [q.UPDATE.with])
  if (data)
    for (const c in target.compositions) {
      for (const row of data) if (row[c] !== undefined) return true
    }
}

// IMPORTANT: Skip only if @cds.persistence.skip is `true` → e.g. this skips skipping targets marked with @cds.persistence.skip: 'if-unused'
const _hasPersistenceSkip = target => target?.['@cds.persistence.skip'] === true

/**
 * @param {import('@sap/cds/apis/cqn').Query} query
 * @param {unknown[]} dbData
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @returns
 */
const getDeepQueries = function (query, target) {
  let queryData
  if (query.INSERT) {
    const inserts = new Map()

    const step = (entry, target) => {
      for (const comp in target.compositions) {
        if (!entry[comp]) continue

        const composition = target.compositions[comp]
        const compTarget = composition._target

        if (_hasPersistenceSkip(compTarget)) continue

        if (!inserts.has(compTarget)) inserts.set(compTarget, INSERT([]).into(compTarget))
        const cqn = inserts.get(compTarget)

        const childEntries = entry[comp]
        if (composition.is2many) {
          cqn.INSERT.entries = [...cqn.INSERT.entries, ...entry[comp]]
          for (const childEntry of childEntries) {
            step(childEntry, compTarget)
          }
        } else {
          cqn.INSERT.entries = [...cqn.INSERT.entries, entry[comp]]
          step(childEntries, compTarget)
        }
      }
    }
    inserts.set(ROOT, query)

    for (const entry of query.INSERT.entries) {
      step(entry, target)
    }

    return {
      deletes: new Map(),
      updates: new Map(),
      upserts: new Map(),
      inserts: inserts,
    }
  }

  if (query.UPDATE || query.UPSERT) {
    const deletes = new Map()
    const upserts = new Map()
    const updates = new Map()

    const keyCompare = (entry, target, eq = true) => {
      let xpr = []
      if (Array.isArray(entry)) {
        const keyList = { list: [] }
        const valList = { list: [] }
        for (const key in target.keys) {
          const element = target.keys[key]
          if (element.virtual || element.isAssociation) continue
          keyList.list.push({ ref: [key] })
          for (let i = 0; i < entry.length; i++) {
            const curEntry = entry[i]
            valList.list[i] ??= { list: [] }
            valList.list[i].list.push({ val: curEntry[key] })
          }
        }
        xpr = eq
          ? [keyList, 'in', valList]
          : [keyList, 'not', 'in', valList]
      } else {
        for (const key in target.keys) {
          const element = target.keys[key]
          if (element.virtual || element.isAssociation) continue
          const comp = [{ ref: [key] }, eq ? '=' : '!=', { val: entry[key] }]
          xpr = xpr.length ? [...xpr, 'and', ...comp] : comp
        }
      }
      return xpr
    }

    const step = (entry, target, path) => {
      for (const comp in target.compositions) {
        if (!entry[comp]) continue

        const composition = target.compositions[comp]
        const compTarget = composition._target

        if (_hasPersistenceSkip(compTarget)) continue

        if (!upserts.has(compTarget)) upserts.set(compTarget, UPSERT([]).into(compTarget))

        const cqn = upserts.get(compTarget)
        const childEntries = entry[comp]

        if (!deletes.has(compTarget)) deletes.set(compTarget, [])
        deletes.get(compTarget).push({
          SELECT: {
            from: {
              ref: [...path, {
                id: comp,
                where: keyCompare(childEntries, compTarget, false),
              }]
            }
          }
        })

        if (composition.is2many) {
          cqn.UPSERT.entries = [...cqn.UPSERT.entries, ...entry[comp]]
          for (const childEntry of childEntries) {
            step(childEntry, compTarget, [...path, { id: comp, where: keyCompare(childEntry, compTarget) }])
          }
        } else {
          cqn.UPSERT.entries = [...cqn.UPSERT.entries, entry[comp]]
          step(childEntries, compTarget, [...path, { id: comp, where: keyCompare(entry[comp], compTarget) }])
        }
      }
    }

    if (query.UPDATE) {
      updates.set(ROOT, query)
      const data = query.UPDATE.data
      // TODO: merge root where into path expression where
      step(data, target, [...query.UPDATE.entity.ref])
    }
    else if (query.UPSERT) {
      upserts.set(ROOT, query)
      for (const data of query.UPSERT.entries) {
        step(data, target, [...query.UPDATE.entity.ref])
      }
    }

    for (const [target, dels] of deletes) {
      const keyList = keyCompare([], target)

      const del = DELETE.from(target)
      del.where(dels
        .map(d => {
          d.SELECT.columns = keyList[0].list
          return ['OR', { xpr: [keyList[0], 'in', d] }]
        })
        .flat()
        .slice(1)
      )
      deletes.set(target, del)
    }

    return {
      deletes,
      upserts,
      updates,
      inserts: new Map(),
    }
  }

}

module.exports = {
  onDeep,
  hasDeep,
  getDeepQueries, // only for testing
}
