'use strict'

const cds = require('@sap/cds')

function getValidationQuery(target, constraints) {
  const columns = []
  const parameterAliases = new Set() // tracks every alias already added

  for (const [name, { condition, parameters, target }] of Object.entries(constraints)) {
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
      throw new Error(
        `Can't evaluate constraint "${name}" in entity “${target.name}” because it's name collides with a parameter name`,
      )

    // 2. The actual constraint condition as another column
    columns.push({
      xpr: wrapInCaseWhen([{ xpr: condition.xpr }]),
      as: constraintAlias,
      cast: { type: 'cds.Boolean' },
    })
  }

  // REVISIT: matchKeys for one entity should be the same for all constraints
  //          it should be more like { 'bookshop.Books' : { c1 : { ... }, c2: { ... } }, …, $matchKeys: [ ... ] }
  const keyMatchingCondition = Object.values(constraints)[0].where.flatMap((matchKey, i) =>
    i > 0 ? ['or', ...matchKey] : matchKey,
  )
  const validationQuery = SELECT.from(target).columns(columns).where(keyMatchingCondition)
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
  const mk = matchKeys(entity, data)
  for (const c of Object.values(constraints)) {
    c.where = [...(c.matchKeys ?? []), ...mk]
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

/** Merge two constraint maps in‑place, concatenating any duplicate matchKeys (they are deduped later). */
function mergeConstraintSets(base, incoming) {
  for (const [name, inc] of Object.entries(incoming)) {
    const existing = base[name]
    if (existing && existing.element === inc.element) {
      existing.where = [...existing.where, ...inc.where]
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
    const propertyName = parts.length === 1 ? parts[0] || (val.xpr ? 'condition' : undefined) : parts.slice(1).join('.')

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
function matchKeys(entity, data) {
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
    .filter(e => e.length > 0) // remove empty entries
}

function wrapInCaseWhen(xpr) {
  return ['case', 'when', 'not', { xpr }, 'then', { val: false }, 'else', { val: true }, 'end']
}

/**
 * Compose the final error text, including i18n look‑up + parameter injection.
 */
function buildMessage(name, { message, parameters = [] }, row) {
  const msgParams = Object.fromEntries(
    parameters
      .map(p => {
        const val = row[p.as]
        return val === undefined ? null : [p.as, val]
      })
      .filter(Boolean),
  )

  return message
    ? cds.i18n.messages.for(message, msgParams) || message // translated or fallback
    : `@assert.constraint “${name}” failed`
}

/**
 * Retrieves constraints grouped by their target from the provided target and data.
 *
 * @param {object} target - The target of the request.
 * @param {object} data - The payload of the request.
 * @returns {Map<string, object>} A map where the keys are entity names and the values are
 * objects containing constraints.
 */
function getConstraintsByTarget(target, data) {
  const flatConstraints = collectConstraints(target, data)
  const map = new Map()
  for (const [name, c] of Object.entries(flatConstraints)) {
    const tgt = c.target.name
    const bucket = map.get(tgt) ?? {}
    bucket[name] = c
    map.set(tgt, bucket)
  }
  return map
}

function getWhereOfPatch(req) {
  if (!['UPDATE', 'UPSERT'].includes(req.event)) return null

  const q = req.query[req.event]
  return q?.where ?? q?.entity?.ref?.[0]?.where ?? null
}

module.exports = {
  getValidationQuery,
  getConstraintsByTarget,
  collectConstraints,
  buildMessage,
  getWhereOfPatch,
}
