'use strict';

const { forEach } = require('../utils/objectUtils');

/* eslint-disable arrow-body-style */
const booleanValidator = {
  validate: val => val === true || val === false,
  expected: () => 'type boolean',
  found: val => `type ${ typeof val }`,
};

/**
 * Validation function. Returns false if invalid.
 *
 * @typedef {(input: any) => boolean} ValidateFunction
 */

/**
 * @typedef {object} Validator
 * @property {ValidateFunction} validate Run the validation check
 * @property {Function} expected Returns the expected type/value as a string.
 * @property {Function} found Returns the actually found type/value as a string.
 */

/**
 * Generate a Validator that validates that the
 * input is a string and one of the available options.
 * The validation of the option values is case-insensitive.
 *
 * @param {any} availableValues Available values
 * @returns {Validator} Return a validator for a string in an expected range
 */
function generateStringValidator( availableValues ) {
  return {
    validate: val => typeof val === 'string' && availableValues.some( av => av.toLowerCase() === val.toLowerCase() ),
    expected: (val) => {
      return typeof val !== 'string' ? 'type string' : availableValues.join(', ');
    },
    found: (val) => {
      return typeof val !== 'string' ? `type ${ typeof val }` : `value ${ val }`;
    },
  };
}

const validators = {
  beta: {
    validate: val => val !== null && typeof val === 'object' && !Array.isArray(val),
    expected: () => 'type object',
    found: (val) => {
      return val === null ? val : `type ${ typeof val }`;
    },
  },
  deprecated: {
    validate: val => val !== null && typeof val === 'object' && !Array.isArray(val),
    expected: () => 'type object',
    found: (val) => {
      return val === null ? val : `type ${ typeof val }`;
    },
  },
  severities: {
    validate: (val) => {
      if (val !== null && typeof val === 'object' && !Array.isArray(val))
        return true;

      return false;
    },
    expected: () => 'type object',
    found: (val) => {
      return val === null ? val : `type ${ typeof val }`;
    },
  },
  // TODO: Maybe do a deep validation of the whole object with leafs?
  variableReplacements: {
    validate: val => val !== null && typeof val === 'object' && !Array.isArray(val),
    expected: () => 'type object',
    found: (val) => {
      return val === null ? val : `type ${ typeof val }`;
    },
  },
  messages: {
    validate: val => Array.isArray(val),
    expected: () => 'type array',
    found: val => `type ${ typeof val }`,
  },
  sqlDialect: generateStringValidator([ 'sqlite', 'hana', 'plain', 'postgres', 'h2' ]),
  sqlMapping: generateStringValidator([ 'plain', 'quoted', 'hdbcds' ]),
  odataVersion: generateStringValidator([ 'v2', 'v4' ]),
  odataFormat: generateStringValidator([ 'flat', 'structured' ]),
  odataVocabularies: {
    validate: val => (typeof val === 'object' && !Array.isArray(val)),
    expected: () => 'type JSON object',
    found: val => `type ${ Array.isArray(val) ? 'JSON array' : typeof val }`,
  },
  service: {
    validate: val => typeof val === 'string',
    expected: () => 'type string',
    found: val => `type ${ typeof val }`,
  },
  serviceNames: {
    validate: val => Array.isArray(val) && !val.some(y => (typeof y !== 'string')),
    expected: () => 'type array of string',
    found: val => `type ${ typeof val }`,
  },
  effectiveServiceName: {
    validate: val => typeof val === 'string',
    expected: () => 'type string',
    found: val => `type ${ typeof val }`,
  },
  defaultBinaryLength: {
    validate: val => !Number.isNaN(Number(val)) && Number.isInteger(Number.parseFloat(val)),

    expected: () => 'Integer literal',
    found: val => `${ (!Number.isNaN(Number(val)) ? val : 'Not a Number') }`,
  },
  defaultStringLength: {
    validate: val => !Number.isNaN(Number(val)) && Number.isInteger(Number.parseFloat(val)),

    expected: () => 'Integer literal',
    found: val => `${ (!Number.isNaN(Number(val)) ? val : 'Not a Number') }`,
  },
  csnFlavor: {
    validate: val => typeof val === 'string',
    expected: () => 'type string',
    found: val => `type ${ typeof val }`,
  },
  testMode: {
    validate: val => typeof val === 'boolean' || typeof val === 'number' || val === '$noAssertConsistency',
    expected: () => 'type boolean|number',
    found: val => `type ${ typeof val }`,
  },
  withLocations: {
    validate: val => typeof val === 'boolean' || val === 'withEndPosition',
    expected: () => 'type boolean|"withEndPosition"',
    found: val => `type ${ typeof val }`,
  },
  dictionaryPrototype: {
    validate: () => true,
  },
  assertIntegrity: {
    validate: val => typeof val === 'string' && val === 'individual' || typeof val === 'boolean',
    expected: () => 'a boolean or a string with value \'individual\'',
    found: val => (typeof val === 'string' ? val : `type ${ typeof val }`),
  },
  assertIntegrityType: generateStringValidator([ 'DB', 'RT' ]),
  tenantDiscriminator: { validate: () => true }, // do it ourselves
};

// Note: if `validate()` returns true, it means the option is _invalid_!
const allCombinationValidators = {
  'valid-structured': (options, message) => {
    if (options.odataVersion === 'v2' && options.odataFormat === 'structured')
      message.error('api-invalid-combination', null, { '#': 'valid-structured' });
  },
  'sql-dialect-and-naming': (options, message) => {
    if (options.sqlDialect && options.sqlMapping && options.sqlDialect !== 'hana' && [ 'quoted', 'hdbcds' ].includes(options.sqlMapping))
      message.error('api-invalid-combination', null, { '#': 'sql-dialect-and-naming', name: options.sqlDialect, prop: options.sqlMapping });
  },
  'beta-no-test': (options, message) => {
    if (options.beta && !options.testMode)
      message.warning('api-unexpected-combination', null, { '#': 'beta-no-test', option: 'beta' });
  },
  'effectiveServiceName-and-type-resolution': (options, message) => {
    if (options.effectiveServiceName && !options.resolveSimpleTypes)
      message.error('api-invalid-combination', null, { '#': 'effectiveServiceName-and-type-resolution', name: 'effectiveServiceName', prop: 'resolveSimpleTypes' });
  },
};

const alwaysRunValidators = [ 'beta-no-test' ];

/**
 * Run the validations for each option.
 * Use a custom validator or "default" custom validator, fallback to Boolean validator.
 *
 * @param {object} options Flat options object to validate
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @param {object} [customValidators] Map of custom validators to use
 * @param {string[]} [combinationValidators] Validate option combinations
 * @returns {void}
 * @throws {CompilationError} Throws in case of invalid option usage
 */
function validate( options, messageFunctions, customValidators = {}, combinationValidators = [] ) {
  const { error, throwWithError } = messageFunctions;

  forEach(options, (optionName, optionValue) => {
    const validator = customValidators[optionName] || validators[optionName] || booleanValidator;

    if (!validator.validate(optionValue)) {
      error('api-invalid-option', null, {
        '#': 'value',
        prop: optionName,
        value: validator.expected(optionValue),
        othervalue: validator.found(optionValue),
      });
    }
  });
  throwWithError();

  for (const combinationValidatorName of combinationValidators.concat(alwaysRunValidators))
    allCombinationValidators[combinationValidatorName](options, messageFunctions);
  throwWithError();
}


module.exports = { validate, generateStringValidator };
/* eslint-enable arrow-body-style */
