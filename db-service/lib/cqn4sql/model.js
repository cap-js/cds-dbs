'use strict'

// Derive model facts: targets, flattened leaves, association key pairs and result types.
// Cache facts per compilation outside the CSN so caller-owned models remain unchanged.

const cds = require('@sap/cds')
const { id } = require('./syntax')

const fullName = element => element.parent?.kind === 'element'
  ? fullName(element.parent) + '_' + element.name : element.name
const calculated = element => element?.value && !element.value.stored && !element.on
function entries(elements) {
  const result = []
  for (const name in elements) result.push([name, elements[name]])
  return result
}

class Model {
  constructor(model, options) {
    if (!model) throw new Error('Please specify a model')
    this.csn = model
    this.options = options
    this.cache = new WeakMap()
  }

  definition(name, localized = false) {
    const def = this.csn.definitions[name]
    return localized && def?.['@cds.localized'] !== false ? this.csn.definitions['localized.' + name] || def : def
  }

  target(element, localized = false) {
    return element.target ? this.definition(element.target, localized) : element
  }

  memo(element, key, derive) {
    let facts = this.cache.get(element)
    if (!facts) this.cache.set(element, facts = {})
    if (!(key in facts)) facts[key] = derive()
    return facts[key]
  }

  keys(element) {
    if (!element) return undefined
    return this.memo(element, 'keys', () => {
      // Linked CSN getters memoize on the model. Read explicit keys or derive
      // them here, including when definitions have been frozen by the caller.
      for (let d = element; d; d = Object.getPrototypeOf(d)) {
        const descriptor = Object.getOwnPropertyDescriptor(d, 'keys')
        if (descriptor) {
          if ('value' in descriptor) return descriptor.value
          break
        }
      }
      if (element.target) {
        if (element.on || element.cardinality?.max === '*') return undefined
        return entries(this.target(element)?.elements || {}).filter(([, e]) => e.key).map(([name]) => ({ ref: [name] }))
      }
      return Object.fromEntries(entries(element.elements || {}).filter(([, e]) => e.key))
    })
  }

  at(definition, path) {
    let current = definition
    for (const step of path) current = this.target(current)?.elements?.[id(step)]
    return current
  }

  leaves(element) {
    return this.memo(element, 'leaves', () => {
      if (element.virtual) return []
      if (element.type === 'cds.Map') return [{ name: '', path: [], element }]
      if (element.target) return (this.keys(element) || []).flatMap(key => {
        const target = this.at(this.target(element), key.ref)
        return this.leaves(target).map(leaf => ({
          name: [key.as || key.ref.at(-1), leaf.name].filter(Boolean).join('_'),
          alias: [target.target ? '' : key.as || key.ref.join('_'), leaf.alias ?? leaf.name].filter(Boolean).join('_'),
          path: [...key.ref, ...leaf.path], element: leaf.element,
        }))
      })
      if (element.elements) return entries(element.elements).flatMap(([name, child]) =>
        this.leaves(child).map(leaf => ({ name: [name, leaf.name].filter(Boolean).join('_'), alias: [name, leaf.alias ?? leaf.name].filter(Boolean).join('_'), path: [name, ...leaf.path], element: leaf.element })))
      return [{ name: '', path: [], element }]
    })
  }

  keyPairs(association) {
    return this.memo(association, 'pairs', () => (this.keys(association) || []).flatMap(key => {
      const target = this.at(this.target(association), key.ref)
      return this.leaves(target).map(leaf => ({
        source: [key.as || key.ref.at(-1), leaf.name].filter(Boolean).join('_'),
        target: [...key.ref, ...leaf.path].join('_'),
        path: [...key.ref, ...leaf.path], element: leaf.element,
      }))
    }))
  }

  primaryKeys(entity) {
    return this.memo(entity, 'primaryKeys', () => entries(entity.elements).flatMap(([name, element]) =>
      element.key && !element.virtual && !element.target ? this.leaves(element).map(leaf => ({
        name: [name, leaf.name].filter(Boolean).join('_'), ref: [name, ...leaf.path], element: leaf.element,
      })) : []))
  }

  persisted(element) {
    const target = this.target(element)
    return !Object.hasOwn(target, '@cds.persistence.skip') || target['@cds.persistence.skip'] !== true ||
      (this.options.runtimeViews && !!target.query)
  }
}

function typeFor(syntax, base) {
  if (!syntax.cast && syntax.xpr?.[0]?.cast) return typeFor(syntax.xpr[0], base)
  if (syntax.cast) {
    if (base?.elements) throw new Error("Structured elements can't be cast to a different type")
    const type = cds.builtin.types[syntax.cast.type] || cds.builtin.types['cds.' + syntax.cast.type]
    return type ? new type.constructor({ ...syntax.cast, type: type._type }) : { ...syntax.cast }
  }
  if (base) return base
  if ('val' in syntax) {
    const name = { string: 'String', boolean: 'Boolean', number: Number.isSafeInteger(syntax.val) ? 'Integer' : 'Decimal' }[typeof syntax.val]
    if (name) return new cds.builtin.types[name].constructor()
  }
  return {}
}

module.exports = { Model, fullName, calculated, typeFor, entries }
