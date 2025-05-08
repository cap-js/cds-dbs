'use strict'

const { applyTransformations, transformAnnotationExpression } = require('../../model/csnUtils');
const { isBuiltinType } = require('../../base/builtins');


function replaceForeignKeyRefsInExpressionAnnotations(csn, options, messageFunctions, csnUtils, iterateOptions = {}) {
  const transformers = {
    elements: processRef,
    params: processRef,
    actions: processRef
    // '@': processRef
  };
  applyTransformations(csn, transformers, [ processRef ], iterateOptions);

  function processRef(parent, prop, _dict, path) {
    transformAnnotationExpression(parent, prop,
      {
        ref: (parent, _prop, ref, path, _p, _ppn, ctx) => {
          const { art, links } = 
            (parent._art && parent._links) ? 
            { art: parent._art, links: parent._links } :
            csnUtils.inspectRef(path);
          // if a reference points to a structure(managed assoc or structured element), then we do not process
          // as we can't guess which specific foreign key is targeted
          if (!art || csnUtils.isManagedAssociation(art) || csnUtils.isStructured(art)) return;

          const allMngAssocsInRef = links.filter(link => csnUtils.isManagedAssociation(link.art));
          if (!allMngAssocsInRef.length) return;
          let firstAssocToProcess = allMngAssocsInRef[0];

          const mngAssocsWithFilter = allMngAssocsInRef.filter(assoc => typeof ref[assoc.idx] !== 'string');
          if (mngAssocsWithFilter.length) {
            const refTail = links.slice(mngAssocsWithFilter.at(-1).idx + 1);
            firstAssocToProcess = refTail.find(link => csnUtils.isManagedAssociation(link.art));
          }

          const match = findMatchingForeignKeyForAssoc(firstAssocToProcess, art, ref, links);
          if (match) {
            const refHead = ref.slice(0, match.idx);
            parent.ref = [...refHead, match.fkName];
            if (ctx?.annoExpr?.['=']) {
              ctx.annoExpr['='] = true;
            }
          }
        }
      },
      path);
  }

  function findMatchingForeignKeyForAssoc(assoc, refArt, ref, links) {
    if (!assoc) return undefined;

    const expectedFkName = findExpectedFkName(assoc, ref, links);
    const gfks = assoc.art?.$generatedForeignKeys;
    if (!gfks) return undefined;
    const matchedFk = gfks.find(fk => fk.source === refArt && fk.name === expectedFkName);
    if (matchedFk) {
      return { fkName: matchedFk.name, idx: assoc.idx };
    } else {
      // try to find FK substitution in the next assoc in the ref (if there is such assoc)
      const refTail = links.slice(assoc.idx + 1);
      const nextAssoc = refTail.find(link => csnUtils.isManagedAssociation(link.art));
      return findMatchingForeignKeyForAssoc(nextAssoc, refArt, ref, links);
    }


    function findExpectedFkName(assoc, ref, links) {
      let expectedFkName = ref[assoc.idx];
      const refAliasMapping = assoc.art.keys.reduce( (acc, key) => {
        acc[key.ref.join('_')] = key.as;
        return acc;
      }, {});
      let bufferRef = [];
      for (let i = assoc.idx + 1; i < links.length; i++) {
        const link = links[i];
        bufferRef.push(ref[i]);
        if (csnUtils.isManagedAssociation(link.art)) {
          const subFkName = findExpectedFkName(link, ref, links);
          if (!subFkName) return undefined;
          expectedFkName += bufferRef.length > 1 ? 
          `_${bufferRef.slice(0, -1).join('_')}_${subFkName}` :
          `_${subFkName}`;
          break;
        } else if (isBuiltinType(link.art.type)) {
          expectedFkName += `_${refAliasMapping[bufferRef.join('_')] || ref[i]}`;
          bufferRef = [];
        }
  
      }
      return expectedFkName;
    }
  }
}

module.exports = replaceForeignKeyRefsInExpressionAnnotations;
