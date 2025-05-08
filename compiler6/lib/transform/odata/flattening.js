'use strict';

const { forEachDefinition,
  copyAnnotations, forEachMemberRecursively,
  transformExpression, transformAnnotationExpression } = require('../../model/csnUtils');
const { isBuiltinType, isMagicVariable } = require('../../base/builtins');
const transformUtils = require('../transformUtils');
const { setProp, forEachGeneric } = require('../../base/model');
const { applyTransformationsOnDictionary,
  applyTransformationsOnNonDictionary } = require('../db/applyTransformations.js');
const { handleManagedAssociationsAndCreateForeignKeys } = require('../db/flattening');
const { cloneCsnNonDict } = require('../../model/cloneCsn');
const { forEach } = require('../../utils/objectUtils');
const { assignAnnotation } = require('../../edm/edmUtils');

function allInOneFlattening(csn, refFlattener, adaptRefs, inspectRef, getFinalTypeInfo, isExternalServiceMember, error, csnUtils, options) {
  const allMgdAssocDefs = [];
  forEachDefinition(csn, (def, defName) => {
    if (def.kind === 'entity' && !isExternalServiceMember(def, defName)) {
      ['elements', 'params'].forEach(dictName => {
        const dict = def[dictName];
        if (dict) {
          const csnPath = ['definitions', defName, dictName];
          const orderedElementList = [];

          forEach(dict, (childName, child) => {
            const location = [ ...csnPath, childName ];
            const rootPrefix = [ defName ];
            let resolvedElt = child;
            let typeIdx = 0;
            if (child.type && !child.elements) {
              resolvedElt = getFinalTypeInfo(child.type);
              if (resolvedElt.elements)
                typeIdx = rootPrefix.length + 1;
            }
            if (resolvedElt.elements) {
              const flattenedSubTree = recurseIntoElement(dictName, child, resolvedElt,
                !!child.notNull, location, [ ...rootPrefix, childName ], typeIdx);

              flattenedSubTree.forEach(([flatEltName, flatElt]) => {
                if (dict[flatEltName] || orderedElementList.some(elt => elt[0] === flatEltName))
                  error('name-duplicate-element', location,
                        { '#': 'flatten-element-exist', name: flatEltName });
                propagateToFlatElem(child, flatElt);
                rewriteOnCondition(flatElt, flattenedSubTree);
                adaptManagedAssociationSpecialFields(flatElt, flatEltName, flattenedSubTree);
                orderedElementList.push([flatEltName, flatElt]);
              });
            }
            else {
              // TODO: run adaptManagedAssociationSpecialFields here as well
              const flatElt = cloneElt(dictName, child, location, [ defName, childName ]);
              orderedElementList.push([childName, flatElt]);
            }
          });

          const flatDict = orderedElementList.reduce((elements, [ flatEltName, flatElt ]) => {
            if (flatElt.items) {
              // rewrite annotation paths inside items.elements
              forEachMemberRecursively(flatElt.items, (elt, eltName, _prop, path) => {
                const exprAnnos = Object.keys(elt).filter(pn => pn[0] === '@');
                flattenAndPrefixExprPaths(elt, exprAnnos, elt.$path, path, 0, true);
                if (csnUtils.isManagedAssociation(elt)) {
                  allMgdAssocDefs.push(elt);
                }
              }, [ flatEltName ], true, { pathWithoutProp: true } );
            } else if (flatElt.targetAspect) {
              forEachMemberRecursively(flatElt.targetAspect, (elt, _eltName, _prop, _path) => {
                // TODO: check whether that needs to be done for targetAspects as well
                // const exprAnnos = Object.keys(elt).filter(pn => pn[0] === '@');
                // flattenAndPrefixExprPaths(elt, exprAnnos, elt.$path, path, 0, true);
                if (csnUtils.isManagedAssociation(elt)) {
                  allMgdAssocDefs.push(elt);
                }
              }, [ flatEltName ], true, { pathWithoutProp: true } );
            }
            setProp(flatElt, '$pathInStructuredModel', flatElt.$path);
            setProp(flatElt, '$path', [ ...csnPath, flatEltName ]);
            elements[flatEltName] = flatElt;
            return elements;
          }, Object.create(null));
          setProp(def, `$flat${dictName}`, flatDict);
          orderedElementList.reduce(
            (mgdAssocs, [ _flatEltName, flatElt ]) => {
              if(csnUtils.isManagedAssociation(flatElt))
                mgdAssocs.push(flatElt);
              return mgdAssocs;
            }, allMgdAssocDefs);
        }
      });
      // entity annotations
      const flatAnnos = Object.create(null);
      const annoNames = copyAnnotations(def, flatAnnos).filter(pn => pn[0] === '@');
      flattenAndPrefixExprPaths(flatAnnos, annoNames, [ 'definitions', defName ], [ defName ], 0);
      setProp(def, '$flatAnnotations', flatAnnos);
      // explicit binding parameter of bound action
      if (def.actions) {
        const special$self = !csn?.definitions?.$self && '$self';
        Object.entries(def.actions).forEach(([actionName, action]) => {
          if (action.params) {
            const params = Object.entries(action.params);
            const firstParam = params[0][1];
            const type = firstParam?.items?.type || firstParam?.type;
            if (type === special$self) {

              const bindingParamName = params[0][0];
              const markBindingParam = {
                ref: (parent, prop, xpr) => {
                  if ((xpr[0].id || xpr[0]) === bindingParamName)
                    setProp(parent, '$bparam', true)
                },
              };
              const refCheck = {
                ref: (elemref, prop, xpr, path) => {
                  const { art, scope } = inspectRef(path);
                  if (scope !== '$magic' && art) {
                    const ft = csnUtils.getFinalTypeInfo(art.type);
                    if (!isBuiltinType(ft?.type) && refCheck.anno !== 'value') {
                      error('odata-anno-xpr-ref', path, { anno: refCheck.anno, elemref, '#': 'flatten_builtin_type' });
                    }
                  }
                }
              };

              const flatAnnos = Object.create(null);
              const annoNames = copyAnnotations(action, flatAnnos).filter(pn => pn[0] === '@');
              annoNames.forEach((an) => {
                refCheck.anno = an;
                transformAnnotationExpression(flatAnnos, an,
                  [ markBindingParam, refCheck, refFlattener ],
                  [ 'definitions', defName, 'actions',  actionName ]);
                adaptRefs.forEach(fn => fn(true, 1, (parent) => parent.$bparam));
                adaptRefs.length = 0;
              });
              setProp(action, '$flatAnnotations', flatAnnos);

              forEachMemberRecursively(action, (member, memberName, prop, path, _parent) => {
                const exprAnnos = Object.keys(member).filter(pn => pn[0] === '@');
                exprAnnos.forEach((pn) => {
                  refCheck.anno = pn;
                  transformAnnotationExpression(member, pn, [ markBindingParam, refCheck, refFlattener ], path);
                  adaptRefs.forEach(fn => fn(true, 1, (parent) => parent.$bparam));
                  adaptRefs.length = 0;
                });
              },
              [ 'definitions', defName, 'actions',  actionName ]);
            }
          }
        });
      }
    }
    // loop through types as well in order to collect the managaed associations
    // that reside in types definitions
    if ((def.kind === 'action' || def.kind === 'function' || def.kind === 'type' || def.kind === 'aspect' || def.kind === 'event')
        && !isExternalServiceMember(def, defName)) {
      if (def.kind === 'type' && csnUtils.isManagedAssociation(def))
        allMgdAssocDefs.push(def);
      else
        forEachMemberRecursively(def, (elt, _eltName, _prop, _path) => {
          if (csnUtils.isManagedAssociation(elt)) {
            allMgdAssocDefs.push(elt);
          }
        });
    }
    // loop through actions/functions and action/function parameters as well
    if (def.kind === 'entity' && def.actions && !isExternalServiceMember(def, defName)) {
      forEachGeneric(def, 'actions', (act) => {
        forEachMemberRecursively(act, (elt, _eltName, _prop, _path) => {
          if (csnUtils.isManagedAssociation(elt)) {
            allMgdAssocDefs.push(elt);
          }
        });
      });
    }
  });
  return allMgdAssocDefs;

  function recurseIntoElement(scope, elt, resolvedElt, rootPathIsNotNull, location, rootPrefix = [], typeIdx = 0) {
    const eltName = rootPrefix[rootPrefix.length-1];
    if (!resolvedElt.elements) {
      const flatElt = cloneElt(scope, elt, location, rootPrefix, typeIdx);
      if (rootPathIsNotNull)
        flatElt.notNull = true;
      else
        delete flatElt.notNull;
      return [[ eltName, flatElt ]];
    }
    else {
      let flattenedSubTree = [];
      forEach(resolvedElt.elements, (childName, child) => {
        resolvedElt = child;
        if (child.type && !child.elements) {
          resolvedElt = getFinalTypeInfo(child.type);
          if (resolvedElt.elements)
            typeIdx = rootPrefix.length + 1;
        }
        flattenedSubTree = flattenedSubTree.concat(recurseIntoElement(scope, child, resolvedElt,
          !!(child.notNull && rootPathIsNotNull),
          [... location, 'elements', childName],
          [ ...rootPrefix, childName ], typeIdx));
      });
      // 1) rename, 2) filter duplicates and finalize new elements
      const duplicateDict = Object.create(null);
      return flattenedSubTree.map(([flatEltName, flatElt]) => {
        return [ `${eltName}_${flatEltName}`, flatElt ];
      }).filter(([name, flatElt]) =>{
        if (duplicateDict[name]) {
          error('name-duplicate-element', location,
          { '#': 'flatten-element-gen', name });
          return false;
        }
        else {
          propagateToFlatElem(elt, flatElt, rootPrefix, typeIdx);
          duplicateDict[name] = flatElt;
          return true;
        }
      })
    }
  }

  function propagateToFlatElem(elt, flatElt, rootPrefix = [], typeIdx = 0) {
    // Copy annotations from struct
    // (not overwriting, because deep annotations should have precedence).
    // This has historic reasons. We don't copy doc-comments because copying annotations
    // is questionable to begin with.  Only selected annotations should have been copied,
    // if at all.
    // When flattening structured elements for OData don't propagate the odata.Type annotations
    // as these would falsify the flattened elements.

    // TODO: directly refer to edmPrimitiveType facets
    const excludes = {
      '@odata.Type': 1,
      '@odata.Scale': 1,
      '@odata.Precision': 1,
      '@odata.MaxLength': 1,
      '@odata.SRID': 1,
      '@odata.FixedLength': 1,
      '@odata.Collation': 1,
      '@odata.Unicode': 1,
    };
    // TODO: copy only those expression annotations that have no path into unreachable subtree, starting
    // of typePathRoot (which could be some completely different path)
    const exprAnnoNames = copyAnnotations(elt, flatElt, false, excludes).filter(pn => pn[0] === '@');
    flattenAndPrefixExprPaths(flatElt, exprAnnoNames, elt.$path, rootPrefix, typeIdx);
    // Copy selected type properties
    ['key', 'virtual', 'masked', 'viaAll', 'localized'].forEach(p => {
      if (elt[p] != null)
        flatElt[p] = elt[p];
    });
  }

  // Copy the original element
  function cloneElt(scope, elt, location, rootPrefix = [], typeIdx = 0) {
    const flatElt = cloneCsnNonDict(elt,
      { ...options,
        hiddenPropertiesToClone: [ '$structRef', '$fkExtensions', '$generatedForeignKeys' ]
      } );

    // needed for @cds.persistence.name
    setProp(flatElt, '$defPath', rootPrefix);
    setProp(flatElt, '$scope', scope);
    retypeCloneWithFinalBaseType(flatElt, location);
    if((elt._type || elt).type === 'cds.Map') {
      assignAnnotation(flatElt, '@open', elt['@open'] || true);
    }
    const [ nonAnnoProps, exprAnnoProps ] = Object.keys(flatElt).reduce((acc, pn) => {
      if (pn[0] !== '@' && pn !== 'value')
        acc[0].push(pn);
      else
        acc[1].push(pn);
      return acc;
    }, [[],[]]);
    // transform all non annotation properties for that flat element with the generic transformer
    // we don't know what's inside the element clone (like anonymous sub elements behind 'items' etc.)
    nonAnnoProps.forEach(pn => applyTransformationsOnNonDictionary(flatElt, pn, refFlattener, {}, elt.$path || location))
    adaptRefs.forEach(fn => fn());
    adaptRefs.length = 0;
    // flatten and prefix annotations and 'value' paths
    flattenAndPrefixExprPaths(flatElt, exprAnnoProps, elt.$path || location, rootPrefix, typeIdx);
    return flatElt;

    function retypeCloneWithFinalBaseType(elt, location) {
      if (elt.type &&
           !isBuiltinType(elt.type) &&
           !isODataV4BuiltinFromService(elt.type, location)
           && !isItemsType(elt.type)) {
        const resolvedType = csnUtils.getFinalTypeInfo(elt);

        delete resolvedType.kind;
        if (resolvedType.items)
          delete resolvedType.type;

        if (elt.items) {
          if (resolvedType.items) {
            elt.items = resolvedType;
            delete elt.items.type;
          }
          else
            elt.items.type = resolvedType;
        }
        else {
          if (resolvedType.items) {
            elt.items = resolvedType.items;
            delete elt.type;
          }
          else
            elt.type = resolvedType;
        }
      }

      function isItemsType(typeName) {
        const typeDef = csn.definitions[typeName];
        return !!typeDef?.items;
      }

      function isODataV4BuiltinFromService( typeName, path ) {
        if (options.odataVersion === 'v2' || typeof typeName !== 'string')
          return false;

        const typeServiceName = csnUtils.getServiceName(typeName);
        let finalBaseType = csnUtils.getFinalTypeInfo(typeName).type;
        if (!isBuiltinType(finalBaseType)) {
          const typeDef = csn.definitions[finalBaseType];
          finalBaseType = typeDef?.items?.type || typeDef?.type;
        }
        // we need the service of the current definition
        const currDefServiceName = csnUtils.getServiceName(path[1]);
        return typeServiceName === currDefServiceName && isBuiltinType(finalBaseType);
      }
    }
  }

  // The path rewriting must be done with the current CSN  path of that exact annotation location
  // in the element tree and done exactly after the initial copy, (otherwise, csnRefs is not able
  // to locate the relative location of the path expression in this element).
  // At this time both annotations and values must be rewritten.
  //
  // Later, the query can/must be rewritten as long as a flat OData CSN is published
  // but this then operates on the entity/view which has all struct infos available
  function flattenAndPrefixExprPaths(carrier, propNames, csnPath, rootPrefix, typeIdx, refParentIsItems = false) {

    const refCheck = {
      ref: (elemref, prop, xpr, path) => {
        const { links, art, scope } = inspectRef(path);
        if (scope !== '$magic' && art) {
          // try to find rightmost 'items', terminate if association comes first.
          let i = links.length-1;
          const getProp = (propName) => links[i].art?.[propName];

          let hasItems = false;
          for(; i >= 0 && !getProp('target') && !hasItems; i--) {
            const art = links[i].art;
            hasItems = !!getProp('items') || (art.type && !!csnUtils.getFinalTypeInfo(art.type)?.items)
          }
          if(!hasItems) {
            const ft = csnUtils.getFinalTypeInfo(art.type);
            if (!isBuiltinType(ft?.items?.type || ft?.type) && refCheck.anno !== 'value') {
              error('odata-anno-xpr-ref', path,
                {
                  anno: refCheck.anno,
                  elemref,
                  name: refCheck.eltLocationStr,
                  '#': 'flatten_builtin'
                });
            }
          }
        }
      }
    }

    refCheck.eltLocationStr = (function() {
      const [head, ...tail ] = rootPrefix;
      if(tail.length)
        return `${head}:${tail.join('.')}`;
      else
        return `${head}`;
    })();

    const absolutifier = {
      ref : (parent, prop, xpr, _path, _p, _ppn, ctx) => {
        const head = xpr[0].id || xpr[0];
        let isPrefixed = false;
        if(!isMagicVariable(head)) {
          if (head === '$self' && typeIdx < rootPrefix.length) {
            isPrefixed = true;
            const [xprHead, ...xprTail] = xpr.slice(1, xpr.length);
            if(xprHead) {
              if (xprHead.id) {
                xprHead.id = rootPrefix.slice(1, typeIdx).concat(xprHead.id).join('_');
                parent[prop] = [ xprHead, ...xprTail ];
              }
              else
                parent[prop] = [ rootPrefix.slice(1, typeIdx).concat(xprHead).join('_'), ...xprTail];
            }
          }
          else if (head !== '$self' && !parent.param && rootPrefix.length > 2) {
            isPrefixed = true;
            const [xprHead, ...xprTail] = xpr;
            if (!refParentIsItems) {
              if (xprHead.id) {
                xprHead.id = rootPrefix.slice(1, -1).concat(xprHead.id).join('_');
                parent[prop] = [ xprHead, ...xprTail ];
              }
              else
                parent[prop] = [ rootPrefix.slice(1, -1).concat(xprHead).join('_'), ...xprTail];
            }
            else
              parent[prop] = [ ...rootPrefix.slice(0, rootPrefix.length-1), ...xpr];
          }
          if(isPrefixed) {
            if (carrier.$scope === 'params')
              parent.param = true;
            else
              parent[prop].unshift('$self');
          }
        }
        if(isPrefixed && ctx?.annoExpr?.['=']) {
          ctx.annoExpr['='] = true;
        }
      }
    }

    refFlattener.$fnArgs = [ refParentIsItems ];
    propNames.forEach(pn => {
      refCheck.anno = pn;
      if(pn[0] === '@') {
        transformAnnotationExpression(carrier, pn, [ refCheck, refFlattener ], csnPath);
        adaptRefs.forEach(fn => fn(refParentIsItems));
        adaptRefs.length = 0;
        transformAnnotationExpression(carrier, pn, absolutifier, csnPath);
      }
      if(pn === 'value') {
        transformExpression(carrier, pn, [ refCheck, refFlattener ], csnPath);
        adaptRefs.forEach(fn => fn(refParentIsItems));
        adaptRefs.length = 0;
        transformExpression(carrier, pn, absolutifier, csnPath);
      }
    });
  }

  // TODO: This should be part of the generic path rewriting algorithm
  // Primitive approach here does not take into account absolute paths via $self etc...
  function rewriteOnCondition(flatElt, flattenedSubTree) {
    if (flatElt.on) {
      // unmanaged relations can't be primary key
      delete flatElt.key;
      // Make refs resolvable by fixing the first ref step
      transformExpression(flatElt, 'on', {
        ref: (parent, prop, xpr) => {
          const prefix = flatElt.$defPath.slice(1, -1).join('_');
          const possibleFlatName = `${prefix}_${xpr[0]}`;
          if (flattenedSubTree.find(entry => entry[0] === possibleFlatName))
            xpr[0] = possibleFlatName;
        }
      });
    }
  }

  // update the @odata.foreignKey4 and the $generatedForeignKeys array of
  // an association that have been flattened
  function adaptManagedAssociationSpecialFields(flatElt, flatEltName, flattenedSubTree) {
    if (!(flatElt.target || flatElt.keys) && !flatElt.on )
      return;
    const structuredAssocName = flatElt.$defPath[flatElt.$defPath.length - 1];
    const generatedForeignKeysForAssoc = flattenedSubTree
      .filter(se => {
        // compare $defPath without the last element
        let comeFromSameDef = flatElt.$defPath.slice(0, flatElt.$defPath.length - 1).join('.') === se[1].$defPath.slice(0, se[1].$defPath.length - 1).join('.');
        return (comeFromSameDef && (se[1]['@odata.foreignKey4'] && se[1]['@odata.foreignKey4'] === structuredAssocName) && se[0].startsWith(flatEltName))
      });

    generatedForeignKeysForAssoc.forEach(gfk => gfk[1]['@odata.foreignKey4'] = flatEltName);
    // reassign the generated foreign keys for current assoc in order to assign
    // correct values for $generatedFieldName later on during flattenManagedAssocsAsKeys();
    // eslint-disable-next-line @stylistic/js/max-statements-per-line
    setProp(flatElt, '$generatedForeignKeys', generatedForeignKeysForAssoc.map(gfk => { return { name: gfk[0] }}));
  }
}

function flattenAllStructStepsInRefs( csn, refFlattener, adaptRefs, inspectRef, effectiveType,
    csnUtils, error, options, iterateOptions = {} ) {

  // All anno path flattening is already done, don't do it on locations where we don't want it!
  const typeNames = [];
  forEachDefinition(csn, (def, defName) => {
    if (def.kind === 'entity') {
      ['query', 'projection'].forEach(dictName => {
        applyTransformationsOnNonDictionary(csn.definitions[defName],
            dictName, refFlattener, iterateOptions,
            [ 'definitions', defName ]);
      })
      if (csn.definitions[defName].actions)
        applyTransformationsOnDictionary(csn.definitions[defName].actions,
          refFlattener, iterateOptions,
          [ 'definitions', defName, 'actions' ]);
    }

    if (['type'].includes(def.kind)) {
      typeNames.push(defName);
      applyTransformationsOnNonDictionary(csn.definitions,
        defName, refFlattener, iterateOptions, [ 'definitions' ]);
    }
  });
  adaptRefs.forEach(fn => fn());
  adaptRefs.length = 0;

  const refCheck = {
    ref: (elemref, prop, xpr, path) => {
      const { links, art, scope } = inspectRef(path);

      if (scope !== '$magic' && art) {
        let i = links.length-2;
        const getProp = (propName) =>
          (links[i].art?.[propName] ||
          effectiveType(links[i].art)[propName]);

        let target = undefined;
        for(; i >= 0 && !getProp('items') && !target; i--) {
          target = getProp('target');
        }
        const ft = csnUtils.getFinalTypeInfo(art.type);
        if (target && csn.definitions[target].$flatelements
            && !isBuiltinType(ft?.type) && refCheck.anno !== 'value') {
          error('odata-anno-xpr-ref', path,
          { anno: refCheck.anno, elemref, '#': 'flatten_builtin_type' });
        }
      }
    }
  }
  typeNames.forEach(tn => {
    forEachMemberRecursively(csn.definitions[tn], (member, memberName, prop, csnPath) => {
      Object.keys(member).filter(pn => pn[0] === '@').forEach(pn => {
        refCheck.anno = pn;
        transformAnnotationExpression(member, pn, [ refCheck, refFlattener ], csnPath);
        adaptRefs.forEach(fn => fn(true, 1));
        adaptRefs.length = 0;
      });
    }, [ 'definitions', tn ]);
  })
}

function getStructRefFlatteningTransformer(csn, inspectRef, effectiveType, options, resolved, pathDelimiter) {
  const { flattenStructStepsInRef } = transformUtils.getTransformers(csn, options, pathDelimiter);
  /**
   * For each step of the links, check if there is a type reference.
   * If there is, resolve it and store the result in a WeakMap.
   *
   * @param {Array} [links]
   * @todo seems too hacky
   * @returns {WeakMap} A WeakMap where a link is the key and the type is the value
   */
  function resolveLinkTypes( links = [] ) {
    const resolvedLinkTypes = new WeakMap();
    links.forEach((link) => {
      const { art } = link;
      if (art && art.type)
        resolvedLinkTypes.set(link, effectiveType(art));
    });
    return resolvedLinkTypes;
  }
  const adaptRefs = [];
  const transformer = {
    ref: (parent, _prop, ref, path, _p, _ppn, ctx) => {
      const { links, art, scope } = inspectRef(path);
      const resolvedLinkTypes = resolveLinkTypes(links);
      setProp(parent, '$path', [ ...path ]);
      if (insideKeys(path))
        setProp(parent, '_art', art);
      const lastRef = ref[ref.length - 1];
      const fn = (suspend = false, suspendPos = 0,
                    refFilter = (_parent) => true) => {
        if (refFilter(parent)) {
          const scopedPath = [ ...parent.$path ];
          // TODO: If foreign key annotations should be assigned via
          //       full path into target, uncomment this line and
          //       comment/remove setProp in expansion.js
          // setProp(parent, '$structRef', parent.ref);
          const flattenParameters = true; // structured parameters are flattened
          const [ newRef, refChanged ] = flattenStructStepsInRef(ref,
              scopedPath, links, scope, resolvedLinkTypes,
              suspend, suspendPos, parent.$bparam,
              flattenParameters);
          parent.ref = newRef;
          resolved.set(parent, { links, art, scope });
          // Explicitly set implicit alias for things that are now flattened - but only in columns
          // TODO: Can this be done elegantly during expand phase already?
          if (parent.$implicitAlias) { // an expanded s -> s.a is marked with this - do not add implicit alias "a" there, we want s_a
            if (parent.ref[parent.ref.length - 1] === parent.as) // for a simple s that was expanded - for s.substructure this would not apply
              delete parent.as;
            delete parent.$implicitAlias;
          }
          // To handle explicitly written s.a - add implicit alias a, since after flattening it would otherwise be s_a
          else if (parent.ref[parent.ref.length - 1] !== lastRef &&
                      (insideColumns(scopedPath) || insideKeys(scopedPath)) &&
                      !parent.as) {
            parent.as = lastRef;
          }
          return refChanged;
        }
        return false;
        /**
         * Return true if the path points inside columns
         *
         * @param {CSN.Path} path
         * @returns {boolean}
         */
        function insideColumns( path ) {
          return path.length >= 3
            && (path[path.length - 3] === 'SELECT'
            || path[path.length - 3] === 'projection')
            && path[path.length - 2] === 'columns';
        }
      };
      /**
       * Return true if the path points inside keys
       *
       * @param {CSN.Path} path
       * @returns {boolean}
       */
      function insideKeys( path ) {
        return path.length >= 3
          && path[path.length - 2] === 'keys'
          && typeof path[path.length - 1] === 'number';
      }


      // adapt queries later
      if(ctx?.annoExpr?.['=']) {
        const annoExpr = ctx.annoExpr;
        adaptRefs.push((...args) => {
          if(fn(...args))
            annoExpr['='] = true;
        });
      }
      else
        adaptRefs.push(fn);
    },
  }

  return { adaptRefs, transformer, inspectRef, effectiveType };
}

// replace managed associations in key refs with their respective foreing keys
function replaceManagedAssocsAsKeys(allFlatManagedAssocDefinitions, csnUtils) {
  allFlatManagedAssocDefinitions.forEach( assoc => {
    let finished = false;

    if (!assoc.keys)
      return; // managed to-many assoc

    while (!finished) {
      const newKeys = [];
      finished = processKeys(newKeys);
      assoc.keys = newKeys;
    }

    function processKeys(collector) {
      let done = true;
      assoc.keys.forEach( key => {
        const art = key._art;
        if (art && csnUtils.isManagedAssociation(art)) {
          done = false;
          // key._art is the artifact from the structured model, because of that we need to look
          // for the flat representation in the allFlatManagedAssocDefinitions
          allFlatManagedAssocDefinitions.find(fa => (fa.$pathInStructuredModel || fa.$path).join() === art.$path.join())
            .keys.forEach( keyAssocKey => {
            collector.push(cloneAndExtendRef(keyAssocKey, key));
          });
        }
        else if (art && !art.on){
          if (!key.$generatedFieldName) {
            const flatAssocName = assoc.$path[assoc.$path.length - 1];
            // When we have a definition like type "<type_name>: Association to <target_name>",
            // we do not generate foreign keys in the definition, therefore no $generatedForeignKeys,
            // respectively we do not assign $generatedFieldName
            if (assoc.$generatedForeignKeys) {
              const generatedForeignKey = assoc.$generatedForeignKeys.find(gfk => gfk.name === `${flatAssocName}_${key.as || key.ref.join('_')}`);
              key.$generatedFieldName = generatedForeignKey.name;
            }
          }
          if (key.as && key.as === key.ref[0]) delete key.as;
          collector.push(key);
        }
      })

      return done;
    }
  });

  function cloneAndExtendRef(keyAssocKey, key) {
    let newKey = { ref:  [`${key.ref.join('_')}_${keyAssocKey.as || keyAssocKey.ref.join('_')}`] };
    setProp(newKey, '_art', keyAssocKey._art);
    if (key.as) {
      newKey.as = `${key.as}_${keyAssocKey.as || keyAssocKey.ref.join('_')}`;
    }
    return newKey;
  }
}

module.exports = {
  allInOneFlattening,
  flattenAllStructStepsInRefs,
  handleManagedAssociationsAndCreateForeignKeys,
  getStructRefFlatteningTransformer,
  replaceManagedAssocsAsKeys
};
