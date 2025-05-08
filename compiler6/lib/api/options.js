'use strict';

const { validate, generateStringValidator } = require('./validate');
const { makeMessageFunction } = require('../base/messages');

// TODO: there should be just one place where the options are defined with
// their types (not also in validate.js or whatever).

// Options that are advertised and documented to users
const publicOptionsNewAPI = [
  // GENERAL
  'beta',
  'deprecated',
  'addTextsLanguageAssoc',
  'localizedLanguageFallback',  // why can't I define the option type here?
  'severities',
  'messages',
  'withLocations',
  'structXpr',
  'defaultBinaryLength',
  'defaultStringLength',
  'csnFlavor',
  // DB
  'sqlDialect',
  'sqlMapping',
  'sqlChangeMode',
  'allowCsnDowngrade',
  'joinfk',
  'magicVars', // deprecated, not removed in v3 as we have specific error messages for it
  'variableReplacements',
  'pre2134ReferentialConstraintNames',
  'betterSqliteSessionVariables',
  'fewerLocalizedViews',
  'withHanaAssociations',
  'standardDatabaseFunctions',
  'booleanEquality',
  // ODATA
  'odataOpenapiHints',
  'edm4OpenAPI',
  'odataVersion',
  'odataFormat',
  'odataContainment',
  'odataCapabilitiesPullup',
  'odataForeignKeys',
  'odataProxies',
  'odataXServiceRefs',
  'odataV2PartialConstr',
  'odataVocabularies',
  'odataNoCreator',
  'service',
  'serviceNames',
  // to.cdl
  'renderCdlDefinitionNesting',
  'renderCdlCommonNamespace',
  //
  'dictionaryPrototype',
  // for.effective
  'resolveSimpleTypes',
  'resolveProjections',
  'remapOdataAnnotations',
  'keepLocalized',
  'effectiveServiceName',
  // for.seal
  'deriveAnalyticalAnnotations',
  // to.sql.migration
  'script',
];

// Internal options used for testing/debugging etc.
const privateOptions = [
  // Not callable via cdsc, keep private for now until we are sure that we want this
  'filterCsn',
  'lintMode', // for cdsse only
  'traceFs',
  'traceParser',
  'traceParserAmb',
  'testMode',
  'testSortCsn',
  'constraintsInCreateTable',
  'integrityNotEnforced',
  'integrityNotValidated',
  'assertIntegrity',
  'assertIntegrityType',
  'noRecompile',
  'internalMsg',
  'disableHanaComments',      // in case of issues with hana comment rendering
  'tenantDiscriminator',      // not published yet
  'localizedWithoutCoalesce', // deprecated version of 'localizedLanguageFallback', TODO(v6): Remove option
  'v6$now', // change mapping of $now for HANA as v6 preview
];

const overallOptions = publicOptionsNewAPI.concat(privateOptions);

/**
 * Extract the cds relevant options from the provided options
 * Apply defaults and make sure that the "hard requirements" are met,
 * i.e. src: sql if to.sql() was called.
 *
 * @param {FlatOptions} [input] Input options
 * @param {FlatOptions} [defaults] Default options to apply
 * @param {FlatOptions} [hardRequire] Hard requirements to enforce
 * @param {object} [customValidators] Custom validations to run instead of defaults
 * @param {string[]} [combinationValidators] Option combinations to validate
 * @param {string} moduleName The called module, e.g. 'for.odata', 'to.hdi'. Needed to initialize the message functions
 * @returns {TranslatedOptions} General cds options
 */
function translateOptions( input = {}, defaults = {}, hardRequire = {},
                           customValidators = {}, combinationValidators = [], moduleName = '' ) {
  const options = Object.assign({}, defaults);
  for (const name of overallOptions) {
    // Ensure that arrays are not passed as a reference!
    // This caused issues with the way messages are handled in processMessages
    if (Array.isArray(input[name]))
      options[name] = [ ...input[name] ];
    else if (Object.hasOwnProperty.call(input, name))
      options[name] = input[name];
  }

  // use original messages object, i.e. keep the reference!
  if (input.messages)
    options.messages = input.messages;

  // Validate the filtered input options
  // only "new-style" options are here
  const messageFunctions = makeMessageFunction(null, options, moduleName);
  validate(options,
           messageFunctions,
           // TODO: is there a better place to specify the type of option values?
           Object.assign( {
             localizedLanguageFallback: generateStringValidator([ 'none', 'coalesce' ]),
             sqlChangeMode: generateStringValidator([ 'alter', 'drop' ]),
           }, customValidators ),
           combinationValidators,
           moduleName);

  // Overwrite with the hardRequire options - like src: sql in to.sql()
  Object.assign(options, hardRequire);

  reclassifyErrorsForOpenApi( options );

  // Convenience for $user -> $user.id replacement
  if (options.variableReplacements?.$user && typeof options.variableReplacements?.$user === 'string')
    options.variableReplacements.$user = { id: options.variableReplacements.$user };

  return options;
}

/**
 * Reclassify certain OData errors to warnings for the OData/EDM/EDMX backends.
 * Some errors are not necessary for openAPI generation.
 *
 * @param {CSN.Options} options OData options
 */
function reclassifyErrorsForOpenApi( options ) {
  if (options.edm4OpenAPI) {
    // shallow clone, so that we can modify severities without changing the user's.
    options.severities = Object.assign({}, options.severities ?? {});

    options.severities['odata-missing-key'] = 'Warning';
  }
}


module.exports = {
  to: {
    cdl: (options) => {
      const defaultOptions = {
        renderCdlDefinitionNesting: true,
        renderCdlCommonNamespace: true,
      };
      return translateOptions(options, defaultOptions, undefined, undefined, undefined, 'to.cdl');
    },
    sql: (options) => {
      const hardOptions = { src: 'sql', toSql: true, forHana: true };
      const defaultOptions = {
        sqlMapping: 'plain',
        sqlDialect: 'plain',
        withHanaAssociations: false,
        booleanEquality: true,
      };
      const processed = translateOptions(options, defaultOptions, hardOptions, undefined, [ 'sql-dialect-and-naming' ], 'to.sql');

      return Object.assign({}, processed);
    },
    hdi: (options) => {
      const hardOptions = { src: 'hdi', toSql: true, forHana: true };
      // TODO: sqlDialect should be a hard option!
      const defaultOptions = {
        sqlMapping: 'plain',
        sqlDialect: 'hana',
        withHanaAssociations: false,
        booleanEquality: true,
      };
      return translateOptions(options, defaultOptions, hardOptions, { sqlDialect: generateStringValidator([ 'hana' ]) }, undefined, 'to.hdi');
    },
    hdbcds: (options) => {
      const hardOptions = { forHana: true };
      // TODO: sqlDialect should be a hard option!
      const defaultOptions = {
        sqlMapping: 'plain',
        sqlDialect: 'hana',
        booleanEquality: false,
      };
      return translateOptions(options, defaultOptions, hardOptions, { sqlDialect: generateStringValidator([ 'hana' ]) }, undefined, 'to.hdbcds');
    },
    edm: (options) => {
      const hardOptions = { json: true, combined: true, toOdata: true };
      const defaultOptions = { odataVersion: 'v4', odataFormat: 'flat' };
      return translateOptions(options, defaultOptions, hardOptions, { odataVersion: generateStringValidator([ 'v4' ]) }, [ 'valid-structured' ], 'to.edm');
    },
    edmx: (options) => {
      const hardOptions = { xml: true, combined: true, toOdata: true };
      const defaultOptions = {
        odataVersion: 'v4', odataFormat: 'flat',
      };
      return translateOptions(options, defaultOptions, hardOptions, undefined, [ 'valid-structured' ], 'to.edmx');
    },
    odata: (options) => {
      const hardOptions = { combined: true, toOdata: true };
      const defaultOptions = {
        odataVersion: 'v4', odataFormat: 'flat',
      };
      return translateOptions(options, defaultOptions, hardOptions, undefined, [ 'valid-structured' ], 'to.odata');
    },
  },
  for: {
    odata: (options) => {
      const hardOptions = { toOdata: true };
      const defaultOptions = { odataVersion: 'v4', odataFormat: 'flat' };
      return translateOptions(options, defaultOptions, hardOptions, undefined, [ 'valid-structured' ], 'for.odata');
    },
    hana: (options) => {
      const hardOptions = { forHana: true };
      const defaultOptions = { sqlMapping: 'plain', sqlDialect: 'hana' };
      return translateOptions(options, defaultOptions, hardOptions, undefined, undefined, 'for.hana');
    },
    effective: (options) => {
      const hardOptions = { addCdsPersistenceName: false, deriveAnalyticalAnnotations: false };
      const defaultOptions = {
        sqlMapping: 'plain', resolveSimpleTypes: true, resolveProjections: true, remapOdataAnnotations: false, keepLocalized: false,
      };
      const processed = translateOptions(options, defaultOptions, hardOptions, null, [ 'sql-dialect-and-naming', 'effectiveServiceName-and-type-resolution' ], 'for.effective');

      return Object.assign({}, processed);
    },
    seal: (options) => {
      const hardOptions = {
        sqlMapping: 'plain', resolveSimpleTypes: true, resolveProjections: true, keepLocalized: false, addCdsPersistenceName: true,
      };
      const defaultOptions = { remapOdataAnnotations: true, deriveAnalyticalAnnotations: false };
      const processed = translateOptions(options, defaultOptions, hardOptions, null, [ 'sql-dialect-and-naming' ], 'for.effective');

      return Object.assign({}, processed);
    },
    java: options => translateOptions(options, { sqlMapping: 'plain' }, {}, undefined, undefined, 'for.java'),
  },
  overallOptions, // exported for testing
};


/**
 * Flat input object using the new-style options.
 *
 * @typedef {object} FlatOptions
 */

/**
 * Flat options object, with defaults, validation and compatibility applied.
 *
 * @typedef {object} TranslatedOptions
 */
