'use strict';

const { setDependencies } = require('./csnUtils');
const { ModelError } = require('../base/error');

/**
 * @typedef {Object} Layers
 * @property {Array[]} layers
 *   An array of arrays, each subarray encompassing one Layer - L0 being layers[0].
 * @property {CSN.Artifact[]} leftover
 *   Any artifacts not sorted into a layer due to unmet dependencies.
 *   Points to there being some error.
 */

/**
 * Sort the given CSN into layers. Layer 0 contains artifacts without any dependencies,
 * L1 contains artifacts with dependencies exclusively to artifacts in L0, L2 contains artifacts
 * with dependencies exclusively to artifacts in L0 and L1, LN contains artifacts with dependencies
 * exclusively to LN-1,..,L0
 *
 * @param {CSN.Model} csn CSN to sort
 * @param {Symbol} _dependents Symbol used to attach the dependents
 * @param {Symbol} _dependencies Symbol used to attach the dependencies
 * @returns {Layers}
 */
function sortTopologically( csn, _dependents, _dependencies ) {
  const layers = [];
  let { zero, nonZero } = _calculateDepth(Object.entries(csn.definitions),
                                          _dependents, _dependencies);
  while (zero.length !== 0) {
    const currentLayer = [];
    zero.forEach(([ artifactName, artifact ]) => {
      currentLayer.push(artifactName);
      if (artifact[_dependents]) {
        Object.values(artifact[_dependents]).forEach((dependant) => {
          dependant.$pointers -= 1;
          dependant[_dependencies].delete(artifact);
        });
      }
    });
    layers.push(currentLayer);
    ({ zero, nonZero } = _findWithXPointers(nonZero, 0, _dependents, _dependencies));
  }

  return { layers, leftover: nonZero };
}

function _calculateDepth( definitionsArray, _dependents, _dependencies ) {
  const zero = [];
  const nonZero = [];

  definitionsArray.forEach(([ artifactName, artifact ]) => {
    if (artifact[_dependencies]) {
      artifact.$pointers = artifact[_dependencies].size;
      nonZero.push([ artifactName, artifact ]);
    }
    else {
      delete artifact.$pointers;
      zero.push([ artifactName, artifact ]);
    }
  });
  return {
    zero,
    nonZero,
  };
}

function _findWithXPointers( definitionsArray, x, _dependents, _dependencies ) {
  const zero = [];
  const nonZero = [];

  definitionsArray.forEach(([ artifactName, artifact ]) => {
    if (artifact.$pointers !== undefined && artifact.$pointers === x) {
      zero.push([ artifactName, artifact ]);
      if (artifact.$pointers === 0)
        delete artifact.$pointers;
    }
    else {
      nonZero.push([ artifactName, artifact ]);
    }
  });

  return {
    zero,
    nonZero,
  };
}

/**
 * Sort the given sql statements so that they can be deployed sequentially.
 * For ordering, only the FROM clause of views is checked - this requires A2J to
 * be run beforehand to resolve association usages.
 *
 * @param {{sql: string, csn: CSN.Model}} arg
 *   sql: Map of <object name>: "CREATE STATEMENT", csn: Model
 * @returns {{name: string, sql: string}[]}
 *   Sorted array of artifact name / "CREATE STATEMENTS" pairs
 */
module.exports = function sortViews({ sql, csn }) {
  const { cleanup, _dependents, _dependencies } = setDependencies(csn);
  const { layers, leftover } = sortTopologically(csn, _dependents, _dependencies);
  if (leftover.length > 0)
    throw new ModelError('Unable to build a correct dependency graph! Are there cycles?');

  const result = [];
  // keep the "artifact name" - needed for to.hdi sorting
  layers.forEach(layer => layer.forEach(objName => result.push({
    name: objName, sql: sql[objName], dependents: csn.definitions[objName][_dependents],
  })));
  // attach sql artifacts which are not considered during the view sorting algorithm
  // --> this is the case for "ALTER TABLE ADD CONSTRAINT" statements,
  //     because their identifiers are not part of the csn.definitions
  Object.entries(sql).forEach(([ name, sqlString ]) => {
    if (!result.some( o => o.name === name )) // not in result but in incoming sql
      result.push({ name, sql: sqlString });
  });

  cleanup.forEach(fn => fn());

  return result;
};
