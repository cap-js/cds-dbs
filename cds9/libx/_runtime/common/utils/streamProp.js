const { ensureNoDraftsSuffix, ensureUnlocalized } = require('./draft')
const { isDuplicate } = require('./rewriteAsterisks')

const _addColumn = (name, type, columns, url, target) => {
  let mediaType = typeof type === 'object' && type['=']
  if (mediaType && target.elements[mediaType]?.virtual) return
  mediaType = mediaType ? { ref: [mediaType.replaceAll(/\./g, '_')] } : { val: type }
  const col = {
    xpr: [
      'case',
      'when',
      { ref: [name] },
      '=',
      { val: null },
      'then',
      { val: null },
      'else',
      { func: 'coalesce', args: [mediaType, { val: 'application/octet-stream' }] },
      'end'
    ],
    as: `${name}@odata.mediaContentType`
  }

  if (!columns.find(isDuplicate(col))) columns.push(col)

  if (url) {
    const ref = {
      ref: [name],
      as: `${name}@odata.mediaReadLink`
    }
    if (!columns.find(isDuplicate(ref))) columns.push(ref)
  }
}

const _addColumns = (target, columns) => {
  for (const k in target.elements) {
    const el = target.elements[k]
    if (el['@Core.MediaType'] && !el.virtual) {
      _addColumn(el.name, el['@Core.MediaType'], columns, el['@Core.IsURL'] && el.type === 'cds.String', target)
    }
  }
}

const handleStreamProperties = (target, columns, model) => {
  if (!target || !model || !columns) return

  let index = columns.length
  while (index--) {
    const col = columns[index]
    const name = col.ref && col.ref[col.ref.length - 1]
    const element = name && target.elements[name]
    const type = element && element.type
    const mediaType = element?.['@Core.MediaType']

    const ignoreMediaType = mediaType && element['@Core.IsURL']

    if (col === '*') {
      _addColumns(target, columns)
    } else if (col.ref && (type === 'cds.LargeBinary' || (mediaType && !ignoreMediaType))) {
      if (mediaType && !element.virtual) _addColumn(name, mediaType, columns, element['@Core.IsURL'], target)
      columns.splice(index, 1)
    } else if (col.expand && col.ref) {
      const tgt = target.elements[col.ref] && target.elements[col.ref].target
      tgt && handleStreamProperties(model.definitions[ensureUnlocalized(ensureNoDraftsSuffix(tgt))], col.expand, model)
    }
  }
}

module.exports = { handleStreamProperties }
