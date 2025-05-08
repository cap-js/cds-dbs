'use strict';

const { setProp } = require('../../base/model');
const flattening = require('../db/flattening');
const {
  applyTransformations, forEachDefinition, forEachMemberRecursively, implicitAs, forEachMember, applyTransformationsOnNonDictionary,
} = require('../../model/csnUtils');
const associations = require('../db/associations');
const backlinks = require('../db/backlinks');
const { cloneCsnNonDict } = require('../../model/cloneCsn');


/**
 * Turn managed associations into unmanaged ones by
 * - unfolding the .keys
 * - creating the foreign keys in .elements
 * - adding a corresponding on-condition
 * @param {CSN.Model} csn Input CSN - will not be transformed
 * @param {CSN.Options} options
 * @param {object} csnUtils
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @todo Remove .keys afterwards
 * @todo Add created foreign keys into .columns in case of a query?
 * @returns {CSN.Model}
 */
function turnAssociationsIntoUnmanaged( csn, options, csnUtils, messageFunctions ) {
  // TODO: Do we really need this?
  forEachDefinition(csn, (artifact, artifactName) => {
    setProp(artifact, '$path', [ 'definitions', artifactName ]);
    forEachMemberRecursively(artifact, (member, memberName, prop, path) => {
      setProp(member, '$path', path);
    }, [ 'definitions', artifactName ]);
  });
  // Flatten out the fks and create the corresponding elements
  flattening.handleManagedAssociationsAndCreateForeignKeys(csn, options, messageFunctions, '_', true, csnUtils, { allowArtifact: () => true, skipDict: {} });

  // Add the foreign keys also to the columns if the association itself was explicitly selected
  // TODO: Extend the expansion to also expand managed to their foreign
  // TODO: Remember where in .elements we had associations and do it then?
  applyTransformations(csn, {
    columns: expandManagedToFksInArray(),
    groupBy: expandManagedToFksInArray(true),
    orderBy: expandManagedToFksInArray(true),
  }, [], { allowArtifact: artifact => artifact.query !== undefined || artifact.projection !== undefined });

  forEachDefinition(csn, associations.getFKAccessFinalizer(csn, csnUtils, '_', true));
  applyTransformations(csn, {
    elements: (_parent, prop, elements, path) => {
      forEachMember(_parent, (element, elementName, _prop, elPath) => {
        if (element.on) {
          applyTransformationsOnNonDictionary(element, 'on', {
            ref: (parent, __prop, ref) => {
              if (ref[0] === '$self' && ref.length > 1 && !ref[1].startsWith('$')) // TODO: Is this safe?
                parent.ref = ref.slice(1);
            },
          }, {}, elPath);
        }
      }, path);
    },
  });
  // Calculate the on-conditions from the .keys -
  associations.attachOnConditions(csn, csnUtils, '_', { allowArtifact: () => true }, options);

  return csn;

  /**
   * Expand managed associations in an array and insert them in-place
   *
   * If requested, leave out the assocs themselves
   *
   * @param {boolean} [killAssoc=false]
   * @returns {Function} applyTransformationsCallback
   */
  function expandManagedToFksInArray( killAssoc = false ) {
    return function expand(parent, prop, array, path) {
      const newColumns = [];
      for (let i = 0; i < array.length; i++) {
        const col = array[i];
        const element = csnUtils.getElement(col) || col.ref && csnUtils.inspectRef(path.concat(prop, i)).art;
        if (!killAssoc || !element?.keys)
          newColumns.push(col);
        if (element?.keys)
          element.keys.forEach(fk => addForeignKeyToColumns(fk, newColumns, col, options));
      }
      parent[prop] = newColumns;
    };
  }
}


/**
 * FKs need to be added to the .columns
 * @todo stolen from lib/transform/db/views.js
 * @todo Can we maybe do this during expansion already?
 * @param {object} foreignKey
 * @param {object[]} columns
 * @param {CSN.Column} associationColumn
 * @param {CSN.Options} options
 */
function addForeignKeyToColumns( foreignKey, columns, associationColumn, options ) {
  const ref = cloneCsnNonDict(associationColumn.ref, options);
  ref[ref.length - 1] = [ implicitAs(ref) ].concat(foreignKey.as || foreignKey.ref).join('_');
  const result = {
    ref,
  };
  if (associationColumn.as) {
    const columnName = `${ associationColumn.as }_${ foreignKey.as || implicitAs(foreignKey.ref) }`;
    result.as = columnName;
  }

  if (associationColumn.key)
    result.key = true;

  columns.push(result);
}

/**
 * Translate $self backlinks to "normal" on-conditions
 * @param {CSN.Model} csn Input CSN - will not be transformed
 * @param {CSN.Options} options
 * @param {object} csnUtils
 * @param {object} messageFunctions
 */
function transformBacklinks( csn, options, csnUtils, messageFunctions ) {
  forEachDefinition(csn, backlinks.getBacklinkTransformer(csnUtils, messageFunctions, options, '_', true));
}

module.exports = {
  managedToUnmanaged: turnAssociationsIntoUnmanaged,
  transformBacklinks,
};
