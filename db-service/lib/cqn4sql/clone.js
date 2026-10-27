'use strict'

// SQL resolution owns its query graph. cds.ql.clone only copies the outer query
// and clause; refs, filters, UPDATE.with, and inherited clauses remain shared.
// Preserve query prototypes and private caller metadata, but discard SQL links
// from previous transformations so an extended query can be resolved again.
const transient = new Set(['sources', 'joinTree', '$combinedElements', '$refLinks', 'isJoinRelevant', 'flatName'])

module.exports = function cloneCqn(value, seen = new WeakMap(), preserveLinks = false, writePayload = false) {
  if (!value || typeof value !== 'object') return value
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    typeof value.pipe === 'function' ||
    typeof value.next === 'function'
  )
    return value
  if (seen.has(value)) return seen.get(value)

  let prototype = Object.getPrototypeOf(value)
  while (prototype && !Object.hasOwn(prototype, 'constructor')) prototype = Object.getPrototypeOf(prototype)
  const result = Array.isArray(value) ? [] : Object.create(prototype)
  seen.set(value, result)

  // Materialize overlays made by cds.ql.clone without retaining the input as a
  // prototype. Defining writable properties also supports frozen input queries.
  for (let layer = value; layer && layer !== prototype; layer = Object.getPrototypeOf(layer)) {
    for (const key of Reflect.ownKeys(layer)) {
      if (Object.hasOwn(result, key) || (!preserveLinks && transient.has(key))) continue
      const descriptor = Object.getOwnPropertyDescriptor(layer, key)
      if ('value' in descriptor) {
        let copy =
          (writePayload && ['entries', 'rows', 'values', 'data'].includes(key)) || key === 'val'
            ? descriptor.value
            : key === '_with'
              ? descriptor.value?.map(q => cloneCqn(q, seen, true))
              : descriptor.enumerable
                ? cloneCqn(descriptor.value, seen, preserveLinks, ['INSERT', 'UPSERT', 'UPDATE'].includes(key))
                : descriptor.value
        if (key === 'joinTree' && copy) {
          copy = Object.assign(Object.create(Object.getPrototypeOf(copy)), copy, {
            _queryAliases: new Map(copy._queryAliases),
            _aliasSuffixes: new Map(copy._aliasSuffixes),
            _roots: new Map(copy._roots),
          })
        }
        if (descriptor.enumerable && (!prototype || !(key in prototype))) {
          result[key] = copy
          continue
        }
        Object.defineProperty(result, key, {
          value: copy,
          enumerable: descriptor.enumerable,
          writable: true,
          configurable: true,
        })
      } else {
        Object.defineProperty(result, key, { ...descriptor, configurable: true })
      }
    }
  }
  return result
}
