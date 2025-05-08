'use strict';

const {
  applyTransformationsOnNonDictionary,
  applyTransformations,
  implicitAs,
} = require('../../model/csnUtils');

/**
 * In all .elements of entities and views (and their bound actions/functions), create the on-condition for
 * a managed associations. This needs to happen after the .keys are expanded and the corresponding elements are created.
 *
 * @param {CSN.Model} csn
 * @param {object} csnUtils
 * @param {string} pathDelimiter
 * @param {object} [iterateOptions={}]
 * @param {CSN.Options} [options={}]
 * @returns {CSN.Model} Return the input csn, with the transformations applied
 */
function attachOnConditions( csn, csnUtils, pathDelimiter, iterateOptions = {}, options = {} ) {
  const { isManagedAssociation } = csnUtils;

  const alreadyHandled = new WeakMap();
  applyTransformations(csn, {
    elements: (parent, prop, elements) => {
      for (const elemName in elements) {
        const elem = elements[elemName];
        // (140) Generate the ON-condition for managed associations
        if (isManagedAssociation(elem))
          transformManagedAssociation(elem, elemName);
      }
    },                                      /* only for views and entities */
  }, [], Object.assign({ skipIgnore: false, allowArtifact: artifact => (artifact.kind === 'entity') }, iterateOptions));

  return csn;

  /**
   * Create the foreign key elements for a managed association and build the on-condition
   *
   * @param {object} elem The association to process
   * @param {string} elemName
   * @returns {void}
   */
  function transformManagedAssociation( elem, elemName ) {
    // No need to run over this - we already did, possibly because it was referenced in the ON-Condition
    // of another association - see a few lines lower
    if (alreadyHandled.has(elem))
      return;
    if ((!elem.keys || elem.keys.length === 0) && options.transformation !== 'effective') { // TODO: really kill instead of $ignore?
      elem.$ignore = true;
    }
    else {
      // Assemble an ON-condition with the foreign keys created in earlier steps
      const onCondParts = [];
      let joinWithAnd = false;
      for (const foreignKey of elem.keys || []) {
        // Assemble left hand side of 'assoc.key = fkey'
        const assocKeyArg = {
          ref: [
            ...elemName.startsWith('$') ? [ '$self' ] : [],
            elemName,
            ...foreignKey.ref,
          ],
        };
        const fkName = `${ elemName }${ pathDelimiter }${ foreignKey.as || implicitAs(foreignKey.ref) }`;
        const fKeyArg = {
          ref: [
            ...fkName.startsWith('$') ? [ '$self' ] : [],
            fkName,
          ],
        };

        if (joinWithAnd) // more than one FK
          onCondParts.push('and');

        onCondParts.push(
          assocKeyArg
        );
        onCondParts.push('=');
        onCondParts.push(fKeyArg);

        if (!joinWithAnd)
          joinWithAnd = true;
      }
      elem.on = onCondParts;
    }

    // If the managed association has a 'key' property => remove it as unmanaged assocs cannot be keys
    // TODO: Are there other modifiers (like 'key') that are valid for managed, but not valid for unmanaged assocs?
    if (elem.key)
      delete elem.key;

    // If the managed association has a 'not null' property => remove it
    if (elem.notNull)
      delete elem.notNull;

    // The association is now unmanaged, i.e. actually it should no longer have foreign keys
    // at all. But the processing of backlink associations below expects to have them, so
    // we don't delete them
    // TODO: maybe make non-enumerable, so we become recompilable in the future?

    // Remember that we already processed this
    alreadyHandled.set(elem, true);
  }
}

/**
 * @param {CSN.Model} csn
 * @param {object} csnUtils
 * @param {string} pathDelimiter
 * @param {boolean} [processOnInQueries=false] Wether to process on-conditions in queries (joins and mixins)
 * @returns {(artifact: CSN.Artifact, artifactName: string) => void} Callback for forEachDefinition
 */
function getFKAccessFinalizer( csn, csnUtils, pathDelimiter, processOnInQueries = false ) {
  const {
    inspectRef,
  } = csnUtils;

  return handleManagedAssocSteps;

  /**
   * Loop over all elements and for all unmanaged associations translate
   * <assoc base>.<managed assoc>.<fk> to <assoc base>.<managed assoc>_<fk>
   *
   * Or in other words: Allow using the foreign keys of managed associations in
   * on-conditions / calculated elements on-write.
   *
   * Expects that flattening has already been performed.
   *
   * @param {CSN.Artifact} artifact Artifact to check
   * @param {string} artifactName Name of the artifact
   */
  function handleManagedAssocSteps( artifact, artifactName ) {
    const transformer = getTransformer();
    const inColumnsTransformer = getTransformer(true);
    for (const elemName in artifact.elements) {
      const elem = artifact.elements[elemName];
      // The association is an unmanaged one
      if (!elem.keys && elem.target && elem.on)
        applyTransformationsOnNonDictionary(elem, 'on', transformer, {}, [ 'definitions', artifactName, 'elements', elemName ]);
      else if (elem.value?.stored)
        applyTransformationsOnNonDictionary(elem, 'value', transformer, {}, [ 'definitions', artifactName, 'elements', elemName ]);
    }

    if (artifact.query || artifact.projection) {
      const transform = (parent, prop, thing, path) => applyTransformationsOnNonDictionary(parent, prop, transformer, {}, path);
      const queryTransformers = {
        orderBy: transform,
        groupBy: transform,
        where: transform,
        having: transform,
      };
      if (processOnInQueries) {
        queryTransformers.columns = (parent, prop, columns, path) => {
          for (let i = 0; i < columns.length; i++) {
            const column = columns[i];
            if (column.ref) {
              inColumnsTransformer.ref(column, 'ref', column.ref, path.concat([ 'columns', i ]));
              column.ref.forEach((step, index) => {
                if (step.where)
                  transform(step, 'where', step.where, path.concat([ 'columns', i, 'ref', index ]));
              });
            }
          }
        };
        queryTransformers.on = transform;
      }
      applyTransformationsOnNonDictionary(artifact, artifact.query ? 'query' : 'projection', queryTransformers, { drillRef: true }, [ 'definitions', artifactName ]);
    }

    /**
     *
     * @param {boolean} isColumns Whether the transformation is taking place on a column
     * @returns {object}
     */
    function getTransformer( isColumns = false ) {
      return {
        ref: (refOwner, prop, ref, path) => {
          // [<assoc base>.]<managed assoc>.<field>
          if (ref.length > 1) {
            const { links } = inspectRef(path);
            if (links) {
              let fkAlias = '';
              for (let i = links.length - 1; i >= 0; i--) {
                const link = links[i];
                // We found the latest managed assoc path step
                if (link.art && link.art.target && link.art.keys &&
                      // Doesn't work when ref-target (filter condition) or similar is used
                      !ref.slice(i).some(refElement => typeof refElement !== 'string')) {
                  const fkRef = ref[i + 1];
                  const fkName = (!fkAlias ? fkRef : `${ fkRef }${ pathDelimiter }${ fkAlias }`);
                  const fks = link.art.keys.filter(key => key.ref[0] === fkName);

                  if (fks.length >= 1) { // after flattening, at most one FK will remain.
                    // `.as` is set for SQL, but not for OData -> fall back to implicit alias
                    fkAlias = fks[0].as || fks[0].ref[fks[0].ref.length - 1];
                    const managedAssocStepName = ref[i];
                    const newFkName = `${ managedAssocStepName }${ pathDelimiter }${ fkAlias }`;
                    if (isColumns) {
                      refOwner.ref = [ ...ref.slice(0, i), newFkName ];
                      if (!refOwner.as)
                        refOwner.as = implicitAs(ref);
                    }
                    else {
                      refOwner.ref = [ ...ref.slice(0, i), newFkName ];
                    }
                  }
                }
                else {
                  fkAlias = '';
                  // Ignore last path step and unmanaged associations.
                  // Structures should have been already flattened.
                }
              }
            }
          }
        },
      };
    }
  }
}
module.exports = {
  attachOnConditions,
  getFKAccessFinalizer,
};
