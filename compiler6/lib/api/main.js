/** @module API */

'use strict';

const lazyload = require('../base/lazyload')( module );

const prepareOptions = lazyload('./options');
const baseModel = lazyload('../base/model');
const location = lazyload('../base/location');
const messages = lazyload('../base/messages');
const compiler = lazyload('../compiler/index');
const toCsn = lazyload('../json/to-csn');
const forOdataNew = lazyload('../transform/forOdata.js');
const generateDrafts = lazyload('../transform/draft/odata');
const tenant = lazyload('../transform/addTenantFields');
const toSql = lazyload('../render/toSql');
const toCdl = require('../render/toCdl');
const modelCompare = lazyload('../modelCompare/compare');
const diffFilter = lazyload('../modelCompare/utils/filter');
const sortViews = lazyload('../model/sortViews');
const csnUtils = lazyload('../model/csnUtils');
const timetrace = lazyload('../utils/timetrace');
const forRelationalDB = lazyload('../transform/forRelationalDB');
const sqlUtils = lazyload('../render/utils/sql');
const effective = lazyload('../transform/effective/main');
const toHdbcds = lazyload('../render/toHdbcds');
const baseError = lazyload('../base/error');
const csnToEdm = lazyload('../edm/csn2edm');
const trace = lazyload('./trace');
const cloneCsn = lazyload('../model/cloneCsn');
const objectUtils = lazyload('../utils/objectUtils');

/**
 * Return the artifact name for use for the hdbresult object
 * So that it stays compatible with v1 .texts
 *
 * @param {string} artifactName Name to map
 * @param {CSN.Model} csn SQL transformed model
 * @returns {string} Name with . replaced as _ in some places
 */
function getFileName( artifactName, csn ) {
  return csnUtils.getResultingName(csn, 'quoted', artifactName);
}

const relevantGeneralOptions = [ /* for future generic options */ ];
const relevantOdataOptions = [ 'sqlMapping', 'odataFormat' ];
const warnAboutMismatchOdata = [ 'odataVersion' ];

/**
 * Attach options and transformation name to the $meta tag
 *
 * @param {CSN.Model} csn CSN to attach to
 * @param {string} transformation Name of the transformation - odata or hana
 * @param {NestedOptions} options Options used for the transformation
 * @param {string[]} relevantOptionNames Option names that are defining characteristics
 * @param {string[]} [optionalOptionNames] Option names that should be attached as a fyi
 */
function attachTransformerCharacteristics( csn, transformation, options,
                                           relevantOptionNames, optionalOptionNames = [] ) {
  const relevant = {};
  for (const name of relevantOptionNames) {
    if (options[name] !== undefined)
      relevant[name] = options[name];
  }

  for (const name of optionalOptionNames) {
    if (options[name] !== undefined)
      relevant[name] = options[name];
  }

  // eslint-disable-next-line sonarjs/no-empty-collection
  for (const name of relevantGeneralOptions) {
    if (options[name] !== undefined)
      relevant[name] = options[name];
  }
  if (!csn.meta)
    baseModel.setProp(csn, 'meta', {});

  baseModel.setProp(csn.meta, 'options', relevant);
  baseModel.setProp(csn.meta, 'transformation', transformation);
}

/**
 * Check the characteristics of the provided, already transformed CSN
 * Report an error if they do not match with the currently requested options
 * V2 vs V4, plain vs hdbcds etc.
 *
 * @param {CSN.Model} csn CSN to check
 * @param {NestedOptions} options Options used for the transformation - scanned top-level
 * @param {string[]} relevantOptionNames Option names that are defining characteristics
 * @param {string[]} warnAboutMismatch Option names to warn about, but not error on
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 */
function checkPreTransformedCsn( csn, options,
                                 relevantOptionNames, warnAboutMismatch,
                                 messageFunctions ) {
  if (!csn.meta?.options) {
    // Not able to check
    return;
  }
  const { error, warning, throwWithAnyError } = messageFunctions;

  for (const name of relevantOptionNames ) {
    if (options[name] !== csn.meta.options[name]) {
      error('api-invalid-option-preprocessed', null, { prop: name, value: options[name], othervalue: csn.meta.options[name] },
            'Expected pre-processed CSN to have option $(PROP) set to $(VALUE). Found: $(OTHERVALUE)');
    }
  }

  for (const name of warnAboutMismatch ) {
    if (options[name] !== csn.meta.options[name]) {
      warning('api-mismatched-option-preprocessed', null, { prop: name, value: options[name], othervalue: csn.meta.options[name] },
              'Expected pre-processed CSN to have option $(PROP) set to $(VALUE). Found: $(OTHERVALUE)');
    }
  }

  throwWithAnyError();
}

/**
 * Check if the CSN was already run through the appropriate transformer
 *
 * - Currently only check for odata, as hana is not exposed
 *
 * @param {CSN.Model} csn CSN
 * @param {string} transformation Name of the transformation
 * @returns {boolean} Return true if it is pre-transformed
 */
function isPreTransformed( csn, transformation ) {
  return csn && csn.meta && csn.meta.transformation === transformation;
}

/**
 * Get an odata-CSN without option handling.
 *
 * @param {CSN.Model} csn Clean input CSN
 * @param {object} internalOptions processed options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} Return an oData-pre-processed CSN
 */
function odataInternal( csn, internalOptions, messageFunctions ) {
  internalOptions.transformation = 'odata';
  let oDataCsn = forOdataNew.transform4odataWithCsn(csn, internalOptions, messageFunctions);
  oDataCsn = cloneCsn.sortCsnForTests(oDataCsn, internalOptions);
  messageFunctions.setModel(oDataCsn);
  attachTransformerCharacteristics(oDataCsn, 'odata', internalOptions, relevantOdataOptions, warnAboutMismatchOdata);
  return oDataCsn;
}

/**
 * Return a odata-transformed CSN
 *
 * @param {CSN.Model} csn Clean input CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {oDataCSN} Return an oData-pre-processed CSN
 */
function odata( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.for.odata(options);
  messageFunctions.setOptions( internalOptions );
  return odataInternal(csn, internalOptions, messageFunctions);
}

/**
 * Return a structured CSN for the Java Runtime: with drafts and tenant support
 *
 * @param {CSN.Model} csn Clean input CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} a CSN for the Java Runtime
 */
function java( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.for.java(options);
  internalOptions.transformation = 'odata'; // otherwise generateDrafts adds tenant
  messageFunctions.setOptions( internalOptions );
  handleTenantDiscriminator(options, internalOptions, messageFunctions);

  const clone = cloneCsn.cloneFullCsn(csn, internalOptions);
  const draft = generateDrafts(clone, internalOptions, undefined, messageFunctions);
  if (internalOptions.tenantDiscriminator)
    tenant.addTenantFields(draft, internalOptions, messageFunctions );
  return draft;
}

/**
 * Process the given csn back to cdl.
 *
 * @param {object} csn CSN to process
 * @param {object} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} { model: string, namespace: string }
 */
function cdl( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.cdl(options);
  messageFunctions.setOptions( internalOptions );
  return toCdl.csnToCdl(csn, internalOptions, messageFunctions);
}

/**
 * Transform a CSN like to.sql().
 * Expects that internalOptions have been validated via prepareOptions.to.sql().
 *
 * @param {CSN.Model} csn Plain input CSN
 * @param {SqlOptions} internalOptions Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} CSN transformed like to.sql
 * @private
 */
function csnForSql( csn, internalOptions, messageFunctions ) {
  internalOptions.transformation = 'sql';
  const transformedCsn = forRelationalDB.transformForRelationalDBWithCsn(
    csn, internalOptions, messageFunctions
  );
  return cloneCsn.sortCsnForTests(transformedCsn, internalOptions);
}

/**
 * Transform a CSN like to.sql(). Also performs options-checks.
 * Pseudo-public version of csnForSql().
 *
 * @param {CSN.Model} csn Plain input CSN
 * @param {SqlOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} CSN transformed like to.sql
 * @private
 */
function forSql( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.sql(options);
  messageFunctions.setOptions( internalOptions );
  return csnForSql(csn, internalOptions, messageFunctions); // already sorted for test mode
}

/**
 * Transform a CSN like to.hdi
 *
 * @param {CSN.Model} csn Plain input CSN
 * @param {HdiOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} CSN transformed like to.hdi
 * @private
 */
function forHdi( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.hdi(options);
  internalOptions.transformation = 'sql';
  messageFunctions.setOptions( internalOptions );
  const transformedCsn = forRelationalDB.transformForRelationalDBWithCsn(
    csn, internalOptions, messageFunctions
  );
  return cloneCsn.sortCsnForTests(transformedCsn, internalOptions);
}
/**
 * Transform a CSN like to.hdbcds
 *
 * @param {CSN.Model} csn Plain input CSN
 * @param {HdbcdsOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} CSN transformed like to.hdbcds
 * @private
 */
function forHdbcds( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.hdbcds(options);
  internalOptions.transformation = 'hdbcds';
  messageFunctions.setOptions( internalOptions );
  const hanaCsn = forRelationalDB.transformForRelationalDBWithCsn(
    csn, internalOptions, messageFunctions
  );
  return cloneCsn.sortCsnForTests(hanaCsn, internalOptions);
}

/**
 * Effective CSN transformation
 *
 * @param {CSN.Model} csn Plain input CSN
 * @param {EffectiveCsnOptions} options Options
 * @param {EffectiveCsnOptions} internalOptions Options that were already processed
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} CSN transformed
 * @private
 */
function forEffectiveInternal( csn, options, internalOptions, messageFunctions ) {
  messageFunctions.setOptions( internalOptions );
  if (options.tenantDiscriminator) {
    messageFunctions.error('api-invalid-option', null, {
      '#': 'forbidden',
      option: 'tenantDiscriminator',
      module: 'for.effective',
    });
    messageFunctions.throwWithAnyError();
  }

  const eCsn = effective.effectiveCsn(csn, internalOptions, messageFunctions);
  return cloneCsn.sortCsnForTests(eCsn, internalOptions);
}

/**
 * SEAL CSN transformation
 *
 * @param {CSN.Model} csn Plain input CSN
 * @param {EffectiveCsnOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} CSN transformed
 * @private
 */
function forSeal( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.for.seal(options);
  internalOptions.transformation = 'effective';
  return forEffectiveInternal(csn, options, internalOptions, messageFunctions);
}

/**
 * Effective CSN transformation
 *
 * @param {CSN.Model} csn Plain input CSN
 * @param {EffectiveCsnOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {CSN.Model} CSN transformed
 * @private
 */
function forEffective( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.for.effective(options);
  internalOptions.transformation = 'effective';
  // for.effective is still beta mode
  if (!baseModel.isBetaEnabled(options, 'effectiveCsn'))
    throw new baseError.CompilerAssertion('effective CSN is only supported with beta flag `effectiveCsn`!');

  return forEffectiveInternal(csn, options, internalOptions, messageFunctions);
}

/**
 * Process the given CSN into SQL.
 *
 * @param {CSN.Model} csn A clean input CSN
 * @param {SqlOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {SQL[]} Array of SQL statements, tables first, views second
 */
function sql( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.sql(options);
  internalOptions.transformation = 'sql';
  messageFunctions.setOptions( internalOptions );

  handleTenantDiscriminator(options, internalOptions, messageFunctions);

  // we need the CSN for view sorting
  const transformedCsn = csnForSql(csn, internalOptions, messageFunctions);
  messageFunctions.setModel(transformedCsn);
  const sqls = toSql.toSqlDdl(transformedCsn, internalOptions, messageFunctions);

  const result = sortViews({ csn: transformedCsn, sql: sqls.sql });
  return [
    ...result.map(obj => obj.sql).filter(create => create),
    ...Object.values(sqls.constraints || {}),
  ];
}

/**
 * Process the given CSN into HDI artifacts.
 *
 * @param {CSN.Model} csn A clean input CSN
 * @param {HdiOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {HDIArtifacts} { <filename>:<content>, ...}
 */
function hdi( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.hdi(options);
  messageFunctions.setOptions( internalOptions );

  handleTenantDiscriminator(options, internalOptions, messageFunctions);

  // we need the CSN for view sorting
  const sqlCSN = forHdi(csn, options, messageFunctions);
  messageFunctions.setModel(sqlCSN);
  const sqls = toSql.toSqlDdl(sqlCSN, internalOptions, messageFunctions);

  if (internalOptions.testMode) {
    // All this mapping is needed because sortViews crossmatches
    // passed in SQLs with the CSN artifact name
    // But we also need to return it with the correct file ending in the end
    // so remember and do lot's of mapping here.

    const flat = flattenResultStructure(sqls);

    const nameMapping = Object.create(null);
    const sqlArtifactsWithCSNNamesToSort = Object.create(null);
    const sqlArtifactsNotToSort = Object.create(null);

    objectUtils.forEach(flat, (key) => {
      const artifactNameLikeInCsn = key.replace(/\.[^/.]+$/, '');
      nameMapping[artifactNameLikeInCsn] = key;
      if (key.endsWith('.hdbtable') || key.endsWith('.hdbview'))
        sqlArtifactsWithCSNNamesToSort[artifactNameLikeInCsn] = flat[key];
      else
        sqlArtifactsNotToSort[key] = flat[key];
    });

    const sorted = sortViews({ sql: sqlArtifactsWithCSNNamesToSort, csn: sqlCSN })
      .filter(obj => obj.sql)
      .reduce((previous, current) => {
        const hdiArtifactName = remapName(nameMapping[current.name], sqlCSN, k => !k.endsWith('.hdbindex'));
        previous[hdiArtifactName] = current.sql;
        return previous;
      }, Object.create(null));

    // now add the not-sorted stuff, like indices
    objectUtils.forEach(sqlArtifactsNotToSort, (key) => {
      sorted[remapName(key, sqlCSN, k => !k.endsWith('.hdbindex'))] = sqlArtifactsNotToSort[key];
    });

    return sorted;
  }

  return remapNames(flattenResultStructure(sqls), sqlCSN, k => !k.endsWith('.hdbindex'));
}
/**
 * Remap names so that they stay consistent between v1 and v2
 *
 * Mainly important for _texts -> .texts
 *
 * @param {object} dict Result dictionary by toSql
 * @param {CSN.Model} csn SQL transformed CSN
 * @param {Function} filter Filter for keys not to remap
 * @returns {object} New result structure
 */
function remapNames( dict, csn, filter ) {
  const result = Object.create(null);

  objectUtils.forEach(dict, (key, value) => {
    const name = remapName(key, csn, filter);
    result[name] = value;
  });

  return result;
}
/**
 * Remap names so that it stays consistent between v1 and v2
 *
 * Mainly important for _texts -> .texts
 *
 * @param {string} key Filename
 * @param {CSN.Model} csn SQL transformed CSN
 * @param {Function} filter Filter for keys not to remap
 * @returns {string} Remapped filename
 */
function remapName( key, csn, filter = () => true ) {
  if (filter(key)) {
    const lastDot = key.lastIndexOf('.');
    const prefix = key.slice(0, lastDot);
    const suffix = key.slice(lastDot);

    const remappedName = getFileName(prefix, csn);
    return remappedName + suffix;
  }

  return key;
}

/**
 * Return all changes in artifacts between two given models.
 * Note: Only supports changes in artifacts compiled/rendered as db-CSN/SQL.
 *
 * @param {CSN.Model}  csn          A clean input CSN representing the desired "after-image"
 * @param {HdiOptions} options      Options
 * @param {object}     messageFunctions Message functions such as `error()`, `info()`, …
 * @param {CSN.Model}  beforeImage  A db-transformed CSN representing the "before-image", or null in case no such image
 *                                  is known, i.e. for the very first migration step.
 * @returns {object}                An object with three properties:
 *                                  - afterImage: A db-transformed CSN representing the "after-image"
 *                                  - drops: An array of SQL statements to drop views/tables
 *                                  - createsAndAlters: An array of SQL statements to ALTER/CREATE tables/views
 */
function sqlMigration( csn, options, messageFunctions, beforeImage ) {
  const internalOptions = prepareOptions.to.sql(options);

  messageFunctions.setOptions( internalOptions );
  if (internalOptions.script)
    messageFunctions.setModuleName( `${ messageFunctions.moduleName }-script` );

  handleTenantDiscriminator(options, internalOptions, messageFunctions);
  if (!options.dry && internalOptions.script) {
    messageFunctions.error('api-invalid-combination', null, { '#': 'dry-and-script', value: options.dry || 'undefined' });
    messageFunctions.throwWithError();
  }

  if (!internalOptions.script && internalOptions.sqlDialect === 'hana')
    messageFunctions.warning('api-invalid-combination', null, { '#': 'hana-migration', value: internalOptions.sqlDialect });

  if (internalOptions.script && !internalOptions.severities?.['migration-unsupported-key-change']) {
    internalOptions.severities = Object.assign({}, internalOptions.severities ?? {});
    internalOptions.severities['migration-unsupported-key-change'] = 'Warning';
  }

  if (internalOptions.script) {
    internalOptions.severities = Object.assign({}, internalOptions.severities ?? {});
    const turnToWarning = [ 'migration-unsupported-element-drop', 'migration-unsupported-length-change', 'migration-unsupported-scale-change', 'migration-unsupported-precision-change', 'migration-unsupported-change', 'migration-unsupported-table-drop' ];
    turnToWarning.forEach((id) => {
      internalOptions.severities[id] = 'Warning';
    });
  }

  const { throwWithError } = messageFunctions;

  // Prepare after-image.
  let afterImage = csnForSql(csn, internalOptions, messageFunctions);
  if (internalOptions.filterCsn)
    afterImage = diffFilter.csn(afterImage);
  // Compare both images.
  const diff = modelCompare.compareModels(beforeImage || afterImage, afterImage, internalOptions);
  messageFunctions.setModel(diff);
  const diffFilterObj = diffFilter.getFilter(internalOptions);

  if (diffFilterObj) {
    diff.extensions = diff.extensions.filter(ex => diffFilterObj.extension(ex, messageFunctions));
    diff.migrations.forEach(migration => diffFilterObj.migration(migration, messageFunctions));
    Object.entries(diff.deletions).forEach(entry => diffFilterObj.deletion(entry, messageFunctions));
    diff.changedPrimaryKeys = diff.changedPrimaryKeys
      .filter(an => diffFilterObj.changedPrimaryKeys(an));

    if (internalOptions.script && diffFilterObj.hasLossyChanges())
      messageFunctions.warning('def-unsupported-changes', null, null, 'Found potentially lossy changes - check generated SQL statements');
  }

  const identifierUtils = sqlUtils.getIdentifierUtils(csn, internalOptions);

  const drops = {
    creates: {},
    final: Object.entries(diff.deletions).reduce((previous, [ name, artifact ]) => {
      if (artifact.query || artifact.projection)
        previous[name] = `DROP VIEW ${ identifierUtils.renderArtifactName(name) };`;
      else
        previous[name] = `-- [WARNING] this statement is lossy\nDROP TABLE ${ identifierUtils.renderArtifactName(name) };`;
      return previous;
    }, {}),
  };

  const markedSkipByUs = {};
  const cleanup = [];
  // Delete artifacts that are already present in csn
  if (beforeImage?.definitions) {
    Object.keys(beforeImage.definitions).forEach((artifactName) => {
      const beforeArtifact = beforeImage.definitions[artifactName];
      const diffArtifact = diff.definitions[artifactName];
      // TODO: exists, abstract? isPersistedOnDb?
      if (diffArtifact && diffArtifact['@cds.persistence.name'] && csnUtils.isPersistedAsView(diffArtifact) &&
        (diffArtifact[modelCompare.isChanged] === true || // we know it changed because we compared two views
          diffArtifact[modelCompare.isChanged] === undefined)) { // if it was removed in the after, then we don't have the flag
        drops.creates[artifactName] = `DROP VIEW ${ identifierUtils.renderArtifactName(artifactName) };`;
      } // TODO: What happens with a changed kind -> entity becomes a view?
      else if (diffArtifact &&
        diffArtifact['@cds.persistence.skip'] !== true &&
        diffArtifact.kind === beforeArtifact.kind && // detect action -> entity
        csnUtils.isPersistedAsTable(diffArtifact) === csnUtils.isPersistedAsTable(beforeArtifact) && // detect removal of @cds.persistence.exists
        csnUtils.isPersistedAsView(diffArtifact) === csnUtils.isPersistedAsView(beforeArtifact) // detect view -> entity
      ) { // don't render again, but need info for primary key extension
        diffArtifact['@cds.persistence.skip'] = true;
        cleanup.push(() => delete diffArtifact['@cds.persistence.skip']);
        markedSkipByUs[artifactName] = true;
      }
    });
  }

  const sortOrder = sortViews({ sql: {}, csn: afterImage });

  const dependentsDict = {};
  sortOrder.forEach(({ name, dependents }) => {
    dependentsDict[name] = dependents;
  });

  const stack = Object.keys(drops.creates);
  while (stack.length > 0) {
    const name = stack.pop();
    const artifact = diff.definitions[name];
    if (drops.creates[name] === undefined) {
      if (csnUtils.hasPersistenceSkipAnnotation(artifact) && markedSkipByUs[name]) {
        // Remove the skip so we render a CREATE VIEW
        diff.definitions[name]['@cds.persistence.skip'] = false;
        drops.creates[name] = `DROP VIEW ${ identifierUtils.renderArtifactName(name) };`;
      }
    }

    const dependents = dependentsDict[name];
    if (dependents) { // schedule any dependents for processing that don't have a drop-create yet
      for (const dependantName in dependents) {
        if (!drops.creates[dependantName])
          stack.push(dependantName);
      }
    }
  }
  // Convert the diff to SQL.
  if (!internalOptions.beta)
    internalOptions.beta = {};

  internalOptions.beta.sqlExtensions = true;

  const {
    // eslint-disable-next-line no-unused-vars
    deletions, constraintDeletions, migrations, constraints, ...hdbkinds
  } = toSql.toSqlDdl(diff, internalOptions, messageFunctions);

  cleanup.forEach(fn => fn());
  // TODO: Handle `ADD CONSTRAINT` etc!

  const dropSqls = [];
  const createAndAlterSqls = [];
  // Turn the structured result into just a flat dictionary of "artifact name": "sql"
  const flatSqlDict = Object.values(hdbkinds).reduce((prev, curr) => {
    objectUtils.forEach(curr, (name, value) => {
      prev[name] = value;
    });
    return prev;
  }, Object.create(null));

  // Sort all the SQL statements according to the overall order
  for (const { name } of sortOrder) {
    if (drops.final[name])
      dropSqls.push(drops.final[name]);
    else if (drops.creates[name])
      dropSqls.push(drops.creates[name]);

    // No else-if, since we have drop-creates for views!
    if (flatSqlDict[name])
      createAndAlterSqls.push(flatSqlDict[name]);
    else if (migrations[name])
      createAndAlterSqls.push(...migrations[name].map(m => m.sql));
  }

  if (constraints)
    Object.values(constraints).forEach(constraint => createAndAlterSqls.push(constraint));

  if (constraintDeletions)
    Object.values(constraintDeletions).forEach(constraint => dropSqls.push(constraint));

  if (Object.keys(drops.final).length > 0) {
    const order = sortViews({ sql: {}, csn: beforeImage });

    for (const { name } of order) {
      if (drops.final[name])
        dropSqls.push(drops.final[name]);
    }
  }

  // We need to drop the things without dependants first - so inversely sorted
  dropSqls.reverse();

  throwWithError();

  return {
    afterImage,
    drops: dropSqls,
    createsAndAlters: createAndAlterSqls,
  };
}

/**
 * Return all changes in artifacts between two given models.
 * Note: Only supports changes in entities (not views etc.) compiled/rendered as HANA-CSN/SQL.
 *
 * @param {CSN.Model}  csn          A clean input CSN representing the desired "after-image"
 * @param {HdiOptions} options      Options
 * @param {object}     messageFunctions Message functions such as `error()`, `info()`, …
 * @param {CSN.Model}  beforeImage  A HANA-transformed CSN representing the "before-image", or null in case no such image
 *                                  is known, i.e. for the very first migration step
 * @returns {migration} The migration result
 */
function hdiMigration( csn, options, messageFunctions, beforeImage ) {
  const internalOptions = prepareOptions.to.hdi(options);
  messageFunctions.setOptions( internalOptions );
  handleTenantDiscriminator(options, internalOptions, messageFunctions);

  // Prepare after-image.
  const afterImage = forHdi(csn, options, messageFunctions);

  const diff = modelCompare.compareModels(beforeImage || afterImage, afterImage, internalOptions);
  messageFunctions.setModel(diff);

  // Convert the diff to SQL.
  if (!internalOptions.beta)
    internalOptions.beta = {};

  internalOptions.beta.sqlExtensions = true;

  // Ignore constraint drops - that is handled by .hdbconstraint et. al.
  const {
    // eslint-disable-next-line no-unused-vars
    deletions, migrations, constraintDeletions, ...hdbkinds
  } = toSql.toSqlDdl(diff, internalOptions, messageFunctions);

  return {
    afterImage,
    definitions: createSqlDefinitions(hdbkinds, afterImage),
    deletions: createSqlDeletions(deletions, beforeImage),
    migrations: createSqlMigrations(migrations, afterImage),
  };
}

/**
 * From the given SQLs, create the correct result structure.
 *
 * @param {object} hdbkinds Object of hdbkinds (such as `hdbindex`) mapped to dictionary of artifacts.
 * @param {CSN.Model} afterImage CSN, used to create correct file names in result structure.
 * @returns {object[]} Array of objects, each having: name, suffix and sql
 */
function createSqlDefinitions( hdbkinds, afterImage ) {
  const result = [];
  objectUtils.forEach(hdbkinds, (kind, artifacts) => {
    const suffix = `.${ kind }`;
    objectUtils.forEach(artifacts, (name, sqlStatement) => {
      if ( kind !== 'hdbindex' )
        result.push({ name: getFileName(name, afterImage), suffix, sql: sqlStatement });
      else
        result.push({ name, suffix, sql: sqlStatement });
    });
  });
  return result;
}
/**
 * From the given deletions, create the correct result structure.
 *
 * @param {object} deletions Dictionary of deletions, only keys are used.
 * @param {CSN.Model} beforeImage CSN used to create correct file names in result structure.
 * @returns {object[]} Array of objects, each having: name and suffix - only .hdbtable as suffix for now
 */
function createSqlDeletions( deletions, beforeImage ) {
  const result = [];
  objectUtils.forEach(deletions, name => result.push({ name: getFileName(name, beforeImage), suffix: beforeImage.definitions[name].query ? '.hdbview' : '.hdbtable' }));
  return result;
}
/**
 * From the given migrations, create the correct result structure.
 *
 * @param {object} migrations Dictionary of changesets (migrations).
 * @param {CSN.Model} afterImage CSN used to create correct file names in result structure.
 * @returns {object[]} Array of objects, each having: name, suffix and changeset.
 */
function createSqlMigrations( migrations, afterImage ) {
  const result = [];
  objectUtils.forEach(migrations, (name, changeset) => result.push({ name: getFileName(name, afterImage), suffix: '.hdbmigrationtable', changeset }));
  return result;
}

hdi.migration = hdiMigration;

sql.migration = sqlMigration;

/**
 * Process the given CSN into HDBCDS artifacts.
 *
 * @param {any} csn A clean input CSN
 * @param {HdbcdsOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {HDBCDS} { <filename>:<content>, ...}
 */
function hdbcds( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.hdbcds(options);
  internalOptions.transformation = 'hdbcds';
  messageFunctions.setOptions( internalOptions );

  // Since v5, the HDBCDS backend is considered deprecated.
  // Since v6, it is a configurable error.
  messageFunctions.message('api-deprecated-hdbcds', null, null);

  if (options.tenantDiscriminator) {
    messageFunctions.error('api-invalid-option', null, {
      '#': 'forbidden',
      option: 'tenantDiscriminator',
      module: 'to.hdbcds',
    });
    messageFunctions.throwWithAnyError();
  }

  const hanaCsn = forHdbcds(csn, internalOptions, messageFunctions);
  messageFunctions.setModel(hanaCsn);
  const result = toHdbcds.toHdbcdsSource(hanaCsn, internalOptions, messageFunctions);
  return flattenResultStructure(result);
}
/**
 * Generate an edm document for the given service
 *
 * @param {CSN|oDataCSN} csn Clean input CSN or a pre-transformed CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {edm} The JSON representation of the service
 */
function edm( csn, options, messageFunctions ) {
  // If not provided at all, set service to 'undefined' to trigger validation
  const internalOptions = prepareOptions.to.edm(
    options.service ? options : Object.assign({ service: undefined }, options)
  );
  messageFunctions.setOptions( internalOptions );

  const { service } = options;

  let servicesEdmj;
  if (isPreTransformed(csn, 'odata')) {
    checkPreTransformedCsn(csn, internalOptions, relevantOdataOptions,
                           warnAboutMismatchOdata, messageFunctions);
    servicesEdmj = preparedCsnToEdm(csn, service, internalOptions, messageFunctions);
  }
  else {
    const oDataCsn = odataInternal(csn, internalOptions, messageFunctions);
    messageFunctions.setModel(oDataCsn);
    servicesEdmj = preparedCsnToEdm(oDataCsn, service, internalOptions, messageFunctions);
  }
  return servicesEdmj.edmj;
}

edm.all = edmall;

/**
 * Generate edm documents for all services
 *
 * @param {CSN|oDataCSN} csn Clean input CSN or a pre-transformed CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {edms} { <service>:<JSON representation>, ...}
 */
function edmall( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.edm(options);
  messageFunctions.setOptions( internalOptions );
  const { error } = messageFunctions;

  if (internalOptions.odataVersion === 'v2')
    error(null, null, {}, 'OData JSON output is not available for OData V2');

  const result = {};
  let oDataCsn = csn;

  if (isPreTransformed(csn, 'odata')) {
    checkPreTransformedCsn(csn, internalOptions, relevantOdataOptions,
                           warnAboutMismatchOdata, messageFunctions);
  }
  else {
    oDataCsn = odataInternal(csn, internalOptions, messageFunctions);
  }

  messageFunctions.setModel(oDataCsn);
  const servicesJson = preparedCsnToEdmAll(oDataCsn, internalOptions, messageFunctions);
  const services = servicesJson.edmj;
  for (const serviceName in services)
    result[serviceName] = services[serviceName];

  return result;
}
/**
 * Generate an edmx document for the given service
 *
 * @param {CSN|oDataCSN} csn Clean input CSN or a pre-transformed CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {edmx} The XML representation of the service
 */
function edmx( csn, options, messageFunctions ) {
  // If not provided at all, set service to 'undefined' to trigger validation
  const internalOptions = prepareOptions.to.edmx(
    options.service ? options : Object.assign({ service: undefined }, options)
  );
  messageFunctions.setOptions( internalOptions );

  const { service } = options;

  let services;
  if (isPreTransformed(csn, 'odata')) {
    checkPreTransformedCsn(csn, internalOptions, relevantOdataOptions,
                           warnAboutMismatchOdata, messageFunctions);
    services = preparedCsnToEdmx(csn, service, internalOptions, messageFunctions);
  }
  else {
    const oDataCsn = odataInternal(csn, internalOptions, messageFunctions);
    messageFunctions.setModel(oDataCsn);
    services = preparedCsnToEdmx(oDataCsn, service, internalOptions, messageFunctions);
  }

  return services.edmx;
}

edmx.all = edmxall;

/**
 * Generate edmx documents for all services
 *
 * @param {CSN|oDataCSN} csn Clean input CSN or a pre-transformed CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {edmxs} { <service>:<XML representation>, ...}
 */
function edmxall( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.edmx(options);
  messageFunctions.setOptions( internalOptions );

  const result = {};
  let oDataCsn = csn;

  if (isPreTransformed(csn, 'odata')) {
    checkPreTransformedCsn(csn, internalOptions, relevantOdataOptions,
                           warnAboutMismatchOdata, messageFunctions);
  }
  else {
    oDataCsn = odataInternal(csn, internalOptions, messageFunctions);
  }

  messageFunctions.setModel(oDataCsn);
  const servicesEdmx = preparedCsnToEdmxAll(oDataCsn, internalOptions, messageFunctions);
  const services = servicesEdmx.edmx;
  // Create annotations and metadata once per service
  for (const serviceName in services) {
    const lEdm = services[serviceName];
    result[serviceName] = lEdm;
  }

  return result;
}

/**
 * Generate an EDM document for the given service in XML and JSON representation
 * If odataVersion is not 'v4', then no JSON is rendered
 *
 * @param {CSN|oDataCSN} csn Clean input CSN or a pre-transformed CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} { <protocol> : { <ServiceName>: { edmx: <XML representation>, edm: <JSON representation> } } }
 */
// @ts-ignore
function odata2( csn, options, messageFunctions ) {
  // If not provided at all, set service to 'undefined' to trigger validation
  const internalOptions = prepareOptions.to.odata(
    options.service ? options : Object.assign({ service: undefined }, options)
  );
  messageFunctions.setOptions( internalOptions );

  const { service } = options;

  let oDataCsn = csn;
  if (isPreTransformed(csn, 'odata')) {
    checkPreTransformedCsn(csn, internalOptions, relevantOdataOptions,
                           warnAboutMismatchOdata, messageFunctions);
  }
  else {
    oDataCsn = odataInternal(csn, internalOptions, messageFunctions);
    messageFunctions.setModel(oDataCsn);
  }

  const edmIR = csnToEdm.csn2edm(oDataCsn, service, internalOptions, messageFunctions);


  const version = internalOptions.odataVersion;
  const result = { [version]: { [service]: {} } };

  if (edmIR) {
    result[version][service].edmx = edmIR.toXML();
    if (version === 'v4')
      result[version][service].edm = edmIR.toJSON();
  }
  return result;
}

odata2.all = odataall;

/**
 * Generate EDM documents for all services in XML and JSON representation
 * If odataVersion is not 'v4', then no JSON is rendered
 *
 * @param {CSN|oDataCSN} csn Clean input CSN or a pre-transformed CSN
 * @param {ODataOptions} options Options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} { <protocol>: { <serviceName>: { edmx: <XML representation>, edm: <JSON representation> } } }
 */
function odataall( csn, options, messageFunctions ) {
  const internalOptions = prepareOptions.to.odata(options);
  messageFunctions.setOptions( internalOptions );
  const { error } = messageFunctions;

  if (internalOptions.odataVersion === 'v2')
    error(null, null, {}, 'OData JSON output is not available for OData V2');

  let oDataCsn = csn;
  if (isPreTransformed(csn, 'odata')) {
    checkPreTransformedCsn(csn, internalOptions, relevantOdataOptions,
                           warnAboutMismatchOdata, messageFunctions);
  }
  else {
    oDataCsn = odataInternal(csn, internalOptions, messageFunctions);
    messageFunctions.setModel(oDataCsn);
  }

  const edmIR = csnToEdm.csn2edmAll(oDataCsn, internalOptions, undefined, messageFunctions);

  const version = internalOptions.odataVersion;

  const result = {};
  result[version] = {};

  if (edmIR) {
    for (const serviceName in edmIR) {
      result[version][serviceName] = { edmx: edmIR[serviceName].toXML() };
      if (internalOptions.odataVersion === 'v4')
        result[version][serviceName].edm = edmIR[serviceName].toJSON();
    }
  }
  return result;
}

/**
 * Generate edmx for given 'service' based on 'csn' (new-style compact, already prepared for OData)
 * using 'options'
 *
 * @param {CSN.Model} csn Input CSN model. Must be OData transformed CSN.
 * @param {string} service Service name to use. If you want all services, use preparedCsnToEdmxAll()
 * @param {ODataOptions} options OData / EDMX specific options.
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} Rendered EDMX string for the given service.
 */
function preparedCsnToEdmx( csn, service, options, messageFunctions ) {
  timetrace.timetrace.start('EDMX rendering');
  const e = csnToEdm.csn2edm(csn, service, options, messageFunctions)?.toXML('all');
  timetrace.timetrace.stop('EDMX rendering');
  return { edmx: e };
}

/**
 * Generate edmx for given 'service' based on 'csn' (new-style compact, already prepared for OData)
 * using 'options'.
 *
 * @param {CSN.Model} csn Input CSN model. Must be OData transformed CSN.
 * @param {ODataOptions} options OData / EDMX specific options.
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} Dictionary of rendered EDMX strings for each service.
 */
function preparedCsnToEdmxAll( csn, options, messageFunctions ) {
  timetrace.timetrace.start('EDMX all rendering');
  const edmxResult = csnToEdm.csn2edmAll(csn, options, undefined, messageFunctions);
  for (const service in edmxResult)
    edmxResult[service] = edmxResult[service].toXML('all');
  timetrace.timetrace.stop('EDMX all rendering');
  return { edmx: edmxResult };
}

/**
 * Generate edm-json for given 'service' based on 'csn' (new-style compact, already prepared for OData)
 * using 'options'
 *
 * @param {CSN.Model} csn Input CSN model. Must be OData transformed CSN.
 * @param {string} service Service name for which EDMX should be rendered.
 * @param {ODataOptions} options OData / EDMX specific options.
 * @param {object} [messageFunctions] Message functions such as `error()`, `info()`, …
 * @returns {object} Rendered EDM JSON object for of the given service.
 */
function preparedCsnToEdm( csn, service, options, messageFunctions ) {
  timetrace.timetrace.start('EDM rendering');
  // Override OData version as edm json is always v4
  options.odataVersion = 'v4';
  const e = csnToEdm.csn2edm(csn, service, options, messageFunctions)?.toJSON();
  timetrace.timetrace.stop('EDM rendering');
  return { edmj: e };
}

/**
 * Generate edm-json for given 'service' based on 'csn' (new-style compact, already prepared for OData)
 * using 'options'
 *
 * @param {CSN.Model} csn Input CSN model. Must be OData transformed CSN.
 * @param {ODataOptions} options OData / EDMX specific options.
 * @param {object} [messageFunctions] Message functions such as `error()`, `info()`, …
 * @returns {object} Dictionary of rendered EDM JSON objects for each service.
 */
function preparedCsnToEdmAll( csn, options, messageFunctions ) {
  timetrace.timetrace.start('EDM all rendering');
  // Override OData version as edm json is always v4
  options.odataVersion = 'v4';
  const edmj = csnToEdm.csn2edmAll(csn, options, undefined, messageFunctions);
  for (const service in edmj)
    edmj[service] = edmj[service].toJSON();
  timetrace.timetrace.stop('EDM all rendering');
  return {
    edmj,
  };
}


/**
 * Flatten the result structure to a flat map.
 *
 * Don't loop over messages.
 *
 * @param {object} toProcess { <type>: { <name>:<content>, ...}, <type>: ...}
 * @returns {object} { <name.type>:<content> }
 */
function flattenResultStructure( toProcess ) {
  const result = {};
  objectUtils.forEach(toProcess, (fileType, artifacts) => {
    if (fileType === 'messages')
      return;
    objectUtils.forEach(artifacts, (filename) => {
      result[`${ filename }.${ fileType }`] = artifacts[filename];
    });
  });

  return result;
}


module.exports = {
  odata: publishCsnProcessor(odata, 'for.odata'),
  java: publishCsnProcessor(java, 'for.java'),
  cdl: publishCsnProcessor(cdl, 'to.cdl'),
  sql: publishCsnProcessor(sql, 'to.sql'),
  hdi: publishCsnProcessor(hdi, 'to.hdi'),
  hdbcds: publishCsnProcessor(hdbcds, 'to.hdbcds'),
  edm: publishCsnProcessor(edm, 'to.edm'),
  edmx: publishCsnProcessor(edmx, 'to.edmx'),
  odata2: publishCsnProcessor(odata2, 'to.odata'),
  /** Internal only */
  for_sql: publishCsnProcessor(forSql, 'for.sql'),
  for_hdi: publishCsnProcessor(forHdi, 'for.hdi'),
  for_hdbcds: publishCsnProcessor(forHdbcds, 'for.hdbcds'),
  for_effective: publishCsnProcessor(forEffective, 'for.effective'),
  for_seal: publishCsnProcessor(forSeal, 'for.seal'),
};


/**
 * @param {any} processor CSN processor
 * @param {string} _name Name of the processor
 * @returns {any} Function that calls the processor and recompiles in case of internal errors
 */
function publishCsnProcessor( processor, _name ) {
  api.internal = processor;

  if (processor.all)
    api.all = publishCsnProcessor(processor.all, `${ _name }.all`);

  if (processor.migration)
    api.migration = publishCsnProcessor(processor.migration, `${ _name }.migration`);

  return api;

  /**
   * Function that calls the processor and re-compiles in case of internal errors
   *
   * @param {CSN.Model} csn CSN
   * @param {CSN.Options} options Options
   * @param {any} args Any additional arguments
   * @returns {any} What ever the processor returns
   */
  function api( csn, options = {}, ...args ) {
    trace.traceApi(_name, options);
    const originalMessageLength = options.messages?.length;
    try {
      const messageFunctions = messages.makeMessageFunction(csn, options, _name);
      if (options.deprecated)
        baseModel.checkRemovedDeprecatedFlags( options, messageFunctions );

      checkOutdatedOptions( options, messageFunctions );
      csn = ensureClientCsn( csn, options, messageFunctions, _name );
      messageFunctions.throwWithError();
      messageFunctions.setModel(csn);

      timetrace.timetrace.start(_name);
      const result = processor( csn, options, messageFunctions, ...args );
      timetrace.timetrace.stop(_name);
      return result;
    }
    catch (err) {
      timetrace.timetrace.reset('Exception in backend triggered');
      if (err instanceof messages.CompilationError || options.noRecompile || isPreTransformed(csn, 'odata')) // we cannot recompile a pre-transformed CSN
        throw err;

      if (options.testMode && !(err instanceof TypeError) &&
        !(err instanceof baseError.ModelError))
        throw err;

      // Reset messages to what we had before the backend crashed.
      // Backends may report the same issues again after compilation.
      if (originalMessageLength !== undefined)
        options.messages.length = originalMessageLength;

      const messageFunctions = messages.makeMessageFunction( csn, options, _name );
      const recompileMsg = messageFunctions.info( 'api-recompiled-csn', location.emptyLocation('csn.json'), {},
                                                  'CSN input had to be recompiled' );
      if (options.internalMsg || options.testMode)
        recompileMsg.error = err; // Attach original error;
      if (options.testMode)  // Attach recompilation reason in testMode
        recompileMsg.message += `\n   ↳ cause: ${ err.message }`;

      const xsn = compiler.recompileX(csn, options);
      const recompiledCsn = toCsn.compactModel(xsn);
      messageFunctions.setModel(recompiledCsn);
      return processor( recompiledCsn, options, messageFunctions, ...args );
    }
  }
}

// Note: No toCsn, because @sap/cds may still use it (2022-06-15)
const oldBackendOptionNames = [ 'toSql', 'toOdata', 'toHana', 'forHana' ];
/**
 * Checks if outdated options are used and if so, throw a compiler error.
 * These include:
 *  - magicVars (now variableReplacements)
 *  - toOdata/toSql/toHana/forHana -> now flat options
 *
 * @param {CSN.Options} options Backend options
 * @param {object} messageFunctions Functions returned by makeMessageFunction()
 */
function checkOutdatedOptions( options, messageFunctions ) {
  // This error has been emitted once, we don't need to emit it again.
  if (options.messages?.some(m => m.messageId === 'api-invalid-option' || m.messageId === 'api-invalid-variable-replacement'))
    return;

  for (const name of oldBackendOptionNames) {
    if (typeof options[name] === 'object') // may be a boolean due to internal options
      messageFunctions.error('api-invalid-option', null, { '#': 'deprecated', name });
  }

  if (options.magicVars)
    messageFunctions.error('api-invalid-option', null, { '#': 'magicVars', prop: 'magicVars', otherprop: 'variableReplacements' });

  // Don't check `options.magicVars`.  It's likely that the user renamed `magicVars` but
  // forgot about user -> $user and locale -> $user.locale
  if (options.variableReplacements?.user) {
    messageFunctions.error('api-invalid-variable-replacement', null, {
      '#': 'user', option: 'variableReplacements', prop: '$user', otherprop: 'user',
    });
  }
  if (options.variableReplacements?.locale) {
    messageFunctions.error('api-invalid-variable-replacement', null, {
      '#': 'locale', option: 'variableReplacements', prop: '$user.locale', otherprop: 'locale',
    });
  }

  objectUtils.forEachKey(options.variableReplacements || {}, (name) => {
    if (!name.startsWith('$') && name !== 'user' && name !== 'locale') {
      messageFunctions.error('api-invalid-variable-replacement', null, {
        '#': 'noDollar', option: 'variableReplacements', code: '$', name,
      });
    }
  });
}

/**
 * Checks that the given CSN is usable by our backends, e.g. that
 * the CSN is not a gensrc (a.k.a. xtended) for most backends.
 *
 * Returns the input CSN if it is acceptable or compiles the input CSN if it does not
 * have the expected CSN flavor.
 *
 * The compiler does not set any marker in `meta`; we use the umbrella one
 * for easier debugging.
 *
 * For reference, cds-compiler/cds-dk CSN flavor map:
 *  - client -> inferred
 *  - gensrc -> xtended
 *  - parseCdl -> parsed
 *
 * If this function becomes more complex (e.g. more module conditions),
 * move it from then generic api wrapper to the individual module.
 *
 * @param {CSN.Model} csn User CSN
 * @param {CSN.Options} options User options
 * @param {object} messageFunctions Functions returned by makeMessageFunction()
 * @param {string} module Backend module, e.g. to.cdl or to.sql
 * @returns {CSN.Model} CSN that works for backends.
 */
function ensureClientCsn( csn, options, messageFunctions, module ) {
  if (module === 'to.cdl' || !csn)
    return csn; // to.cdl allows every CSN flavor

  if (csn.meta?.flavor === 'xtended') {
    messageFunctions.error('api-unsupported-csn-flavor', null, { name: module, option: csn.meta?.flavor });
    return csn;
  }

  // `parsed` CSN is allowed if it can be compiled (i.e. no `requires`).
  // Still return false, because it's not client CSN. The caller must handle it.
  if (csn.meta?.flavor === 'parsed') {
    if (csn.requires?.length > 0) {
      messageFunctions.error('api-unsupported-csn-flavor', null, {
        '#': 'parsed-requires',
        name: module,
        prop: 'requires',
      });
      return csn;
    }

    // TODO: next line to be replaced by CSN parser call which reads the CSN object once the two API files are merged.
    const xsn = compiler.recompileX(csn, options);
    return toCsn.compactModel(xsn);
  }

  return csn;
}

/**
 * Error when tenantDiscriminator and withHanaAssociations is set by the user, or
 * if tenantDiscriminator is used with anything but "plain" mode.
 *
 * Set withHanaAssociations to false when tenantDiscriminator is used.
 *
 * @param {object} options Options set by the user
 * @param {object} internalOptions Options clone after we processed it
 * @param {object} messageFunctions Message functions
 */
function handleTenantDiscriminator( options, internalOptions, messageFunctions ) {
  if (options.tenantDiscriminator && options.withHanaAssociations && internalOptions.sqlDialect === 'hana') {
    messageFunctions.error('api-invalid-combination', null, {
      option: 'tenantDiscriminator',
      prop: 'withHanaAssociations',
    });
  }

  if (options.tenantDiscriminator && internalOptions.sqlMapping !== 'plain') {
    messageFunctions.error('api-invalid-combination', null, {
      '#': 'tenant-and-naming',
      option: 'tenantDiscriminator',
      prop: internalOptions.sqlMapping,
      value: 'plain',
    });
  }

  messageFunctions.throwWithError();

  if (internalOptions.tenantDiscriminator)
    internalOptions.withHanaAssociations = false;
}


/**
 * Option format used by the old API, where they are grouped thematically.
 *
 * @typedef {object} NestedOptions
 */

/**
 * Option format used by the new API, where all options are top-level.
 *
 * @typedef {object} FlatOptions
 */

/**
 * Available SQL dialects
 *
 * @typedef {'hana' | 'sqlite' } SQLDialect
 */

/**
 * Available naming modes
 *
 * @typedef {'plain' | 'quoted' | 'hdbcds' } NamingMode
 */

/**
 * Available oData versions
 *
 * @typedef {'v2' | 'v4' } oDataVersion
 */

/**
 * Available oData versions
 *
 * @typedef { 'structured' | 'flat' } oDataFormat
 */

/**
 * A fresh (just compiled, not transformed) CSN
 *
 * @typedef {object} CSN
 */

/**
 * A CSN transformed for oData - can be rendered to edm or edmx
 *
 * @typedef {CSN.Model} oDataCSN
 */

/**
 * The CDL representation of a model
 *
 * @typedef {object} CDL
 */

/**
 * A map of { <file.hdbcds|hdbconstraint>:<content> }.
 *
 * @typedef {object} HDBCDS
 */

/**
 * A map of { <file.hdbtable|hdbview|hdbconstraint...>:<content> }.
 *
 * @typedef {object} HDIArtifacts
 */

/**
 * A SQL statement - CREATE TABLE, CREATE VIEW etc.
 *
 * @typedef {string} SQL
 */

/**
 * The XML document representing the service.
 *
 * @typedef {object} edmx
 */

/**
 * The JSON document representing the service.
 *
 * @typedef {object} edm
 */

/**
 * A map of { <serviceName>:<XML> }.
 *
 * @typedef {object} edmxs
 */

/**
 * A map of { <serviceName>:<JSON> }.
 *
 * @typedef {object} edms
 */

/**
 * - afterImage:  The desired after-image in db-CSN format
 * - definitions: An array of objects with all artifacts in the after-image. Each object specifies
 *                the artifact filename, the suffix, and the corresponding SQL statement to create
 *                the artifact.
 * - deletions:   An array of objects with the deleted artifacts. Each object specifies the artifact
 *                filename and the suffix.
 * - migrations:  An array of objects with the changed (migrated) artifacts. Each object specifies the
 *                artifact filename, the suffix, and the changeset (an array of changes, each specifying
 *                whether it incurs potential data loss, and its respective SQL statement(s), with
 *                multiple statements concatenated as a multi-line string in case the change e.g.
 *                consists of a column drop and add).
 *
 * @typedef {object} migration
 */
