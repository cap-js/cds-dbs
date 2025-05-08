'use strict';

const { setProp, isBetaEnabled } = require('../../base/model');
const { hasPersistenceSkipAnnotation } = require('../../model/csnUtils');

const sqlServiceAnnotation = '@protocol';

/**
 * Find all entities in SQL services and mark them with an annotation and
 * remember them in a symbol property for easier processing in toSql-rendering.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @returns {Function}
 */
function processSqlServices(csn, options) {
  setProp(csn, '$sqlServiceEntities', Object.create(null));
  setProp(csn, '$dummyServiceEntities', Object.create(null));
  return function findAndMarkSqlServiceArtifacts(artifact, artifactName) {
    const { sqlServiceName, dummyServiceName } = isEntityInSqlService(artifact, artifactName, csn, options);
    if (sqlServiceName?.length > 0)
      setProp(artifact, '$sqlService', sqlServiceName);
    if (dummyServiceName?.length > 0)
      setProp(artifact, '$dummyService', dummyServiceName);
  };
}

/**
 *
 * @param {CSN.Artifact} artifact
 * @returns {boolean}
 */
function isSqlService(artifact) {
  return artifact.kind === 'service' && artifact[sqlServiceAnnotation] === 'sql';
}

/**
 * Checks if the given artifact is an external ABAP SQL service.
 *
 * @param {object} artifact - The artifact to check.
 * @param {CSN.Options} options
 * @returns {boolean} - Returns true if the artifact is an external ABAP SQL service, otherwise false.
 */
function isDummyService(artifact, options) {
  return isBetaEnabled(options, 'sqlServiceDummies') && artifact.kind === 'service' && artifact['@cds.external'] && artifact[sqlServiceAnnotation] === 'dummy';
}

/**
 * Determines if an artifact is part of a SQL service or an external ABAP SQL service.
 *
 * @param {object} artifact - The artifact to check.
 * @param {string} artifactName - The name of the artifact.
 * @param {object} csn - The CSN (Core Schema Notation) object containing definitions.
 * @param {CSN.Options} options
 * @returns {object} An object containing the names of the SQL service and external ABAP SQL service, if found.
 */
function isEntityInSqlService(artifact, artifactName, csn, options) {
  const result = { sqlServiceName: undefined, dummyServiceName: undefined };
  if (artifact.kind !== 'entity' || !artifactName.includes('.') || hasPersistenceSkipAnnotation(artifact))
    return result;

  const nameParts = artifactName.split('.');
  for (let i = nameParts.length - 1; i >= 0; i--) {
    const possibleServiceName = nameParts.slice(0, i).join('.');
    if (!csn.definitions[possibleServiceName])
      continue;

    const definition = csn.definitions[possibleServiceName];
    if (isSqlService(definition))
      result.sqlServiceName = possibleServiceName;

    if (isDummyService(definition, options))
      result.dummyServiceName = possibleServiceName;

    // We don't allow nested services/contexts - if we find one, we don't need to keep searching
    if (definition.kind === 'service' || definition.kind === 'context')
      return result;
  }

  return result;
}

/**
 * Creates a dummy ABAP SQL service for the given artifact if it is marked as an external ABAP SQL service.
 * The dummy service is a copy of the original artifact with certain properties removed.
 * The dummy service is then added to the CSN (Core Schema Notation) definitions.
 *
 * @param {object} artifact - The artifact to create a dummy service for.
 * @param {string} artifactName - The name of the artifact.
 * @param {object} csn - The Core Schema Notation (CSN) object where the dummy service will be added.
 * @param {object} messageFunctions
 * @param {Function} messageFunctions.error
 */
function createServiceDummy(artifact, artifactName, csn, { error }) {
  if (!artifact.$dummyService)
    return;

  artifact['@cds.persistence.exists'] = true;
  artifact.$ignore = true;

  const dummy = { ...artifact };
  delete dummy['@cds.persistence.exists'];
  delete dummy.$ignore;

  if (csn.definitions[`dummy.${ artifactName }`])
    error(null, [ 'definitions', artifactName ], { name: `dummy.${ artifactName }` }, 'Generated artifact name $(NAME) conflicts with existing entity');
  else
    csn.definitions[`dummy.${ artifactName }`] = dummy;
}

module.exports = {
  processSqlServices,
  isSqlService,
  isDummyService,
  sqlServiceAnnotation,
  createServiceDummy,
};
