const cds = require('../../../')

const { where2obj } = require('../../_runtime/common/utils/cqn')
const propagateForeignKeys = require('../../_runtime/common/utils/propagateForeignKeys')

let _consistent_params //> remove with cds^10

// REVISIT: do we already have something like this _without using okra api_?
// REVISIT: should we still support process.env.CDS_FEATURES_PARAMS? probably nobody uses it...
exports.getKeysAndParamsFromPath = (from, { model }) => {
  if (!from.ref || !from.ref.length) return {}

  _consistent_params ??= cds.env.features.consistent_params

  const params = []
  const data = {}
  let currData = data
  const navigations = []

  let cur = model.definitions
  let lastElement

  for (let i = 0; i < from.ref.length; i++) {
    const ref = from.ref[i]
    const id = ref.id || ref
    lastElement = cur[id]
    const target = cur[id]._target ?? lastElement
    cur = target.elements

    if (lastElement.isAssociation) {
      currData[lastElement.name] = {}
      currData = currData[lastElement.name]
      navigations.push(lastElement)
    }

    if (ref.where) {
      const seg_keys = where2obj(ref.where)
      if (_consistent_params) params[i] = seg_keys
      else params[i] = seg_keys.ID && Object.keys(seg_keys).length === 1 ? seg_keys.ID : seg_keys
      Object.assign(currData, seg_keys)
    }

    if (i === from.ref.length - 1 && !ref.where && ref.args) {
      const seg_keys = Object.fromEntries(Object.entries(ref.args).map(([k, v]) => [k, 'val' in v ? v.val : v]))
      if (_consistent_params) params[i] = seg_keys
      else params[i] = seg_keys.ID && Object.keys(seg_keys).length === 1 ? seg_keys.ID : seg_keys
    }
  }

  let current = data
  for (let nav of navigations) {
    propagateForeignKeys(nav.name, current, nav._foreignKeys, true, { generateKeys: false })
    current = current[nav.name]
  }

  return { keys: current || {}, params }
}
