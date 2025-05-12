// module- and csn/XSN-independent definitions

// TODO: move XSN-specific things to lib/compiler/utils/
// TODO: move CSN-specific things to ???

'use strict';

const { forEach } = require('../utils/objectUtils');

/**
 * Object of all available beta flags that will be enabled/disabled by `--beta-mode`
 * through cdsc.  Only intended for INTERNAL USE.
 * NOT to be used by umbrella, etc.
 *
 * @type {{[flag: string]: boolean}} Indicates whether it is enabled by --beta-mode or not.
 * @private
 */
const availableBetaFlags = {
  // enabled by --beta-mode
  hanaAssocRealCardinality: true,
  mapAssocToJoinCardinality: true, // only SAP HANA HEX engine supports it
  enableUniversalCsn: true,
  odataTerms: true,
  effectiveCsn: true,
  tenantVariable: true,
  calcAssoc: true,
  temporalRawProjection: true,
  v7preview: true,
  draftMessages: true,
  rewriteAnnotationExpressionsViaType: true,
  sqlServiceDummies: true,
  // disabled by --beta-mode
  nestedServices: false,
};

// Used by isDeprecatedEnabled() to check if any flag ist set.
const availableDeprecatedFlags = {
  // the old ones starting with _, : false
  noPersistenceJournalForGeneratedEntities: true, // since v6
  downgradableErrors: true,
  noCompositionIncludes: true, // since v6; was an option with inverted meaning in v5
  noQuasiVirtualAssocs: true, // since v6
  _includesNonShadowedFirst: true,
  _eagerPersistenceForGeneratedEntities: true,
  _noKeyPropagationWithExpansions: true,
  ignoreSpecifiedQueryElements: true,
};

// Deprecated flags that were removed in v5.
const oldDeprecatedFlagsV5 = [
  'includesNonShadowedFirst',
  'eagerPersistenceForGeneratedEntities',
  'noKeyPropagationWithExpansions',
];

/**
 * Test for early-adaptor feature, stored in option `beta`(new-style) / `betaMode`(old-style)
 * With that, the value of `beta` is a dictionary of feature=>Boolean.
 *
 * Beta features cannot be used when `options.deprecated` is set.
 *
 * A feature always needs to be provided - otherwise false will be returned.
 *
 * Do not move this function to the "option processor" code.
 *
 * @param {object} options Options
 * @param {string} feature Feature to check for
 * @returns {boolean}
 */
function isBetaEnabled( options, feature ) {
  const beta = options.beta || options.betaMode;
  return beta && typeof beta === 'object' && !options.deprecated && feature && beta[feature];
}

/**
 * Test for deprecated feature, stored in option `deprecated`.
 * With that, the value of `deprecated` is a dictionary of feature=>Boolean.
 *
 * If no `feature` is provided, checks if any deprecated option is set
 * which is not mentioned in availableDeprecatedFlags with value true.
 * Useful for newer functionality which might not work with some
 * deprecated feature turned on.
 *
 * Do not move this function to the "option processor" code.
 *
 * @param {object} options Options
 * @param {string|null} [feature] Feature to check for
 * @returns {boolean}
 */
function isDeprecatedEnabled( options, feature = null ) {
  const { deprecated } = options;
  if (!feature) {
    return !!deprecated && Object.keys( deprecated )
      .some( d => !availableDeprecatedFlags[d] );
  }
  return deprecated && typeof deprecated === 'object' && deprecated[feature];
}

/**
 * In cds-compiler v3, we removed old v2 deprecated flags.  That can lead to silent
 * errors such as entity/view names changing.  To ensure that the user is forced
 * to change their code, emit an error if one of such removed flags was used.
 *
 * @param {CSN.Options} options
 * @param error Error message function returned by makeMessageFunction().
 */
function checkRemovedDeprecatedFlags( options, { error } ) {
  // Assume that we emitted these errors once if a message with this ID was found.
  if (!options.deprecated || options.messages?.some(m => m.messageId === 'api-invalid-deprecated'))
    return;

  forEach(options.deprecated, (key, val) => {
    if (val && oldDeprecatedFlagsV5.includes(key)) {
      error('api-invalid-deprecated', null, { name: key },
            'Deprecated flag $(NAME) has been removed in CDS compiler v6');
    }
  });
}

/**
 * Apply function `callback` to all artifacts in dictionary
 * `model.definitions`.  See function `forEachGeneric` for details.
 * TODO: should we skip "namespaces" already here?
 */
function forEachDefinition( model, callback ) {
  forEachGeneric( model, 'definitions', callback );
}

/**
 * Apply function `callback` to all members of object `obj` (main artifact or
 * parent member).  Members are considered those in dictionaries `elements`,
 * `enum`, `actions` and `params` of `obj`, `elements` and `enums` are also
 * searched inside property `items` (array of).  See function `forEachGeneric`
 * for details.
 *
 * @param {XSN.Artifact} construct
 * @param {(member: XSN.Artifact, memberName: string, prop: string) => void} callback
 * @param {XSN.Artifact} [target]
 */
function forEachMember( construct, callback, target ) {
  let obj = construct;
  while (obj.items)
    obj = obj.items;
  forEachGeneric( target || obj, 'elements', callback );
  forEachGeneric( obj, 'enum', callback );
  forEachGeneric( obj, 'foreignKeys', callback );
  forEachGeneric( construct, 'actions', callback );
  forEachGeneric( construct, 'params', callback );
  if (construct.returns)
    callback( construct.returns, '', 'params' );
}

/**
 * Same as forEachMember, but inside each member, calls itself recursively, i.e.
 * sub members are traversed as well.
 *
 * @param {XSN.Artifact} construct
 * @param {(member: XSN.Artifact, memberName: string, prop: string) => void} callback
 * @param {XSN.Artifact} [target]
 */
function forEachMemberRecursively( construct, callback, target ) {
  forEachMember( construct, ( member, memberName, prop ) => {
    callback( member, memberName, prop );
    // Descend into nested members, too
    forEachMemberRecursively( member, callback );
  }, target);
}

// Apply function `callback` to all objects in dictionary `dict`, including all
// duplicates (found under the same name).  Function `callback` is called with
// the following arguments: the object, the name, and - if it is a duplicate -
// the array index and the array containing all duplicates.
function forEachGeneric( obj, prop, callback ) {
  const dict = obj[prop];
  for (const name in dict) {
    obj = dict[name];
    const { $duplicates } = obj;
    callback( obj, name, prop );
    if (Array.isArray($duplicates)) // redefinitions
      $duplicates.forEach( o => callback( o, name, prop ) );
  }
}

const forEachInOrder = forEachGeneric;

/**
 * Like `obj.prop = value`, but not contained in JSON / CSN
 * It's important to set enumerable explicitly to false (although 'false' is the default),
 * as else, if the property already exists, it keeps the old setting for enumerable.
 *
 * @param {object} obj
 * @param {string} prop
 * @param {any} value
 */
function setProp( obj, prop, value ) {
  const descriptor = {
    value, configurable: true, writable: true, enumerable: false,
  };
  Object.defineProperty( obj, prop, descriptor );
  return value;
}


module.exports = {
  isBetaEnabled,
  availableBetaFlags,
  isDeprecatedEnabled,
  checkRemovedDeprecatedFlags,
  forEachDefinition,
  forEachMember,
  forEachMemberRecursively,
  forEachGeneric,
  forEachInOrder,
  setProp,
};
