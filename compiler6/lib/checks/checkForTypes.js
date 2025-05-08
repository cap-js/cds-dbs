'use strict';

const { isPersistedOnDatabase } = require('../model/csnUtils.js');

/**
 * Check that `cds.hana` types are not used - we don't support them for postgres
 *
 * @param {object} parent Object with a type
 * @param {string} name Name of the type property on parent
 * @param {Array} type type to check
 * @param {CSN.Path} path
 */
function checkForHanaTypes( parent, name, type, path ) {
  const artifact = this.csn.definitions[path[1]];
  if (artifact.kind === 'entity' && isPersistedOnDatabase(artifact) && typeof parent.type === 'string' && parent.type.startsWith('cds.hana.')) {
    this.error('ref-unexpected-hana-type', [ ...path, 'type' ], { type: 'cds.hana', value: this.options.sqlDialect },
               'Types in the $(TYPE) namespace can\'t be used with sqlDialect $(VALUE)');
  }
}

/**
 * Check that `cds.UInt8` is not used - we don't have a clear idea how to represent it on postgres and h2
 *
 * @param {object} parent Object with a type
 * @param {string} name Name of the type property on parent
 * @param {Array} type type to check
 * @param {CSN.Path} path
 */
function CheckForUInt8( parent, name, type, path ) {
  const artifact = this.csn.definitions[path[1]];
  if (artifact.kind === 'entity' && isPersistedOnDatabase(artifact) && parent.type === 'cds.UInt8') {
    this.error('ref-unexpected-type', [ ...path, 'type' ], { type: 'cds.UInt8', value: this.options.sqlDialect },
               'Type $(TYPE) can\'t be used with sqlDialect $(VALUE)');
  }
}

/**
 * Check types - specifically for postgres and h2
 *
 * @param {object} parent Object with a type
 * @param {string} name Name of the type property on parent
 * @param {Array} type type to check
 * @param {CSN.Path} path
 */
function checkTypes( parent, name, type, path ) {
  checkForHanaTypes.bind(this)(parent, name, type, path);
  if (this.options.sqlDialect === 'postgres' || this.options.sqlDialect === 'h2')
    CheckForUInt8.bind(this)(parent, name, type, path);
}

module.exports = {
  type: checkTypes,
};
