'use strict';

const {
  getUtils, mergeTransformers, applyTransformations,
} = require('../../model/csnUtils');
const transformUtils = require('../transformUtils');
const effectiveFlattening = require('./flattening');
const flattening = require('../db/flattening');
const types = require('./types');
// const { addLocalizationViews } = require('../../transform/localized');
const validate = require('../../checks/validator');
const expansion = require('../db/expansion');
const queries = require('./queries');
const associations = require('./associations');
const handleExists = require('../db/assocsToQueries/transformExists');
const misc = require('./misc');
const annotations = require('./annotations');
const { rewriteCalculatedElementsInViews, processCalculatedElementsInEntities } = require('../db/rewriteCalculatedElements');
const { cloneFullCsn } = require('../../model/cloneCsn');
const { featureFlags } = require('../featureFlags');
const getServiceFilterFunction = require('./service');

/**
 * This is just a PoC for now!
 *
 * Transform the given CSN into a so called effective CSN, by
 * - dissolving structured types
 * - turning managed into unmanaged associations
 * @private
 * @param {CSN.Model} model Input CSN - will not be transformed
 * @param {CSN.Options} options
 * @param {object} messageFunctions
 * @returns {CSN.Model}
 */
function effectiveCsn( model, options, messageFunctions ) {
  const csn = cloneFullCsn(model, options);
  delete csn.namespace; // must not be set for effective CSN
  delete csn.vocabularies; // must not be set for effective CSN
  messageFunctions.setModel(csn);

  const transformerUtils = transformUtils.getTransformers(csn, options, messageFunctions, '_');
  const { expandStructsInExpression } = transformerUtils;
  const redoProjections = queries.projectionToSELECTAndAddColumns(csn);

  let csnUtils = getUtils(csn, 'init-all');

  // Run validations on CSN - each validator function has access to the message functions and the inspect ref via this
  const cleanup = validate.forRelationalDB(csn, {
    ...messageFunctions, csnUtils, ...csnUtils, csn, options,
  });

  if (csn.meta?.[featureFlags]?.$calculatedElements)
    rewriteCalculatedElementsInViews(csn, options, csnUtils, '_', messageFunctions);

  // Needs to happen before tuple expansion, so the newly generated WHERE-conditions have it applied
  handleExists(csn, options, messageFunctions.error, csnUtils.inspectRef, csnUtils.initDefinition, csnUtils.dropDefinitionCache);

  // Check if structured elements and managed associations are compared in an expression
  // and expand these structured elements. This tuple expansion allows all other
  // subsequent procession steps to see plain paths in expressions.
  // If errors are detected, throwWithAnyError() will return from further processing
  expandStructsInExpression(csn, { drillRef: true });

  messageFunctions.throwWithAnyError();

  // Expand a structured thing in: keys, columns, order by, group by
  expansion.expandStructureReferences(csn, options, '_', messageFunctions, csnUtils);

  const resolveTypesInActionsAfterFlattening = types.resolve(csn, csnUtils, transformerUtils, options);

  // Remove properties attached by validator - they do not "grow" as the model grows.
  cleanup();


  effectiveFlattening.flattenRefs(csn, options, csnUtils, messageFunctions);
  flattening.flattenElements(csn, options, messageFunctions, '_', { skipDict: { actions: true } });

  // ensure getElement works on flattened struct_assoc columns and getFinalTypeInfo refreshes the cache
  csnUtils = getUtils(csn, 'init-all');

  resolveTypesInActionsAfterFlattening(csnUtils);

  processCalculatedElementsInEntities(csn, options);
  associations.managedToUnmanaged(csn, options, csnUtils, messageFunctions);
  associations.transformBacklinks(csn, options, csnUtils, messageFunctions);
  const transformers = mergeTransformers([
    options.remapOdataAnnotations ? annotations.remapODataAnnotations(csn) : {},
    misc.removeDefinitionsAndProperties(csn, options),
    options.deriveAnalyticalAnnotations ? annotations.sealAnnoMagic(csn) : {},
  ], null);

  if (options.addCdsPersistenceName) {
    applyTransformations(csn, misc.attachPersistenceName(csn, options, csnUtils), [], {
      skipIgnore: false, skipArtifact: artifact => artifact.kind !== 'entity', skipDict: { actions: true }, skipStandard: { items: true },
    });
  }

  const artifactTransformers = [];

  const collector = {
    service: null,
    containedArtifacts: Object.create(null),
  };

  if (options.effectiveServiceName)
    artifactTransformers.push(getServiceFilterFunction(options.effectiveServiceName, collector));

  applyTransformations(csn, transformers, artifactTransformers, { skipIgnore: false, processAnnotations: true });

  if (!options.resolveProjections)
    redoProjections.forEach(fn => fn());

  // Remove unapplied extensions/annotations
  delete csn.extensions;

  if (options.effectiveServiceName) {
    if (collector.service) {
      csn.definitions = collector.containedArtifacts;
      csn.definitions[options.effectiveServiceName] = collector.service;
    }
    else {
      messageFunctions.warning(null, null, { name: options.effectiveServiceName, option: 'effectiveServiceName' }, 'Could not find a service matching requested effective service $(NAME) (option $(OPTION))');
      csn.definitions = Object.create(null);
    }
  }

  messageFunctions.throwWithError();

  return csn;
}

module.exports = { effectiveCsn };
