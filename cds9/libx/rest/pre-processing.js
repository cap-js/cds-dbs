const getTemplate = require('../_runtime/common/utils/template')
const { checkStaticElementByKey } = require('../_runtime/cds-services/util/assert')
const _picker = element => {
  const categories = []
  if (Array.isArray(element)) return
  if (element.type === 'cds.Binary' || element.type === 'cds.LargeBinary') categories.push('convert_binary')
  if (!(element._isStructured || element.isAssociation || element.items)) categories.push('static_validation')
  if (categories.length) return { categories }
}

const _processorFn = errors => elementInfo => {
  const { row, key, plain, target } = elementInfo
  if (typeof row !== 'object') return
  if (row[key] == null) return
  for (const category of plain.categories) {
    switch (category) {
      case 'convert_binary':
        if (typeof row[key] === 'string') row[key] = Buffer.from(row[key], 'base64')
        break
      case 'static_validation':
        if (errors) { //> errors collector is only provided in case of !cds.env.features.cds_validate
          // REVISIT move validation to generic asserter => see PR 717
          const validations = checkStaticElementByKey(target, key, row[key])
          errors.push(...validations)
        }
        break
    }
  }
}

const preProcessData = (data, srv, definition, usecase = 'rest-pre-process', errors) => {
  const template = getTemplate(usecase, srv, definition, { pick: _picker })
  template.process(data, _processorFn(errors))
}

module.exports = {
  preProcessData
}
