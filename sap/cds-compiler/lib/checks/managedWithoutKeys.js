'use strict';

const { ModelError } = require('../base/error');

/**
 * Trigger a recompilation in case of an to-one association without .keys and without .on
 *
 * @param {CSN.Element} member the element to be checked
 * @param {string} memberName the elements name
 * @param {string} prop which kind of member are we looking at -> only prop "elements"
 */
function managedWithoutKeys( member, memberName, prop ) {
  if (prop === 'elements' && member.target && !member.keys && !member.on) {
    const targetMax = member.cardinality?.max;
    if (!targetMax || targetMax === 1)
      throw new ModelError('Expected association to have either an on-condition or foreign keys.');
  }
}

module.exports = managedWithoutKeys;
