'use strict'

const cds = require('@sap/cds')
const dedup = arr => [...new Set(arr)]

function attachConstraints(_results, req) {
  if (!req.target || !this.model || req.target._unresolved) return
  const { data } = req
  if (Array.isArray(data[0])) return // REVISIT: what about csv inserts?
  const constraintsPerTarget = {}
  for (const [cName, c] of Object.entries(collectConstraints(req.target, req.data))) {
    if (c.target.name in constraintsPerTarget) {
      constraintsPerTarget[c.target.name][cName] = c
    } else {
      constraintsPerTarget[c.target.name] = { [cName]: c }
    }
  }
  if (Object.keys(constraintsPerTarget).length === 0) return

  // for UPDATE/UPSERT there is probably an additional where clause
  let where = []
  if (req.event === 'UPDATE' || req.event === 'UPSERT') {
    const prop = req.event
    if (req.query[prop]?.where) {
      where = req.query[prop].where
    } else if (req.query[prop]?.entity?.ref[0]?.where) {
      where = req.query[prop].entity.ref[0].where
    }
  }

  const validationQueries = []
  for (const [targetName, constraints] of Object.entries(constraintsPerTarget)) {
    const validationQuery = _getValidationQuery(targetName, constraints)
    if (where.length > 0 && targetName === req.target.name) {
      if (validationQuery.SELECT.where.length > 0) validationQuery.SELECT.where.push('or', { xpr: where })
      else validationQuery.SELECT.where.push(...where)
    }
    validationQueries.push(validationQuery)
  }

  if (this.tx.assert_constraints) this.tx.assert_constraints.push(validationQueries)
  else this.tx.assert_constraints = [validationQueries]
  return

  function _getValidationQuery(target, constraints) {
    const validationQuery = SELECT.from(target)

    const columns = []
    const parameterAliases = new Set() // tracks every alias already added

    for (const [name, { condition, parameters }] of Object.entries(constraints)) {
      // 1. first add text parameters of the constraint, if any
      if (parameters?.length) {
        for (const p of parameters) {
          if (parameterAliases.has(p.as)) {
            // one constraints parameters may shadow another constraints parameters
            // in that case, the last one wins
            const idx = columns.findIndex(c => c.as === p.as)
            columns[idx] = p
          } else {
            parameterAliases.add(p.as)
            columns.push(p)
          }
        }
      }

      const constraintAlias = `${name}_constraint`
      // should not happen, but just in case
      if (parameterAliases.has(constraintAlias))
        throw new Error(`Can't evaluate constraint "${name}" because it's name collides with a parameter name`)

      // 2. The actual constraint condition as another column
      columns.push({
        xpr: _wrapInCaseWhen([{ xpr: condition.xpr }]),
        as: constraintAlias,
        cast: { type: 'cds.Boolean' },
      })
    }

    validationQuery.SELECT.columns = columns
    // REVISIT: matchKeys for one entity should be the same for all constraints
    //          it should be more like { 'bookshop.Books' : { c1 : { ... }, c2: { ... } }, …, $matchKeys: [ ... ] }
    const keyMatchingConditions = Object.values(constraints)[0].matchKeys
    validationQuery.SELECT.where = keyMatchingConditions.flatMap((matchKey, i) =>
      i > 0 ? ['or', ...matchKey] : matchKey,
    )
    Object.defineProperty(validationQuery, '$constraints', { value: constraints })
    return validationQuery
  }

  /**
   * Collect every @assert.constraint defined on an entity, its elements and any
   * compositions that appear in the current payload.
   */
  function collectConstraints(entity, data, model = cds.model) {
    /** All constraints discovered so far, keyed by constraint name */
    const constraints = { ...extractConstraints(entity) }
    /** Remove duplicates while preserving order. */

    // ────────── 1. scan elements ──────────
    for (const el of Object.values(entity.elements ?? {})) {
      Object.assign(constraints, extractConstraints(el, entity))
    }

    // ────────── 2. attach match keys ──────
    const mk = _matchKeys(entity, data)
    for (const c of Object.values(constraints)) {
      c.matchKeys = dedup([...(c.matchKeys ?? []), ...mk])
    }

    // ────────── 3. recurse into compositions present in the payload ──────────
    for (const [compKey, composition] of Object.entries(entity.compositions ?? {})) {
      const payload = data?.[compKey]
      if (!payload) continue // nothing sent for this comp

      const target = model.definitions[composition.target]
      const recurse = child => mergeConstraintSets(constraints, collectConstraints(target, child, model))

      Array.isArray(payload) ? payload.forEach(recurse) : recurse(payload)
    }

    return constraints
  }

  /** Merge two constraint maps in‑place, concatenating any duplicate matchKeys. */
  function mergeConstraintSets(base, incoming) {
    for (const [name, inc] of Object.entries(incoming)) {
      const existing = base[name]
      if (existing && existing.element === inc.element) {
        existing.matchKeys = dedup([...existing.matchKeys, ...inc.matchKeys])
      } else {
        base[name] = inc
      }
    }
    return base
  }

  /** Collect @assert.constraint annotations from an entity or element. */
  function extractConstraints(obj, target = obj) {
    const collected = {}

    for (const [key, val] of Object.entries(obj)) {
      if (!key.startsWith('@assert.constraint')) continue

      // strip prefix and leading dot
      let [, remainder] = key.match(/^@assert\.constraint\.?(.*)$/)
      const parts = remainder.split('.')
      const constraintName = parts.length === 1 ? obj.name || parts[0] : parts[0]
      const propertyName =
        parts.length === 1 ? parts[0] || (val.xpr ? 'condition' : undefined) : parts.slice(1).join('.')

      if (!propertyName) continue // nothing useful to store

      const entry = (collected[constraintName] ??= { element: obj, target })
      if (propertyName.startsWith('parameters')) {
        const paramName = propertyName.slice('parameters.'.length)
        if (paramName === '') {
          // anonymous parameters, attach index as name
          entry[propertyName] = val.map((p, i) => ({ ...p, as: `${i}` }))
        } else {
          const param = { ...val, as: paramName }
          entry.parameters = [...(entry.parameters ?? []), param]
        }
      } else {
        entry[propertyName] = val
      }
    }
    return collected
  }

  /**
   * Constructs a condition which matches the primary keys of the entity for the given data.
   *
   * @param {CSN.entity} entity
   * @param {object} data
   * @returns {Array} conditions
   */
  function _matchKeys(entity, data) {
    const primaryKeys = Object.keys(entity.keys || {})
    const dataEntries = Array.isArray(data) ? data : [data] // Ensure batch handling

    // construct {key:value} pairs holding information about the entry to check
    return dataEntries
      .map(entry =>
        primaryKeys.reduce((identifier, key) => {
          const value = entry?.[key]
          if (value !== undefined) {
            if (identifier.length > 0) {
              identifier.push('and')
            }
            identifier.push({ ref: [key] }, '=', { val: value })
          }
          return identifier
        }, []),
      )
      .filter(Boolean)
  }

  function _wrapInCaseWhen(xpr) {
    return ['case', 'when', 'not', { xpr }, 'then', { val: false }, 'else', { val: true }, 'end']
  }
}

/**
 * Validate the constraint‑check queries collected in the current transaction.
 *
 * – runs every query batch in order,
 * – raises `req.error(400, …)` for each violated constraint,
 * – resets `this.tx.assert_constraints` when done.
 */
async function checkConstraints(req) {
  const pending = this.tx?.assert_constraints
  if (!pending?.length) return // nothing to validate

  for (const queryBatch of pending) {
    const results = await this.run(queryBatch)

    results.forEach((rows, idx) => {
      if (!rows?.length) return // no rows ⇒ nothing failed

      const constraints = queryBatch[idx].$constraints

      Object.entries(constraints).forEach(([name, meta]) => {
        const col = `${name}_constraint`

        rows.forEach(row => {
          if (row[col]) return // constraint passed

          req.error(400, buildMessage(name, meta, row)) // raise validation error
        })
      })
    })
  }

  this.tx.assert_constraints = [] // clean up
}

/**
 * Compose the final error text, including i18n look‑up + parameter injection.
 */
function buildMessage(name, { message, parameters = [] }, row) {
  const msgParams = Object.fromEntries(
    parameters
      .map((p, i) => {
        const val = row[p.as]
        return val === undefined ? null : [p.as, val]
      })
      .filter(Boolean),
  )

  return message
    ? cds.i18n.messages.for(message, msgParams) || message // translated or fallback
    : `@assert.constraint “${name}” failed`
}

module.exports = {
  attachConstraints,
  checkConstraints,
}
