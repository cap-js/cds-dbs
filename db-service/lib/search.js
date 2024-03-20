'use strict'

const DRAFT_COLUMNS_UNION = {
  IsActiveEntity: 1,
  HasActiveEntity: 1,
  HasDraftEntity: 1,
  DraftAdministrativeData_DraftUUID: 1,
  SiblingEntity: 1,
  DraftAdministrativeData: 1,
}
const DEFAULT_SEARCHABLE_TYPE = 'cds.String'

// only those which return strings are relevant for search
const aggregateFunctions = {
  MAX: true,
  MIN: true,
}

/**
 * This method gets all columns for an entity.
 * It includes the generated foreign keys from managed associations, structured elements and complex and custom types.
 * Moreover, it provides the annotations starting with '@' for each column.
 *
 * @param {object} entity - the csn entity
 * @param {object} [options]
 * @param [options.onlyNames=false] - decides if the column name or the csn representation of the column should be returned
 * @param [options.filterDraft=false] - indicates whether the draft columns should be filtered if the entity is draft enabled
 * @param [options.removeIgnore=false]
 * @param [options.filterVirtual=false]
 * @param [options.keysOnly=false]
 * @returns {Array<object>} - array of columns
 */
const getColumns = (
  entity,
  { onlyNames = false, removeIgnore = false, filterDraft = true, filterVirtual = false, keysOnly = false },
) => {
  const columns = []
  const elements = entity.elements

  for (const each in elements) {
    const element = elements[each]
    if (element.isAssociation) continue
    if (filterVirtual && element.virtual) continue
    if (removeIgnore && element['@cds.api.ignore']) continue
    if (filterDraft && each in DRAFT_COLUMNS_UNION) continue
    if (keysOnly && !element.key) continue
    columns.push(onlyNames ? each : element)
  }

  return columns
}

const _isColumnCalculated = (query, columnName) => {
  if (!query) return false
  if (query.SELECT?.columns?.find(col => col.xpr && col.as === columnName)) return true
  return _isColumnCalculated(query._target?.query, columnName)
}

const _getSearchableColumns = entity => {
  const columnsOptions = { removeIgnore: true, filterVirtual: true }
  const columns = getColumns(entity, columnsOptions)
  const cdsSearchTerm = '@cds.search'
  const cdsSearchKeys = []
  const cdsSearchColumnMap = new Map()

  for (const key in entity) {
    if (key.startsWith(cdsSearchTerm)) cdsSearchKeys.push(key)
  }

  let atLeastOneColumnIsSearchable = false

  // build a map of columns annotated with the @cds.search annotation
  for (const key of cdsSearchKeys) {
    const columnName = key.split(cdsSearchTerm + '.').pop()

    // REVISIT: for now, exclude search using path expression, as deep search is not currently
    // supported
    if (columnName.includes('.')) {
      continue
    }

    const annotationKey = `${cdsSearchTerm}.${columnName}`
    const annotationValue = entity[annotationKey]
    if (annotationValue) atLeastOneColumnIsSearchable = true
    cdsSearchColumnMap.set(columnName, annotationValue)
  }

  const searchableColumns = columns.filter(column => {
    const annotatedColumnValue = cdsSearchColumnMap.get(column.name)

    // the element is searchable if it is annotated with the @cds.search, e.g.:
    // `@cds.search { element1: true }` or `@cds.search { element1 }`
    if (annotatedColumnValue) return true

    // if at least one element is explicitly annotated as searchable, e.g.:
    // `@cds.search { element1: true }` or `@cds.search { element1 }`
    // and it is not the current column name, then it must be excluded from the search
    if (atLeastOneColumnIsSearchable) return false

    // the element is considered searchable if it is explicitly annotated as such or
    // if it is not annotated and the column is typed as a string (excluding elements/elements expressions)
    return (
      annotatedColumnValue === undefined &&
      column._type === DEFAULT_SEARCHABLE_TYPE &&
      !_isColumnCalculated(entity?.query, column.name)
    )
  })

  // if the @cds.search annotation is provided -->
  // Early return to ignore the interpretation of the @Search.defaultSearchElement
  // annotation when an entity is annotated with the @cds.search annotation.
  // The @cds.search annotation overrules the @Search.defaultSearchElement annotation.
  if (cdsSearchKeys.length > 0) {
    return searchableColumns.map(column => column.name)
  }

  return searchableColumns.map(column => column.name)
}

/**
 * @returns {Array<object>} - array of columns
 */
const computeColumnsToBeSearched = (cqn, entity = { __searchableColumns: [] }, alias) => {
  let toBeSearched = []

  // aggregations case
  // in the new parser groupBy is moved to sub select.
  if (cqn._aggregated || /* new parser */ cqn.SELECT.groupBy || cqn.SELECT?.from?.SELECT?.groupBy) {
    cqn.SELECT.columns?.forEach(column => {
      if (column.func || column.xpr) {
        // exclude $count by SELECT of number of Items in a Collection
        if (
          cqn.SELECT.columns.length === 1 &&
          column.func === 'count' &&
          (column.as === '_counted_' || column.as === '$count')
        ) {
          return
        }

        // only strings can be searched
        if (column.element.type !== DEFAULT_SEARCHABLE_TYPE) {
          if (column.xpr) return
          if (column.func && !(column.func in aggregateFunctions)) return
        }

        const searchTerm = {}
        if (column.func) {
          searchTerm.func = column.func
          searchTerm.args = column.args
        } else if (column.xpr) {
          searchTerm.xpr = column.xpr
        }
        toBeSearched.push(searchTerm)
        return
      }

      // no need to set ref[0] to alias, because columns were already properly transformed
      if (column.ref) {
        if (column.element.type !== DEFAULT_SEARCHABLE_TYPE) return
        column = { ref: [...column.ref] }
        toBeSearched.push(column)
        return
      }
    })
  } else {
    toBeSearched = entity.own('__searchableColumns') || entity.set('__searchableColumns', _getSearchableColumns(entity))
    if (cqn.SELECT.groupBy) toBeSearched = toBeSearched.filter(tbs => cqn.SELECT.groupBy.some(gb => gb.ref[0] === tbs))
    toBeSearched = toBeSearched.map(c => {
      const column = { ref: [c] }
      if (alias) column.ref.unshift(alias)
      return column
    })
  }

  return toBeSearched
}

module.exports = {
  getColumns,
  computeColumnsToBeSearched,
}
