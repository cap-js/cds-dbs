/*
 * Input handler on application service layer
 *
 * - remove readonly fields
 * - remove immutable fields on update
 * - add UUIDs
 * - asserts
 */

const cds = require('../../cds')
const LOG = cds.log('app')

const { Readable } = require('node:stream')

const { enrichDataWithKeysFromWhere } = require('../utils/keys')
const { DRAFT_COLUMNS_MAP } = require('../../common/constants/draft')
const propagateForeignKeys = require('../utils/propagateForeignKeys')
const { checkInputConstraints, assertTargets } = require('../../cds-services/util/assert')
const getTemplate = require('../utils/template')
const { getDataFromCQN, setDataFromCQN } = require('../utils/data')
const getRowUUIDGeneratorFn = require('../utils/rowUUIDGenerator')

const _shouldSuppressErrorPropagation = (event, value) => {
  return (
    event === 'NEW' ||
    event === 'PATCH' ||
    (event === 'UPDATE' && value.val === undefined) ||
    (value.val == null && !value.mandatory)
  )
}

const _sliceBase64 = function* (str) {
  const chunkSize = 1 << 16
  for (let i = 0; i < str.length; i += chunkSize) {
    yield Buffer.from(str.slice(i, i + chunkSize), 'base64')
  }
}

const _getSimpleCategory = category => {
  if (typeof category === 'object') {
    category = category.category
  }

  return category
}

const _preProcessAssertTarget = (assocInfo, assertMap) => {
  const { element: assoc, row } = assocInfo
  const assocTarget = assoc._target

  // it is expected that the associated entities be defined in the same service
  if (assoc.parent._service !== assocTarget._service) {
    LOG._warn && LOG.warn('Cross-service checks for the @assert.target constraint are not supported.')
    return
  }

  const foreignKeys = assoc._foreignKeys
  let mapKey = `${assocTarget.name}(`
  const hasOwn = Object.prototype.hasOwnProperty
  const parentKeys = []

  foreignKeys.forEach(keyMap => {
    const { childElement, parentElement } = keyMap

    // don't assert target if the foreign key isn't in the payload
    if (!hasOwn.call(row, parentElement.name)) return

    const foreignKeyValue = row[parentElement.name]

    // don't assert target if the foreign key value is null
    if (foreignKeyValue === null) return

    mapKey += `${childElement.name}=${foreignKeyValue},`
    parentKeys.push({
      [childElement.name]: foreignKeyValue
    })
  })
  mapKey += `)`

  if (parentKeys.length === 0) return

  foreignKeys.forEach(keyMap => {
    const clonedAssocInfo = Object.assign({}, assocInfo, { pathSegmentsInfo: assocInfo.pathSegmentsInfo.slice(0) })
    const target = {
      key: mapKey,
      entity: assocTarget,
      keys: parentKeys,
      assocInfo: clonedAssocInfo,
      foreignKey: keyMap.parentElement
    }

    if (!assertMap.targets.has(mapKey)) {
      assertMap.targets.set(mapKey, target)
    }

    assertMap.allTargets.push(target)
  })
}

const _processCategory = (req, category, value, elementInfo, assertMap) => {
  const { row, key, element, isRoot } = elementInfo
  category = _getSimpleCategory(category)

  if (category === 'propagateForeignKeys') {
    propagateForeignKeys(key, row, element._foreignKeys, element.isComposition)
    return
  }

  // remember mandatory
  if (category === 'mandatory') {
    value.mandatory = true
    return
  }

  const event = req.event

  // remove readonly (can also be complex, so do first)
  if (category === 'readonly') {
    // preserve computed values if triggered by draftActivate and not managed
    const managed = `@cds.on.${event === 'CREATE' ? 'insert' : 'update'}`
    if (cds.env.features.preserve_computed !== false && req._?.event === 'draftActivate' && !element[managed]) return

    // read-only values are already deleted before `NEW` (and they can be set in a `NEW` handler!)
    if (event === 'CREATE' && req.target.isDraft) return

    delete row[key]
    value.val = undefined
    return
  }

  // remove immutable (can also be complex, so do first)
  // for new db drivers (cds.db.cqn2sql is defined), deep immutable values are handled in differ
  // otherwise they're not supported and always filtered out here.
  if (category === 'immutable' && event === 'UPDATE' && (isRoot || !cds.db.cqn2sql)) {
    delete row[key]
    value.val = undefined
    return
  }

  // generate UUIDs
  if (
    category === 'uuid' &&
    !value.val &&
    ((event !== 'UPDATE' && event !== 'PATCH') || !isRoot) &&
    !element.parent.elements[element._foreignKey4]?._isAssociationStrict
  ) {
    value.val = row[key] = cds.utils.uuid()
  }

  // @assert.target
  if ((event === 'UPDATE' || event === 'CREATE') && category === '@assert.target') {
    _preProcessAssertTarget(elementInfo, assertMap)
  }

  if (category === 'binary' && typeof row[key] === 'string') {
    row[key] = Buffer.from(row[key], 'base64')
    return
  }

  if (category === 'largebinary' && typeof row[key] === 'string') {
    row[key] = Readable.from(_sliceBase64(row[key]), { objectMode: false })
    return
  }
}

const _getProcessorFn = (req, errors, assertMap) => {
  const event = req.event

  return elementInfo => {
    const { row, key, element, plain, pathSegmentsInfo } = elementInfo
    // ugly pointer passing for sonar
    const value = { mandatory: false, val: row && row[key] }

    for (const category of plain.categories) {
      _processCategory(req, category, value, elementInfo, assertMap)
    }

    if (_shouldSuppressErrorPropagation(event, value)) return

    // REVISIT: Convert checkInputConstraints to template mechanism
    checkInputConstraints({ element, value: value.val, errors, pathSegmentsInfo, event })
  }
}

// params: element, target, parent
const _pick = element => {
  // collect actions to apply
  const categories = []

  // REVISIT: element._foreignKeys.length seems to be a very broad check
  if (element.isAssociation && element._foreignKeys.length) {
    categories.push({ category: 'propagateForeignKeys' })
  }

  // some checks are not needed if cds_validate is active (the default in cds^8)
  if (!cds.env.features.cds_validate) {
    if (element['@assert.range'] || element['@assert.format'] || element.type === 'cds.Decimal') {
      categories.push('assert')
    }

    if (element._isMandatory) {
      categories.push('mandatory')
    }

    if (element._isReadOnly) {
      // > _isReadOnly includes @cds.on.insert and @cds.on.update
      categories.push('readonly')
    }
  }

  // REVISIT: cleanse @Core.Immutable
  //          should be a db feature, as we cannot handle completely on service level (cf. deep update)
  //          -> add to attic env behavior once new dbs handle this
  // also happens in validate but because of draft activate we have to do it twice (where cleansing is suppressed)
  if (element['@Core.Immutable'] && !element.key) {
    categories.push('immutable')
  }

  if (element.key && !DRAFT_COLUMNS_MAP[element.name] && element.isUUID) {
    categories.push('uuid')
  }

  if (
    element._isAssociationStrict &&
    !element.on && // managed assoc
    element.is2one &&
    element['@assert.target'] === true
  ) {
    categories.push('@assert.target')
  }

  if (element.type === 'cds.Binary' && !cds.env.features.base64_binaries) {
    categories.push('binary')
  }

  if (element.type === 'cds.LargeBinary' && !cds.env.features.base64_binaries) {
    categories.push('largebinary')
  }

  if (categories.length) return { categories }
}

async function validate_input(req) {
  if (!req.query) return // FIXME: the code below expects req.query to be defined
  if (!req.target || req.target._unresolved) return // Validation requires resolved targets

  // validate data
  // Remove the if for cds9
  if (cds.env.features.cds_validate) {
    const assertOptions = {
      mandatories: req.event === 'CREATE' || req.method === 'PUT',
      protocol: req.protocol
    }

    const _is_activate = req._?.event === 'draftActivate' && cds.env.features.preserve_computed !== false
    if (_is_activate) assertOptions.cleanse = false

    // REVISIT: initialize path if necessary (currently only done in lean-draft -> correct?)
    const { actions } = req.target
    if (actions) {
      const bound = actions[req.event] || actions[req._.event]
      if (bound) assertOptions.path = [bound['@cds.odata.bindingparameter.name'] || 'in']
    }

    if (req.protocol && !_is_activate) assertOptions.rejectIgnore = true

    const errs = cds.validate(req.data, req.target, assertOptions)
    if (errs) {
      if (errs.length === 1) throw errs[0]
      throw Object.assign(new Error('MULTIPLE_ERRORS'), { statusCode: 400, details: errs })
    }
  }

  const template = getTemplate('app-input', this, req.target, {
    pick: _pick,
    ignore: element => element._isAssociationStrict
  })
  if (template.elements.size === 0) return

  const errors = []
  const assertMap = {
    targets: new Map(),
    allTargets: []
  }

  const pathOptions = {
    rowUUIDGenerator: getRowUUIDGeneratorFn(req.event),
    includeKeyValues: true,
    pathSegmentsInfo: []
  }

  const data = getDataFromCQN(req.query) // REVISIT: req.data should point into req.query
  enrichDataWithKeysFromWhere(data, req, this)

  template.process(data, _getProcessorFn(req, errors, assertMap), pathOptions)

  if (assertMap.targets.size > 0) {
    await assertTargets(assertMap, errors)
  }

  setDataFromCQN(req) // REVISIT: req.data should point into req.query

  if (errors.length) for (const error of errors) req.error(error)
}

const _getProcessorFnForActionsFunctions =
  (errors, opName) =>
  ({ row, key, element }) => {
    const value = row && row[key]

    // REVISIT: Convert checkInputConstraints to template mechanism
    checkInputConstraints({ element, value, errors, key: opName })
  }

const _processActionFunctionRow = (row, param, key, errors, event, service) => {
  const values = Array.isArray(row[key]) ? row[key] : [row[key]]

  // unstructured
  for (const value of values) {
    checkInputConstraints({ element: param, value, errors, key })
  }

  // structured
  const template = getTemplate('app-input-operation', service, param, {
    pick: _pick,
    ignore: element => element._isAssociationStrict
  })

  template.process(values, _getProcessorFnForActionsFunctions(errors, key))
}

const _processActionFunction = (row, eventParams, errors, event, service) => {
  for (const key in eventParams) {
    let param = eventParams[key]

    // .type of action/function behaves different to .type of other csn elements
    const _type = param.type
    if (!_type && param.items) param = param.items
    _processActionFunctionRow(row, param, key, errors, event, service)
  }
}

function validate_action(req) {
  const operation = this.actions?.[req.event] || req.target?.actions?.[req.event]
  if (!operation) return

  const data = req.data || {}

  // validate data
  if (cds.env.features.cds_validate) {
    const assertOptions = {
      mandatories: true,
      // REVISIT: which operations are neither action nor function ?!?
      cleanse: !(operation.kind === 'action' || operation.kind === 'function'),
      protocol: req.protocol
    }
    let errs = cds.validate(data, operation, assertOptions)
    if (errs) {
      if (errs.length === 1) throw errs[0]
      throw Object.assign(new Error('MULTIPLE_ERRORS'), { statusCode: 400, details: errs })
    }
  }

  // REVISIT: need to follow up on that!
  // REVISIT: the below is still needed if !cds.env.features.cds_validate because cds.validate doesn't throw missing mandatory struct.
  //          look for comment "skip struct-likes as we check flat payloads above, and deep payloads via struct.validate()".
  //          structured params are _not_ flattened and, hence, the assumption in the comment is incorrect (or the flattening must be done).
  const errors = []
  const arrayData = Array.isArray(data) ? data : [data]
  for (const row of arrayData) _processActionFunction(row, operation.params, errors, req.event, this)
  if (errors.length) for (const error of errors) req.error(error)

  // convert binaries
  operation.params &&
    !cds.env.features.base64_binaries &&
    Object.keys(operation.params).forEach(key => {
      if (operation.params[key].type === 'cds.Binary' && typeof data[key] === 'string')
        data[key] = Buffer.from(data[key], 'base64')
    })
}

validate_input._initial = true
validate_action._initial = true

module.exports = cds.service.impl(function () {
  this.before(['CREATE', 'UPDATE'], '*', validate_input)
  for (const each of this.actions) this.before(each, validate_action)
  for (const entity of this.entities) for (let a in entity.actions) this.before(a, entity, validate_action)
})

// needed for testing
module.exports.commonGenericInput = validate_input
