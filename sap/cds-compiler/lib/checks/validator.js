'use strict';

const {
  forEachDefinition, forEachMemberRecursively, forAllQueries,
  forEachMember, getNormalizedQuery,
  applyTransformations, functionList, mergeTransformers, hasPersistenceSkipAnnotation,
} = require('../model/csnUtils');
const enrichCsn = require('./enricher');

// forRelationalDB
const { validateSelectItems } = require('./selectItems');
const { rejectParamDefaultsInHanaCds, warnAboutDefaultOnAssociationForHanaCds } = require('./defaultValues');
const validateCdsPersistenceAnnotation = require('./cdsPersistence');
const navigationIntoMany = require('./manyNavigations');
const checkUsedTypesForAnonymousAspectComposition = require('./managedInType');
const validateHasPersistedElements = require('./hasPersistedElements');
const checkForHanaTypes = require('./checkForTypes');
const { checkAnnotationExpression } = require('./structuredAnnoExpressions');
const checkForParams = require('./parameters');
const checkAndRemoveEnums = require('./enums');
// forOdata
const { validateDefaultValues } = require('./defaultValues');
const { checkActionOrFunction } = require('./actionsFunctions');
const {
  checkCoreMediaTypeAllowance, checkAnalytics,
  checkAtSapAnnotations, checkReadOnlyAndInsertOnly,
  checkTemporalAnnotationsAssignment,
} = require('./annotationsOData');
// both
const checkCdsMap = require('./cdsMap');
const { validateOnCondition, validateMixinOnCondition } = require('./onConditions');
const validateForeignKeys = require('./foreignKeys');
const {
  checkTypeDefinitionHasType, checkElementTypeDefinitionHasType,
  checkTypeIsScalar, checkDecimalScale,
} = require('./types');
const {
  checkPrimaryKey, checkVirtualElement, checkManagedAssoc,
  checkRecursiveTypeUsage, rejectAnnotationsOnCalcElement,
} = require('./elements');
const checkForInvalidTarget = require('./invalidTarget');
const { validateAssociationsInItems } = require('./arrayOfs');
const checkQueryForNoDBArtifacts = require('./queryNoDbArtifacts');
const checkExplicitlyNullableKeys = require('./nullableKeys');
const nonexpandableStructuredInExpression = require('./nonexpandableStructured');
const existsMustEndInAssoc = require('./existsMustEndInAssoc');
const forbidAssocInExists = require('./existsExpressionsOnlyForeignKeys');
const checkPathsInStoredCalcElement = require('./checkPathsInStoredCalcElement');
const managedWithoutKeys = require('./managedWithoutKeys');
const {
  checkSqlAnnotationOnArtifact,
  checkSqlAnnotationOnElement,
} = require('./sql-snippets');
const assertNoAssocUsageOutsideOfService = require('./assocOutsideService');
const featureFlags = require('./featureFlags');
const { timetrace } = require('../utils/timetrace');

const forRelationalDBMemberValidators
= [
  // For HANA CDS specifically, reject any default parameter values, as these are not supported.
  rejectParamDefaultsInHanaCds,
  checkTypeIsScalar,
  checkDecimalScale,
  checkExplicitlyNullableKeys,
  managedWithoutKeys,
  warnAboutDefaultOnAssociationForHanaCds,
  // sql.prepend/append
  checkSqlAnnotationOnElement,
  // no temporal annotations on calc elements
  rejectAnnotationsOnCalcElement,
  checkElementTypeDefinitionHasType,
];

const forRelationalDBArtifactValidators = [
  checkPrimaryKey,
  // @cds.persistence has no impact on odata
  validateCdsPersistenceAnnotation,
  // virtual items are not persisted on the db
  validateHasPersistedElements,
  // sql.prepend/append
  checkSqlAnnotationOnArtifact,
  // strip down CSN to reduce it's size by removing non-sql relevant parts
  deleteBoundActions,
];

const forRelationalDBCsnValidators = [
  checkCdsMap,
  existsMustEndInAssoc,
  forbidAssocInExists,
  nonexpandableStructuredInExpression,
  navigationIntoMany,
  checkPathsInStoredCalcElement,
  featureFlags,
  checkAndRemoveEnums,
];
/**
 * @type {Array<(query: CSN.Query, path: CSN.Path) => void>}
 */
const forRelationalDBQueryValidators = [
  // TODO reason why this is forRelationalDB exclusive
  validateSelectItems,
  checkQueryForNoDBArtifacts,
];

const forOdataMemberValidators
= [
  // OData allows only simple values, no expressions or functions
  validateDefaultValues,
  managedWithoutKeys,
];

const forOdataArtifactValidators
= [
  // actions and functions are not of interest for the database
  checkActionOrFunction,
  // arrays are just CLOBs/LargeString for the database,
  // no inner for the array structure is of interest for the database
  // NOTE: moved to the renderer for a while
  // TODO: Re-enable this code and remove the duplicated code from the renderer.
  //       Not possible at the moment, because running this at the beginning of
  //       the renderer does not work because the enricher can't handle certain
  //       OData specifics.
  // checkChainedArray,
  checkReadOnlyAndInsertOnly,
];

const forOdataCsnValidators = [ checkCdsMap, nonexpandableStructuredInExpression ];

const forOdataQueryValidators = [];

const commonMemberValidators
= [ validateOnCondition, validateForeignKeys,
  validateAssociationsInItems, checkForInvalidTarget,
  checkVirtualElement, checkManagedAssoc ];

// TODO: checkManagedAssoc is a forEachMemberRecursively!
const commonArtifactValidators = [
  checkTypeDefinitionHasType,
  checkRecursiveTypeUsage,
];
// TODO: Does it make sense to run the on-condition check as part of a CSN validator?
const commonQueryValidators = [ validateMixinOnCondition ];

/**
 * Run the given validations for each artifact and for each member recursively
 *
 * @param {CSN.Model} csn CSN to check
 * @param {object} that Will be provided to the validators via "this"
 * @param {object[]} [csnValidators] Validations on whole CSN using applyTransformations
 * @param {Function[]} [memberValidators] Validations on member-level
 * @param {Function[]} [artifactValidators] Validations on artifact-level
 * @param {Function[]} [queryValidators] Validations on query-level
 * @param {object} iterateOptions can be used to skip certain kinds from being iterated e.g. 'action' and 'function' for hana
 * @returns {Function} Function taking no parameters, that cleans up the attached helpers
 */
function _validate( csn, that,
                    csnValidators = [],
                    memberValidators = [],
                    artifactValidators = [],
                    queryValidators = [],
                    iterateOptions = {} ) {
  timetrace.start('Enrich CSN');
  const { cleanup } = enrichCsn(csn, that.options);
  timetrace.stop('Enrich CSN');
  // TODO: Don't know if that's feasible? Do we really need to enrich annotations always?
  // const { cleanup } = enrich(csn, { processAnnotations: that.options.tranformation === 'odata' });

  applyTransformations(csn, mergeTransformers(csnValidators, that), [], { drillRef: true });

  forEachDefinition(csn, (artifact, artifactName, prop, path) => {
    artifactValidators.forEach((artifactValidator) => {
      artifactValidator.bind(that)(artifact, artifactName, prop, path);
    });
    that.artifact = artifact;
    if (memberValidators.length) {
      forEachMemberRecursively( artifact,
                                memberValidators.map(v => v.bind(that)),
                                path,
                                true,
                                iterateOptions );
    }

    if (queryValidators.length && getNormalizedQuery(artifact).query) {
      forAllQueries(getNormalizedQuery(artifact).query, functionList(queryValidators, that),
                    path.concat([ artifact.projection ? 'projection' : 'query' ]));
    }
  }, iterateOptions);

  return cleanup;
}

/**
 * Depending on the dialect we need to run different validations.
 *
 * @param {CSN.Options} options
 * @returns {any[]} Array of validator functions (or objects?)
 */
function getDBCsnValidators( options ) {
  const validations = [ ...forRelationalDBCsnValidators ];

  if (options.transformation !== 'effective')
    validations.push(checkForParams.csnValidator);
  if (options.sqlDialect === 'h2' || options.sqlDialect === 'postgres')
    validations.push(checkForHanaTypes);
  if (options.transformation === 'effective' && options.effectiveServiceName)
    validations.push(assertNoAssocUsageOutsideOfService);

  return validations;
}

/**
 * @param {CSN.Model} csn CSN to check
 * @param {object} that Will be provided to the validators via "this"
 * @returns {Function} the validator function with the respective checks for the HANA backend
 */
function forRelationalDB( csn, that ) {
  const memberValidators = [ ...forRelationalDBMemberValidators, ...commonMemberValidators ];
  if (that.options.transformation === 'hdbcds')
    memberValidators.push(checkForParams.memberValidator);

  return _validate(csn, that,
                   getDBCsnValidators(that.options),
                   memberValidators,
                   forRelationalDBArtifactValidators.concat(commonArtifactValidators).concat(
                     // why is this hana exclusive
                     (artifact) => {
                       /*  the validation itself performs a recursive check on structured elements.
                        That is why it is not run along with the memberValidators, as it would result in
                        duplicate messages due to the forEachMemberRecursively.
                        TODO: check if this recursion can be factored out of the validator */
                       forEachMember(artifact, checkUsedTypesForAnonymousAspectComposition.bind(that));
                     },
                     (artifact, artifactName) => {
                       if (that.options.transformation === 'effective') {
                         forEachMemberRecursively(artifact, checkAnnotationExpression.bind(that), [ 'definitions', artifactName ], false, {
                           skipArtifact: a => a.returns || (a.params && !a.query),
                         });
                       }
                     }
                   ),
                   forRelationalDBQueryValidators.concat(commonQueryValidators),
                   {
                     skipArtifact: artifact => artifact.abstract ||
                                                hasPersistenceSkipAnnotation(artifact) ||
                                                artifact['@cds.persistence.exists'] ||
                                                [ 'action', 'function', 'event' ].includes(artifact.kind),
                   });
}

/**
 * @param {CSN.Model} csn CSN to check
 * @param {object} that Will be provided to the validators via "this"
 * @returns {Function} the validator function with the respective checks for the OData backend
 */
function forOdata( csn, that ) {
  return _validate(csn, that,
                   forOdataCsnValidators,
                   forOdataMemberValidators.concat(commonMemberValidators),
                   forOdataArtifactValidators.concat(commonArtifactValidators).concat(
                     (artifact, artifactName) => {
                       if (that.csnUtils.getServiceName(artifactName)) {
                         checkAtSapAnnotations.bind(that)(artifact);
                         forEachMemberRecursively(artifact, [
                           checkCoreMediaTypeAllowance.bind(that),
                           checkAnalytics.bind(that),
                           checkAtSapAnnotations.bind(that),
                         ]);
                       }
                       checkTemporalAnnotationsAssignment.bind(that)(artifact, artifactName);
                     }
                   ),
                   // eslint-disable-next-line sonarjs/no-empty-collection
                   forOdataQueryValidators.concat(commonQueryValidators),
                   {
                     skipArtifact: this.isExternalServiceMember,
                   });
}

/**
 * Shrink the CSN by
 * - deleting bound actions
 *
 * Artifacts can only be shrunk later, when types are resolved
 *
 * @param {CSN.Artifact} artifact
 */
function deleteBoundActions( artifact ) {
  if (this.options.transformation !== 'effective')
    delete artifact.actions;
}

module.exports = { forRelationalDB, forOdata };
