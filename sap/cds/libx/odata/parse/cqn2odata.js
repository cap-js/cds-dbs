const cds = require('../../../')

const { formatVal } = require('../utils')

const OPERATORS = {
  '=': 'eq',
  '!=': 'ne',
  '<>': 'ne',
  '<': 'lt',
  '>': 'gt',
  '<=': 'le',
  '>=': 'ge'
}

const LAMBDA_VARIABLE = 'd'

const needArrayProps = Object.fromEntries(
  ['where', 'search', 'xpr', 'columns', 'orderBy', 'ref', 'args'].map(propName => [
    propName,
    cur => Array.isArray(cur) && (cur.length !== 0 || propName === 'expand' || propName === 'ref')
  ])
)

const validators = {
  SELECT: SELECT => SELECT && SELECT.from,
  INSERT: INSERT => {
    if (INSERT.rows || INSERT.values) {
      throw new Error('Feature not supported: INSERT statement with .values or .rows')
    }
    return INSERT && INSERT.into
  },
  UPDATE: UPDATE => UPDATE && UPDATE.entity,
  DELETE: DELETE => DELETE && DELETE.from,
  from: any => (typeof any === 'string' && any) || any.ref,
  into: any => (typeof any === 'string' && any) || any.ref,
  entity: any => (typeof any === 'string' && any) || any.ref,
  id: id => typeof id === 'string',
  val: val => typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null,
  count: count => typeof count === 'boolean',
  limit: limit => limit && (limit.rows || limit.offset),
  rows: rows => rows && rows.val && typeof rows.val === 'number',
  offset: offset => offset && offset.val && typeof offset.val === 'number',
  sort: sort => sort === 'asc' || sort === 'desc',
  func: func => typeof func === 'string',
  one: count => typeof count === 'boolean',
  as: any => typeof any === 'string',
  expand: any => any === '*' || Array.isArray(any),
  ...needArrayProps
}

// strip service & namespace prefixes
const _entityUrl = path => path.match(/^(\w*\.)*(.*)$/)[2]

function getProp(obj, propName) {
  const validate = validators[propName]
  const isValid = validate && validate(obj[propName])
  if (isValid) {
    return obj[propName]
  }

  throw new Error(`Invalid property '${propName}' provided`)
}

function hasValidProps(obj, ...names) {
  for (const propName of names) {
    const validate = validators[propName]
    const isValid = validate && validate(obj[propName])

    if (!isValid) {
      return false
    }
  }

  return true
}

function _args(args, func, navPrefix) {
  const res = []

  for (const cur of args) {
    if (typeof cur === 'string') {
      res.push(cur)
      continue
    }

    if (hasValidProps(cur, 'func', 'args')) {
      res.push(`${cur.func}(${_args(cur.args, cur.func, navPrefix)})`)
    } else if (hasValidProps(cur, 'ref')) {
      res.push(_format(cur, null, null, null, null, null, navPrefix))
    } else if (hasValidProps(cur, 'val')) {
      res.push(_format(cur, null, null, null, null, func))
    }
  }

  return res.join(',')
}

const _in = (column, /* in */ collection, target, kind, isLambda, navPrefix) => {
  const ref = _format(column, null, target, kind, isLambda, null, navPrefix)
  // { list: [ { val: 1}, { val: 2}, { val: 3} ] }
  const values = collection.list
  if (values && values.length) {
    // REVISIT: what about OData `in` operator?
    const expressions = values.map(
      value => `${ref}%20eq%20${_format(value, ref, target, kind, isLambda, null, navPrefix)}`
    )
    return expressions.join('%20or%20')
  }
}

const _odataV2Func = (func, args, navPrefix) => {
  switch (func) {
    case 'contains':
      // this doesn't support the contains signature with two collections as args, introduced in odata v4.01
      return `substringof(${_args([args[1], args[0]], null, navPrefix)})`
    default:
      return `${func}(${_args(args, func, navPrefix)})`
  }
}

const _format = (cur, elementName, target, kind, isLambda, func, navPrefix = []) => {
  if (typeof cur !== 'object') return encodeURIComponent(formatVal(cur, elementName, target, kind))
  if (hasValidProps(cur, 'ref'))
    return encodeURIComponent(
      isLambda ? [LAMBDA_VARIABLE, ...cur.ref].join('/') : cur.ref[0].id || [...navPrefix, ...cur.ref].join('/')
    )
  if (hasValidProps(cur, 'val'))
    return encodeURIComponent(formatVal(cur.val, elementName, target, kind, func, cur.literal))
  if (hasValidProps(cur, 'xpr')) return `(${_xpr(cur.xpr, target, kind, isLambda, navPrefix)})`
  // REVISIT: How to detect the types for all functions?
  if (hasValidProps(cur, 'func')) {
    if (cur.args?.length) {
      return kind === 'odata-v2'
        ? _odataV2Func(cur.func, cur.args, navPrefix)
        : `${cur.func}(${_args(cur.args, cur.func)})`
    }
    return `${cur.func}()`
  }
}

const _isLambda = (cur, next) => {
  if (cur !== 'exists') return
  const last = Array.isArray(next.ref) && next.ref.slice(-1)[0]
  return last && hasValidProps(last, 'id')
}

function _xpr(expr, target, kind, isLambda, navPrefix = []) {
  const res = []
  const openBrackets = []

  for (let i = 0; i < expr.length; i++) {
    const cur = expr[i]

    if (typeof cur === 'string') {
      // REVISIT: will it be fixed with a new odata2cqn and follow-ups?
      const isOrIsNotValue = cur.match(/^is\s(not)?\s*(.+)$/)

      if (cur === '(') {
        openBrackets.push(res.length)
        continue
      } else if (cur === ')') {
        const startIdx = openBrackets.pop()
        res[startIdx] = `(${res[startIdx]}`
        res[res.length - 1] = `${res[res.length - 1]})`
      } else if (isOrIsNotValue) {
        // REVISIT: "is" only used for null values?
        const operator = isOrIsNotValue[1] /* 'is not' */ ? 'ne' : 'eq'
        res.push(...[operator, _format({ val: isOrIsNotValue[2] })])
      } else if (cur === 'between') {
        // ref gt low.val and ref lt high.val
        const between = [expr[i - 1], 'gt', expr[i + 1], 'and', expr[i - 1], 'lt', expr[i + 3]]
        // cleanup previous ref
        res.pop()
        res.push(`(${_xpr(between, target, kind, isLambda, navPrefix)})`)
        i += 3
      } else if (cur === 'in') {
        const inExpr = _in(expr[i - 1], expr[i + 1], target, kind, isLambda, navPrefix)
        // cleanup previous ref
        res.pop()
        // when sending a where clause with "col in []" we currently ignore the where clause
        // analog to interpretation for sql generation
        // double check if this is the intended behavior
        if (inExpr) res.push(`(${inExpr})`)
        i += 1
      } else if (_isLambda(cur, expr[i + 1])) {
        const { where } = expr[i + 1].ref.at(-1)
        const nav = expr[i + 1].ref.map(ref => ref?.id ?? ref).join('/')

        if (kind === 'odata-v2') {
          // odata-v2 does not support lambda expressions but successfactors allows filter like for to-one assocs
          cds.log('remote').info(`OData V2 does not support lambda expressions. Using path expression as best effort.`)
          isLambda = false
          res.push(_xpr(where, target, kind, isLambda, [...navPrefix, nav]))
        } else if (!where) {
          res.push(`${nav}/any()`)
        } else {
          res.push(`${nav}/any(${LAMBDA_VARIABLE}:${_xpr(where, target, kind, true, navPrefix)})`)
        }

        i++
      } else {
        res.push(OPERATORS[cur] || cur.toLowerCase())
      }
    } else {
      const ref = expr[i - 2]
      const formatted = _format(
        cur,
        ref?.ref && (ref.ref.length ? ref.ref : ref.ref[0]),
        target,
        kind,
        isLambda,
        null,
        navPrefix
      )
      if (formatted !== undefined) res.push(formatted)
    }
  }

  return res.join('%20')
}

const _keysOfWhere = (where, kind, target) => {
  if (!Array.isArray(where) || !where.length) return ''

  if (kind === 'rest') {
    const keys = where.length === 1 ? getProp(where[0], 'val') : getProp(where[2], 'val')
    return `/${keys}`
  }

  if (where.length === 3) {
    const [left, op, right] = where
    if (op === '=' && (('val' in left && right.ref) || (left.ref && 'val' in right))) {
      const formattedValue =
        'val' in left
          ? formatVal(left.val, right.ref.join('/'), target, kind)
          : formatVal(right.val, left.ref.join('/'), target, kind)

      return `(${encodeURIComponent(formattedValue)})`
    }
  }

  const res = []
  for (const cur of where) {
    if (hasValidProps(cur, 'ref')) {
      res.push(_format(cur))
    } else if (hasValidProps(cur, 'val')) {
      // find previous ref
      const element = res[res.length - 2]
      res.push(_format(cur, element, target, kind))
    } else if (cur === 'and') {
      res.push(',')
    } else {
      res.push(cur)
    }
  }

  return `(${res.join('')})`
}

function _getQueryTarget(entity, propOrEntity, model) {
  if (!entity) {
    // if there is no entity yet, we need to look it up in the model
    return model.definitions[propOrEntity]
  }

  if (entity && entity.elements[propOrEntity]) {
    // structured type
    if (entity.elements[propOrEntity].elements) return entity.elements[propOrEntity]
    // assoc or comp
    return entity && entity.elements[propOrEntity] && model.definitions[entity.elements[propOrEntity].target]
  }
}

const _params = (args, kind, target) => {
  if (!args) {
    throw cds.error(`Invalid call to "${target.name}". You need to navigate to Set`, { code: '400', statusCode: 400 })
  }
  const params = Object.keys(args)
  if (params.length !== Object.keys(target.params).length) {
    throw new Error('KEY_EXPECTED')
  }
  if (params.length === 1) {
    return `(${formatVal(args[params[0]].val, params[0], target, kind)})`
  }
  const _params = []
  for (const p of params) {
    _params.push(`${_format({ ref: [p] })}=${formatVal(args[p].val, p, target, kind)}`)
  }
  return `(${_params.join(',')})`
}

function _from(from, kind, model) {
  if (typeof from === 'string') {
    return { url: _entityUrl(from), queryTarget: model && model.definitions[from] }
  }

  let ref = getProp(from, 'ref')
  ref = (Array.isArray(ref) && ref) || [ref]

  const path = []
  let queryTarget

  for (const curRef of ref) {
    if (hasValidProps(curRef, 'where', 'id')) {
      const { where, id } = curRef
      queryTarget = model && _getQueryTarget(queryTarget, id, model)
      const keys = _keysOfWhere(where, kind, queryTarget)
      path.push(`${id}${keys}`)
    } else if (hasValidProps(curRef, 'id') && 'args' in curRef) {
      const { args, id } = curRef
      queryTarget = model && _getQueryTarget(queryTarget, id, model)
      const params = _params(args, kind, queryTarget)
      path.push(`${id}${params}`)
    } else if (typeof curRef === 'string') {
      queryTarget = model && _getQueryTarget(queryTarget, curRef, model)
      path.push(curRef)
    }
  }

  return { url: _entityUrl(path.join('/')), queryTarget }
}

const _parseColumnsV2 = (columns, prefix = []) => {
  const select = []
  const expand = []

  for (const column of columns) {
    if (hasValidProps(column, 'ref')) {
      const refName = [...prefix, ...column.ref].join('/')

      if (hasValidProps(column, 'expand')) {
        const parsed = _parseColumnsV2(column.expand, [refName])
        expand.push(encodeURIComponent(refName), ...parsed.expand)
        select.push(...parsed.select)
      } else {
        select.push(encodeURIComponent(refName))
      }
    }

    if (column === '*') {
      select.push(encodeURIComponent(prefix.length ? `${prefix.join('/')}/*` : '*'))
    }
  }

  return { select, expand }
}

const _parseColumns = columns => {
  const select = []
  const expand = []

  for (const column of columns) {
    if (hasValidProps(column, 'ref')) {
      let refName = _format(column)
      if (hasValidProps(column, 'expand')) {
        // REVISIT: incomplete, see test Foo?$expand=invoices($count=true;$expand=item($search="some"))
        if (!columns.some(c => !c.expand) && !column.ref[0].id) select.push(refName)
        const curOptions = getOptions(column).join(';')
        refName += curOptions ? `(${curOptions})` : ''
        expand.push(refName)
        // REVISIT: expand to one & limit in options
        // > const expanded = $expand(col.expand)
        // > expand.push(expanded ? `${ref}(${expanded})` : ref)
        // see test.skip('READ with expand'... in custom handler test
      } else {
        select.push(refName)
      }
    } else if (hasValidProps(column, 'expand') && column.expand[0] === '*') {
      expand.push('*')
    }
    if (column === '*') {
      select.push(column)
    }
  }
  // omit '$select' option if contains only '*'
  if (select.length === 1 && (select[0] === '*' || (select[0].ref && select[0].ref[0] === '*'))) {
    select.pop()
  }
  return { select, expand }
}

function $select(columns, kind, separator = '&') {
  const { select, expand } = kind === 'odata-v2' ? _parseColumnsV2(columns) : _parseColumns(columns)
  const res = []
  if (expand.length) res.unshift('$expand=' + expand.join(','))
  if (select.length) res.unshift('$select=' + select.join(','))
  return res.join(separator)
}
const $expand = columns => $select(columns, 'odata', ';')

function $count(count, kind) {
  if (count !== true) return ''
  if (kind === 'odata-v2') return '$inlinecount=allpages'
  return '$count=true'
}

function $limit(limit) {
  const res = []

  if (hasValidProps(limit, 'rows')) {
    res.push('$top=' + getProp(limit.rows, 'val'))
  }

  if (hasValidProps(limit, 'offset')) {
    res.push('$skip=' + getProp(limit.offset, 'val'))
  }

  return res
}

function $orderBy(orderBy) {
  const res = []

  for (const cur of orderBy) {
    if (cur.implicit) continue

    if (hasValidProps(cur, 'ref', 'sort')) {
      res.push(_format(cur) + '%20' + cur.sort)
      continue
    }

    if (hasValidProps(cur, 'ref')) {
      res.push(_format(cur))
    }

    if (hasValidProps(cur, 'func', 'sort')) {
      res.push(`${cur.func}(${_args(cur.args)})` + '%20' + cur.sort)
      continue
    }

    if (hasValidProps(cur, 'func')) {
      res.push(`${cur.func}(${_args(cur.args)})`)
    }
  }

  if (res.length) return '$orderby=' + res.join(',')
}

function parseSearch(search) {
  const res = []

  for (const cur of search) {
    if (hasValidProps(cur, 'xpr')) {
      // search term must not be formatted
      res.push('(', ...parseSearch(cur.xpr), ')')
    }

    if (hasValidProps(cur, 'val')) {
      // search term must not be formatted
      res.push(`${encodeURIComponent(cur.val)}`)
    }

    if (typeof cur === 'string') {
      const upperCur = cur.toUpperCase()

      if (upperCur === 'OR' || upperCur === 'AND' || upperCur === 'NOT') {
        res.push(upperCur)
      }
    }
  }

  return res
}

function $search(search, kind) {
  const expr = parseSearch(search, kind).join('%20').replace('(%20', '(').replace('%20)', ')')

  if (expr) {
    // odata-v2 may support custom query option "search"
    if (kind === 'odata-v2') return `search=${expr}`
    // kind === 'odata-v4'
    return `$search=${expr}`
  }

  return ''
}

function $where(where, target, kind) {
  const expr = _xpr(where, target, kind)
  return expr ? `$filter=${expr}` : ''
}

function $one(one, url, kind) {
  return one && !_isOdataUrlWithKeys(url, kind) && '$top=1'
}

// eslint-disable-next-line no-useless-escape
const _isOdataUrlWithKeys = (url, kind) => kind !== 'rest' && /^[\w\.]+\(.*\)/.test(url)

const parsers = {
  columns: (cqnPart, url, kind, target, isCount) => !isCount && $select(cqnPart, kind),
  expand: (cqnPart, url, kind, target, isCount) => !isCount && $expand(cqnPart),
  // eslint-disable-next-line no-unused-vars
  where: (cqnPart, url, kind, target, isCount) => $where(cqnPart, target, kind),
  // eslint-disable-next-line no-unused-vars
  search: (cqnPart, url, kind, target, isCount) => $search(cqnPart, kind),
  orderBy: (cqnPart, url, kind, target, isCount) => !isCount && $orderBy(cqnPart),
  count: (cqnPart, url, kind, target, isCount) => !isCount && $count(cqnPart, kind),
  limit: (cqnPart, url, kind, target, isCount) => !isCount && $limit(cqnPart),
  one: (cqnPart, url, kind, target, isCount) => !isCount && $one(cqnPart, url, kind),
  // eslint-disable-next-line no-unused-vars
  ref: (cqnPart, url, kind, target, isCount) => cqnPart[0].where && $where(cqnPart[0].where, target, kind)
}

function getOptions(cqnPart, url, kind, target, isCount) {
  const options = []

  for (const opt in cqnPart) {
    const cqnPartOpt = cqnPart[opt]
    if (cqnPartOpt === undefined) continue
    if (!hasValidProps(cqnPart, opt)) throw new Error(`Feature not supported: SELECT statement with .${opt}`)
    const parser = parsers[opt]
    const parsed = parser && parser(cqnPartOpt, url, kind, target, isCount)
    const parsedOpts = (Array.isArray(parsed) && parsed) || (parsed && [parsed]) || []
    options.push(...parsedOpts)
  }

  return options
}

const _isCount = SELECT => {
  if (SELECT.columns) {
    const columns = getProp(SELECT, 'columns')
    return columns.some(c => c.func === 'count' && c.as === '$count')
  }
  return false
}

const _select = (cqn, kind, model) => {
  const SELECT = getProp(cqn, 'SELECT')
  const { url, queryTarget } = _from(getProp(SELECT, 'from'), kind, model)
  const isCount = _isCount(SELECT)
  const queryOptions = getOptions(SELECT, url, kind, queryTarget, isCount).join('&')
  const path = `${url}${isCount ? '/$count' : ''}${queryOptions ? `?${queryOptions}` : ''}`
  return { method: 'GET', path }
}

const _insert = (cqn, kind, model) => {
  const INSERT = getProp(cqn, 'INSERT')
  const { url } = _from(getProp(INSERT, 'into'), kind, model)
  const body = _copyData(
    Array.isArray(INSERT.entries) && INSERT.entries.length === 1 ? INSERT.entries[0] : INSERT.entries
  )
  return { method: 'POST', path: url, body }
}

const _copyData = data => {
  // only works on flat structures
  if (Array.isArray(data)) return data.map(_copyData)
  const copied = {}
  for (const property in data) {
    copied[property] =
      data[property] != null && typeof data[property] === 'object' && 'val' in data[property]
        ? data[property].val
        : data[property]
  }
  return copied
}

const _update = (cqn, kind, model, method) => {
  const UPDATE = getProp(cqn, 'UPDATE')
  const { url, queryTarget } = _from(getProp(UPDATE, 'entity'), kind, model)
  let keys = ''

  if (UPDATE.where) {
    if (_isOdataUrlWithKeys(url, kind)) {
      throw new Error('Cannot generate URL for UPDATE CQN. Conflicting .from and .where')
    }
    keys = _keysOfWhere(getProp(UPDATE, 'where'), kind, queryTarget)
  }

  // TODO: support for .set as well
  const body = _copyData(UPDATE.data)
  return { method: method || 'PATCH', path: `${url}${keys}`, body }
}

const _delete = (cqn, kind, model) => {
  const DELETE = getProp(cqn, 'DELETE')
  const { url, queryTarget } = _from(getProp(DELETE, 'from'), kind, model)
  let keys = ''

  if (DELETE.where) {
    if (_isOdataUrlWithKeys(url, kind)) {
      throw new Error('Cannot generate URL for DELETE CQN. Conflicting .from and .where')
    }

    keys = _keysOfWhere(getProp(DELETE, 'where'), kind, queryTarget)
  }

  return { method: 'DELETE', path: `${url}${keys}` }
}

function cqn2odata(cqn, { kind, model, method }) {
  if (cqn.SELECT) return _select(cqn, kind, model)
  if (cqn.INSERT) return _insert(cqn, kind, model)
  if (cqn.UPDATE) return _update(cqn, kind, model, method)
  if (cqn.DELETE) return _delete(cqn, kind, model)

  throw new Error('Unknown CQN object cannot be translated to URL: ' + JSON.stringify(cqn))
}

module.exports = cqn2odata
