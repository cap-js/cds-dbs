'use strict';

const { transformAnnotationExpression, implicitAs, } = require('../../model/csnUtils');

/**
 * Used during annotating of foreign keys.
 * Expression annotations which are assigned to a foreign key are examined. If some ref point to another foreign
 * key declared in the scope, we replace it with referencing the foreign key itself. If a reference is a $self reference,
 * we do nothing and if a ref points to a structure/managed association, an error is thrown
 *
 * @param {object[]|string[][]} generatedForeignKeys
 * @param {object} csnUtils
 * @param {object} messageFunctions
 * @param {CSN.Path} elementPath
 */
function adaptAnnotationsRefs(generatedForeignKeys, csnUtils, { error }, elementPath) {
  if(Array.isArray(generatedForeignKeys?.[0])) {
    // ensure we are always called with an array of objects. TODO: Cleanup fk creation in for.effective to create array of objects
    adaptAnnotationsRefs(remapToArrayOfObjects(generatedForeignKeys), csnUtils, { error }, elementPath);
  } else {
    const reportedErrorsForAnnoPath = {};
    generatedForeignKeys.forEach((gfk, index) => {
      Object.entries(gfk.foreignKey).forEach(([key, value]) => {
        if (key[0] !== '@') return;

        transformAnnotationExpression(gfk.foreignKey, key, {
          ref: (_parent, _prop, ref, path, _p, _ppn, ctx) => {
            // if the reference is a $self reference, we do nothing,
            // as this is the way to tell that we do not reference the foreign key
            if (ref[0] === '$self') return;
            // if annotation was not propagated from the keys array during foreign keys creation,
            // means that it is not a candidate for foreign key substitution
            if (gfk.keyAnnotations !== null && !gfk.keyAnnotations.includes(key)) return;

            const art = gfk.originalKey._art ||
            csnUtils.inspectRef(elementPath ? path : getOriginatingKeyPath(gfk, path)).art; // OData uses getOriginatingKeyPath - as it relies on $path
            if (csnUtils.isManagedAssociation(art)) {
              if (!reportedErrorsForAnnoPath[path]) {
                error('odata-anno-xpr-ref', path, { elemref: { ref }, anno: key, '#': 'fk_substitution' });
                reportedErrorsForAnnoPath[path] = true;
              }
            } else {
              const gfkForRef = findGeneratedForeignKeyForKeyRef(generatedForeignKeys, ref);
              if (gfkForRef.length === 1) {
                ref[0] = gfkForRef[0].prefix;

                if (ctx?.annoExpr?.['=']) {
                  ctx.annoExpr['='] = true;
                }
              } else {
                // check if the annotation reference points to a structure that has been expanded,
                // if so -> report an error
                const foundInOriginalRef = findOriginalRef(generatedForeignKeys.filter(gfk => gfk.originalKey.$originalKeyRef), ref);
                // references to expanded structures in flat mode will be found in the $originalKeyRef
                // and in structured mode more than one match will be found in the generated foreign keys
                if ((foundInOriginalRef.length || gfkForRef.length > 1) && !reportedErrorsForAnnoPath[path]) {
                  error('odata-anno-xpr-ref', path, { elemref: { ref }, anno: key, '#': 'fk_substitution' });
                  reportedErrorsForAnnoPath[path] = true;
                }
              }
            }
          }
        }, elementPath ? elementPath.concat(['keys', index]) : value?.$path?.slice(0, value.$path.length - 1)); // OData uses $path
      });
    });
  }

  // During tuple expansion, the key ref object looses the $path, therefore
  // it needs to be extracted from the anno path
  function getOriginatingKeyPath(gfk, path) {
    return gfk.originalKey.$path || path.slice(0, path.findIndex(ps => ps[0] === '@'));
  }

  // Loops through the generated foreign keys for this entity
  // and filters the ones, which were created for this specific
  // key ref. In case there are more than one foreign keys found,
  // that means the key ref points to a structured element/managed assoc
  function findGeneratedForeignKeyForKeyRef(generatedForeignKeys, ref) {
    return generatedForeignKeys.filter(gfk => (ref.join() === (gfk.originalKey.as || implicitAs(gfk.originalKey.ref))));
  }

  // Tuple expansion is performed before the generation of the foreign keys and the original(unexpanded) key ref
  // is stored in the property $originalKeyRef. Here we try to evaluate whether the reference in the annotation
  // points to a structure that has been expanded.
  function findOriginalRef(generatedForeignKeys, ref) {
    return generatedForeignKeys.filter(gfk => (ref.join() === (gfk.originalKey.$originalKeyRef.as || implicitAs(gfk.originalKey.$originalKeyRef.ref))));
  }
}

function remapToArrayOfObjects(generatedForeignKeys) {
  return generatedForeignKeys.map(([ prefix, foreignKey, originalKey ]) => {
    return { prefix, foreignKey, originalKey, keyAnnotations: null };
  });
}

module.exports = { adaptAnnotationsRefs };
