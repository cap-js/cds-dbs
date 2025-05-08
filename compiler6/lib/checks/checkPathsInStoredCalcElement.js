'use strict';

const { requireForeignKeyAccess } = require('../checks/onConditions');
const { applyTransformationsOnNonDictionary } = require('../model/csnUtils');

/**
 * Check that all paths in calculated elements-on write either access normal fields
 * (structures are already rejected by the compiler) or access the foreign keys of
 * associations. Filters and parameters are not allowed.
 *
 * @param {CSN.Element} calculatedElement
 * @param {string} propOnParent
 * @param {object} valueOfCalculatedElement
 * @param {CSN.Path} path
 */
function checkPathsInStoredCalcElement( calculatedElement, propOnParent, valueOfCalculatedElement, path ) {
  if (calculatedElement.value.stored) {
    applyTransformationsOnNonDictionary(calculatedElement, 'value', {
      ref: (parent, prop, value, csnPath) => {
        _checkPathsInStoredCalcElement.call(this, parent, value, csnPath);
      },
    }, {}, path);
  }
}


/**
 * See comment for calling function above.
 *
 * @param {object} parent
 * @param {(string|object)[]} value
 * @param {CSN.Path} csnPath
 */
function _checkPathsInStoredCalcElement( parent, value, csnPath ) {
  const { _links } = parent;

  for (let i = 0; i < value.length; ++i) {
    let hasPathError = false;
    const step = value[i];
    const stepArt = _links[i].art;

    if (stepArt.value) {
      applyTransformationsOnNonDictionary(stepArt, 'value', {
        ref: (nestedParent, prop, nestedValue, path) => {
          _checkPathsInStoredCalcElement.call(this, nestedParent, nestedValue, path);
        },
      }, {}, csnPath);
    }
    else if (stepArt.target) {
      const id = step.id || step;
      if (stepArt.on) {
        // It's an unmanaged association - traversal is always forbidden
        this.error('ref-unexpected-navigation', csnPath, { '#': 'calc-unmanaged', id, elemref: parent });
        hasPathError = true;
      }
      else {
        // It's a managed association - access of the foreign keys is allowed
        requireForeignKeyAccess(parent, i, (errorIndex) => {
          this.error('ref-unexpected-navigation', csnPath, {
            '#': 'calc-non-fk', id, elemref: parent, name: value[errorIndex].id || value[errorIndex],
          });
          hasPathError = true;
        });
      }
    }
    if (typeof step === 'object') {
      if (step.where) {
        this.error('ref-unexpected-filter', csnPath, { '#': 'calc', elemref: parent });
        hasPathError = true;
      }
      if (step.args) {
        this.error('ref-unexpected-args', csnPath, { '#': 'calc', elemref: parent });
        hasPathError = true;
      }
    }
    if (hasPathError)
      break; // avoid too many consequent errors
  }
}

module.exports = {
  value: checkPathsInStoredCalcElement,
};
