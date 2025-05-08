'use strict';

const {
  getArtifactDatabaseNameOf, getElementDatabaseNameOf,
} = require('../../model/csnUtils');
/**
 * Attach @cds.persistence.name to all artifacts and "things".
 * We could also do it more selectively like we do in forRelationalDb, but: Why? Space maybe?
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} csnUtils
 * @returns {object}
 */
function attachPersistenceName( csn, options, csnUtils ) {
  const { addStringAnnotationTo } = csnUtils;

  /**
   *
   * @param {object} parent
   * @param {string} prop
   * @param {object} dict
   */
  function addToEachMember( parent, prop, dict ) {
    for (const memberName in dict)
      addStringAnnotationTo('@cds.persistence.name', getElementDatabaseNameOf(memberName, options.sqlMapping, options.sqlDialect), dict[memberName]);
  }

  return {
    kind: (parent, prop, kind, path) => {
      addStringAnnotationTo('@cds.persistence.name', getArtifactDatabaseNameOf(path[1], options.sqlMapping, csn, options.sqlDialect), parent);
    },
    elements: addToEachMember,
    params: addToEachMember,
  };
}

/**
 * Delete the given prop from parent.
 *
 * @param {object} parent
 * @param {string|number} prop
 */
function killProp( parent, prop ) {
  delete parent[prop];
}

/**
 * Remove definitions from the CSN:
 * - types
 * - aspects
 *
 * Remove properties from artifacts:
 * - includes
 * - localized
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @returns {object}
 * @todo Callback-like architecture and merge with persistence name?
 */
function _removeDefinitionsAndProperties( csn, options ) {
  const transformers = {
    $ignore: (a, b, c, path, parentParent) => {
      const tail = path[path.length - 1];
      delete parentParent[tail];
    },
    kind: (artifact, a, b, path) => {
      if (artifact.kind === 'aspect' || artifact.kind === 'type') {
        if (artifact.elements || artifact.items || options.resolveSimpleTypes)
          delete csn.definitions[path[1]];
      }
      else {
        if (artifact.kind === 'event') {
          delete artifact.projection;
          delete artifact.query;
        }
        if (artifact['@cds.persistence.skip'] === 'if-unused')
          artifact['@cds.persistence.skip'] = false;
      }
    },
    // Still used in flattenStructuredElements - in db/flattening.js
    _flatElementNameWithDots: killProp,
    // Set when setting default string/binary length - used in copyTypeProperties and fixBorkedElementsOfLocalized
    // to not copy the .length property if it was only set via default
    $default: killProp,
    // Set when we turn UUID into String, checked during generateDraftForHana
    $renamed: killProp,
    // Set when we remove .key from temporal things, used in localized.js
    $key: killProp,
    includes: killProp,
    enum: killProp,
    keys: killProp,
    excluding: killProp, // * is resolved, so has no effect anymore
    targetAspect: killProp,
  };

  if (!options.keepLocalized)
    transformers.localized = killProp;

  return transformers;
}


module.exports = {
  attachPersistenceName,
  removeDefinitionsAndProperties: _removeDefinitionsAndProperties,
};
