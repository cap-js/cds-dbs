const { foreignKey4 } = require('../../common/utils/foreignKeyPropagations')

const _getCommonFieldControl = e => {
  const cfr = e['@Common.FieldControl']
  return cfr && cfr['#']
}

const _isMandatory = e => {
  return (
    e['@assert.mandatory'] !== false &&
    (e['@mandatory'] ||
      e['@Common.FieldControl.Mandatory'] ||
      e['@FieldControl.Mandatory'] ||
      _getCommonFieldControl(e) === 'Mandatory')
  )
}

const _isReadOnly = e => {
  return (
    e['@readonly'] ||
    e['@cds.on.update'] ||
    e['@cds.on.insert'] ||
    e['@Core.Computed'] ||
    e['@Common.FieldControl.ReadOnly'] ||
    e['@FieldControl.ReadOnly'] ||
    _getCommonFieldControl(e) === 'ReadOnly'
  )
}

// NOTE: Please only add things which are relevant to _any_ type,
// use specialized types otherwise (entity, Association, ...).
module.exports = class {
  get _isStructured() {
    return this.own('__isStructured', () => !!this.elements && this.kind !== 'entity')
  }

  get _isMandatory() {
    return this.own('__isMandatory', () => !this.isAssociation && _isMandatory(this))
  }

  get _isReadOnly() {
    return this.own('__isReadOnly', () => !this.key && _isReadOnly(this))
  }

  get _mandatories() {
    return this.own(
      '__mandatories',
      // eslint-disable-next-line no-unused-vars
      () => this.elements && Object.entries(this.elements).filter(([_, v]) => v._isMandatory)
    )
  }

  get _foreignKey4() {
    return this.own('__foreignKey4', () => foreignKey4(this))
  }
}
