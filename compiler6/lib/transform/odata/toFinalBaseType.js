'use strict';

const { setProp, isBetaEnabled } = require('../../base/model');
const {
  transformAnnotationExpression,
  forEachDefinition,
  forEachGeneric,
  forEachMemberRecursively,
} = require('../../model/csnUtils');
const { isBuiltinType } = require('../../base/builtins');
const { isArtifactInSomeService, isArtifactInService } = require('./utils');
const { cloneCsnDict, cloneCsnNonDict } = require('../../model/cloneCsn');

function expandToFinalBaseType(csn, transformers, csnUtils, services, options, error) {
  const isV4 = options.odataVersion === 'v4';
  const special$self = !csn?.definitions?.$self && '$self';
  forEachDefinition(csn, (def, defName) => {
    // Unravel derived type chains to final one for elements, actions, action parameters (propagating annotations)
    forEachMemberRecursively(def, (member, _memberName) => {
      expandToFinalBaseType(member, defName);
      expandToFinalBaseType(member.items, defName);
      expandToFinalBaseType(member.returns, defName);
      expandToFinalBaseType(member.returns && member.returns.items, defName);

    }, ['definitions', defName]);

    expandToFinalBaseType(def, defName);
    expandToFinalBaseType(def.items, defName);
    expandToFinalBaseType(def.returns, defName);
    expandToFinalBaseType(def.returns && def.returns.items, defName);
    /*
      If the definition('def' variable) is a type definition and the assigned type of this very same definition('def' variable)
      is structured type, e.g.:

      type Struct1 {
        a : Integer;
        b : Integer;
      };
      type Struct2: Struct1;
      after compilation the csn looks like this:
      ...
      "S.Struct1": {
        "kind": "type",
        "elements": {
          "a": { "type": "cds.Integer" },
          "b": { "type": "cds.Integer" }
        } },
      "S.Struct2": {
        "kind": "type",
        "type": "S.Struct1",
        "elements": {
          "a": { "type": "cds.Integer" },
          "b": { "type": "cds.Integer" }
        } } ...

      "S.Struct2" should looks just like "S.Struct1" => the "type": "S.Struct1" property has to be removed
    */
    if (def.kind === 'type' && def.type && !isBuiltinType(def.type) && !def.type.ref) {
      // elements are already there -> do not show the type
      delete def.type;
    }
    // TODO: this is more types exposure related, check and move
    // In case we have in the model something like:
    // type Foo: array of Bar; type Bar: { qux: Integer };
    // In the type Foo we expand the first level of elements of the items or
    // type Foo: array of { qux: Integer };
    if (def.kind === 'type' && def.items && isArtifactInSomeService(defName, services)) {
      expandFirstLevelOfArrayed(def);
    }
  });

  if(isBetaEnabled(options, 'odataTerms')) {
    forEachGeneric(csn, 'vocabularies', (def, defName) => {
      forEachMemberRecursively(def, (member) => {
        expandToFinalBaseType(member, defName);
        expandToFinalBaseType(member.items, defName);

      }, ['vocabularies', defName]);

      expandToFinalBaseType(def, defName);
      expandToFinalBaseType(def.items, defName);
    }, []);
  }
  // In case we have in the model something like:
  // type Foo: array of Bar; type Bar: { qux: Integer };
  // In the type Foo we expand the first level of elements of the items like we have in CDL this:
  // type Foo: array of { qux: Integer };
  function expandFirstLevelOfArrayed(def) {
    if (def.items.type && !isBuiltinType(def.items.type)) {
      const finalBaseType = csnUtils.getFinalTypeInfo(def.items.type);
      if (finalBaseType?.elements) {
        def.items.elements = cloneCsnDict(finalBaseType.elements, options);
        delete def.items.type;
      }
    }
  }

  function expandToFinalBaseType(node, defName) {
    if (!node) return;
    if (node.kind === 'event') return;

    if(node.type && !isBuiltinType(node.type)) {
      const finalBaseType = csnUtils.getFinalTypeInfo(node.type);
      if(finalBaseType == null) {
        /*
          type could not be resolved, delete type property to be equal to a typeless element
          definition. Today, all type refs must be resolvable, input validations
          checkTypeDefinitionHasType, checkElementTypeDefinitionHasType
          guarantee this. In the future this may change.
        */
        delete node.type;
      }
      else {
        if (isExpandable(finalBaseType) || node.kind === 'type') {
          // 1. Get the final type of the node (resolve derived type chain)
          if (finalBaseType.type !== special$self) {
            // The type replacement depends on whether 'node' is a definition or a member[element].
            if (node.kind) {
              /*
                It is a definition and we expand to builtin type and to elements
                type T: S; --> Integer;
                type S: X; --> Integer;
                type X: Integer;

                type A: B; -> {...}
                type B: C; -> { ... }
                type C { .... };
              */
              if (isBuiltinType(finalBaseType.type)) {
                /*
                  use transformUtils::toFinalBaseType for the moment,
                  as it is collects along the chain of types
                  attributes that need to be propagated
                  enum, length, scale, etc.
                */
                transformers.toFinalBaseType(node);
              }
              else if (csnUtils.isStructured(finalBaseType)) {
                cloneElements(node, finalBaseType);
              }
              else if (node.type && node.items)
                delete node.type;
            }
            else {
              /*
                this is a member and we expand to final base only if builtin
                  type T: S; --> Integer;
                  type S: X; --> Integer;
                  type X: Integer;

                  type {
                    struct_elt: many A; ---> stays the same
                    scalar_elt: T; ---> Integer;
                    type_ref_elt: type of struct_elt;
                  };
                  type A: B; -> {...}
                  type B: C; -> { ... }
                  type C { .... };
              */
              if (isBuiltinType(finalBaseType.type)) {
                /*
                  use transformUtils::toFinalBaseType for the moment,
                  as it is collects along the chain of types
                  attributes that need to be propagated
                  enum, length, scale, etc.
                */
                transformers.toFinalBaseType(node);
                // node.type = finalType;
              }
              else if (node.type.ref) {
                cloneElements(node, finalBaseType);
              }
            }
          }
        }
        if (/*the resolved type is not built in*/ !isBuiltinType(node.type)) {
          // handle array of defined via a named type
          // example in actions: 'action act() return Primitive; type Primitive: array of String;'
          const currService = csnUtils.getServiceName(defName);
          const isArrayOfBuiltin = finalBaseType.items &&
            isBuiltinType(csnUtils.getFinalTypeInfo(finalBaseType.items.type)?.type)
          if (isArrayOfBuiltin && (!isArtifactInService(node.type, currService) || !isV4)) {
            node.items = finalBaseType.items;
            delete node.type;
          }
        }
      }
    }

    function cloneElements(node, finalBaseType) {
      let clone;
      // do the clone only if really needed
      if((finalBaseType.items && !node.items) ||
         (finalBaseType.elements && !node.elements)) {
        // clone the definition not another clone
        let _type = node._type;
        while(_type._type && !_type.items && !_type.elements)
          _type = _type._type;
        clone = cloneCsnNonDict(_type, { ...options, hiddenPropertiesToClone: [ '_type' ] });
        fitClonedElementsIntoParent(clone, node, _type.$path);
      }
      if (finalBaseType.items) {
        delete node.type;
        if(!node.items)
          Object.assign(node, { items: clone.items });
      }
      if (finalBaseType.elements) {
        if(!finalBaseType.items)
          delete node.type;
        if(!node.elements)
          Object.assign(node, { elements: clone.elements });
      }
    }

    function fitClonedElementsIntoParent(clone, node, typeRefCsnPath) {
      const f = (p) => {
        const [h, ...t ] = p;
        return `${h}:${t.join('.')}`;
      }
      const typeRefStr = f(node.type.ref);
      const typeRefRootPath = $path2path(typeRefCsnPath);
      forEachMemberRecursively(clone, (elt, eltName, prop, location) => {
        const usingPositionStr = f($path2path(location));
        const eltRootPath = $path2path(elt.$path);

        Object.keys(elt).filter(pn => pn[0] === '@').forEach(anno => {
          transformAnnotationExpression(elt, anno, {
            ref: (parent, prop, xpr, csnPath, _p, _ppn, ctx) => {
              let prefixMatch = true;
              const head = xpr[0].id || xpr[0];
              if (head === '$self') {
                for (let i = 1; i < typeRefRootPath.length && prefixMatch; i++){
                  prefixMatch = (xpr[i].id || xpr[i]) === typeRefRootPath[i];
                }
                if(prefixMatch && xpr.length > typeRefRootPath.length) {
                  if(xpr.length >= eltRootPath.length)
                    parent[prop] = [ ...xpr.slice(eltRootPath.length-1)];
                  else
                    parent[prop] = [ '$self', ...xpr.slice(typeRefRootPath.length)];
                  if(ctx?.annoExpr?.['='])
                    ctx.annoExpr['='] = true;
                }
                else {
                  error('odata-anno-xpr-ref', csnPath,
                  { anno, elemref: xpr.join('.'), name: usingPositionStr, code: typeRefStr });
                }              
              }
            },
          }, elt.$path);
        });
        setProp(elt, '$path', location);
      }, node.$path);
    }
    /*
      Check, if a type needs to be expanded into the service

      All types are expansion candidates except these in V4:
      - it's a builtin
      - it's an assoc
      - the referred type is defined in the service
    */
    function isExpandable(finalBaseType) {
        // in V4 we should use TypeDefinitions whenever possible, thus in case the final type of a field is
        // a builtin from the service - do not expand to the final base type

      const currService = csnUtils.getServiceName(defName);
      const isBuiltin = isBuiltinType(finalBaseType.type);
      const isAssoc = node.target;
      const isInCurServ = isArtifactInService(node.type, currService);
      return !isV4 || !(isBuiltin && !isAssoc && isInCurServ);
    }

// convert $path to path starting at main artifact
    function $path2path( p ) {
      const path = [];
      let env = csn;
      for (let i = 0; p && env && i < p.length; i++) {
        const ps = p[i];
        env = env[ps];
        if (env && env.constructor === Object) {
          path.push(ps);
      // jump over many items but not if this is an element
          if (env.items) {
            env = env.items;
            if (p[i + 1] === 'items')
              i++;
          }
          if (env.type && !isBuiltinType(env.type) && !env.elements)
            env = csn.definitions[env.type];
        }
      }
      return path;
    }

  }
}

module.exports = expandToFinalBaseType;
