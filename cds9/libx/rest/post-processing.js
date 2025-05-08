const getTemplate = require('../_runtime/common/utils/template')
const _picker = element => {
  const categories = []
  if (Array.isArray(element)) return
  if (element.type === 'cds.Binary' || element.type === 'cds.LargeBinary') categories.push('convert_binary')
  if (element['@cds.api.ignore'] && !element.isAssociation) categories.push('@cds.api.ignore')
  if (categories.length) return { categories }
}

const _processorFn = elementInfo => {
  const { row, key, plain } = elementInfo
  if (typeof row !== 'object') return
  for (const category of plain.categories) {
    switch (category) {
      case 'convert_binary':
        if (row[key] != null && Buffer.isBuffer(row[key])) row[key] = row[key].toString('base64')
        break
      case '@cds.api.ignore':
        delete row[key]
        break
      // no default
    }
  }
}

const postProcessData = (data, srv, definition) => {
  const template = getTemplate('rest-post-process', srv, definition, { pick: _picker })
  template.process(data, _processorFn)
}

module.exports = {
  postProcessData
}
