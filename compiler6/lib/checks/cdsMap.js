'use strict';

const { hasNonEnumerable } = require('../utils/objectUtils');

/**
 * We don't support cds.Map in conjunction with .elements yet. To ensure that no one uses it and accidentally creates an
 * empty structured type, we check for it and forbid it.
 *
 * Non-enumerable .elements are added by cds.linked - we silently remove them and proceed as usual.
 *
 * @param {*} parent
 * @param {*} prop
 * @param {*} type
 * @param {*} path
 */
function checkCdsMap( parent, prop, type, path ) {
  if (type === 'cds.Map' && parent.elements) {
    if (hasNonEnumerable(parent, 'elements'))
      delete parent.elements; // linked CSN sets a non-enumerable empty elements on cds.Map
    else
      this.error('type-unexpected-elements-for-map', path, { id: path.at(-1), type: 'cds.Map' }, 'Unexpected .elements for element $(ID) of type $(TYPE)');
  }
}

module.exports = {
  type: checkCdsMap,
};
