const fs = require('fs')
const assert = require('assert')
const path = require('path')

const _debug = process.env.DEBUG && process.env.DEBUG.match(/\benv\b/);
const debug = msg => console.log(msg);
/* eslint no-console:0 */


const isDirectory = dirPath => fs.statSync(dirPath).isDirectory()

function readFiles(dirPath) {
  const result = {}
  for (const dirEntry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const filePath = path.join(dirPath, dirEntry.name)
    if (isFile(filePath, dirEntry)) {
      result[dirEntry.name] = fs.readFileSync(filePath, 'utf8')
    }
  }
  return result
}

const DEFAULT_META_DATA_PROPERTIES = { type: true, provider: true }

function parseJsonSafe(str) {
  try {
    return JSON.parse(str)
  } catch {
    return undefined
  }
}

function buildBindingWithoutMetaData(properties) {
  const binding = { credentials: {} }

  for (const propertyName in properties) {
    if (propertyName in DEFAULT_META_DATA_PROPERTIES) {
      binding[propertyName] = properties[propertyName]
    } else {
      binding.credentials[propertyName] = properties[propertyName]
    }
  }

  return binding
}

function parseProperties(properties, metaData = [], bindingPath) {
  const result = {}

  for (const metaDataProperty of metaData) {
    const { name } = metaDataProperty
    const text = properties[name]
    if (name && typeof text !== 'undefined') {
      let value
      switch (metaDataProperty.format) {
        case 'text':
          result[name] = text
          break
        case 'json':
          value = parseJsonSafe(text)
          if (metaDataProperty.container) {
            Object.assign(result, value)
          } else {
            result[name] = value
          }
          break
        default:
          _debug && debug(`Unexpected format "${metaDataProperty.format}" in service binding "${bindingPath}"`)
      }
    } else {
      _debug && debug(`Missing property "${name}" in service binding "${bindingPath}"`)
    }
  }

  return result
}

function readBinding(bindingPath, bindingName) {
  const properties = readFiles(bindingPath)
  return parseBinding(bindingPath, bindingName, properties)
}

function parseBinding(bindingPath, bindingName, properties) {
  const metaDataString = properties['.metadata']
  let metaData
  if (metaDataString) {
    metaData = parseJsonSafe(metaDataString)
    if (typeof metaData === 'undefined' && _debug) debug(`Cannot parse JSON: ${bindingPath}/.metadata`)
  }

  let binding
  if (metaData) {
    binding = parseProperties(properties, metaData.metaDataProperties, bindingPath)
    binding.credentials = parseProperties(properties, metaData.credentialProperties, bindingPath)
  } else {
    binding = buildBindingWithoutMetaData(properties)
  }

  if (!binding.type) {
    _debug && debug(`Missing type property for service binding "${bindingPath}"`)
    return undefined
  }

  binding.name = bindingName
  return binding
}

function readServiceBindingsServicesFromPath(serviceBindingRoot) {
  assert(isDirectory(serviceBindingRoot), 'secrets path must be a directory')

  const bindingsForService = {}
  for (const bindingEntry of fs.readdirSync(serviceBindingRoot, { withFileTypes: true })) {
    if (bindingEntry.isDirectory()) {
      const bindingPath = path.join(serviceBindingRoot, bindingEntry.name)
      const binding = readBinding(bindingPath, bindingEntry.name)
      if (!binding) continue
      const type = binding.type
      const bindings = bindingsForService[type] || (bindingsForService[type] = [])
      bindings.push(binding)
    }
  }
  return Object.keys(bindingsForService).length > 0 ? bindingsForService : undefined
}

function serviceBindings(serviceBindingRoot) {
  serviceBindingRoot = serviceBindingRoot || process.env.SERVICE_BINDING_ROOT
  if ((typeof serviceBindingRoot === 'string' && serviceBindingRoot.length > 0)) {
    return fs.existsSync(serviceBindingRoot) ? readServiceBindingsServicesFromPath(serviceBindingRoot) : undefined
  } else {
    return undefined
  }
}

function isFile(p, entry) {
  if (entry.isFile()) return true
  if (entry.isSymbolicLink()) {
    // Kubernetes credentials use symlinks
    const target = fs.realpathSync(p)
    const targetStat = fs.statSync(target)

    if (targetStat.isFile()) return true
  }
  return false
}

module.exports = serviceBindings
module.exports.parseBinding = parseBinding // required by "cds bind"