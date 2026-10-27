'use strict'

module.exports = { keysOf, foreignKeysOf }

// Linked CSN exposes keys and foreignKeys as memoizing getters. Reading them
// directly would enrich the caller's model. Resolve the same information here
// without installing caches on definitions (including frozen definitions).
function dataProperty(definition, name) {
  for (let d = definition; d; d = Object.getPrototypeOf(d)) {
    const property = Object.getOwnPropertyDescriptor(d, name)
    if (property) return property
  }
}

function keysOf(definition, cache) {
  if (!definition) return undefined
  if (cache) return cached(cache, definition, 'keys', keysOf)
  const property = dataProperty(definition, 'keys')
  if (property && 'value' in property) return property.value
  if (definition.isAssociation) {
    if (definition.on || definition.is2many || !definition._target) return undefined
    return Object.values(definition._target.elements)
      .filter(e => e.key)
      .map(e => ({ ref: [e.name] }))
  }
  if (definition.kind === 'entity') {
    const keys = Object.fromEntries(Object.entries(definition.elements).filter(([, e]) => e.key))
    return Object.keys(keys).length ? keys : null
  }
}

function foreignKeysOf(definition, cache) {
  if (!definition) return undefined
  if (cache) return cached(cache, definition, 'foreignKeys', foreignKeysOf)
  const property = dataProperty(definition, 'foreignKeys')
  if (property && 'value' in property) return property.value
  if (!definition.isAssociation) return undefined
  const keys = keysOf(definition)
  if (!keys) return undefined
  if (!keys.length) return null
  const foreignKeys = {}
  for (const key of keys) {
    const element = key.ref.reduce((target, name) => target.elements[name], definition._target)
    const name = key.as || key.ref.at(-1)
    foreignKeys[name] = Object.create(element, { name: { value: name }, notNull: { value: true } })
  }
  return foreignKeys
}

function cached(cache, definition, kind, derive) {
  let entry = cache.get(definition)
  if (!entry) cache.set(definition, (entry = {}))
  if (!(kind in entry)) entry[kind] = derive(definition)
  return entry[kind]
}
