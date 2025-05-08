const cds = require('../../cds')
const LOG = cds.log('app')
const templatePathSerializer = require('../../common/utils/templateProcessorPathSerializer')

const typeCheckers = require('../../../common/assert/type-strict')
const { 'cds.Decimal': checkDecimal } = typeCheckers
const { checkMandatory, checkEnum, checkRange, checkFormat } = require('../../../common/assert/validation')

const ASSERT_VALID_ELEMENT = 'ASSERT_VALID_ELEMENT'
const ASSERT_RANGE = 'ASSERT_RANGE'
const ASSERT_FORMAT = 'ASSERT_FORMAT'
const ASSERT_DATA_TYPE = 'ASSERT_DATA_TYPE'
const ASSERT_ENUM = 'ASSERT_ENUM'
const ASSERT_NOT_NULL = 'ASSERT_NOT_NULL'

const _enumValues = element => {
  return Object.keys(element).map(enumKey => {
    const enum_ = element[enumKey]
    const enumValue = enum_ && enum_.val

    if (enumValue !== undefined) {
      if (enumValue['=']) return enumValue['=']
      if (enum_ && enum_.literal && enum_.literal === 'number') return Number(enumValue)
      return enumValue
    }

    return enumKey
  })
}

// REVISIT: this needs a cleanup!
const assertError = (code, element, value, key, path) => {
  let args

  if (typeof code === 'object') {
    args = code.args
    code = code.code
  }

  const { name, type, precision, scale } = element
  const error = new Error()
  const errorEntry = {
    code,
    message: code,
    target: path ?? element.name ?? key,
    args: args ?? [name ?? key]
  }

  const assertError = Object.assign(error, errorEntry)
  Object.assign(assertError, {
    entity: element.parent && element.parent.name,
    element: name, // > REVISIT: when is error.element needed?
    type: element.items ? element.items._type : type,
    status: 400,
    value
  })

  if (element.enum) assertError.enum = _enumValues(element)
  if (precision) assertError.precision = precision
  if (scale) assertError.scale = scale

  if (element.target) {
    // REVISIT: when does this case apply?
    assertError.target = element.target
  }

  return assertError
}

// Limitation: depth 1
const checkComplexType = ([key, value], elements, ignoreNonModelledData) => {
  let found = false

  for (const objKey in elements) {
    if (objKey.startsWith(`${key}_`)) {
      const element = elements[objKey]
      const typeChecker = typeCheckers[element._type]
      found = true

      const nestedData = value[objKey.substring(key.length + 1)]
      // check existence of nestedData to not stumble across not-provided, yet-modelled type parts with depth > 1
      if (nestedData && !typeChecker(nestedData)) {
        return false
      }
    }
  }

  return found || ignoreNonModelledData
}

// TODO: what fails if no-op?!
const checkStaticElementByKey = (definition, key, value, result = [], ignoreNonModelledData = true) => {
  const elementsOrParameters = definition.elements || definition.params
  if (!elementsOrParameters) return result
  const elementOrParameter = elementsOrParameters[key]

  if (!elementOrParameter) {
    if (!checkComplexType([key, value], elementsOrParameters, ignoreNonModelledData)) {
      result.push(assertError(ASSERT_VALID_ELEMENT, { name: key }))
    }

    return result
  }

  let typeChecker
  if (elementOrParameter.isUUID && definition.name === 'ProvisioningService.tenant') {
    // > old SCP accounts don't have UUID ids
    typeChecker = typeCheckers['cds.String']
  } else {
    typeChecker = typeCheckers[elementOrParameter._type]
  }

  if (typeChecker && !typeChecker(value, elementOrParameter)) {
    // code, entity, element, value
    const args = [typeof value === 'string' ? '"' + value + '"' : value, elementOrParameter._type]
    result.push(assertError({ code: ASSERT_DATA_TYPE, args }, elementOrParameter, value, key))
  }

  return result
}

/**
 * @param {import('../../types/api').InputConstraints} constraints
 */
const checkInputConstraints = ({ element, value, errors, key, pathSegmentsInfo }) => {
  if (!element) return errors

  let path
  if (pathSegmentsInfo?.length) path = templatePathSerializer(element.name || key, pathSegmentsInfo)

  // not nice, but best option for keeping new cds.assert() clean
  if (element._isMandatory) {
    const mandatoryErrors = []
    checkMandatory(value, element, mandatoryErrors, [], key)
    if (mandatoryErrors.length) {
      errors.push(...mandatoryErrors.map(() => assertError({ code: ASSERT_NOT_NULL }, element, value, key, path)))
    }
  }

  if (value == null) return errors

  // not nice, but best option for keeping new cds.assert() clean
  const enumErrors = []
  checkEnum(value, element, enumErrors, [], key)
  if (enumErrors.length) {
    errors.push(...enumErrors.map(e => assertError({ code: ASSERT_ENUM, args: e.args }, element, value, key, path)))
  }

  // not nice, but best option for keeping new cds.assert() clean
  const rangeErrors = []
  checkRange(value, element, rangeErrors, [], key)
  if (rangeErrors.length) {
    errors.push(...rangeErrors.map(e => assertError({ code: ASSERT_RANGE, args: e.args }, element, value, key, path)))
  }

  // not nice, but best option for keeping new cds.assert() clean
  const formatErrors = []
  checkFormat(value, element, formatErrors, [], key)
  if (formatErrors.length) {
    errors.push(...formatErrors.map(e => assertError({ code: ASSERT_FORMAT, args: e.args }, element, value, key, path)))
  }

  if (element.type === 'cds.Decimal') {
    // not nice, but best option for keeping new cds.assert() clean
    const decimalErrors = []
    checkDecimal(value, element, decimalErrors, [], key)
    if (decimalErrors.length) {
      errors.push(
        ...decimalErrors.map(e => assertError({ code: ASSERT_DATA_TYPE, args: e.args }, element, value, key, path))
      )
    }
  }

  return errors
}

// TODO: what fails if no-op?!
const checkStatic = (definition, data, ignoreNonModelledData = false) => {
  if (!Array.isArray(data)) data = [data]

  return data.reduce((result, row) => {
    return Object.entries(row)
      .filter(([, value]) => value !== null && value !== undefined)
      .reduce((result, [key, value]) => {
        return checkStaticElementByKey(definition, key, value, result, ignoreNonModelledData)
      }, result)
  }, [])
}

/**
 * Check whether the target entity referenced by the association (the reference's target) exists and assert an error if
 * the the reference's target doesn't exist.
 *
 * In other words, use this annotation to check whether a non-null foreign key input in a table has a corresponding
 * primary key (also known as a parent key) in the associated/referenced target table (also known as a parent table).
 *
 * @param {import('../../types/api').assertTargetMap} assertMap
 * @param {array} errors An array to appends the possible errors.
 * @see {@link https://cap.cloud.sap/docs/guides/providing-services#assert-target @assert.target} for
 * further information.
 */
const assertTargets = async (assertMap, errors) => {
  const { targets: targetsMap, allTargets } = assertMap
  if (targetsMap.size === 0) return

  const targets = Array.from(targetsMap.values())
  const transactions = targets.map(({ keys, entity }) => {
    const where = Object.assign({}, ...keys)
    return cds.db.exists(entity, where).forShareLock()
  })
  const targetsExistsResults = await Promise.allSettled(transactions)

  targetsExistsResults.forEach((txPromise, index) => {
    const isPromiseRejected = txPromise.status === 'rejected'
    const shouldAssertError = (txPromise.status === 'fulfilled' && txPromise.value == null) || isPromiseRejected
    if (!shouldAssertError) return

    const target = targets[index]
    const { element } = target.assocInfo

    if (isPromiseRejected) {
      LOG._debug &&
        LOG.debug(
          `The transaction to check the @assert.target constraint for foreign key "${element.name}" failed`,
          txPromise.reason
        )

      throw new Error(txPromise.reason.message)
    }

    allTargets
      .filter(t => t.key === target.key)
      .forEach(target => {
        const { row, pathSegmentsInfo } = target.assocInfo
        const key = target.foreignKey.name
        let path
        if (pathSegmentsInfo?.length) path = templatePathSerializer(key, pathSegmentsInfo)
        const error = assertError('ASSERT_TARGET', target.foreignKey, row[key], key, path)
        errors.push(error)
      })
  })
}

module.exports = {
  checkStatic,
  checkStaticElementByKey,
  checkInputConstraints,
  assertTargets
}
