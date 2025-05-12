const _flat2struct = (def, prefix = '') => {
  const map = {}
  for (const ele in def.elements) {
    if (def.elements[ele].elements)
      Object.assign(map, _flat2struct(def.elements[ele], prefix ? prefix + '$$$' + ele : ele))
    else if (prefix) map[prefix.replace(/\$\$\$/g, '_') + '_' + ele] = [...prefix.split('$$$'), ele]
  }
  return map
}

module.exports = class {
  get _isSingleton() {
    return this.own(
      '__isSingleton',
      () => this['@odata.singleton'] || (this['@odata.singleton.nullable'] && this['@odata.singleton'] !== false)
    )
  }

  get _hasPersistenceSkip() {
    return this.own(
      '__hasPersistenceSkip',
      () => this.own('@cds.persistence.skip') && this.own('@cds.persistence.skip') !== 'if-unused'
    )
  }

  get _isDraftEnabled() {
    return this.own('__isDraftEnabled', () => {
      return (
        (this.associations && this.associations.DraftAdministrativeData) ||
        this.name.match(/\.DraftAdministrativeData$/) ||
        (this.own('@odata.draft.enabled') && this.own('@Common.DraftRoot.ActivationAction'))
      )
    })
  }

  get _etag() {
    return this.own('__etag', () => {
      for (const el in this.elements) {
        const element = this.elements[el]
        if (element['@odata.etag']) return element
      }
    })
  }

  get _flat2struct() {
    return this.own('_flat2struct', () => _flat2struct(this))
  }
}
