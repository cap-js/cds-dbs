'use strict'

// Freeze owned data, including non-enumerable properties, without invoking
// linked-CSN or extension getters or freezing shared class prototypes.
function freezeData(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if ('value' in descriptor) freezeData(descriptor.value, seen)
  }
  return Object.freeze(value)
}

module.exports = freezeData
