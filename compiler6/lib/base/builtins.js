'use strict';

// Model agnostic builtins.
// It should not contain any specific to XSN, i.e. neither XSN structures
// nor any other XSN properties.

/**
 * Map of propagation rules for annotations.
 * Does not include rules for standard propagation of annotations or other properties.
 *
 * @type {Record<string, string>}
 */
const propagationRules = {
  __proto__: null,
  '@Analytics.hidden': 'never',
  '@Analytics.visible': 'never',
  '@cds.autoexpose': 'onlyViaArtifact',
  '@cds.autoexposed': 'never',
  '@cds.external': 'never',
  '@cds.java.this.name': 'onlyViaParent',
  '@cds.persistence.calcview': 'never',
  '@cds.persistence.exists': 'never',
  '@cds.persistence.skip': 'notWithPersistenceTable',
  '@cds.persistence.table': 'never',
  '@cds.persistence.udf': 'never',
  '@cds.redirection.target': 'never',
  '@com.sap.gtt.core.CoreModel.Indexable': 'never',
  '@fiori.draft.enabled': 'onlyViaArtifact',
  '@sql.append': 'never',
  '@sql.prepend': 'never',
  '@sql.replace': 'never',
};

/**
 * Checks whether the given absolute path is inside a reserved namespace.
 *
 * @param {string} absolute
 * @returns {boolean}
 */
function isInReservedNamespace( absolute ) {
  return absolute === 'cds' || absolute.startsWith( 'cds.' ) &&
    !absolute.match( /^cds\.foundation(\.|$)/ ) &&
    !absolute.match( /^cds\.outbox(\.|$)/ ) && // Requested by Node runtime
    !absolute.match( /^cds\.core(\.|$)/ ) && // Requested by Node runtime
    !absolute.match( /^cds\.xt(\.|$)/ ); // Requested by Mtx
}

/**
 * Tell if a type is (directly) a builtin type
 * Note that in CSN builtins are not in the definition of the model, so we can only
 * check against their absolute names.  Builtin types are "cds.<something>", i.e. they
 * are directly in 'cds', but not for example in 'cds.foundation'.
 *
 * @param {string|object} type
 * @returns {boolean}
 */
function isBuiltinType( type ) {
  type = typeof type === 'string' ? type : type?.ref?.[0];
  return type && isInReservedNamespace( type );
}

const magicVariables = [
  '$user',
  '$at',
  '$valid',
  '$now',
  '$tenant',
  '$session',
  '$draft',
];

/**
 * Tell if a name is a magic variable
 *
 * @param {string} name
 * @returns {boolean}
 */
function isMagicVariable( name ) {
  return typeof name === 'string' && magicVariables.includes(name);
}

/**
 * Properties that are required next to `=` to make an annotation value an actual expression
 * and not some foreign structure.
 *
 * @type {string[]}
 */
const xprInAnnoProperties = [
  'ref', 'xpr', 'list', 'literal', 'val',
  '#', 'func', 'args', 'SELECT', 'SET',
  'cast',
];


/**
 * Return whether JSON object `val` is a representation for an annotation expression
 */
function isAnnotationExpression( val ) {
  return val?.['='] !== undefined && xprInAnnoProperties.some( prop => val[prop] !== undefined );
}

module.exports = {
  propagationRules,
  xprInAnnoProperties,
  isInReservedNamespace,
  isBuiltinType,
  isMagicVariable,
  isAnnotationExpression,
};
