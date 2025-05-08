const { Readable } = require('stream')

const _deepCopy = arg => {
  if (Buffer.isBuffer(arg)) {
    return Buffer.from(arg)
  }
  if (Array.isArray(arg)) {
    return _deepCopyArray(arg)
  }
  if (arg instanceof Readable) {
    return arg
  }
  if (typeof arg === 'object') {
    return _deepCopyObject(arg)
  }
  return arg
}

const _deepCopyArray = arr => {
  if (!arr) return arr
  const clone = []
  for (const item of arr) {
    clone.push(_deepCopy(item))
  }
  return clone
}

const _deepCopyObject = obj => {
  if (!obj) return obj
  const clone = {}
  for (const key in obj) {
    clone[key] = _deepCopy(obj[key])
  }
  return clone
}

const deepCopy = data => {
  if (Array.isArray(data)) return _deepCopyArray(data)
  return _deepCopyObject(data)
}

module.exports = {
  deepCopy
}
