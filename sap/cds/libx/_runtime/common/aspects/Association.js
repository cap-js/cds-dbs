const cds = require('../../cds')

const { foreignKeyPropagations } = require('../utils/foreignKeyPropagations')

const _hasJoinCondition = e => e.isAssociation && e.on && e.on.length > 2

const _isSelfRef = e => (e.xpr ? e.xpr.find(_isSelfRef) : e.ref && e.ref[0] === '$self')

const _getBacklinkName = xpr => {
  for (let i = 0; i < xpr.length; i++) {
    const element = xpr[i]
    if (element.xpr) {
      const selfComparison = _getBacklinkName(element.xpr)
      if (selfComparison) return selfComparison
    }

    if (element.ref?.[0] === '$self') {
      let ref
      if (xpr[i + 1] && xpr[i + 1] === '=') ref = xpr[i + 2].ref
      if (xpr[i - 1] && xpr[i - 1] === '=') ref = xpr[i - 2].ref
      if (ref) return ref[ref.length - 1]
    }
  }
}

const isSelfManaged = e => {
  if (!_hasJoinCondition(e)) return
  return !!e.on.find(_isSelfRef)
}

const _isUnManagedAssociation = (e, checkComposition) =>
  e.isAssociation && (!checkComposition || e.isComposition) && _hasJoinCondition(e)

const getAnchor = (e, checkComposition) => {
  if (!(e._isAssociationStrict && (e.keys || e.on))) return
  for (const anchor of Object.values(e._target.associations || {})) {
    if (!_isUnManagedAssociation(anchor, checkComposition)) continue
    if (_getBacklinkName(anchor.on) === e.name && anchor.target === e.parent.name) return anchor
  }
}

const getBacklink = (e, checkComposition) => {
  if (!_isUnManagedAssociation(e, checkComposition)) return
  const backlinkName = _getBacklinkName(e.on)
  if (backlinkName) return e._target && e._target.elements && e._target.elements[backlinkName]
}

module.exports = class {
  get _isAssociationStrict() {
    return this.own('__isAssociationStrict', () => !this.isComposition)
  }

  get _isContained() {
    return (
      this.own('__isContained') || this.set('__isContained', this.isComposition && cds.env.effective.odata.containment)
    )
  }

  get _isSelfManaged() {
    return this.own('__isSelfManaged', () => isSelfManaged(this))
  }

  get _isBacklink() {
    return this.own('__isBacklink', () => !!getAnchor(this))
  }

  get _isCompositionBacklink() {
    return this.own('__isCompositionBacklink', () => !!getAnchor(this, true))
  }

  get _anchor() {
    return this.own('__anchor', () => getAnchor(this))
  }

  get _backlink() {
    return this.own('__backlink', () => getBacklink(this))
  }

  get _foreignKeys() {
    return this.own('__foreignKeys', () => foreignKeyPropagations(this))
  }
}
