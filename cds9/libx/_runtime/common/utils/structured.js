const resolveStructured = require('./resolveStructured')
const { ensureNoDraftsSuffix } = require('../../common/utils/draft')
const { traverseFroms } = require('../../common/utils/entityFromCqn')

const OPERATIONS_MAP = ['=', '>', '<', '!=', '<>', '>=', '<=', 'like', 'between', 'in', 'not in'].reduce((acc, cur) => {
  acc[cur] = 1
  return acc
}, {})

const NOT_EQUAL = { '!=': 1, '<>': 1 }

const _getEntityNamesAndIds = from => {
  const nameAndIds = []
  traverseFroms(from, from => {
    const nameAndId = { name: ensureNoDraftsSuffix(from.ref[0].id || from.ref[0]), id: from.as || from.ref[0] }
    if (nameAndIds.some(x => x.name === nameAndId.name)) return // no duplicates
    nameAndIds.push(nameAndId)
  })

  return nameAndIds
}

const _flattenStructuredInExpand = (column, { _target: expandedEntity }) => {
  const flattenedElements = []
  const toBeDeleted = []
  for (const expandElement of column.expand) {
    if (expandElement.expand) {
      _flattenStructuredInExpand(expandElement, getNavigationIfStruct(expandedEntity, expandElement.ref))
      continue
    }

    if (!expandElement.ref) continue
    const propertyName = expandElement.ref[expandElement.ref.length - 1]
    const element = expandedEntity.elements[expandElement.ref[0]] // TODO alias
    if (!element) continue

    if (element._isStructured) {
      toBeDeleted.push(propertyName)
      flattenedElements.push(...resolveStructured({ element, structProperties: expandElement.ref.slice(1) }))
    }
  }

  const orderBy = _flattenStructuredOrderBy(column.orderBy, expandedEntity)
  if (orderBy) {
    column.orderBy = orderBy
  }
  const columnWhere = flattenStructuredWhereHaving(column.where, expandedEntity)
  if (columnWhere) column.where = columnWhere
  column.expand = column.expand.filter(e => !e.ref || !toBeDeleted.includes(e.ref[e.ref.length - 1]))
  column.expand.push(...flattenedElements)
}

const _flattenStructuredOrderBy = (orderBy, csnEntity) => {
  if (orderBy) {
    const newOrder = []
    for (const order of orderBy) {
      const element = order.ref && csnEntity.elements[order.ref[0]]
      if (!element) {
        newOrder.push(order)
        continue
      }

      if (element._isStructured) {
        const flattenedStructOrder = resolveStructured({ element, structProperties: order.ref.slice(1) })
        newOrder.push(...flattenedStructOrder.map(element => ({ ref: element.ref, sort: order.sort })))
      } else {
        newOrder.push(order)
      }
    }
    return newOrder
  }
}

const _getVal = (data, name) => {
  if (!data) return null

  if (typeof data !== 'object') return data

  if (name in data) {
    return data[name]
  }

  return null
}

const _filterForStructProperty = (structElement, structData, op, prefix = '', nav = []) => {
  const filterArray = []
  const andOr = op in NOT_EQUAL ? 'or' : 'and'

  for (const elementName in structElement.elements) {
    const element = structElement.elements[elementName]
    if (!element) continue

    if (element._isStructured) {
      filterArray.push(
        ..._filterForStructProperty(
          element,
          structData && structData[element.name],
          op,
          prefix + '_' + element.name,
          nav
        )
      )
    } else {
      if (element.isAssociation) continue
      const assocName = element._foreignKey4
      if (assocName) {
        const assoc = structElement.elements[assocName]
        if (assoc.is2one && !assoc.on) {
          for (const key in assoc._target.keys) {
            if (element.name === `${assocName}_${key}`) {
              const ref = [`${prefix}_${assocName}_${key}`]
              const val = _getVal(structData && structData[assocName], key)
              filterArray.push({ ref }, op, { val }, andOr)
            }
          }
        }
        continue
      }
      filterArray.push(
        { ref: [...nav, `${prefix}_${element.name}`] },
        op,
        { val: _getVal(structData, element.name) },
        andOr
      )
    }
  }

  return filterArray
}

const _nestedStructElement = (ref, element, prefix = `${element.name}`) => {
  const nestedElement = element.elements[ref[0]]

  if (!ref.length) return { prefix, nestedElement: element }

  if (ref.length === 1) {
    if (nestedElement.isAssociation)
      return { prefix: `${prefix}_${nestedElement.name}`, nestedElement: nestedElement._target }
    return { prefix: `${prefix}_${nestedElement.name}`, nestedElement }
  }

  if (nestedElement._isStructured) {
    return _nestedStructElement(ref.slice(1), nestedElement, `${prefix}_${nestedElement.name}`)
  }
  if (nestedElement.isAssociation) {
    return _nestedStructElement(ref.slice(1), nestedElement._target, `${prefix}_${nestedElement.name}`)
  }
}

const _transformStructToFlatWhereHaving = ([first, op, second], resArray, structElement, structIdx) => {
  const ref = first.ref || second.ref
  const val = first.val === undefined ? second.val : first.val

  const structName = ref[structIdx]
  const structProperties = ref.slice(structIdx + 1)
  const nav = structIdx > 0 ? ref.slice(0, structIdx) : []
  const flattenedElements = resolveStructured({ element: structElement, structProperties })
  const flattenedElement = flattenedElements.find(el => el.ref[0] === [structName, ...structProperties].join('_'))
  let structData = val
  try {
    structData = JSON.parse(val)
  } catch {
    /* since val === string */
  }
  if (flattenedElement && (structData === val || `${structData}` === val)) {
    flattenedElement.ref.unshift(...nav)
    resArray.push(flattenedElement, op, { val })
  } else {
    // transform complex structured to multiple single structured
    const { nestedElement, prefix } = _nestedStructElement(structProperties, structElement)
    const filterForStructProperty = _filterForStructProperty(nestedElement, structData, op, prefix, nav)
    if (filterForStructProperty.length) {
      filterForStructProperty.pop() // last and/or
      if (op in NOT_EQUAL) resArray.push({ xpr: [...filterForStructProperty] })
      else resArray.push(...filterForStructProperty)
    }
  }

  if (resArray[resArray.length - 1] === 'and') {
    resArray.pop()
  }
}

const _structFromRef = (ref, csnEntity, model) => {
  let entity = csnEntity
  if (!ref) return {}
  for (let idx = 0; idx < ref.length; idx++) {
    const part = ref[idx]
    const element = entity.elements[part]
    if (!element) return {}
    if (element._isStructured) return { element, idx }
    if (element.target) entity = model.definitions[element.target]
    else return {}
  }
}

const flattenStructuredWhereHaving = (filterArray, csnEntity, model) => {
  if (!filterArray) return

  const newFilterArray = []
  for (let i = 0; i < filterArray.length; i++) {
    if (filterArray[i].xpr) {
      newFilterArray.push({ xpr: flattenStructuredWhereHaving(filterArray[i].xpr, csnEntity, model) })
      continue
    }

    if (filterArray[i + 1] in OPERATIONS_MAP) {
      const refElement = filterArray[i].ref ? filterArray[i] : filterArray[i + 2]

      // copy for processing
      const ref = refElement.ref && refElement.ref.map(ele => ele)

      // is ref[0] an alias? -> remove
      const isAliased = ref && ref.length > 1 && !csnEntity.elements[ref[0]]
      if (isAliased) ref.shift()
      const { element, idx } = _structFromRef(ref, csnEntity, model)

      // REVISIT: We cannot make the simple distinction between ref and others
      // for xpr, subselect, we need to call this method recursively
      if (element) {
        if (isAliased) refElement.ref.shift()

        // REVISIT: This does not support operator like "between", "in" or a different order of elements like val,op,ref or expressions like ref,op,val+val
        _transformStructToFlatWhereHaving(filterArray.slice(i, i + 3), newFilterArray, element, idx)
        i += 2 // skip next two entries e.g. ('=', '{struct:{int:1}}')
        continue
      }
    }

    newFilterArray.push(filterArray[i])
  }

  return newFilterArray
}

const _entityFromRef = ref => {
  if (ref) return ref[0].id || ref[0]
}

const getNavigationIfStruct = (entity, ref) => {
  const element = entity && entity.elements && entity.elements[_entityFromRef(ref)]
  if (!element) return
  if (ref.length > 1) return getNavigationIfStruct(element._target || element, ref.slice(1))
  return element
}

const _flattenColumns = (SELECT, flattenedElements, toBeDeleted, csnEntity, tableId) => {
  for (const column of SELECT.columns) {
    if (!column.ref) continue

    // might begin with table id
    const cleanedUpRef = column.ref.length > 1 && column.ref[0] === tableId ? column.ref.slice(1) : column.ref
    const structName = cleanedUpRef[0]

    const element = csnEntity.elements[structName]
    if (!element) continue

    if (column.expand) {
      _flattenStructuredInExpand(column, getNavigationIfStruct(csnEntity, cleanedUpRef))
      continue
    }

    if (element._isStructured) {
      toBeDeleted.push(structName) // works with aliases?
      flattenedElements.push(...resolveStructured({ element, structProperties: cleanedUpRef.slice(1) }))
    }
    if (cleanedUpRef.length < column.ref.length) {
      flattenedElements.forEach(e => e.ref.unshift(tableId))
    }
  }
}

const flattenStructuredSelect = ({ SELECT }, model) => {
  const entityNamesAndIds = _getEntityNamesAndIds(SELECT.from)

  for (const entityNameAndId of entityNamesAndIds) {
    const entity = model.definitions[entityNameAndId.name]
    if (!entity) return
    const tableId = entityNameAndId.id

    if (Array.isArray(SELECT.columns) && SELECT.columns.length > 0) {
      const flattenedElements = []
      const toBeDeleted = []
      _flattenColumns(SELECT, flattenedElements, toBeDeleted, entity, tableId)
      SELECT.columns = SELECT.columns.filter(column => {
        const columnName = column.ref ? (column.ref[0] === tableId ? column.ref[1] : column.ref[0]) : column.as
        return (columnName && !toBeDeleted.includes(columnName)) || column.func || column.expand || 'val' in column
      })
      if (flattenedElements.length) SELECT.columns.push(...flattenedElements)
    }
    if (SELECT.from.args) {
      for (const arg of SELECT.from.args) {
        if (arg.SELECT) {
          flattenStructuredSelect(arg, model)
        }
      }
    }

    const orderBy = _flattenStructuredOrderBy(SELECT.orderBy, entity)
    if (orderBy) SELECT.orderBy = orderBy
    const flattenedWhere = flattenStructuredWhereHaving(SELECT.where, entity, model)
    if (flattenedWhere) SELECT.where = flattenedWhere
    const flattenedHaving = flattenStructuredWhereHaving(SELECT.having, entity, model)
    if (flattenedHaving) SELECT.having = flattenedHaving
  }
}

module.exports = {
  flattenStructuredSelect,
  flattenStructuredWhereHaving,
  getNavigationIfStruct,
  OPERATIONS_MAP
}
