'use strict';

const { ModelError } = require('../base/error');

/**
 * Removes the `enum` property - the compiler already resolved them.
 *
 * @param {Object} parent
 */
function removeEnum( parent ) {
  delete parent.enum;
}

/**
 * Check if '#' has a  `val` property. If val is undefined, an error is logged as this means that the compiler could not resolve the reference.
 *
 * If the reference was resolved, remove # and keep the .val.
 *
 * @param {Object} parent
 */
function checkAndRemoveHash( parent ) {
  if (parent.val === undefined)
    throw new ModelError('Expected value to be resolved by the compiler - throwing exception to trigger recompilation.');

  delete parent['#'];
}

module.exports = {
  enum: removeEnum,
  '#': checkAndRemoveHash,
};
