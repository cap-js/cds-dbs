const getNormalizedDecimal = val => {
  let v = `${val}`
  const cgs = v.match(/^(\d*\.*\d*)e([+|-]*)(\d*)$/)
  if (cgs) {
    let [l, r = ''] = cgs[1].split('.')
    const dir = cgs[2] || '+'
    const exp = Number(cgs[3])
    if (dir === '+') {
      // move decimal point to the right
      r = r.padEnd(exp, '0')
      l += r.substring(0, exp)
      r = r.slice(exp)
      v = `${l}${r ? '.' + r : ''}`
    } else {
      // move decimal point to the left
      l = l.padStart(exp, '0')
      r = l.substring(0, exp) + r
      l = l.slice(exp)
      v = `${l ? l : '0'}.${r}`
    }
  }
  return v
}

function getTarget(path, k) {
  return path.length && path[path.length - 1].match(/\[\d+\]$/) ? path.join('/') : path.concat(k).join('/')
}

// non-strict mode also allows url-safe base64 strings
function isBase64String(string, strict = false) {
  if (typeof string !== 'string') return false

  if (strict && string.length % 4 !== 0) return false

  let length = string.length
  if (string.endsWith('==')) length -= 2
  else if (string.endsWith('=')) length -= 1

  let char
  for (let i = 0; i < length; i++) {
    char = string[i]
    if (char >= 'A' && char <= 'Z') continue
    else if (char >= 'a' && char <= 'z') continue
    else if (char >= '0' && char <= '9') continue
    else if (char === '+' || char === '/') continue
    else if (!strict && (char === '-' || char === '_')) continue
    return false
  }

  return true
}

const resolveCDSType = ele => {
  // REVISIT: when is ele._type not set and sufficient?
  if (ele._type?.match(/^cds\./)) return ele._type
  if (ele.type) {
    if (ele.type.match(/^cds\./)) return ele.type
    return resolveCDSType(ele.__proto__)
  }
  if (ele.items) return resolveCDSType(ele.items)
  return ele
}


module.exports = {
  getNormalizedDecimal,
  getTarget,
  isBase64String,
  resolveCDSType
}
