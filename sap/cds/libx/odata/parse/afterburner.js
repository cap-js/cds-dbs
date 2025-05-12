const cds = require('../../../lib')

const { keysOf, addRefToWhereIfNecessary } = require('../utils')

const { where2obj, resolveFromSelect, targetFromPath } = require('../../_runtime/common/utils/cqn')
const { findCsnTargetFor } = require('../../_runtime/common/utils/csn')
const normalizeTimestamp = require('../../_runtime/common/utils/normalizeTimestamp')
const { rewriteExpandAsterisk } = require('../../_runtime/common/utils/rewriteAsterisks')
const resolveStructured = require('../../_runtime/common/utils/resolveStructured')

function _getDefinition(definition, name, namespace) {
  return (
    definition?.definitions?.[name] ||
    definition?.elements?.[name] ||
    (definition.actions && (definition.actions[name] || definition.actions[name.replace(namespace + '.', '')])) ||
    definition[name]
  )
}

function _resolveAliasesInRef(ref, target) {
  if (ref.length === 1) {
    if (target.keys?.[ref[0]]) return ref

    // resolve multi-part refs for innermost ref in url
    if (target._flattenedKeys === undefined) {
      const flattenedKeys = []
      for (const key in target.keys) {
        if (!target.keys[key].elements) continue
        flattenedKeys.push(...resolveStructured({ element: target.keys[key], structProperties: [] }, false, true))
      }

      target._flattenedKeys = flattenedKeys.length ? flattenedKeys : null
    }

    const fk = target._flattenedKeys?.find(fk => fk.key === ref[0])
    if (fk) return [...fk.resolved]
  }

  for (const seg of ref) {
    target = target.elements[seg.id || seg]
    if (!target) return ref
    if (target.isAssociation) {
      target = target._target
      if (seg.where) _resolveAliasesInXpr(seg.where, target)
    }
  }

  return ref
}

function _resolveAliasesInXpr(xpr, target) {
  if (!target || !xpr) return

  for (const el of xpr) {
    if (el.xpr) _resolveAliasesInXpr(el.xpr, target)
    if (el.args) _resolveAliasesInXpr(el.args, target)
    if (el.ref) el.ref = _resolveAliasesInRef(el.ref, target)
  }
}

function _resolveAliasesInNavigation(cqn, target) {
  if (!target || !cqn) return

  if (cqn.SELECT.from.SELECT) _resolveAliasesInNavigation(cqn.SELECT.from, target)
  if (cqn.SELECT.where) _resolveAliasesInXpr(cqn.SELECT.where, target)
  if (cqn.SELECT.having) _resolveAliasesInXpr(cqn.SELECT.having, target)
}

function _addDefaultParams(ref, view) {
  const params = view.params
  const defaults = params && Object.values(params).filter(p => p.default)

  if (defaults && defaults.length > 0) {
    if (!ref.where) ref.where = []
    for (const def of defaults) {
      if (ref.where.find(e => e.ref && e.ref[0] === def.name)) continue
      if (ref.where.length > 0) ref.where.push('and')
      ref.where.push({ ref: [def.name] }, '=', { val: def.default.val })
    }
  }
}

function getResolvedElement(entity, { ref }) {
  const element = entity.elements[ref[0]]

  if (element && element.isAssociation && ref.length > 1) {
    return getResolvedElement(element._target, { ref: ref.slice(1) })
  }

  if (element && element._isStructured) {
    return getResolvedElement(element, { ref: ref.slice(1) })
  }

  return element
}

const forbidden = { '(': 1, and: 1, or: 1, not: 1, ')': 1 }

function _processWhere(where, entity) {
  for (let i = 0; i < where.length; i++) {
    const ref = where[i]
    const operator = where[i + 1]
    const val = where[i + 2]

    if (ref in forbidden || val in forbidden || ref.func) continue

    if (ref.xpr) {
      _processWhere(ref.xpr, entity)
      continue
    }

    // xpr check needs to be done first, else it could happen, that we ignore xpr OR xpr
    if (operator in forbidden) continue

    let valIndex = -1
    let refIndex = -1
    if (typeof val === 'object') {
      if (val.val !== undefined) valIndex = i + 2
      if (val.ref != undefined) refIndex = i + 2
    }

    if (typeof ref === 'object') {
      if (ref.val !== undefined) valIndex = i
      if (ref.ref != undefined) refIndex = i
    }

    // no need to check ref = ref or val = val, if no ref or no val exists we can't do anything
    if (valIndex === refIndex || valIndex === -1 || refIndex == -1) continue

    const realRef = where[refIndex]
    const element = getResolvedElement(entity, realRef)

    if (element) {
      i += 2
      where[valIndex].val = _convertVal(where[valIndex].val, element)
    }
  }
}

function _convertVal(value, element) {
  if (value === null) return value

  switch (element._type) {
    // numbers
    case 'cds.UInt8':
    case 'cds.Integer':
    case 'cds.Int16':
    case 'cds.Int32':
      if (!/^-?\+?\d+$/.test(value)) {
        const msg = `Element "${element.name}" does not contain a valid Integer`
        throw Object.assign(new Error(msg), { statusCode: 400 })
      }

      // eslint-disable-next-line no-case-declarations
      const n = Number(value)
      if (!Number.isSafeInteger(n)) {
        const msg = `Element "${element.name}" does not contain a valid Integer`
        throw Object.assign(new Error(msg), { statusCode: 400 })
      }

      if (element._type === 'cds.UInt8' && n < 0) {
        const msg = `Element "${element.name}" does not contain a valid positive Integer`
        throw Object.assign(new Error(msg), { statusCode: 400 })
      }

      return n

    case 'cds.Double':
      return parseFloat(value)

    case 'cds.Decimal':
    case 'cds.DecimalFloat':
    case 'cds.Int64':
    case 'cds.Integer64':
      if (typeof value === 'string') return value
      return String(value)

    // others
    case 'cds.String':
    case 'cds.LargeString':
      return String(value)

    case 'cds.Boolean':
      return typeof value === 'string' ? value === 'true' : value

    case 'cds.Timestamp':
      return normalizeTimestamp(value)

    default:
      return value
  }
}

const getStructRef = (element, ref = []) => {
  if (element.kind === 'element') {
    if (element.parent.kind === 'element') {
      getStructRef(element.parent, ref)
      ref.push(element.name)
    }

    if (element.parent.kind === 'entity') {
      ref.push(element.name)
    }
  }

  return ref
}

const getStructTargetName = element => {
  if (element.kind === 'element') {
    if (element.parent.kind === 'element') {
      return getStructTargetName(element.parent)
    }

    if (element.elements && element.parent.kind === 'entity') {
      return element.parent.name
    }
  }
}

const _getDataFromParams = (params, operation) => {
  try {
    return Object.keys(params).reduce((acc, cur) => {
      acc[cur] =
        typeof params[cur] === 'string' && (operation.params[cur]?.elements || operation.params[cur]?.items)
          ? JSON.parse(params[cur])
          : params[cur]
      return acc
    }, {})
  } catch (e) {
    throw Object.assign(e, { statusCode: 400, internal: e.message, message: 'Malformed parameters' })
  }
}

function _handleCollectionBoundActions(current, ref, i, namespace, one) {
  let action

  if (current.actions) {
    const nextRef = (typeof ref[i + 1] === 'string' && ref[i + 1]) || ref[i + 1]?.id
    const shortName = nextRef && nextRef.replace(namespace + '.', '')
    action = shortName && current.actions[shortName]
  }

  let incompleteKeys = !(!!ref[i].where || i === ref.length - 1 || one)
  if (!action) return incompleteKeys

  const onCollection = !!(
    action['@cds.odata.bindingparameter.collection'] ||
    (action?.params && [...action.params].some(p => p?.items?.type === '$self'))
  )

  if (onCollection && one) {
    const msg = `${action.kind.at(0).toUpperCase() + action.kind.slice(1)} "${action.name}" must be called on a collection of ${current.name}`
    throw Object.assign(new Error(msg), { statusCode: 400 })
  }

  if (incompleteKeys) {
    if (!onCollection) {
      const msg = `${action.kind.at(0).toUpperCase() + action.kind.slice(1)} "${action.name}" must be called on a single instance of ${current.name}`
      throw Object.assign(new Error(msg), { statusCode: 400 })
    }

    incompleteKeys = false
  }

  return incompleteKeys
}

function _resolveImplicitFunctionParameters(args) {
  Object.entries(args).forEach(([key, value]) => {
    if (typeof value !== 'boolean' && !!Number(value)) {
      args[key] = Number(value)
    } else if (typeof value === 'string') {
      let result
      result = value.match(/^'(\w*)'$/)?.[1]
      if (result) {
        args[key] = result
      } else {
        result = value.match(/^binary'([^']+)'$/)?.[1]
        if (result) args[key] = Buffer.from(result, 'base64')
      }
    }
  })
}

function _processSegments(from, model, namespace, cqn, protocol) {
  const { ref } = from

  let current = model,
    path,
    keys = null,
    keyCount = 0,
    incompleteKeys = false,
    one,
    target

  for (let i = 0; i < ref.length; i++) {
    const seg = ref[i].id || ref[i]
    const whereRef = ref[i].where
    let params = whereRef && where2obj(whereRef)

    if (incompleteKeys) {
      // > key
      // in case of odata, values for keys that are backlinks are expected to be omitted
      keys = keys || keysOf(current, !!protocol?.match(/odata/i))
      if (!keys.length) throw new cds.error(404, `Invalid resource path "${path}"`)
      let key = keys[keyCount++]
      one = true
      const element = current.elements[key]
      let base = ref[i - keyCount]
      if (!base.id) base = { id: base, where: [] }
      if (base.where.length) base.where.push('and')

      if (ref[i].id) {
        // > fix case key value parsed to collection with filter
        const val = `${ref[i].id}(${Object.keys(params)
          .map(k => `${k}='${params[k]}'`)
          .join(',')})`
        base.where.push({ ref: [key] }, '=', { val })
      } else {
        const val = _convertVal(seg, element)
        base.where.push({ ref: [key] }, '=', { val })
      }

      ref[i] = null
      ref[i - keyCount] = base
      incompleteKeys = keyCount < keys.length
    } else {
      // > entity or property (incl. nested) or navigation or action or function
      keys = null
      keyCount = 0
      one = false

      path = path ? path + `${path.match(/:/) ? '.' : ':'}${seg}` : seg

      // REVISIT: replace use case: <namespace>.<entity>_history is at <namespace>.<entity>.history
      current = _getDefinition(current, seg, namespace) || _getDefinition(current, seg.replace(/_/g, '.'), namespace)

      // REVISIT: 404 or 400?
      if (!current) throw new cds.error(404, `Invalid resource path "${path}"`)

      if (current.params && current.kind === 'entity') {
        // > View with params
        target = current

        if (whereRef) {
          keyCount += addRefToWhereIfNecessary(ref[i].where, current)
          _resolveAliasesInXpr(ref[i].where, current)
          _processWhere(ref[i].where, current)
        } else {
          // parentheses are missing
          const msg = `Invalid call to "${current.name}". Parentheses are missing`
          throw cds.error(msg, { code: '400', statusCode: 400 })
        }

        _addDefaultParams(ref[i], current)
        if ((!params || !Object.keys(params).length) && ref[i].where) params = where2obj(ref[i].where)
        _checkAllKeysProvided(params, current)
        ref[i].args = {}

        const where = ref[i].where
        for (let j = 0; j < where.length; j++) {
          const whereElement = where[j]
          if (whereElement === 'and' || !whereElement.ref) continue
          ref[i].args[whereElement.ref[0]] = where[j + 2]
          j += 2
        }

        ref[i].where = undefined

        if (ref[i + 1] !== 'Set') {
          // /Set is missing
          const msg = `Invalid call to "${current.name}". You need to navigate to Set`
          throw cds.error(msg, { code: '400', statusCode: 400 })
        }

        ref[++i] = null
      } else if (current.kind === 'entity') {
        // > entity
        target = current
        one = !!(ref[i].where || current._isSingleton)

        incompleteKeys = _handleCollectionBoundActions(current, ref, i, namespace, one)

        if (whereRef) {
          keyCount += addRefToWhereIfNecessary(whereRef, current)
          _resolveAliasesInXpr(whereRef, current)

          // in case of Foo(1), params will be {} (before addRefToWhereIfNecessary was called)
          if (!Object.keys(params).length) params = where2obj(ref[i].where)
          _processWhere(ref[i].where, current)
          _checkAllKeysProvided(params, current)

          if (keyCount === 0 && !Object.keys(params).length && whereRef.length === 1) {
            const msg = `Entity "${current.name}" can not be accessed by key.`
            throw Object.assign(new Error(msg), { statusCode: 400 })
          }
        }
      } else if ({ action: 1, function: 1 }[current.kind]) {
        // > action or function
        if (current.kind === 'action' && ref && ref.at(-1)?.where?.length === 0) {
          const msg = `Parentheses are not allowed for action calls.`
          throw Object.assign(new Error(msg), { statusCode: 400 })
        }

        if (i !== ref.length - 1) {
          const msg = `${i ? 'Bound' : 'Unbound'} ${current.kind}s are only supported as the last path segment`
          throw Object.assign(new Error(msg), { statusCode: 400 })
        }

        ref[i] = { operation: current.name }

        if (current.kind === 'function') {
          if (params) ref[i].args = _getDataFromParams(params, current)
          // REVISIT: SELECT.from._params is a temporary hack
          else if (from._params) {
            // only take known params to allow additional instructions like sap-language, etc.
            ref[i].args = current['@open']
              ? Object.assign({}, from._params)
              : Object.keys(from._params).reduce((acc, cur) => {
                  const param = cur.startsWith('@') ? cur.slice(1) : cur
                  if (current.params && param in current.params) acc[param] = from._params[cur]
                  return acc
                }, {})
            ref[i].args = _getDataFromParams(ref[i].args, current) //resolve parameter if Object or Array
            _resolveImplicitFunctionParameters(ref[i].args)
          }
        }
        if (current.returns && current.returns._type) one = true

        if (current.returns) {
          if (current.returns._type) {
            one = true
          }

          target = current.returns.items ?? current.returns
        }
      } else if (current.isAssociation) {
        if (!current._target._service) {
          // not exposed target
          cds.error(`Property '${current.name}' does not exist in type '${target.name.replace(namespace + '.', '')}'`, {
            statusCode: 404
          })
        }

        // > navigation
        one = !!(current.is2one || ref[i].where)
        incompleteKeys = one || i === ref.length - 1 ? false : true
        current = model.definitions[current.target]
        target = current

        incompleteKeys = _handleCollectionBoundActions(current, ref, i, namespace, one)

        if (ref[i].where) {
          keyCount += addRefToWhereIfNecessary(ref[i].where, current, true)
          _resolveAliasesInXpr(ref[i].where, current)
          _processWhere(ref[i].where, current)
        }
      } else if (current.kind === 'element' && current.type !== 'cds.Map' && current.elements && i < ref.length - 1) {
        // > structured
        continue
      } else {
        // > property

        // we do not support navigations from properties yet
        one = true

        // if the last segment is a property, it must be removed and pushed to columns
        target = target || _getDefinition(model, ref[0].id, namespace)

        if (getStructTargetName(current) === target.name) {
          // TODO add simple isStructured check before
          if (!cqn.SELECT.columns) cqn.SELECT.columns = []
          const ref = getStructRef(current)
          cqn.SELECT.columns.push({ ref }) // store struct as ref

          // we need the keys to generate the correct @odata.context
          for (const key in target.keys || {}) {
            if (key !== 'IsActiveEntity' && !cqn.SELECT.columns.some(c => c.ref?.[0] === key))
              cqn.SELECT.columns.push({ ref: [key] })
          }

          Object.defineProperty(cqn, '_propertyAccess', { value: current.name, enumerable: false })

          // if we end up with structured, keep path as is, if we end up with property in structured, cut off property
          if (!current.elements || current.type === 'cds.Map') from.ref.splice(-1)
          break
        } else if (Object.keys(target.elements).includes(current.name)) {
          if (!cqn.SELECT.columns) cqn.SELECT.columns = []
          const propRef = ref.slice(i)
          if (propRef[0].where?.length === 0) {
            const msg = 'Parentheses are not allowed when addressing properties.'
            throw Object.assign(new Error(msg), { statusCode: 400 })
          }
          cqn.SELECT.columns.push({ ref: propRef })

          // we need the keys to generate the correct @odata.context
          for (const key in target.keys || {}) {
            if (key !== 'IsActiveEntity' && !cqn.SELECT.columns.some(c => c.ref?.[0] === key))
              cqn.SELECT.columns.push({ ref: [key] })
          }

          // REVISIT: remove hacky _propertyAccess
          Object.defineProperty(cqn, '_propertyAccess', { value: current.name, enumerable: false })
          from.ref.splice(i)
          break
        }
      }
    }
  }

  if (incompleteKeys) {
    // > last segment not fully qualified
    const msg = `Entity "${current.name}" has ${keysOf(current).length} keys. Only ${keyCount} ${keyCount === 1 ? 'was' : 'were'} provided.`
    throw Object.assign(new Error(msg), { statusCode: 400 })
  }

  // remove all nulled refs
  from.ref = ref.filter(r => r)

  return { one, current, target }
}

const AGGR_DFLT = '@Aggregation.default'
const CSTM_AGGR = '@Aggregation.CustomAggregate'

function _addKeys(columns, target) {
  let hasAggregatedColumn = false,
    hasStarColumn = false

  for (const column of columns) {
    if (column === '*') hasStarColumn = true
    else if (column.func || column.func === null) hasAggregatedColumn = true
    // Add keys to (sub-)expands
    else if (column.expand && column.ref) _addKeys(column.expand, target.elements[column.ref]._target)
  }

  // Don't add keys to queries with calculated properties, especially aggregations
  // REVISIT Clarify if keys should be added for queries containing non-aggregating func columns
  if (hasAggregatedColumn) return

  if (hasStarColumn) return

  const keys = keysOf(target)

  for (const key of keys) {
    if (!columns.some(c => (typeof c === 'string' ? c === key : c.ref?.[0] === key))) columns.push({ ref: [key] })
  }
}

/**
 * Recursively, for each depth, remove all other select columns if a select star is present
 * (including duplicates) and remove duplicate expand stars.
 *
 * @param {*} columns CQN `SELECT` columns array.
 */
function _removeUnneededColumnsIfHasAsterisk(columns) {
  // We need to know if column contains a select * before we can remove other selected columns below
  const hasSelectStar = columns.some(column => column === '*')
  let hasExpandStar = false

  columns.forEach((column, i) => {
    // Remove other select columns if we have a select star
    if (hasSelectStar && column.ref && !column.expand) columns.splice(i, 1)
    // Remove duplicate expand stars
    if (!column.ref && column.expand?.[0] === '*') {
      if (hasExpandStar) columns.splice(i, 1)
      hasExpandStar = true
    }
    // Recursively remove unneeded columns in expand
    if (column.expand) _removeUnneededColumnsIfHasAsterisk(column.expand)
  })
}

const _structProperty = (ref, target) => {
  if (target.elements && target.kind === 'element') {
    return _structProperty(ref.slice(1), target.elements[ref[0]])
  }

  return target
}

function _processColumns(cqn, target, protocol) {
  if (cqn.SELECT.from.SELECT) _processColumns(cqn.SELECT.from, target)

  let columns = cqn.SELECT.columns

  if (columns && !columns.length && cqn.SELECT.groupBy) {
    cds.error('Explicit select must include at least one column available in the result set of groupby!', {
      code: '400',
      statusCode: 400
    })
  }

  if (columns && !cqn.SELECT.groupBy) {
    let entity
    if (target.kind === 'entity') entity = target
    else if (target.kind === 'action' && target.returns?.kind === 'entity') entity = target.returns
    if (!entity) return

    _removeUnneededColumnsIfHasAsterisk(columns)
    rewriteExpandAsterisk(columns, entity)

    // in case of odata, add all missing key fields (i.e., not in $select)
    if (protocol?.match(/odata/i)) _addKeys(columns, entity)
  }

  if (!Array.isArray(columns)) return

  let aggrProp, aggrElem, defaultAggregation
  for (let i = 0; i < columns.length; i++) {
    if (
      columns[i].func === null &&
      columns[i].args &&
      columns[i].args.length &&
      columns[i].args[0].ref &&
      columns[i].args[0].ref.length
    ) {
      // REVISIT: also support aggregate(Sales/Amount)?
      aggrProp = columns[i].args[0].ref[0]
      aggrElem = target.elements[aggrProp]
      if (aggrElem && target[`${CSTM_AGGR}#${aggrProp}`] && aggrElem[AGGR_DFLT] && aggrElem[AGGR_DFLT]['#']) {
        defaultAggregation = aggrElem[AGGR_DFLT]['#'].toLowerCase()
        if (defaultAggregation === 'count_distinct') defaultAggregation = 'countdistinct'
        columns[i].func = defaultAggregation
        columns[i].as = columns[i].as || aggrProp
      } else {
        throw new Error(`Default aggregation for property "${aggrProp}" not found`)
      }
    }
  }
}

const _checkAllKeysProvided = (params, entity) => {
  let keysOfEntity
  const isView = !!entity.params

  if (isView) {
    // view with params
    if (params === undefined) {
      throw cds.error(`Invalid call to "${entity.name}". You need to navigate to Set`, { code: '400', statusCode: 400 })
    }

    keysOfEntity = Object.keys(entity.params)
  } else {
    keysOfEntity = keysOf(entity)
  }

  if (!keysOfEntity) return
  for (const keyOfEntity of keysOfEntity) {
    if (!(keyOfEntity in params)) {
      if (isView && entity.params[keyOfEntity].default) {
        // will be added later?
        continue
      }

      // prettier-ignore
      const msg = `${isView ? 'Parameter' : 'Key'} "${keyOfEntity}" is missing for ${isView ? 'view' : 'entity'} "${entity.name}"`
      throw Object.assign(new Error(msg), { statusCode: 400 })
    }
  }
}

const _doesNotExistError = (isExpand, refName, targetName, targetKind) => {
  const msg = isExpand
    ? `Navigation property "${refName}" is not defined in "${targetName}"`
    : `Property "${refName}" does not exist in ${targetKind === 'type' ? 'type ' : ''}"${targetName}"`
  throw Object.assign(new Error(msg), { statusCode: 400 })
}

function _validateXpr(xpr, target, isOne, model, aliases = []) {
  if (!xpr) return []

  const ignoredColumns = Object.values(target?.elements ?? {})
    .filter(element => element['@cds.api.ignore'] && !element.isAssociation)
    .map(element => element.name)
  const _aliases = []

  for (const x of xpr) {
    if (x.as) _aliases.push(x.as)

    if (x.xpr) {
      _validateXpr(x.xpr, target, isOne, model)
      continue
    }

    if (x.ref) {
      const refName = x.ref[0].id ?? x.ref[0]

      if (x.ref[0].where) {
        const element = target.elements[refName]
        if (!element) {
          _doesNotExistError(true, refName, target.name)
        }
        _validateXpr(x.ref[0].where, element._target ?? element.items, isOne, model)
      }

      if (!target?.elements) {
        _doesNotExistError(false, refName, target.name, target.kind)
      }

      if (ignoredColumns.includes(refName) || (!target.elements[refName] && !aliases.includes(refName))) {
        _doesNotExistError(x.expand, refName, target.name)
      } else if (x.ref.length > 1) {
        const element = target.elements[refName]
        if (element.isAssociation) {
          // navigation
          _validateXpr([{ ref: x.ref.slice(1) }], element._target, false, model)
        } else if (element.kind === 'element') {
          // structured
          _validateXpr([{ ref: x.ref.slice(1) }], element, isOne, model)
        } else {
          throw new Error('not yet validated')
        }
      }

      if (x.expand) {
        let element = target.elements[refName]
        if (element.kind === 'element' && element.elements) {
          // structured
          _validateXpr([{ ref: x.ref.slice(1) }], element, isOne, model)
          element = _structProperty(x.ref.slice(1), element)
        }
        if (!element._target) {
          _doesNotExistError(true, refName, target.name)
        }
        _validateXpr(x.expand, element._target, false, model)
        if (x.where) {
          _validateXpr(x.where, element._target, false, model)
        }
        if (x.orderBy) {
          _validateXpr(x.orderBy, element._target, false, model)
        }
      }
    }

    if (x.func) {
      _validateXpr(x.args, target, isOne, model)
      continue
    }

    if (x.SELECT) {
      const { target } = targetFromPath(x.SELECT.from, model)
      _validateQuery(x.SELECT, target, x.SELECT.one, model)
    }
  }

  return _aliases
}

function _validateQuery(SELECT, target, isOne, model) {
  const aliases = []

  if (SELECT.from.SELECT) {
    const { target } = targetFromPath(SELECT.from.SELECT.from, model)
    const subselectAliases = _validateQuery(SELECT.from.SELECT, target, SELECT.from.SELECT.one, model)
    aliases.push(...subselectAliases)
  }

  const columnAliases = _validateXpr(SELECT.columns, target, isOne, model)
  aliases.push(...columnAliases)

  _validateXpr(SELECT.orderBy, target, isOne, model, aliases)
  _validateXpr(SELECT.where, target, isOne, model, aliases)
  _validateXpr(SELECT.groupBy, target, isOne, model, aliases)
  _validateXpr(SELECT.having, target, isOne, model, aliases)

  return aliases
}

module.exports = (cqn, model, namespace, protocol) => {
  if (!model) return cqn

  const from = resolveFromSelect(cqn)
  const { ref } = from

  let edmName = ref[0].id || ref[0]
  // REVISIT: shouldn't be necessary
  if (edmName.split('.').length > 1)
    //required for concat query, where the root is already identified with the first query and subsequent queries already have correct root
    edmName = edmName.split('.')[edmName.split('.').length - 1]

  // Make first path segment fully qualified
  const root = findCsnTargetFor(edmName, model, namespace)

  if (!root) {
    //404 else we would expose knowledge to potential attackers
    throw new cds.error(404, `Invalid resource path "${namespace}.${ref[0].id || ref[0]}"`)
  }
  if (cds.env.effective.odata.containment && model.definitions[namespace]._containedEntities.has(root.name)) {
    throw new cds.error(
      404,
      `Invalid resource path "${namespace}.${ref[0].id || ref[0]}"! It is not an entity set nor a singleton.`
    )
  }
  if (ref[0].id) ref[0].id = root.name
  else ref[0] = root.name

  // key vs. path segments (/Books/1/author/books/2/...) and more
  const { one, current, target } = _processSegments(from, model, namespace, cqn, protocol)

  if (cds.env.effective.odata.proxies && cds.env.effective.odata.xrefs && target) {
    if (!target._service) {
      // proxy navigation, add keys as columns only
      const columns = []
      for (const key in target.keys) {
        if (target.keys[key].isAssociation) continue
        columns.push({ ref: [key] })
      }

      cqn.SELECT.columns = columns
    }
  }

  if (cqn.SELECT.where) {
    _processWhere(cqn.SELECT.where, target)
  }

  // one?
  if (one) cqn.SELECT.one = true

  // hierarchy requests, quick check to avoid unnecessary traversing
  // REVISIT: Should be done via annotation on backlink, would make lookup easier
  if (target?.elements?.LimitedDescendantCount) {
    let uplinkName
    for (const key in target) {
      if (key.match(/@Aggregation\.RecursiveHierarchy\s*#.*\.ParentNavigationProperty/)) {
        // Qualifiers are bad for lookups
        uplinkName = target[key]['=']
        break
      }
    }
    if (uplinkName) {
      let r = cqn.SELECT.recurse
      if (r) r.ref[0] = uplinkName
    }
  }

  // REVISIT: better
  // Set target (csn definition) for later retrieval
  if (protocol === 'rest')
    cqn.__target = current.parent?.kind === 'entity' ? `${current.parent.name}:$:${current.name}` : current.name

  // target <=> endpoint entity, all navigation refs must be resolvable accordingly
  if (cds.env.effective.odata.structs) _resolveAliasesInNavigation(cqn, target)

  // Add default aggregation function (and alias)
  _processColumns(cqn, current, protocol)

  if (target) {
    // validate whether only known properties are used in query options
    _validateQuery(cqn.SELECT, target, one, model)
  }

  return cqn
}
