'use strict';

/**
 * A path following an “exists” predicate must always end in an association.
 *
 * @param {object} parent
 * @param {string} prop
 * @param {Array} expression
 * @param {CSN.Path} path
 */
function existsMustEndInAssoc( parent, prop, expression, path ) {
  for (let i = 0; i < expression?.length - 1; i++) {
    if (expression[i] === 'exists') {
      const next = expression[i + 1];
      const { _art } = next;
      const errorPath = path.concat([ prop, i ]);
      if (!next.SELECT && !_art?.target) {
        this.error('ref-expecting-assoc', errorPath, {
          '#': _art.type ? 'with-type' : 'std',
          elemref: next,
          type: _art.type,
        });
      }
    }
  }
}

module.exports = {
  having: existsMustEndInAssoc,
  where: existsMustEndInAssoc,
  xpr: existsMustEndInAssoc,
};
