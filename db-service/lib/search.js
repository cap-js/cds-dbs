'use strict'

const DEFAULT_SEARCHABLE_TYPE = 'cds.String'

/**
 * This method gets all columns for an entity.
 * It includes the generated foreign keys from managed associations, structured elements and complex and custom types.
 * As well, it provides the annotations starting with '@' for each column.
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
  { removeIgnore = false, filterVirtual = false},
) => {
  const columns = []
  const elements = entity.elements

  for (const each in elements) {
    const element = elements[each]
    if (filterVirtual && element.virtual) continue
    if (removeIgnore && element['@cds.api.ignore']) continue
    columns.push(element)
  }

  return columns
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
  const deepSearchCandidates = []

  // build a map of columns annotated with the @cds.search annotation
  for (const key of cdsSearchKeys) {
    const columnName = key.split(cdsSearchTerm + '.').pop()

    const annotationKey = `${cdsSearchTerm}.${columnName}`
    const annotationValue = entity[annotationKey]
    if (annotationValue) atLeastOneColumnIsSearchable = true
    const column = entity.elements[columnName]

    if (column?.isAssociation || columnName.includes('.')) {
      deepSearchCandidates.push({ ref: columnName.split('.') })
      continue;
    }
    cdsSearchColumnMap.set(columnName, annotationValue)
  }

  const searchableColumns = columns.filter(column => {
    const annotatedColumnValue = cdsSearchColumnMap.get(column.name)

    // the element is searchable if it is annotated with the @cds.search, e.g.:
    // `@cds.search { element1: true }` or `@cds.search { element1 }`
    if (annotatedColumnValue) return true

    // calculated elements are only searchable if requested through `@cds.search` 
    if(column.value) return false

    // if at least one element is explicitly annotated as searchable, e.g.:
    // `@cds.search { element1: true }` or `@cds.search { element1 }`
    // and it is not the current column name, then it must be excluded from the search
    if (atLeastOneColumnIsSearchable) return false

    // the element is considered searchable if it is explicitly annotated as such or
    // if it is not annotated and the column is typed as a string (excluding elements/elements expressions)
    return (
      annotatedColumnValue === undefined &&
      column._type === DEFAULT_SEARCHABLE_TYPE &&
      !entity?.query?.SELECT?.columns?.find(col => col.xpr && col.as === column.name)
    )
  })

  if (deepSearchCandidates.length) {
    deepSearchCandidates.forEach(c => {
      const element = c.ref.reduce((resolveIn, curr, i) => {
        const next = resolveIn.elements?.[curr] || resolveIn._target.elements[curr]
        if (next.isAssociation && !c.ref[i + 1]) {
          const searchInTarget = _getSearchableColumns(next._target)
          searchInTarget.forEach(elementRefInTarget => {
            searchableColumns.push({ ref: c.ref.concat(...elementRefInTarget.ref) })
          })
        }
        return next
      }, entity)
      if (element?.type === DEFAULT_SEARCHABLE_TYPE) {
        searchableColumns.push({ ref: c.ref })
      }
    })
  }

  return searchableColumns.map(column => {
    if(column.ref)
      return column
    return { ref: [ column.name ] }
  })
}

/**
 * @returns {Array<object>} - array of columns
 */
const computeColumnsToBeSearched = (cqn, entity = { __searchableColumns: [] }, alias) => {
  let toBeSearched = []

  // aggregations case
  // in the new parser groupBy is moved to sub select.
  if (cqn._aggregated || /* new parser */ cqn.SELECT.groupBy || cqn.SELECT?.from?.SELECT?.groupBy) {
    // REVISIT: No search for aggregation case for the moment
  } else {
    toBeSearched = entity.own('__searchableColumns') || entity.set('__searchableColumns', _getSearchableColumns(entity))
    toBeSearched = toBeSearched.map(c => {
      const col = {ref: [...c.ref]}
      if (alias) col.ref.unshift(alias)
      return col
    })
  }

  return toBeSearched
}

module.exports = {
  getColumns,
  computeColumnsToBeSearched,
}
