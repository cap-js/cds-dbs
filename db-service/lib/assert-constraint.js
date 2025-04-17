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
    if (where.length > 0) {
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
    // each column represents a constraint
    const columns = Object.keys(constraints).flatMap(name => {
      const constraint = constraints[name]
      const { condition, parameters } = constraint
      const xpr = []
      xpr.push({ xpr: condition.xpr })
      const colsForConstraint = [
        {
          xpr: _wrapInCaseWhen(xpr),
          // avoid naming ambiguities for anonymous constraints,
          // where the element itself is part of the msg params
          as: name + '_constraint',
          cast: {
            type: 'cds.Boolean',
          },
        },
      ]
      if (parameters) {
        // if (parameters.list) parameters.list.forEach(p => colsForConstraint.push(p))
        // else if (parameters.ref) colsForConstraint.push(parameters.ref)
        // else if (parameters.length) parameters.forEach(p => colsForConstraint.push({ ref: [p['=']] }))
        parameters.forEach(p => {
          const { ref, val } = p
          if (ref) {
            colsForConstraint.push({ ref })
          } else if (val) {
            colsForConstraint.push({ val })
          }
        })
      }
      return colsForConstraint
    })

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
      if (propertyName.startsWith('parameters.')) {
        const pname = propertyName.slice('parameters.'.length)
        const param = { ...val, name: pname }
        entry.parameters = [...(entry.parameters ?? []), param]
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

async function checkConstraints(req) {
  if (this.tx.assert_constraints) {
    for (const validationQueries of this.tx.assert_constraints) {
      // REVISIT: cds.run fails for some tests
      const results = await this.run(validationQueries)
      let i = 0
      for (const result of results) {
        const constraints = validationQueries[i].$constraints
        if (!result?.length) continue
        for (const key in constraints) {
          const constraintCol = key + '_constraint'
          for (const row of result) {
            if (!row[constraintCol]) {
              const { message, parameters } = constraints[key]
              const msgParams = {}
              if (parameters) {
                parameters.forEach((p, i) => {
                  const { name } = p
                  // this should also handle cases where parameters where renamed
                  const paramReturnValue = row[p['=']]
                  if (paramReturnValue) msgParams[name || i] = paramReturnValue
                })
              }
              const constraintValidationMessage = message
                ? cds.i18n.messages.for(message, msgParams) || message
                : `@assert.constraint ”${key}” failed`
              req.error(400, constraintValidationMessage)
            }
          }
        }
        i += 1
      }
    }
    // REVISIT: we can probably get rid of this
    this.tx.assert_constraints = []
  }
}

module.exports = {
  attachConstraints,
  checkConstraints,
}
