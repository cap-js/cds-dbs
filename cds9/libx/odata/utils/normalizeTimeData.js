const normalizeTimestamp = require('../../_runtime/common/utils/normalizeTimestamp')
const getTemplate = require('../../_runtime/common/utils/template')

const _processorFn = elementInfo => {
  const { row, plain } = elementInfo
  if (typeof row !== 'object') return
  for (const category of plain.categories) {
    const { row, key } = elementInfo
    if (!(row[key] == null) && row[key] !== '$now') {
      const dt = typeof row[key] === 'string' && new Date(row[key])
      if (!isNaN(dt)) {
        switch (category) {
          case 'cds.DateTime':
            row[key] = new Date(row[key]).toISOString().replace(/\.\d\d\d/, '')
            break
          case 'cds.Timestamp':
            row[key] = normalizeTimestamp(row[key])
            break
          // no default
        }
      }
    }
  }
}

const _pick = element => {
  const categories = []
  if (element.type === 'cds.DateTime') categories.push('cds.DateTime')
  if (element.type === 'cds.Timestamp') categories.push('cds.Timestamp')
  if (categories.length) return { categories }
}

module.exports = function normalizeTimeData(data, model, target) {
  if (!data) return
  if (Array.isArray(data) && data.length === 0) return
  if (typeof data === 'object' && Object.keys(data).length === 0) return

  const template = getTemplate('normalize-datetime', { model }, target, { pick: _pick })

  if (template.elements.size === 0) return

  template.process(data, _processorFn)
}
