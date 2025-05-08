'use strict';

const {
  applyTransformations,
} = require('../../model/csnUtils');
const { setProp } = require('../../base/model');

/**
 * Set the annotation on the carrier if it is not already present.
 *
 * @param {object} carrier Object having/getting the annotation
 * @param {string} name Name of the annotations
 * @param {any} value Value of the annotation
 */
function setAnnotationIfNotDefined( carrier, name, value ) {
  if (carrier[name] === undefined)
    carrier[name] = value;
}

/**
 * Strip/change the CSN to ensure compatibility with what we have in the client CSN
 * - Removes every occurrence of '$origin', '$generated' and '$source'
 * - elements of subqueries become non-enumerable
 * - remove `actions|params|virtual|notNull: null`, this stops the inheritance of the actions/params/virtual
 *   along the $origin chain, this can be ignored for the comparison in our tests.
 *
 * @param {CSN.Model} csn
 */
function makeClientCompatible( csn ) {
  applyTransformations(csn, {
    actions: removeNullProperty,
    notNull: removeNullProperty,
    params: removeNullProperty,
    virtual: removeNullProperty,
    $origin: (parent, prop) => delete parent[prop],
    $generated: (parent, prop) => delete parent[prop],
    $source: (parent, prop) => delete parent[prop],
    SELECT: (parent, prop, query) => {
      if (query.elements)
        setProp(query, 'elements', query.elements);
    },
    SET: (parent, prop, query) => {
      if (query.elements)
        setProp(query, 'elements', query.elements);
    },
  });
}

/**
 * Removes the `prop` from the `node` if `prop === null`
 *
 * @param {object} node
 * @param {string} prop
 */
function removeNullProperty( node, prop ) {
  if (node[prop] === null)
    delete node[prop];
}

module.exports = {
  setAnnotationIfNotDefined,
  makeClientCompatible,
};
