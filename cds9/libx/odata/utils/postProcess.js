const cds = require('../../../lib')

const getTemplate = require('../../_runtime/common/utils/template')
const { toBase64url } = require('../../_runtime/common/utils/binary')

const _addEtags = (row, key) => {
  if (!row[key]) return
  // if provided as js date, take the iso string
  const value = row[key] instanceof Date ? row[key].toISOString() : row[key]
  row.$etag = value.startsWith?.('W/') ? value : `W/"${value}"`
}
const _processorFn = elementInfo => {
  const { row, plain } = elementInfo
  if (typeof row !== 'object') return
  for (const category of plain.categories) {
    const { row, key } = elementInfo
    switch (category) {
      case '@odata.etag':
        _addEtags(row, key)
        break
      case '@cds.api.ignore':
        delete row[key]
        break
      case 'binary':
        if (Buffer.isBuffer(row[key])) {
          // if the result object gets serialize to json, the buffer shall become a base64 string
          row[key].toJSON = function () {
            return toBase64url(this)
          }
        } else if (typeof row[key] === 'string') {
          row[key] = toBase64url(row[key])
        }
        break
      case 'array':
        if (row[key] === null) row[key] = []
        break
      case '@cleanup':
        if (key !== 'DraftAdministrativeData_DraftUUID') delete row[key]
        break
      // no default
    }
  }
}

const _pick = element => {
  const categories = []
  if (element['@odata.etag']) categories.push('@odata.etag')
  if (element['@cds.api.ignore'] && !element.isAssociation) categories.push('@cds.api.ignore')
  if (element._type === 'cds.Binary') categories.push('binary')
  if (element.items) categories.push('array')

  // in case of containment managed composition (& assoc backlinks) keys are not exposed and have to be removed from the result
  if (cds.env.effective.odata.containment) {
    const _isContainedOrBackLink = element =>
      element &&
      element.isAssociation &&
      element.keys &&
      (element._isContained || (element._anchor && element._anchor._isContained))

    const assocName = element._foreignKey4
    const assoc = assocName && element.parent.elements[assocName]

    if (_isContainedOrBackLink(assoc)) categories.push('@cleanup')
  }

  if (categories.length) return { categories }
}

module.exports = function postProcess(target, model, result, isMinimal) {
  if (!result) return

  if (!model.definitions[target.name]) {
    if (model.definitions[target.items?.type]) target = target.items
    else return
  }

  const cacheKey = isMinimal ? 'postProcessMinimal' : 'postProcess'
  const options = { pick: _pick, ignore: isMinimal ? el => el.isAssociation : undefined }
  const template = getTemplate(cacheKey, { model }, target, options)

  if (template.elements.size === 0) return

  // normalize result to rows
  result = result.value != null && Object.keys(result).filter(k => !k.match(/^\W/)).length === 1 ? result.value : result
  template.process(result, _processorFn)
}
