const cds = require('../../cds')

const getRowUUIDGeneratorFn = eventName => {
  if (eventName === 'UPDATE') return
  return (keyNames, row, template) => {
    for (const keyName of keyNames) {
      if (Object.prototype.hasOwnProperty.call(row, keyName)) {
        continue
      }

      const elementInfo = template.elements.get(keyName)
      const plain = elementInfo && elementInfo.picked && elementInfo.picked.plain
      if (!plain || !plain.categories) continue
      if (plain.categories.includes('uuid')) {
        row[keyName] = cds.utils.uuid()
      }
    }
  }
}

module.exports = getRowUUIDGeneratorFn
