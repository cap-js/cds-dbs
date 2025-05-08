const DELIMITER = require('./templateDelimiter')

const _processElement = (processFn, row, key, target, picked = {}, isRoot, pathSegmentsInfo) => {
  const element = (target.elements || target.params)[key]
  const { plain } = picked

  if (!plain) return

  /** @type import('../../types/api').templateElementInfo */
  const elementInfo = { row, key, element, target, plain, isRoot, pathSegmentsInfo }

  if (!element && target._flat2struct?.[key] && elementInfo.pathSegmentsInfo) {
    elementInfo.pathSegmentsInfo = pathSegmentsInfo.slice(0)
    elementInfo.pathSegmentsInfo.push(...target._flat2struct[key])
  }

  processFn(elementInfo)
}

const _processRow = (processFn, row, template, tKey, tValue, isRoot, pathOptions) => {
  const { template: subTemplate, picked } = tValue
  const key = tKey.split(DELIMITER).pop()

  _processElement(processFn, row, key, template.target, picked, isRoot, pathOptions.pathSegmentsInfo)

  // process deep
  if (subTemplate && typeof row === 'object' && row) {
    _processComplex(processFn, row, subTemplate, key, pathOptions)
  }
}

const _getTargetKeyNames = target => {
  const keyNames = []

  for (const keyName in target.keys) {
    if (target.keys[keyName].__isAssociationStrict) continue
    keyNames.push(keyName)
  }

  return keyNames
}

const _processComplex = (processFn, row, template, key, pathOptions) => {
  const subRow = row?.[key]
  const rows = Array.isArray(subRow) ? subRow : [subRow]
  if (rows.length === 0) return
  const keyNames = pathOptions.includeKeyValues && _getTargetKeyNames(template.target)

  for (const row of rows) {
    if (row == null) continue
    const args = { processFn, data: row, template, isRoot: false, pathOptions }

    let pathSegmentInfo
    if (pathOptions.includeKeyValues) {
      pathOptions.rowUUIDGenerator?.(keyNames, row, template)
      /** @type import('../../types/api').pathSegmentInfo */
      pathSegmentInfo = { key, keyNames, row, elements: template.target.elements, draftKeys: pathOptions.draftKeys }
    }

    if (pathOptions.pathSegmentsInfo) pathOptions.pathSegmentsInfo.push(pathSegmentInfo || key)
    templateProcessor(args)
    if (pathOptions.pathSegmentsInfo) pathOptions.pathSegmentsInfo.pop()
  }
}

/**
 * @param {import("../../types/api").TemplateProcessor} args
 */
const templateProcessor = ({ processFn, data, template, isRoot = true, pathOptions = {} }) => {
  if (!template || !template.elements.size || !data || typeof data !== 'object') return
  const dataArr = Array.isArray(data) ? data : [data]
  for (const row of dataArr) {
    for (const [tKey, tValue] of template.elements) {
      _processRow(processFn, row, template, tKey, tValue, isRoot, pathOptions)
    }
  }
}

module.exports = templateProcessor
