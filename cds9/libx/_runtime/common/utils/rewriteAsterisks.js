const { getNavigationIfStruct } = require('./structured')
const { ensureNoDraftsSuffix } = require('./draft')
const { getEntityNameFromCQN } = require('./entityFromCqn')
const cds = require('../../../../lib')

const resolveStructured = require('./resolveStructured')

const _isStreamProperty = element => {
  return element.type === 'cds.LargeBinary' || (element['@Core.MediaType'] && element['@Core.IsURL'])
}

/**
 * This method gets all columns for an entity.
 * It includes the generated foreign keys from managed associations, structured elements and complex and custom types.
 * As well, it provides the annotations starting with '@' for each column.
 *
 * @param entity - the csn entity
 * @returns {Array} - array of columns
 */
const getColumns = (entity, { omitStream } = { omitStream: false }) => {
  // REVISIT is this correct or just a problem that occurs because of new structure we do not deal with yet?
  if (!(entity && entity.elements)) return []
  const columnNames = []
  // REVISIT!!!
  const { structs = cds.env.features.ucsn_struct_conversion } = cds.env.effective.odata
  const elements = entity.elements
  for (const elementName in elements) {
    const element = elements[elementName]
    if (element['@cds.api.ignore']) continue
    if (omitStream && _isStreamProperty(element)) continue
    if (element.isAssociation) continue
    if (structs && element.elements) {
      columnNames.push(...resolveStructured({ element, structProperties: [] }, false))
      continue
    }
    columnNames.push(elementName)
  }
  return columnNames.map(name => elements[name] || { name })
}

const isAsteriskColumn = col => col === '*' || (col.ref && col.ref[0] === '*' && !col.expand)

const isDuplicate = newColumn => column => {
  if (newColumn.as && column.as) return column.as === newColumn.as
  if ((newColumn.as && !column.as) || (!newColumn.as && column.as)) return
  if (!column.ref) return
  if (Array.isArray(newColumn)) newColumn = { ref: newColumn }
  return newColumn.ref ? newColumn.ref.join('_') === column.ref.join('_') : newColumn === column.ref.join('_')
}

const _expandColumn = (column, target) => {
  if (!(column.ref && column.expand)) return
  const nextTarget = getNavigationIfStruct(target, column.ref)
  if (nextTarget && nextTarget._target && nextTarget._target.elements) _rewriteAsterisks(column, nextTarget._target)
  return column
}

const _resolveTarget = (ref, target) => {
  if (ref.length > 1) {
    const element = target.elements[ref[0]]
    if (element) {
      if (element.isAssociation) throw cds.error(`Navigation "${ref.join('/')}" in expand is not supported`)
      // structured
      return _resolveTarget(ref.slice(1), element)
    } else {
      // in case there is an alias, try with the next entry
      return _resolveTarget(ref.slice(1), target)
    }
  }

  const _ref = ref[0].id || ref[0]
  const element = target.elements[_ref]
  if (element) return element._target

  throw cds.error(`Navigation property "${_ref}" is not defined in ${target.name}`, { code: 400 })
}

const rewriteExpandAsterisk = (columns, target) => {
  // check all nested expands to resolve nested expand asterisks first
  for (const column of columns) {
    if (column.expand && column.ref) {
      rewriteExpandAsterisk(column.expand, _resolveTarget(column.ref, target))
    }
  }

  const expandAllColIdx = columns.findIndex(col => {
    if (col.ref || !col.expand) return
    return col.expand.includes('*')
  })
  if (expandAllColIdx > -1) {
    const { expand } = columns.splice(expandAllColIdx, 1)[0]
    for (const elName in target.elements) {
      if (target.elements[elName]._target && !columns.find(col => col.expand && col.ref && col.ref[0] === elName)) {
        if (elName === 'SiblingEntity') continue
        columns.push({ ref: [elName], expand: [...expand] })
      }
    }
  }
}

const _rewriteAsterisk = (columns, target, isRoot) => {
  const asteriskColumnIndex = columns.findIndex(col => isAsteriskColumn(col))
  if (asteriskColumnIndex > -1) {
    columns.splice(
      asteriskColumnIndex,
      1,
      ...getColumns(target, { omitStream: true })
        .map(c => ({ ref: [c.name] }))
        .filter(c => !columns.find(isDuplicate(c)) && (isRoot || c.ref[0] !== 'DraftAdministrativeData_DraftUUID'))
    )
  }
}

const _rewriteAsterisks = (cqn, target, isRoot) => {
  const columns = cqn.expand || cqn.columns
  _rewriteAsterisk(columns, target, isRoot)
  rewriteExpandAsterisk(columns, target)
  for (const column of columns) {
    _expandColumn(column, target)
  }
  return columns
}

const _targetOfQueryIfNotDraft = (query, model) => {
  const { entityName } = getEntityNameFromCQN(query)
  const target = model.definitions[entityName]
  if (!target || target.name.endsWith('_drafts')) return
  return target
}

const rewriteAsterisks = (query, model, options) => {
  /*
   * REVISIT:
   * - _4db: called on db level
   * - _4fiori: cqn2cqn4sql called in a fiori handler
   * this is extremely obfuscated!
   */
  const { _4db, _4fiori } = options

  if (!query.SELECT.columns || !query.SELECT.columns.length) {
    if (_4db || _4fiori) {
      // REVISIT these are two nasty hacks for UNION and JOIN,
      // which should be implemented generically.
      // Please, do not continue to develop here if possible.
      if (query.SELECT.from.SET?.args[0]?.SELECT?.columns) {
        // > best-effort derive column list from first join element if given
        query.SELECT.columns = query.SELECT.from.SET.args[0].SELECT.columns.map(c => ({
          ref: [c.as || c.ref[c.ref.length - 1]]
        }))
      } else if (query.SELECT.from.join && query.SELECT.from.args) {
        if (!query.SELECT.columns) query.SELECT.columns = []
        for (const arg of query.SELECT.from.args) {
          const _targetName = arg.ref[0].id || arg.ref[0]
          const _target = model.definitions[ensureNoDraftsSuffix(_targetName)]
          const columns = getColumns(_target, {})
            .filter(
              c =>
                !query.SELECT.columns.some(
                  existing => (existing.as || existing.ref[existing.ref.length - 1]) === c.name
                )
            )
            .map(col => ({
              ref: [arg.as || _targetName, col.name]
            }))
          columns.forEach(c => query.SELECT.columns.push(c))
        }
      } else {
        const target = _targetOfQueryIfNotDraft(query, model)
        if (!target) return

        query.SELECT.columns = getColumns(target, { omitStream: true }).map(col => ({
          ref: [col.name]
        }))
      }
    }

    return
  }

  const target = options.target || _targetOfQueryIfNotDraft(query, model)
  if (!target) return

  // REVISIT: Also support JOINs/SETs here
  query.SELECT.columns = _rewriteAsterisks(query.SELECT, target, true)
}

module.exports = {
  rewriteAsterisks,
  isAsteriskColumn,
  rewriteExpandAsterisk,
  isDuplicate
}
