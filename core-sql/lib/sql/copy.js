module.exports.copy = function (obj) {
  const walk = function (par, prop) {
    const val = prop ? par[prop] : par

    // If value is native return
    if (typeof val !== 'object' || val == null || val instanceof RegExp || val instanceof Date || val instanceof Buffer)
      return val

    const ret = Array.isArray(val) ? [] : {}
    Object.keys(val).forEach(k => {
      ret[k] = walk(val, k)
    })
    return ret
  }

  return walk(obj)
}
