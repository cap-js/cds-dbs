const { Readable } = require('stream')

const { _target_name4 } = require('@cap-js/db-service/lib/SQLService')
const { getDBTable, getTransition } = require('@sap/cds/libx/_runtime/common/utils/resolveView')


const ROOT = Symbol('root')
const DEEP_INSERT_SQL = Symbol('deep insert sql')
const DEEP_UPSERT_SQL = Symbol('deep upsert sql')

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

  const { _target: target } = this.infer(query)
  if (!hasDeep(query, target)) return next()

  return getDeepQueries.call(this, query, target)
}

const hasDeep = (q, target) => {
  if (q.INSERT && !q.INSERT.entries) return false
  if (q.UPSERT && !q.UPSERT.entries) return false
  for (const _ in target.compositions) return true
  return false
}

// IMPORTANT: Skip only if @cds.persistence.skip is `true` → e.g. this skips skipping targets marked with @cds.persistence.skip: 'if-unused'
const _hasPersistenceSkip = target => target?.['@cds.persistence.skip'] === true

/**
 * @param {import('@sap/cds/apis/cqn').Query} query
 * @param {unknown[]} dbData
 * @param {import('@sap/cds/apis/csn').Definition} target
 * @returns
 */
const getDeepQueries = async function (query, target) {
  const getEntries = (query) => {
    const cqn2sql = new this.class.CQN2SQL(this)
    cqn2sql.cqn = query
    return Readable.from(
      cqn2sql.INSERT_entries_stream(
        query.INSERT
          ? query.INSERT.entries
          : query.UPSERT.entries
      ),
      { ObjectMode: false },
    )
  }

  const cqn2sql = new this.class.CQN2SQL()

  const extract = new Map()
  const deletes = new Map()
  const upserts = new Map()
  const inserts = new Map()

  const renderTarget = (target) => {
    const elements = target.elements
    const elems = Object.keys(target.elements)
    const columns = elems.filter(c => c in elements && !elements[c].virtual && !elements[c].value && !elements[c].isAssociation)
    const compositions = elems.filter(c => c in elements && elements[c].isComposition)

    const variableName = cqn2sql.name(target.name)

    const managed = cqn2sql.managed([...columns, ...compositions].map(name => ({ name })), elements)
    const extraction = managed.map(c => c.extract)

    const deepDeletes = deletes.has(target) && getDeepDeletes.call(this, { query: deletes.get(target) })
      .join(';\n')
      .replace(/([^ ]*) as "VAR"/gi, (_, b) => `:${b} as "VAR"`)

    return {
      extract: `${variableName} = ${extract.get(target).map(p => `SELECT * FROM JSON_TABLE(:JSON, '${p.join('.')}' COLUMNS(${extraction}))`).join(' UNION ALL ')}`,
      deletes: deepDeletes,
      inserts: inserts.has(target) &&
        this.cqn2sql(inserts.get(target)).sql
          .replace('WITH SRC AS (SELECT ? AS JSON FROM DUMMY UNION ALL SELECT TO_NCLOB(NULL) AS JSON FROM DUMMY)', '')
          .replace(/JSON_TABLE\(.*\) AS NEW/, `:${variableName} AS NEW`),
      upserts: upserts.has(target) &&
        this.cqn2sql(upserts.get(target)).sql
          .replace('WITH SRC AS (SELECT ? AS JSON FROM DUMMY UNION ALL SELECT TO_NCLOB(NULL) AS JSON FROM DUMMY)', '')
          .replace(/JSON_TABLE\(.*\) AS NEW/, `:${variableName} AS NEW`),
    }
  }

  const render = () => {
    const sqls = {
      extract: [],
      deletes: [],
      inserts: [],
      upserts: [],
    }
    for (const [key] of extract) {
      const curSql = renderTarget(key)
      sqls.extract.push(curSql.extract)
      if (curSql.deletes) sqls.deletes.push(curSql.deletes)
      if (curSql.inserts) sqls.inserts.push(curSql.inserts)
      if (curSql.upserts) sqls.upserts.push(curSql.upserts)
    }

    return `DO (IN JSON NCLOB => ?) BEGIN
${sqls.extract.join(';\n')}${sqls.extract.length ? ';' : ''}
${sqls.deletes.join(';\n')}${sqls.deletes.length ? ';' : ''}
${sqls.inserts.join(';\n')}${sqls.inserts.length ? ';' : ''}
${sqls.upserts.join(';\n')}${sqls.upserts.length ? ';' : ''}
SELECT MAX(RN) AS "changes" FROM JSON_TABLE(:JSON, '$' COLUMNS(RN FOR ORDINALITY));
END;`
  }

  if (query.INSERT) {
    if (target[DEEP_INSERT_SQL]) {
      const ps = await this.prepare(target[DEEP_INSERT_SQL])
      return ps.run([getEntries(query)])
    }

    const step = (target, path, visited = []) => {
      for (const comp in target.compositions) {
        const composition = target.compositions[comp]
        const compTarget = composition._target

        if (visited.reduce((l, c) => c === composition ? l + 1 : l, 1) > (composition['@depth'] || 3)) continue
        if (_hasPersistenceSkip(compTarget)) continue

        if (!inserts.has(compTarget)) inserts.set(compTarget, INSERT([]).into(compTarget))

        const compPath = composition.is2many ? [...path, comp + '[*]'] : [...path, comp]
        if (!extract.has(compTarget)) extract.set(compTarget, [])
        extract.get(compTarget).push(compPath)

        step(compTarget, compPath, [...visited, composition])
      }
    }

    inserts.set(target, query)
    extract.set(target, [])

    const rootPath = ['$']
    extract.get(target).push(rootPath)
    step(target, rootPath)

    const sql = target[DEEP_INSERT_SQL] = render()

    const ps = await this.prepare(sql)
    const ret = await ps.run([getEntries(query)])
    return new this.class.InsertResults(query, ret.changes?.[1]?.[0])
  }

  if (query.UPDATE) {
    query = UPSERT([query.UPDATE.data]).into(target)
  }

  if (query.UPSERT) {
    if (target[DEEP_UPSERT_SQL]) {
      const ps = await this.prepare(target[DEEP_UPSERT_SQL])
      return ps.run([getEntries(query)])
    }

    const step = (target, path, visited = []) => {
      for (const comp in target.compositions) {
        const composition = target.compositions[comp]
        const compTarget = composition._target

        if (visited.reduce((l, c) => c === composition ? l + 1 : l, 1) > (composition['@depth'] || 3)) continue
        if (_hasPersistenceSkip(compTarget)) continue

        if (!upserts.has(compTarget)) upserts.set(compTarget, UPSERT([]).into(compTarget))
        if (!deletes.has(compTarget)) {
          const fkeynames = composition._foreignKeys.map(k => k.childElement.name)
          const keynames = Object.keys(compTarget.keys).filter(k => !compTarget.keys[k].isAssociation && !compTarget.keys[k].virtual)
          const fkeyrefs = fkeynames.map(k => ({ ref: [k] }))
          const keyrefs = keynames.map(k => ({ ref: [k] }))
          const pkeyrefs = composition._foreignKeys.map(k => ({ ref: [k.parentElement.name] }))
          const fkeys = SELECT(pkeyrefs).from({ ref: [target.name], as: 'VAR' }).where([cqn2sql.quote(comp), 'is', 'not', 'null'])
          const nkeys = SELECT(keyrefs).from({ ref: [compTarget.name], as: 'VAR' })

          const del = DELETE.from(compTarget)
            .where([
              { list: fkeyrefs }, 'in', fkeys,
              'and',
              { list: keyrefs }, 'not', 'in', nkeys,
            ])
          deletes.set(compTarget, del)
        }

        const compPath = composition.is2many ? [...path, comp + '[*]'] : [...path, comp]
        if (!extract.has(compTarget)) extract.set(compTarget, [])
        extract.get(compTarget).push(compPath)

        step(compTarget, compPath, [...visited, composition])
      }
    }

    upserts.set(target, query)
    extract.set(target, [])

    const rootPath = ['$']
    extract.get(target).push(rootPath)
    step(target, rootPath)

    const sql = target[DEEP_UPSERT_SQL] = render()

    const ps = await this.prepare(sql)
    return ps.run([getEntries(query)])
  }

  if (query.DELETE) {
    const keys = []
    const elements = query._target.keys || query._target.elements
    const exists = e => e && !e.virtual && !e.value && !e.isAssociation
    for (const key in elements) {
      if (exists(elements[key])) keys.push({ ref: [key] })
    }

    const src = new this.class.CQN2SQL()
    const variableName = src.name(query._target.name)
    src.SELECT(SELECT(keys).from({ ...query.DELETE.from, as: 'VAR' }).where(query.DELETE.where))

    const sqls = getDeepDeletes.call(this, { query: DELETE.from(query._target).where([{ list: keys }, 'in', SELECT(keys).from({ ref: [query._target.name], as: 'VAR' })]) })
    const sql = `DO BEGIN
${variableName} = ${src.sql};
${sqls.join(';\n').replace(/([^ ]*) as "VAR"/gi, (_, b) => `:${b} as "VAR"`)};
SELECT COUNT(*) AS "changes" FROM :${variableName};
END`
    const ps = await this.prepare(sql)
    const ret = await ps.run(src.values)
    return ret.changes?.[1]?.[0]?.changes
  }

}

// Modified to be static version from SQLService
const getDeepDeletes = function deep_delete(/** @type {Request} */ req) {
  req.target ??= req.query._target
  const transitions = getTransition(req.target, this, false, req.query.cmd || 'DELETE')
  if (transitions.target !== transitions.queryTarget) {
    const keys = []
    const transitionsTarget = transitions.queryTarget.keys || transitions.queryTarget.elements
    const exists = e => e && !e.virtual && !e.value && !e.isAssociation
    for (const key in transitionsTarget) {
      if (exists(transitionsTarget[key])) keys.push(key)
    }
    const matchedKeys = keys.filter(key => transitions.mapping.has(key)).map(k => ({ ref: [k] }))
    const query = DELETE.from({
      ref: [
        {
          id: transitions.target.name,
          where: [
            { list: matchedKeys.map(k => transitions.mapping.get(k.ref[0])) },
            'in',
            SELECT.from(req.query.DELETE.from).columns(matchedKeys).where(req.query.DELETE.where),
          ],
        },
      ],
    })
    return deep_delete.call(this, { query, target: transitions.target })
  }
  let ret = []
  const table = getDBTable(req.target)
  let { compositions } = table
  if (compositions) {
    // Transform CQL`DELETE from Foo[p1] WHERE p2` into CQL`DELETE from Foo[p1 and p2]`
    let { from, where } = req.query.DELETE
    if (typeof from === 'string') from = { ref: [from] }
    if (where) {
      let last = from.ref.at(-1)
      if (last.where) [last, where] = [last.id, [{ xpr: last.where }, 'and', { xpr: where }]]
      from = { ref: [...from.ref.slice(0, -1), { id: last, where }] }
    }
    // Process child compositions depth-first
    let { depth = 0, visited = [] } = req
    visited.push(req.target.name)

    ret = Object.values(compositions).map(c => {
      if (c._target['@cds.persistence.skip'] === true) return
      if (c._target === req.target) {
        // the Genre.children case
        if (++depth > (c['@depth'] || 3)) return
      } else if (visited.includes(c._target.name))
        throw new Error(
          `Transitive circular composition detected: \n\n` +
          `  ${visited.join(' > ')} > ${c._target.name} \n\n` +
          `These are not supported by deep delete.`,
        )
      // Prepare and run deep query, à la CQL`DELETE from Foo[pred]:comp1.comp2...`
      const query = DELETE.from({ ref: [...from.ref, c.name] })
      return deep_delete.call(this, { query, depth, visited: [...visited], target: c._target })
    })
      .flat()
      .filter(a => a)
  }
  ret.push(this.cqn2sql(req.query).sql)
  return ret
}

module.exports = {
  onDeep,
  hasDeep,
  getDeepQueries, // only for testing
}
