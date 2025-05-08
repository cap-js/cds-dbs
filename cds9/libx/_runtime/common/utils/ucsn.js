const cds = require('../../cds')
const getTemplate = require('./template')
const IS_PROXY = Symbol('flat2structProxy')

const proxifyIfFlattened = (definition, payload) => {
  if (!definition || !definition._flat2struct || payload == null || payload[IS_PROXY]) return payload
  return Object.setPrototypeOf(
    payload,
    new Proxy(
      {},
      {
        get: function (_, k, cur) {
          if (k === IS_PROXY) return true
          if (!definition._flat2struct[k]) return Reflect.get(...arguments)
          const segments = definition._flat2struct[k]
          for (let i = 0; i < segments.length - 1; i++) {
            cur = cur[segments[i]]
            if (!cur) return cur
          }
          return cur[segments[segments.length - 1]]
        },
        set: function (_, k, v, o) {
          let cur = o
          if (definition._flat2struct[k]) {
            const segments = definition._flat2struct[k]
            for (let i = 0; i < segments.length - 1; i++) {
              if (!cur[segments[i]]) {
                cur[segments[i]] = {}
              }
              cur = cur[segments[i]]
            }
            cur[segments[segments.length - 1]] = v
          } else if (k === IS_PROXY) {
            // do nothing
          } else {
            Reflect.set(...arguments)
          }
          return o
        }
      }
    )
  )
}

const _picker = element => {
  if (Array.isArray(element)) return { category: 'flat leaf' }
  if (element.isAssociation) return { category: 'node' }
}

const _processor = ({ row, key, plain: { category }, element }) => {
  if (!(key in row)) return
  if (category === 'node') {
    row[key] = Array.isArray(row[key])
      ? row[key].map(data => proxifyIfFlattened(element._target, data))
      : proxifyIfFlattened(element._target, row[key])
  } else if (category === 'flat leaf') {
    const data = row[key]
    delete row[key]
    row[key] = data
  }
}

const _cleanup = (row, definition, cleanupNull, cleanupStruct, errors, prefix = []) => {
  if (!row || !definition) return
  const elements = definition.elements || definition.params
  for (const key of Object.keys(row)) {
    if (definition['@open']) continue
    const element = elements[key] || (cleanupStruct && elements[`${prefix.join('_')}_${key}`])
    if (!element) {
      if (cleanupStruct && typeof row[key] === 'object' && !Array.isArray(row[key])) {
        _cleanup(row[key], definition, cleanupNull, cleanupStruct, errors, [...prefix, key])
      } else {
        if (errors) {
          errors.push(new cds.error(400, `Property "${key}" does not exist in ${definition.name}`))
        }
        delete row[key]
      }
      continue
    }
    if (!row[key]) continue
    if (element.isAssociation) {
      if (element.is2many) {
        for (const r of row[key]) {
          _cleanup(r, element._target, cleanupNull, cleanupStruct, errors, [])
        }
      } else {
        _cleanup(row[key], element._target, cleanupNull, cleanupStruct, errors, [])
      }
    } else if (element.elements) {
      _cleanup(row[key], element, cleanupNull, cleanupStruct, errors, prefix)
      if (!Object.keys(row).length) {
        delete row[key]
      }
      if (cleanupNull && Object.values(row[key]).every(v => v == null)) row[key] = null
    }
  }
}

// REVISIT: when needed?
function convertStructured(service, definition, data, { cleanupNull = false, cleanupStruct = false, errors } = {}) {
  if (!definition) return
  // REVISIT check `structs` mode only for now as uCSN is not yet available
  const flatAccess = cds.env.features.compat_flat_access
  const template = getTemplate('universal-input', service, definition, { pick: _picker, flatAccess })
  const arrayData = Array.isArray(data) ? data : [data]
  if (template && template.elements.size) {
    const _data = arrayData.map(d => proxifyIfFlattened(definition, d))
    template.process(_data, _processor)
  }
  for (const row of arrayData) {
    _cleanup(row, definition, cleanupNull, cleanupStruct, errors)
  }
}

module.exports = {
  convertStructured,
  proxifyIfFlattened
}
