'use strict';

// Only to be used with validator.js - a correct this value needs to be provided!

/**
 * OData allows simple values only (val, -val, enum), no expressions or functions
 * Leave the default value check to the Database.
 * E.g. HANA allows functions on columns but only simple values on parameter definitions
 *
 * @param {CSN.Element} member Member to validate
 * @param {string} memberName Name of the member
 * @param {string} prop Property being looped over
 * @param {CSN.Path} path Path to the member
 */
function validateDefaultValues( member, memberName, prop, path ) {
  if (member.default && this.options.toOdata) {
    // unary minus is xpr: [ "-", { val: ... } ]
    if (member.default.xpr) {
      let i = 0;
      // consume all unary signs
      while (member.default.xpr[i] === '-' || member.default.xpr[i] === '+')
        i++;
      // TODO: This check only counts the number of leading signs, not inbetween (e.g. 1 - - 1).
      //       The message also needs to be improved.
      if (i > 1)
        // eslint-disable-next-line cds-compiler/message-no-quotes
        this.error(null, path, {}, 'Illegal number of unary ‘+’/‘-’ operators');
    }
  }
}

/**
 * For HANA CDS specifically, reject any default parameter values, as these are not supported.
 *
 * @param {CSN.Element} member Member to validate
 * @param {string} memberName Name of the member
 * @param {string} prop Property being looped over
 * @param {CSN.Path} path Path to the member
 */
function rejectParamDefaultsInHanaCds( member, memberName, prop, path ) {
  if (member.default && prop === 'params' && this.options.transformation === 'hdbcds') {
    this.error('def-unsupported-param', path, {},
               'Parameter default values are not supported in SAP HANA CDS');
  }
}

/**
 * For HANA CDS, we render a default for a mixin if the projected entity contains
 * a derived association with a default defined on it. This leads to a deployment error
 * and should be warned about.
 *
 * @param {CSN.Element} member Member to validate
 * @param {string} memberName Name of the member
 * @param {string} prop Property being looped over
 * @param {CSN.Path} path Path to the member
 */
function warnAboutDefaultOnAssociationForHanaCds( member, memberName, prop, path ) {
  const art = this.csn.definitions[path[1]];
  if (this.options.transformation === 'hdbcds' && !art.query && !art.projection && member.target && member.default) {
    const type = member._type?.type || member.type || 'cds.Association';
    this.warning('type-invalid-default', path, { '#': type === 'cds.Association' ? 'std' : 'comp' }, {
      std: 'Default on associations is not supported for HDBCDS',
      comp: 'Default on compositions is not supported for HDBCDS',
    });
  }
}

module.exports = {
  validateDefaultValues,
  rejectParamDefaultsInHanaCds,
  warnAboutDefaultOnAssociationForHanaCds,
};
