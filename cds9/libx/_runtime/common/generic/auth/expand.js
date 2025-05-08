const cds = require('../../../cds')

const { rewriteExpandAsterisk } = require('../../utils/rewriteAsterisks')

const { ensureNoDraftsSuffix } = require('../../utils/draft')

const _getTarget = (ref, target, definitions) => {
  if (cds.env.effective.odata.proxies) {
    const target_ = target.elements[ref[0]]
    if (ref.length === 1) return definitions[ensureNoDraftsSuffix(target_.target)]
    return _getTarget(ref.slice(1), target_, definitions)
  }
  const target_ = target.elements[ref.map(x => x.id || x).join('_')]
  return definitions[ensureNoDraftsSuffix(target_.target)]
}

const _getRestrictedExpand = (columns, target, definitions) => {
  if (!columns || !target || columns === '*') return

  const annotation = target['@Capabilities.ExpandRestrictions.NonExpandableProperties']
  const restrictions = annotation && annotation.map(element => element['='])

  rewriteExpandAsterisk(columns, target)

  for (const col of columns) {
    if (col.expand) {
      if (restrictions && restrictions.length !== 0) {
        const ref = col.ref.join('_')
        const ref_ = restrictions.find(element => element.replace(/\./g, '_') === ref)
        if (ref_) return ref_
      }
      // expand: '**' or '*3' is only possible within custom handler, no check needed
      if (typeof col.expand[0] === 'string' && /^\*{1}[\d|*]+/.test(col.expand[0])) {
        continue
      } else {
        const restricted = _getRestrictedExpand(col.expand, _getTarget(col.ref, target, definitions), definitions)
        if (restricted) return restricted
      }
    }
  }
}

function restrict_expand(req) {
  if (!req.query) return
  const restricted = _getRestrictedExpand(
    req.query.SELECT && req.query.SELECT.columns,
    req.target,
    this.model.definitions
  )
  if (restricted) req.reject(400, 'EXPAND_IS_RESTRICTED', [restricted])
}

restrict_expand._initial = true

module.exports = restrict_expand
