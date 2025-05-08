'use strict';

const { forEachDefinition, applyTransformationsOnNonDictionary } = require('../../model/csnUtils');

/**
 * - Make .projections look like simple SELECTS
 * - ensure we always have a .columns by adding a .columns = ['*'] if none is present
 * @param {CSN.Model} csn
 * @returns {Function[]} Callbacks to re-add the .projection
 */
function projectionToSELECTAndAddColumns( csn ) {
  const redoProjections = [];
  forEachDefinition(csn, (artifact) => {
    if (artifact.projection) {
      if (!artifact.projection.columns)
        artifact.projection.columns = [ '*' ];
      artifact.query = { SELECT: artifact.projection };
      delete artifact.projection;
      redoProjections.push(() => {
        if (artifact.query) {
          artifact.projection = artifact.query.SELECT;
          delete artifact.query;
          if (artifact.$syntax === 'projection')
            delete artifact.$syntax;
        }
      });
    }
    else if (artifact.query) {
      applyTransformationsOnNonDictionary(artifact, 'query', {
        SELECT: (parent, prop, SELECT) => {
          SELECT.columns ??= [ '*' ];
        },
      });
    }
  });

  return redoProjections;
}

module.exports = { projectionToSELECTAndAddColumns };
