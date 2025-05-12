const cds = require('../../../../lib')
let LOG = cds.log('app')

const { rewriteAsterisks } = require('../../common/utils/rewriteAsterisks')

const _setInverseTransition = (mapping, ref, mapped) => {
  const existing = mapping.get(ref)
  if (!existing) mapping.set(ref, mapped)
  else {
    const alternatives = existing.alternatives || []
    alternatives.push(mapped)
    existing.alternatives = alternatives
    mapping.set(ref, existing)
  }
}

const _inverseTransition = transition => {
  const inverseTransition = {}
  inverseTransition.target = transition.queryTarget
  inverseTransition.queryTarget = transition.target
  inverseTransition.mapping = new Map()

  if (!transition.mapping.size) inverseTransition.mapping = new Map()

  for (const [key, value] of transition.mapping) {
    const mapped = {}
    if (value.ref) {
      if (value.transition) mapped.transition = _inverseTransition(value.transition)

      const ref0 = value.ref[0]
      if (value.ref.length > 1) {
        // ignore flattened columns like author.name
        if (transition.target.elements[ref0]?.isAssociation) continue

        const nested = inverseTransition.mapping.get(ref0) || {}
        if (!nested.transition) nested.transition = { mapping: new Map() }
        let current = nested.transition.mapping

        for (let i = 1; i < value.ref.length; i++) {
          const last = i === value.ref.length - 1
          const obj = last ? { ref: [key] } : { transition: { mapping: new Map() } }
          _setInverseTransition(current, value.ref[i], obj)
          if (!last) current = current.get(value.ref[i]).transition.mapping
        }
        inverseTransition.mapping.set(ref0, nested)
      } else {
        mapped.ref = [key]
        _setInverseTransition(inverseTransition.mapping, ref0, mapped)
      }
    }
  }

  return inverseTransition
}

const revertData = (data, transition, service, options) => {
  if (!transition || !transition.mapping.size) return data
  const inverseTransition = _inverseTransition(transition)
  return Array.isArray(data)
    ? data.map(entry => _newData(entry, inverseTransition, true, service, options))
    : _newData(data, inverseTransition, true, service, options)
}

const _newSubData = (val, key, transition, el, inverse, service, options) => {
  if ((!Array.isArray(val) && typeof val === 'object') || (Array.isArray(val) && val.length !== 0)) {
    let mapped = transition.mapping.get(key)
    if (!mapped) {
      mapped = {}
      transition.mapping.set(key, mapped)
    }

    if (!mapped.transition) {
      const subTransition = getTransition(el._target, service, undefined, options?.event, { abort: options?.abort })
      mapped.transition = inverse ? _inverseTransition(subTransition) : subTransition
    }

    if (Array.isArray(val)) {
      return val.map(singleVal => _newData(singleVal, mapped.transition, inverse, service, options))
    } else {
      return _newData(val, mapped.transition, inverse, service, options)
    }
  }
  return val //Case of empty array
}

const _newNestedData = (queryTarget, newData, ref, value) => {
  const parent = queryTarget.query && queryTarget.query._target
  let currentEntity = parent
  let currentData = newData

  for (let i = 0; i < ref.length; i++) {
    currentEntity = currentEntity.elements[ref[i]]
    if (!currentEntity || currentEntity.isAssociation) {
      // > don't follow associations
      break
    } else {
      // > intermediate or final struct element
      if (i === ref.length - 1) currentData[ref[i]] = value
      else currentData = currentData[ref[i]] = currentData[ref[i]] || {}
    }
  }
}

const _newData = (data, transition, inverse, service, options) => {
  if (data === null) return null

  // no transition -> nothing to do
  if (transition.target && transition.target.name === transition.queryTarget.name) return data

  const newData = {}
  const queryTarget = transition.queryTarget

  for (const key in data) {
    const el = queryTarget && queryTarget?.elements[key]
    const isAssoc = el && el.isAssociation

    const mapped = transition.mapping.get(key)
    if (!mapped) {
      //In this condition the data is needed
      if (
        ((typeof data[key] === 'object' && data[key] !== null) || transition.target.elements[key]) &&
        newData[key] === undefined
      )
        newData[key] = data[key]
      continue
    }
    let value = data[key]
    if (isAssoc) {
      if (value || (value === null && service.name === 'db')) {
        value = _newSubData(value, key, transition, el, inverse, service, options)
      }
    }

    if (!isAssoc && mapped.transition) {
      value = _newSubData(value, key, transition, el, inverse, undefined, options)
      Object.assign(newData, value)
    }

    if (mapped.ref) {
      const { ref } = mapped
      if (ref.length === 1) {
        newData[ref[0]] = value
        if (mapped.alternatives) mapped.alternatives.forEach(({ ref }) => (newData[ref[0]] = value))
      } else {
        _newNestedData(queryTarget, newData, ref, value)
      }
    }
  }

  return newData
}

const _newColumns = (columns = [], transition, service, withAlias = false, options) => {
  const newColumns = []

  columns.forEach(column => {
    let newColumn
    if (column.func) {
      newColumn = { ...column }
      newColumn.args = _newColumns(column.args, transition, service, withAlias, options)
      newColumns.push(newColumn)
      return newColumns
    }

    const mapped = column.ref && transition.mapping.get(column.ref[0])

    if (mapped && mapped.ref) {
      newColumn = { ...column }

      if (withAlias) {
        newColumn.as = column.ref[column.ref.length - 1]
      }

      newColumn.ref = [...mapped.ref, ...column.ref.slice(mapped.ref.length)]
    } else if (mapped && mapped.val) {
      newColumn = {}
      newColumn.as = column.ref[0]
      newColumn.val = mapped.val
    } else if (column.ref && !transition.target.elements[column.ref[0]]) {
      return // ignore columns which are not part of the entity
    } else {
      newColumn = column
    }

    // ensure that renaming of a redirected assoc are also respected
    if (mapped && column.expand) {
      // column.ref might be structured elements
      let def
      column.ref.forEach((ref, i) => {
        if (i === 0) {
          def = transition.queryTarget.elements[ref]
        } else {
          def = def.elements[ref]
        }
      })

      // reuse _newColumns with new transition
      const expandTarget = def._target
      const subtransition = getTransition(expandTarget, service, undefined, options.event, { abort: options.abort })
      mapped.transition = subtransition
      newColumn.expand = _newColumns(column.expand, subtransition, service, withAlias, options)
    }

    newColumns.push(newColumn)
  })

  return newColumns
}

const _resolveColumn = (column, transition) => {
  const mapped = transition.mapping.get(column)
  if (mapped && mapped.ref) {
    return mapped.ref[0]
  } else if (!mapped) {
    return column
  }
}

const _newInsertColumns = (columns = [], transition) => {
  const newColumns = []

  columns.forEach(column => {
    const resolvedColumn = _resolveColumn(column, transition)
    if (resolvedColumn) {
      newColumns.push(resolvedColumn)
    }
  })

  return newColumns
}

// REVISIT: this hard-coding on ref indexes does not support path expressions
const _newWhereRef = (newWhereElement, transition, tableName, options) => {
  let newRef = Array.isArray(newWhereElement.ref) ? [...newWhereElement.ref] : [newWhereElement.ref]

  if (newRef.length === 1 && typeof newRef[0] === 'string') {
    const mapped = transition.mapping.get(newRef[0])
    if (mapped) {
      newRef[0] = mapped.ref.join('_')
    }
  } else {
    // REVISIT: aliases in sub selects not yet supported
    if (newRef[0] !== tableName) options.previousEntity = transition.queryTarget
    const nestedTransitions = _entityTransitionsForTarget(
      newWhereElement,
      options.model,
      options.service,
      options
    ).filter(nT => nT?.target)
    newRef = _rewriteQueryPath(newWhereElement, [transition, ...nestedTransitions], options)
  }
  newWhereElement.ref = newRef
}

const _newEntries = (entries = [], transition, service, options) =>
  entries.map(entry => _newData(entry, transition, false, service, options))

const _newWhere = (where = [], transition, tableName, alias, isSubselect = false, options) => {
  const newWhere = where.map(whereElement => {
    if (whereElement.xpr) {
      return { xpr: _newWhere(whereElement.xpr, transition, tableName, alias, isSubselect, options) }
    }

    if (whereElement.list) {
      return { list: _newWhere(whereElement.list, transition, tableName, alias, isSubselect, options) }
    }

    const newWhereElement = { ...whereElement }
    if (!whereElement.ref && !whereElement.SELECT && !whereElement.func) return whereElement

    if (whereElement.SELECT && whereElement.SELECT.where && !whereElement._doNotResolve) {
      newWhereElement.SELECT.where = _newWhere(whereElement.SELECT.where, transition, tableName, alias, true, options)
      return newWhereElement
    }

    if (newWhereElement.ref) {
      options.alias = alias
      _newWhereRef(newWhereElement, transition, tableName, options)
      return newWhereElement
    }

    if (newWhereElement.func) {
      newWhereElement.args = _newWhere(newWhereElement.args, transition, tableName, alias, undefined, options)
      return newWhereElement
    }

    return whereElement
  })

  return newWhere
}

const _initialColumns = transition => {
  const columns = []

  for (const [transitionEl] of transition.mapping) {
    // REVISIT: structured elements
    if (!transition.queryTarget.elements[transitionEl] || transition.queryTarget.elements[transitionEl].isAssociation) {
      continue
    }

    columns.push({ ref: [transitionEl] })
  }

  return columns
}

const _rewriteQueryPath = (path, transitions, options) => {
  const alias = options?.alias
  let hasAlias = false
  let target = options?.previousEntity
  return path.ref.map((f, i) => {
    if (f === alias) {
      hasAlias = true
      return alias
    }
    if (options?.previousEntity && !hasAlias) i++
    if (i === 0) {
      target = transitions[0].target

      if (typeof f === 'string') {
        return target.name
      }

      if (f.id) {
        return {
          id: target.name,
          where: _newWhere(f.where, transitions[0], f.id, undefined, undefined, options)
        }
      }
    } else {
      // REVISIT: alias in sub selects not yet supported
      if (transitions[i - 1]) {
        if (typeof f === 'string') {
          const transitionMapping = transitions[i - 1].mapping.get(f)
          return (transitionMapping && transitionMapping.ref && transitionMapping.ref[0]) || f
        }

        if (f.id) {
          const transitionMapping = transitions[i - 1].mapping.get(f.id)
          return {
            id: (transitionMapping && transitionMapping.ref && transitionMapping.ref[0]) || f.id,
            where: _newWhere(f.where, transitions[i], f.id, undefined, undefined, options)
          }
        }
      }

      return f
    }
  })
}

const _newUpdate = (query, transitions, options) => {
  const targetTransition = transitions.at(-1)
  const targetName = targetTransition.target.name
  const newUpdate = Object.create(query.UPDATE)

  newUpdate.entity = newUpdate.entity.ref
    ? {
        ...newUpdate.entity,
        ref: _rewriteQueryPath(query.UPDATE.entity, transitions, options)
      }
    : targetName
  if (newUpdate.data) newUpdate.data = _newData(newUpdate.data, targetTransition, false, options.service, options)
  if (newUpdate.with) newUpdate.with = _newData(newUpdate.with, targetTransition, false, options.service, options)
  if (newUpdate.where) {
    newUpdate.where = _newWhere(
      newUpdate.where,
      targetTransition,
      query._target.name,
      query.UPDATE.entity.as,
      undefined,
      options
    )
  }

  return newUpdate
}

const _newSelect = (query, transitions, options) => {
  const service = options.service
  const targetTransition = transitions.at(-1)
  const newSelect = Object.create(query.SELECT)
  newSelect.from = {
    ...newSelect.from,
    ref: _rewriteQueryPath(query.SELECT.from, transitions, options)
  }

  if (!newSelect.columns && targetTransition.mapping.size) newSelect.columns = _initialColumns(targetTransition)
  if (newSelect.columns) {
    rewriteAsterisks({ SELECT: query.SELECT }, service.model, {
      _4db: service.isDatabaseService,
      target: targetTransition.queryTarget
    })
    newSelect.columns = _newColumns(
      newSelect.columns,
      targetTransition,
      service,
      service.kind !== 'app-service',
      options
    )
  }

  if (newSelect.having)
    newSelect.having = _newColumns(newSelect.having, targetTransition, undefined, undefined, options)
  if (newSelect.groupBy)
    newSelect.groupBy = _newColumns(newSelect.groupBy, targetTransition, undefined, undefined, options)
  if (newSelect.orderBy)
    newSelect.orderBy = _newColumns(newSelect.orderBy, targetTransition, undefined, undefined, options)
  if (newSelect.where) {
    newSelect.where = _newWhere(
      newSelect.where,
      targetTransition,
      query.SELECT.from && query.SELECT.from.ref[0],
      query.SELECT.from && query.SELECT.from.as,
      undefined,
      options
    )
  }

  return newSelect
}

const _newInsert = (query, transitions, options) => {
  const targetTransition = transitions.at(-1)
  const targetName = targetTransition.target.name
  const newInsert = Object.create(query.INSERT)

  if (newInsert.into) {
    const refObject = newInsert.into.ref ? newInsert.into : { ref: [query.INSERT.into] }
    newInsert.into = {
      ...refObject,
      ref: _rewriteQueryPath(refObject, transitions, options)
    }
    if (!query.INSERT.into.ref) newInsert.into = newInsert.into.ref[0] // leave as string
  } else {
    newInsert.into = targetName
  }

  if (newInsert.columns) newInsert.columns = _newInsertColumns(newInsert.columns, targetTransition)
  if (newInsert.entries) newInsert.entries = _newEntries(newInsert.entries, targetTransition, options.service, options)

  return newInsert
}

const _newUpsert = (query, transitions, options) => {
  const targetTransition = transitions.at(-1)
  const targetName = targetTransition.target.name
  const newUpsert = Object.create(query.UPSERT)

  newUpsert.into = newUpsert.into.ref
    ? {
        ...newUpsert.into,
        ref: _rewriteQueryPath(query.UPSERT.into, transitions, options)
      }
    : targetName
  if (newUpsert.columns) newUpsert.columns = _newInsertColumns(newUpsert.columns, targetTransition)
  if (newUpsert.entries) newUpsert.entries = _newEntries(newUpsert.entries, targetTransition, options.service, options)

  return newUpsert
}

const _newDelete = (query, transitions, options) => {
  const targetTransition = transitions[transitions.length - 1]
  const targetName = targetTransition.target.name
  const newDelete = Object.create(query.DELETE)

  newDelete.from = newDelete.from.ref
    ? {
        ...newDelete.from,
        ref: _rewriteQueryPath(query.DELETE.from, transitions, options)
      }
    : targetName

  if (newDelete.where) {
    const from = typeof query.DELETE.from === 'string' ? query.DELETE.from : query.DELETE.from.ref[0]
    newDelete.where = _newWhere(newDelete.where, targetTransition, from, query.DELETE.from.as, undefined, options)
  }

  return newDelete
}

const _findRenamed = (cqnColumns, column) =>
  cqnColumns.find(
    cqnColumn =>
      cqnColumn.as &&
      (column?.ref?.at(-1) === cqnColumn.as ||
        (column.as === cqnColumn.as && Object.prototype.hasOwnProperty.call(cqnColumn, 'val')))
  )

const _queryColumns = (target, columns = [], isAborted) => {
  if (!(target && target.query && target.query.SELECT)) return columns

  const cqnColumns = target.query.SELECT.columns || []
  const from = target.query.SELECT.from
  const isTargetAliased = from.as && cqnColumns.some(c => c.ref?.[0] === from.as)

  if (!columns.length) columns = Object.keys(target.elements).map(e => ({ ref: [e], as: e }))

  const queryColumns = columns.reduce((res, column) => {
    const renamed = _findRenamed(cqnColumns, column)

    if (renamed) {
      if (renamed.val) return res.concat({ as: renamed.as, val: renamed.val })

      // There could be some `where` clause inside `ref` which we don't support yet
      if (!renamed.ref || renamed.ref.some(e => typeof e !== 'string') || renamed.xpr) return res
      if (isTargetAliased && renamed.ref[0] === from.as) renamed.ref.shift()

      column.ref = isAborted ? [renamed.as] : [...renamed.ref]
    }

    res.push(column)
    return _appendForeignKeys(res, target, columns, column)
  }, [])

  return queryColumns
}

const _mappedValue = (col, alias) => {
  const key = col.as || col.ref[0]

  if (col.ref) {
    const columnRef = col.ref.filter(columnName => columnName !== alias)
    return [key, { ref: columnRef }]
  }

  return [key, { val: col.val }]
}

const getDBTable = target => cds.ql.resolve.table(target)

const _appendForeignKeys = (newColumns, target, columns, { as, ref = [] }) => {
  const el = target.elements[as] || target.query._target.elements[ref.at(-1)]

  if (el && el.isAssociation && el.keys) {
    for (const key of el.keys) {
      // .as and .ref has a different meaning here
      // .as means the original property name, if the foreign key is renamed
      const keyName = key.as || key.ref[0]
      const keyAlias = key.ref[0]
      const found = columns.find(col => col.as === `${as}_${keyAlias}`)

      if (found) {
        found.ref = [`${ref.join('_')}_${keyName}`]
      } else {
        newColumns.push({
          ref: [`${ref.join('_')}_${keyName}`],
          as: `${as}_${keyAlias}`
        })
      }
    }
  }

  return newColumns
}

const _checkForForbiddenViews = (queryTarget, event) => {
  const select = queryTarget && queryTarget.query && queryTarget.query.SELECT

  if (select) {
    if (!select.from || select.from.join || select.from.length > 1) {
      throw cds.error(501, `${event || 'INSERT|UPDATE|DELETE'} on views with join and/or union is not supported`, {
        target: queryTarget.name
      })
    }

    if (select.where) {
      LOG._debug &&
        LOG.debug(`Ignoring where clause during ${event || 'INSERT|UPDATE|DELETE'} on view "${queryTarget.name}".`)
    }
  }
}

const _getTransitionData = (target, columns, service, options) => {
  let { abort, skipForbiddenViewCheck, event } = options
  // REVISIT revert after cds-dbs pr
  if (!abort) abort = cds.ql.resolve.abortDB
  // REVISIT: Find less param polluting way to skip forbidden view check for reads
  if (!skipForbiddenViewCheck) _checkForForbiddenViews(target, event)
  const isAborted = abort(target)
  columns = _queryColumns(target, columns, isAborted)

  if (isAborted) return { target, transitionColumns: columns }

  if (!target.query?._target) {
    // for cross service in x4 and DRAFT.DraftAdministrativeData we cannot abort properly
    // therefore return last resolved target
    if (cds.env.features.restrict_service_scope === false) return { target, transitionColumns: columns }
    return undefined
  } else {
    const newTarget = target.query._target
    // continue projection resolving for projections
    return _getTransitionData(newTarget, columns, service, options)
  }
}

/**
 * If no entity definition is found, no transition is done.
 *
 * @param queryTarget
 * @param service
 * @param skipForbiddenViewCheck
 */
const getTransition = (queryTarget, service, skipForbiddenViewCheck, event, options) => {
  // Never resolve unknown targets (e.g. for drafts)
  if (!queryTarget) {
    return { target: queryTarget, queryTarget, mapping: new Map() }
  }

  const transitionData = _getTransitionData(queryTarget, [], service, {
    skipForbiddenViewCheck,
    event,
    abort: options?.abort
  })
  if (!transitionData) return undefined
  const { target: _target, transitionColumns } = transitionData
  const query = queryTarget.query
  const alias = query && query.SELECT && query.SELECT.from && query.SELECT.from.as
  const mappedColumns = transitionColumns.map(column => _mappedValue(column, alias))
  const mapping = new Map(mappedColumns)
  return { target: _target, queryTarget, mapping }
}

const _entityTransitionsForTarget = (from, model, service, options) => {
  let previousEntity = options.previousEntity

  if (typeof from === 'string') {
    return (
      model.definitions[from] && [
        getTransition(model.definitions[from], service, undefined, options.event, { abort: options.abort })
      ]
    )
  }

  return from.ref.map((f, i) => {
    const element = f.id || f
    if (element === options.alias) return

    if (i === 0 && !previousEntity) {
      const entity = model.definitions[element]
      if (entity) {
        previousEntity = entity
        return getTransition(entity, service, undefined, options.event, { abort: options.abort })
      }
    }

    if (previousEntity) {
      const entity = previousEntity.elements[element] && previousEntity.elements[element]._target
      if (entity) {
        // > assoc
        previousEntity = entity
        return getTransition(entity, service, undefined, options.event, { abort: options.abort })
      }

      // > struct
      previousEntity = previousEntity.elements[element]
      return {
        target: previousEntity,
        queryTarget: previousEntity,
        mapping: new Map()
      }
    }
  })
}

const resolveView = (query, model, service, abort) => {
  // swap logger
  const _LOG = LOG
  LOG = cds.log(service.kind) // REVISIT: Avoid obtaining loggers per request!

  // If the query is a projection, one must follow it
  // to let the underlying service know its true entity.
  // prettier-ignore
  const kind = query.kind || (
    query.SELECT ? 'SELECT' :
    query.INSERT ? 'INSERT' :
    query.UPSERT ? 'UPSERT' :
    query.UPDATE ? 'UPDATE' :
    query.DELETE ? 'DELETE' :
    undefined
  )

  const [_prop, _func] = {
    SELECT: ['from', _newSelect],
    INSERT: ['into', _newInsert],
    UPSERT: ['into', _newUpsert],
    UPDATE: ['entity', _newUpdate],
    DELETE: ['from', _newDelete]
  }[kind]

  const options = { abort, event: kind, service, model }
  const transitions = _entityTransitionsForTarget(query[kind][_prop], model, service, options)
  if (!service.isDatabaseService && cds.env.features.restrict_service_scope !== false && transitions.some(t => !t))
    return

  const newQuery = Object.create(query)
  newQuery[kind] = (transitions?.[0] && _func(newQuery, transitions, options)) || { ...query[kind] }

  const target = transitions?.at(-1)?.target || query._target //> IMPORtANT!
  Object.defineProperties(newQuery, {
    _target: { value: target, enumerable: false, writable: true },
    _transitions: { value: transitions }
  })

  // restore logger
  LOG = _LOG // REVISIT: Don't do such global variables juggling !!!

  return newQuery
}

module.exports = {
  getDBTable,
  resolveView,
  getTransition,
  revertData
}
