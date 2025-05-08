'use strict';

const { applyTransformationsOnNonDictionary } = require('../model/csnUtils');

/**
 * Check all refs in the given parent for the traversal of paths
 * into `.items`
 *
 * @param {object} parent Object with the expression as a property
 * @param {string} propOnParent Name of the expression property on parent
 * @param {Array} e Expression to check - see module.exports
 * @param {CSN.Path} path
 */
function navigationIntoMany( parent, propOnParent, e, path ) {
  applyTransformationsOnNonDictionary(parent, propOnParent, {
    ref: (_parent, _prop, ref, _path) => {
      const itemNavigationIndex = _parent._links?.findIndex(l => l.art.items);
      if (itemNavigationIndex !== -1 && _parent.ref.length > itemNavigationIndex + 1)
        this.message('ref-unexpected-many-navigation', _path);
    },
  }, { skipStandard: { type: true } }, path);
}

module.exports = {
  columns: navigationIntoMany,
  from: navigationIntoMany,
  on: navigationIntoMany,
  having: navigationIntoMany,
  groupBy: navigationIntoMany,
  orderBy: navigationIntoMany,
  where: navigationIntoMany,
  xpr: navigationIntoMany,
};
