'use strict'

const transient = new Set(['sources', 'joinTree', '$combinedElements', '$refLinks', 'isJoinRelevant', 'flatName', 'elements', '_target', 'element'])
const id = step => step?.id || step
const hidden = (object, name, value) => Object.defineProperty(object, name, { value, configurable: true, writable: true })

function prototype(input) {
  let layer = input
  while (layer && !Object.hasOwn(layer, 'constructor')) layer = Object.getPrototypeOf(layer)
  return layer || Object.prototype
}

// Materialize overlays without retaining caller syntax as an output prototype
// or evaluating extension getters. Semantic children are emitted separately.
function shell(input, omit = []) {
  const result = {}
  const seen = new Set(omit)
  for (let layer = input; layer && !Object.hasOwn(layer, 'constructor'); layer = Object.getPrototypeOf(layer)) {
    for (const key of Reflect.ownKeys(layer)) {
      if (seen.has(key) || transient.has(key)) continue
      seen.add(key)
      const descriptor = Object.getOwnPropertyDescriptor(layer, key)
      if ('value' in descriptor) Object.defineProperty(result, key, { ...descriptor, writable: true, configurable: true })
      else Object.defineProperty(result, key, { ...descriptor, configurable: true })
    }
  }
  return result
}

function copy(input, seen = new WeakMap(), payload = false) {
  if (!input || typeof input !== 'object') return input
  if (input instanceof Date || input instanceof RegExp || ArrayBuffer.isView(input) || input instanceof ArrayBuffer ||
    typeof input.pipe === 'function' || typeof input.next === 'function') return input
  if (seen.has(input)) return seen.get(input)
  const result = Array.isArray(input) ? [] : shell(input)
  if (input.SELECT || input.INSERT || input.UPSERT || input.UPDATE || input.DELETE) Object.setPrototypeOf(result, prototype(input))
  seen.set(input, result)
  if (Array.isArray(input)) {
    for (const item of input) result.push(copy(item, seen))
  } else {
    for (const key of Reflect.ownKeys(result)) {
      const descriptor = Object.getOwnPropertyDescriptor(result, key)
      if (!('value' in descriptor) || !descriptor.enumerable || key === 'val' ||
        (payload && ['entries', 'rows', 'values', 'data'].includes(key))) continue
      result[key] = copy(descriptor.value, seen, ['INSERT', 'UPSERT', 'UPDATE'].includes(key))
    }
  }
  return result
}

const nameOf = column => column.as ?? column.ref?.map(id).join('_') ?? column.func ?? String(column.val)
const grouped = tokens => tokens?.some(t => typeof t === 'string' && t.toLowerCase() === 'or') ? [{ xpr: tokens }] : tokens
function and(...parts) {
  const present = parts.filter(p => p?.length)
  if (present.length < 2) return present[0] || []
  return present.flatMap((p, i) => i ? ['and', ...grouped(p)] : grouped(p))
}

module.exports = { id, hidden, shell, copy, nameOf, and, grouped, prototype }
