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
  const columns = entity.SELECT?.columns || getColumns(entity, columnsOptions)
  const cdsSearchTerm = '@cds.search'
  const cdsSearchKeys = []
  const cdsSearchColumnMap = new Map()

  for (const key in entity) {
    if (key.startsWith(cdsSearchTerm)) cdsSearchKeys.push(key)
  }

  let skipDefaultSearchableElements = false
  const deepSearchCandidates = []

  // build a map of columns annotated with the @cds.search annotation
  for (const key of cdsSearchKeys) {
    const columnName = key.split(cdsSearchTerm + '.').pop()
    const annotationKey = `${cdsSearchTerm}.${columnName}`
    const annotationValue = entity[annotationKey]

    const column = entity.elements[columnName]
    // always ignore virtual elements from search
    if(column?.virtual) continue
    if (column?.isAssociation || columnName.includes('.')) {
      const ref = columnName.split('.')
      if(ref.length > 1) skipDefaultSearchableElements = true
      deepSearchCandidates.push({ ref })
      continue
    }

    if(annotationValue) skipDefaultSearchableElements = true
    cdsSearchColumnMap.set(columnName, annotationValue)
  }

  const searchableColumns = columns.filter(column => {
    const annotatedColumnValue = cdsSearchColumnMap.get(column.name)
    const elementName = column.as || column.ref?.at(-1) || column.name
    const element = entity.elements[elementName]

    // the element is searchable if it is annotated with the @cds.search, e.g.:
    // `@cds.search { element1: true }` or `@cds.search { element1 }`
    if (annotatedColumnValue) return true

    // calculated elements are only searchable if requested through `@cds.search`
    if (column.value) return false

    // if at least one element is explicitly annotated as searchable, e.g.:
    // `@cds.search { element1: true }` or `@cds.search { element1 }`
    // and it is not the current column name, then it must be excluded from the search
    if (skipDefaultSearchableElements) return false

    // the element is considered searchable if it is explicitly annotated as such or
    // if it is not annotated and the column is typed as a string (excluding elements/elements expressions)
    return (
      annotatedColumnValue === undefined &&
      element?.type === DEFAULT_SEARCHABLE_TYPE &&
      !_isColumnCalculated(entity?.query, column.name)
    )
  })

  if (deepSearchCandidates.length) {
    deepSearchCandidates.forEach(c => {
      let element = entity
      for (let i = 0; i < c.ref.length; ++i) {
        const curr = c.ref[i]
        const next = element.elements?.[curr] ?? element._target?.elements?.[curr]

        if (!next) { // e.g. if a search element is not part of a projection
          element = undefined
          break
        }

        if (next.isAssociation && i === c.ref.length - 1) {
          _getSearchableColumns(next._target).forEach(r => searchableColumns.push({ ref: c.ref.concat(...r.ref) }))
        }

        element = next
      }

      if (element?.type === DEFAULT_SEARCHABLE_TYPE) {
        searchableColumns.push({ ref: c.ref })
      }
    })
  }

  return searchableColumns.map(column => {
    if (column.ref) return column
    return { ref: [column.name] }
  })
}

/**
 * @returns {Array<object>} - array of columns
 */
const computeColumnsToBeSearched = (cqn, entity = { __searchableColumns: [] }) => {
  let toBeSearched = []

  // aggregations case
  // in the new parser groupBy is moved to sub select.
  if (cqn._aggregated || /* new parser */ cqn.SELECT.groupBy || cqn.SELECT?.from?.SELECT?.groupBy) {
    cqn.SELECT.columns?.forEach(column => {
      const elementName = column.as || column.ref?.at(-1) || column.name
      const element = cqn.elements[elementName]
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
        if (element?.type !== DEFAULT_SEARCHABLE_TYPE) {
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
        if (element?.type !== DEFAULT_SEARCHABLE_TYPE) return
        column = { ref: [...column.ref] }
        toBeSearched.push(column)
        return
      }
    })
  } else {
    if (entity.kind === 'entity') {
      // first check cache
      toBeSearched =
        entity.own('__searchableColumns') || entity.set('__searchableColumns', _getSearchableColumns(entity))
    } else {
      // if we search on a subquery, we don't have a cache
      toBeSearched = _getSearchableColumns(entity)
    }
    toBeSearched = toBeSearched.map(c => {
      const column = { ref: [...c.ref] }
      return column
    })
  }

  return toBeSearched
}

module.exports = {
  getColumns,
  computeColumnsToBeSearched,
}
