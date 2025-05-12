const odata = require('../index.js')
const { where2obj } = require('../../_runtime/common/utils/cqn.js')
const _throw = key => {
  throw Object.assign(new Error('Invalid binding value for', key), { statusCode: 400 })
}

/// Transforms { 'myAssoc@odata.bind': 'myTarget(ID=123)' }
///       into { myAssoc: { ID: 123 } }
function odataBind(data, target) {
  if (!data || typeof data !== 'object' || !target?.associations) return
  if (Array.isArray(data)) {
    data.forEach(d => odataBind(d, target))
    return
  }
  for (const assoc of target.associations) {
    // deep
    if (data[assoc.name] && typeof data[assoc.name] === 'object') {
      odataBind(data[assoc.name], assoc._target)
    }
    const bindName = assoc.name + '@odata.bind'
    if (data[bindName]) {
      const parsed = odata.parse(data[bindName])?.SELECT?.from?.ref?.[0]?.where
      if (!parsed) _throw(assoc.name)
      if (parsed.length === 1) {
        // single key variant
        const keys = Object.keys(target.elements[assoc.name]?._target?.keys || {})
        if (keys.length !== 1) _throw(assoc.name)
        data[assoc.name] = { [keys[0]]: parsed[0].val }
      } else {
        data[assoc.name] = where2obj(parsed)
      }
      delete data[bindName]
    }
  }
}
module.exports = odataBind
