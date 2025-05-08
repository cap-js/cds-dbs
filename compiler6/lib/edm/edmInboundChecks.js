'use strict';

const { setProp, isBetaEnabled } = require('../base/model');
const {
  forEachDefinition, forEachMemberRecursively, getUtils,
  transformAnnotationExpression,
} = require('../model/csnUtils');
const { isBuiltinType } = require('../base/builtins');
const { assignAnnotation } = require('./edmUtils.js');

// eslint-disable-next-line no-unused-vars
function resolveForeignKeyRefs( csn, csnUtils ) {
  forEachDefinition(csn, (def, defName) => {
    const currPath = [ 'definitions', defName ];
    forEachMemberRecursively(def, (construct, _constructName, _prop, path) => {
      if (construct.target && construct.keys) {
        construct.keys.forEach((fk, i) => {
          setProp(fk, '_artifact', csnUtils.inspectRef([ ...path, 'keys', i ]).art);
        });
      }
    }, currPath, true, { elementsOnly: true });
  });
}


function inboundQualificationChecks( csn, options, messageFunctions,
                                     serviceRootNames, requestedServiceNames, isMyServiceRequested, whatsMyServiceRootName, csnUtils ) {
  const { message, warning, throwWithError } = messageFunctions;

  const { getFinalTypeInfo } = getUtils(csn);

  forEachDefinition(csn, [ attach$path, onServiceMember ]);
  checkNestedContextsAndServices();
  throwWithError();

  // attach $path to all
  function attach$path( def, defName ) {
    setProp(def, '$path', [ 'definitions', defName ]);
    forEachMemberRecursively(def,
                             (member, _memberName, _prop, path) => {
                               setProp(member, '$path', path);
                             }, [ 'definitions', defName ]);
  }

  // code that should be run only on service members
  function onServiceMember( def, defName ) {
    if (!isMyServiceRequested(defName))
      return;

    const location = [ 'definitions', defName ];
    // check items.items
    checkIfItemsOfItems(def, undefined, undefined, location);
    forEachMemberRecursively(def, checkIfItemsOfItems, location);
    checkIfItemsOfItems(def.returns, undefined, undefined, location.concat('returns'));
    if (def.actions) {
      Object.entries(def.actions).forEach(([ n, action ]) => {
        const aLoc = location.concat('actions', n);
        checkIfItemsOfItems(action, undefined, undefined, aLoc);
        markBindingParamPaths(action, aLoc);
        forEachMemberRecursively(action, checkIfItemsOfItems, aLoc);
        checkIfItemsOfItems(action.returns, undefined, undefined, aLoc.concat('returns'));
      });
    }

    // decorate UUID keys with @Core.ComputedDefaultValue and complain
    // on named type UUID elements that have no such annotation
    const anno = '@Core.ComputedDefaultValue';
    if (def.kind === 'entity' && def.elements) {
      Object.entries(def.elements).forEach(([ eltName, elt ]) => {
        if (elt.key)
          addCoreComputedDefaultValueOnUUIDKeys(elt, [ eltName ], location);
      });
    }

    function addCoreComputedDefaultValueOnUUIDKeys( elt, eltPath, path ) {
      let type = elt.items?.type || elt.type;
      if (type && !isBuiltinType(type)) {
        type = getFinalTypeInfo(type);
        if (!isBuiltinType(type.type))
          path = [ 'definitions', type.type ];
      }
      else {
        type = elt;
      }

      if (type.type === 'cds.UUID' && elt['@odata.foreignKey4'] == null) {
        if (path[1] === defName)
          assignAnnotation(elt, anno, true);
        else if (elt[anno] == null)
          warning('odata-key-uuid-default-anno', path, { type: type.type, anno, id: `${ defName }:${ eltPath.join('.') }` });
      }
      else {
        const elements = type.items?.elements || type.elements;
        if (elements) {
          Object.entries(elements).forEach(([ eltName, subelt ]) => {
            addCoreComputedDefaultValueOnUUIDKeys(subelt, [ ...eltPath, eltName ], [ ...path, 'elements', eltName ]);
          });
        }
      }
    }

    function checkIfItemsOfItems( member, _memberName, _prop, path ) {
      if (!member)
        return;
      const memberType = csnUtils.effectiveType(member);
      let { items } = memberType;
      if (items) {
        if (items.target) {
          const isComp = items.type === 'cds.Composition';
          message('type-invalid-items', path, { '#': isComp ? 'comp' : 'assoc', prop: 'items' });
          return;
        }
        let i = 1;
        while (items) {
          items = items.items;
          if (items)
            i++;
        }
        if (i > 1) {
          message('chained-array-of', path);
          return;
        }

        const itemsType = csnUtils.effectiveType(memberType.items);
        if (itemsType.items)
          message('chained-array-of', path);
      }
    }

    // we need to know if the first path step is the bindind param
    // for the rejection of V2 paths where the BP is ignored
    function markBindingParamPaths( action, loc ) {
      const special$self = !csn?.definitions?.$self && '$self';
      if (action.params) {
        const params = Object.entries(action.params);
        const firstParam = params[0][1];
        const type = firstParam?.items?.type || firstParam?.type;
        if (type === special$self) {
          const bindingParamName = params[0][0];
          const markBindingParam = {
            ref: (parent, prop, xpr) => {
              if ((xpr[0].id || xpr[0]) === bindingParamName)
                parent.$bparam = true;
            },
          };
          Object.keys(action).filter(pn => pn[0] === '@').forEach((pn) => {
            transformAnnotationExpression(action, pn, markBindingParam, loc);
          });
          forEachMemberRecursively(action, (member, _memberName, _prop, path, _parent) => {
            Object.keys(member).filter(pn => pn[0] === '@').forEach((pn) => {
              transformAnnotationExpression(member, pn, markBindingParam, path);
            });
          }, loc);
        }
      }
    }
  }

  function checkNestedContextsAndServices() {
    if (!isBetaEnabled(options, 'nestedServices')) {
      serviceRootNames.forEach((sn) => {
        const parent = whatsMyServiceRootName(sn, false);
        if (parent && requestedServiceNames.includes(parent) && parent !== sn) {
          message( 'service-nested-service', [ 'definitions', sn ], { art: parent },
                   'A service can\'t be nested within a service $(ART)' );
        }
      });
    }

    Object.entries(csn.definitions).forEach(([ fqName, art ]) => {
      if (art.kind === 'context') {
        const parent = whatsMyServiceRootName(fqName);
        if (requestedServiceNames.includes(parent)) {
          message( 'service-nested-context', [ 'definitions', fqName ], { art: parent },
                   'A context can\'t be nested within a service $(ART)' );
        }
      }
    });
  }
}

module.exports = { inboundQualificationChecks };
