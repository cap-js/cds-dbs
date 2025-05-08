'use strict';

// Only to be used with validator.js - a correct this value needs to be provided!

/**
 * Ensure that `@cds.persistence.[table||udf||calcview]` are not used in combination.
 *
 * @param {CSN.Artifact} artifact Artifact to validate
 * @param {string} artifactName Name of the artifact
 * @param {string} prop Property being looped over
 * @param {CSN.Path} path Path to the artifact
 */
function validateCdsPersistenceAnnotation( artifact, artifactName, prop, path ) {
  if (artifact.kind === 'entity') {
    // filter for 'table', 'udf', 'calcview' === true
    const persistenceAnnos = [ '@cds.persistence.table', '@cds.persistence.udf', '@cds.persistence.calcview' ];
    // TODO: Why not filter over persistenceAnnos, is shorter!
    const TableUdfCv = Object.keys(artifact).filter(p => persistenceAnnos.includes(p) && artifact[p]);
    if (TableUdfCv.length > 1)
      this.error(null, path, { annos: TableUdfCv }, 'Annotations $(ANNOS) can\'t be used in combination');
  }
}

module.exports = validateCdsPersistenceAnnotation;
