'use strict';

const { isPersistedOnDatabase, hasPersistenceSkipAnnotation } = require('../model/csnUtils');
const { isBuiltinType } = require('../base/builtins');
const { requireForeignKeyAccess } = require('./onConditions');
const { pathId } = require('../model/csnRefs');

const generalQueryProperties = [ 'from', 'columns', 'where', 'groupBy', 'orderBy', 'having', 'limit' ];

/**
 * Ensure that all source artifacts and association targets are persisted on the database.
 * Otherwise, we would end up with a JOIN against a non-existent table.
 *
 * Check the given query for:
 * - Association-traversal over skipped/abstract things
 * - Associations (indirectly) using managed associations without foreign keys
 *
 * Currently checked:
 * - "columns" for something like toF.field, where F is skipped. But publishing toF is fine, will be ignored later on
 * - "from" for something like "select from E.toF" where E, F or E AND F are no-db.
 *
 * @param {CSN.Query} query Query to check
 */
function checkQueryForNoDBArtifacts( query ) {
  if (isPersistedOnDatabase(this.artifact) && !this.artifact['@cds.persistence.table']) {
    for (const prop of generalQueryProperties) {
      const queryPart = (query.SELECT || query.SET)[prop];
      if (Array.isArray(queryPart)) {
        for (const part of queryPart)
          checkQueryRef.call(this, part, prop === 'columns');
      }
      else if (typeof queryPart === 'object') {
        checkQueryRef.call(this, queryPart, prop === 'columns');
      }
    }
  }
}

/**
 * @param {CSN.Element} assoc Definition to check
 * @returns {boolean} True, if there are any foreign keys.
 */
function hasForeignKeys( assoc ) {
  if (!assoc || !assoc.keys)
    return false;
  return _hasForeignKeyOrElements.call(this, assoc);
}

/**
 * Returns true if the given definition has at least one foreign key or element leaf node.
 *
 * @param {CSN.Artifact} def
 * @returns {boolean} True if there are FKs/element leaves.
 */
function _hasForeignKeyOrElements( def ) {
  if (!def) {
    return false;
  }
  else if (def.keys) {
    return def.keys.some(e => _hasForeignKeyOrElements.call(this, e._art));
  }
  else if (def.elements) {
    return Object.values(def.elements).some( e => _hasForeignKeyOrElements.call(this, e));
  }
  else if (def.type) {
    if (isBuiltinType(def.type) && !(def.target))
      return true;
    return _hasForeignKeyOrElements.call(this, this.artifactRef(def.type, null));
  }
  return false;
}

/**
 * Check the given `obj.ref` for usage of skipped/abstract assoc targets
 *
 * @param {CSN.Column} obj CSN "thing" to check
 * @param {boolean} inColumns True if the ref is part of a from
 */
function checkQueryRef( obj, inColumns ) {
  if (!obj)
    return;

  if (obj.expand || obj.inline)
    _checkExpandInline.call(this, obj);

  else if (obj.ref && obj._links)
    _checkRef.call(this, obj.ref, obj._links, obj.$path, inColumns);
}

/**
 * Run _checkRef on all expand/inline structure leaf nodes.
 * We do so by creating artificial paths that follow expand/inline nodes to their leaves.
 *
 * @param {CSN.Column} obj
 * @param {CSN.Path} previousRefs
 * @param {object[]} previousLinks
 */
function _checkExpandInline( obj, previousRefs = [], previousLinks = [] ) {
  if (obj.ref && obj._links) { // There could be anonymous nested "expand".
    previousRefs = previousRefs.concat(obj.ref);
    previousLinks = previousLinks.concat(obj._links);
  }

  if (!obj.expand && !obj.inline) {
    if (obj.ref && obj._links) {
      // `inColumns: true` for expand/inline
      _checkRef.call(this, previousRefs, previousLinks, obj.$path, true);
    }
    return;
  }

  for (const col of obj.expand || obj.inline)
    _checkExpandInline.call(this, col, previousRefs, previousLinks);
}

/**
 * Implementation of checkQueryRef() that works on ref/links arrays instead of a column.
 *
 * @param {CSN.Path} ref
 * @param {object[]} _links
 * @param {CSN.Path} $path
 * @param {boolean} inColumns
 */
function _checkRef( ref, _links, $path, inColumns ) {
  if (!ref || !_links )
    return;

  let nonPersistedTarget = null;
  const isPublishedAssoc = this.csnUtils.isAssocOrComposition(_links[_links.length - 1].art);

  // Don't check the last element - to allow association publishing in columns
  for (let i = 0; i < (inColumns ? _links.length - 1 : _links.length); i++) {
    const link = _links[i];
    if (!link)
      continue;
    const { art } = link;
    if (!art)
      continue;

    const isLast = i >= _links.length - 1;
    const isUnmanagedOrNoKeys = !art.keys;
    const targetArt = art.target ? this.artifactRef(art.target) : art;
    const pathStep = pathId(ref[i]);
    const name = art.target || pathStep;

    // If any path-step is not persisted, then all following path steps must only access foreign keys.
    // For example, it could be toF.toG.field, where toG is FK of toF; the FK-only-check would succeed,
    // but we only check "field" in the next iteration, where it is seen as access on a non-skipped
    // entity, hence the need to store if any target is skipped.
    if (!isPersistedOnDatabase(targetArt))
      nonPersistedTarget = { name, pathStep };

    if (nonPersistedTarget) {
      let isJoinRelevant = isPublishedAssoc || // publishing associations is always join relevant
        isLast || // e.g. FROM targets are always join relevant.
        isUnmanagedOrNoKeys; // unmanaged associations are always join relevant -> no FKs

      if (!isJoinRelevant) {
        // for managed, published associations with more than one $path-step, only FK
        // access is allowed.
        requireForeignKeyAccess({ ref, _links }, i, () => {
          isJoinRelevant = true;
        });
      }

      if (isJoinRelevant) {
        const cdsPersistenceSkipped = hasPersistenceSkipAnnotation(targetArt);
        this.error( null, $path, {
          '#': cdsPersistenceSkipped ? 'std' : 'abstract',
          anno: '@cds.persistence.skip',
          id: nonPersistedTarget.pathStep,
          elemref: { ref },
          name: nonPersistedTarget.name,
        }, {
          std: 'Unexpected $(ANNO) annotation on association target $(NAME) of $(ID) in path $(ELEMREF)',
          abstract: 'Unexpected abstract association target $(NAME) of $(ID) in path $(ELEMREF)',
        } );
        break; // only one error per path
      }
    }

    // check managed association to have foreign keys array filled
    if (art.target && art.on) {
      for (let j = 0; j < art.on.length - 2; j++) {
        if (art.on[j].ref && art.on[j + 1] === '=' && art.on[j + 2].ref) {
          const [ fwdAssoc, fwdPath ] = getForwardAssociation(pathStep, art.on[j], art.on[j + 2]);
          if (fwdAssoc?.keys && !hasForeignKeys.call(this, fwdAssoc)) {
            this.error(null, $path, { name: pathStep, elemref: { ref }, id: fwdPath },
                       'Path step $(NAME) of $(ELEMREF) is a $self comparison with $(ID) that has no foreign keys');
            break; // only one error per path
          }
        }
      }
    }
    else if (art.target && !hasForeignKeys.call(this, art)) {
      // Either no 'keys' array or an empty one.  Since v6, to-many associations
      // may have neither ON-condition nor foreign keys.
      this.error('expr-missing-foreign-key', $path, { id: pathStep, elemref: { ref } } );
      break; // only one error per path
    }
  }
}

/**
 * Get the forward association from a backlink $self association.
 *
 * @param {string} prefix Name of the association
 * @param {object} lhs Left hand side of the on-condition part
 * @param {object} rhs Right hand side of the on-condition part
 * @returns {Array} Return the association object (index 0) and the corresponding path (index 1).
 */
function getForwardAssociation( prefix, lhs, rhs ) {
  if (lhs && rhs) {
    if (rhs.ref.length === 1 && rhs.ref[0] === '$self' &&
       lhs.ref.length > 1 && lhs.ref[0] === prefix)
      return [ lhs._links[lhs._links.length - 1].art, lhs.ref.join('.') ];
    if (lhs.ref.length === 1 && lhs.ref[0] === '$self' &&
       rhs.ref.length > 1 && rhs.ref[0] === prefix)
      return [ rhs._links[rhs._links.length - 1].art, rhs.ref.join('.') ];
  }
  return [ undefined, undefined ];
}

module.exports = checkQueryForNoDBArtifacts;
