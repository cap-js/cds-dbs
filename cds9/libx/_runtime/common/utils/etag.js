const { isAsteriskColumn } = require('./rewriteAsterisks')

/**
 * Recursively adds etag columns if a manual list of columns is specified.
 * If asterisk columns or no columns are given, the database layer will
 * add the etag columns anyway.
 */
const addEtagColumns = (columns, entity) => {
  if (!columns || !Array.isArray(columns)) return
  if (
    entity._etag &&
    !columns.some(c => isAsteriskColumn(c)) &&
    !(columns.length === 1 && columns[0].func === 'count') &&
    !columns.some(c => c.ref && c.ref[c.ref.length - 1] === entity._etag.name)
  ) {
    columns.push({ ref: [entity._etag.name] })
  }
  const expands = columns.filter(c => c.expand)
  for (const expand of expands) {
    const refName = expand.ref[expand.ref.length - 1]
    const targetEntity = refName && entity.elements[refName] && entity.elements[refName]._target
    if (targetEntity) {
      addEtagColumns(expand.expand, targetEntity)
    }
  }
}

module.exports = {
  addEtagColumns
}
