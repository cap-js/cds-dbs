'use strict';

const {
  forEachDefinition, forEachMemberRecursively, applyTransformationsOnNonDictionary, transformExpression, transformAnnotationExpression,
} = require('../../model/csnUtils');
const { getStructStepsFlattener } = require('../db/flattening');
const { setProp } = require('../../base/model');
const { forEach } = require('../../utils/objectUtils');


/**
 *
 * @param csn
 * @param options
 * @param csnUtils
 * @param messageFunctions
 */
function flattenRefs(csn, options, csnUtils, messageFunctions) {
  const cleanup = [];
  forEachDefinition(csn, (artifact) => {
    if (artifact.elements) {
      const stack = [ { prefix: [], elements: artifact.elements } ];
      while (stack.length > 0) {
        const { prefix, elements } = stack.pop();
        forEach(elements, (elementName, element) => {
          if (element.elements)
            stack.push({ prefix: prefix.concat(elementName), elements: element.elements });

          const absolutifier = absolutifyPaths(prefix, cleanup);
          // Absolutify paths in on-conditions
          if (element.on) {
            transformExpression(element, 'on', {
              ref: absolutifier,
            }, []);
          }

          // Absolutify paths in annotation expressions
          Object.keys(element)
            .filter(pn => pn.startsWith('@') && element[pn])
            .forEach((anno) => {
              transformAnnotationExpression(element, anno, {
                ref: absolutifier,
              }, []);
              if (element[anno].ref)
                absolutifier(element[anno], 'ref', element[anno].ref);
            });
        });
      }
    }
  });


  const adaptRefs = [];
  const resolved = new WeakMap();
  const refFlattener = getStructStepsFlattener(csn, options, messageFunctions, resolved, '_', adaptRefs);

  forEachDefinition(csn, (def, defName) => {
    if (def.kind === 'entity') {
      applyTransformationsOnNonDictionary(csn.definitions, defName, refFlattener, { processAnnotations: true, skipDict: { actions: 1 } }, [ 'definitions' ]);

      adaptRefs.forEach(fn => fn());
      adaptRefs.length = 0;

      // explicit binding parameter of bound action
      if (def.actions) {
        const special$self = !csn?.definitions?.$self && '$self';
        Object.entries(def.actions).forEach(([ an, a ]) => {
          if (a.params) {
            const params = Object.entries(a.params);
            const firstParam = params[0][1];
            const type = firstParam?.items?.type || firstParam?.type;
            if (type === special$self) {
              const bindingParamName = params[0][0];
              const markBindingParam = {
                ref: (parent, prop, xpr) => {
                  if ((xpr[0].id || xpr[0]) === bindingParamName)
                    setProp(parent, '$bparam', true);
                },
              };

              Object.keys(a)
                .filter(pn => pn.startsWith('@') && a[pn])
                .forEach((pn) => {
                  transformAnnotationExpression(a, pn, [ markBindingParam, refFlattener ], [ 'definitions', defName, 'actions', an ]);
                  adaptRefs.forEach(fn => fn(true, 1, parent => parent.$bparam));
                  adaptRefs.length = 0;
                });


              forEachMemberRecursively(a, (member, memberName, prop, path) => {
                Object.keys(member).filter(pn => pn.startsWith('@') && member[pn]).forEach((pn) => {
                  transformAnnotationExpression(member, pn, [ markBindingParam, refFlattener ], path);
                  adaptRefs.forEach(fn => fn(true, 1, parent => parent.$bparam));
                  adaptRefs.length = 0;
                });
              }, [ 'definitions', defName, 'actions', an ]);
            }
          }
        });
      }
    }
    else {
      applyTransformationsOnNonDictionary(csn.definitions, defName, refFlattener, { processAnnotations: false }, [ 'definitions' ]);
      adaptRefs.forEach(fn => fn());
      adaptRefs.length = 0;
    }
  });

  cleanup.forEach((obj) => {
    if (obj.ref && obj.ref[0] === '$self')
      obj.ref.shift();
  });
}

function absolutifyPaths(prefix, cleanup) {
  return function absolutify(_parent, _prop, ref) {
    if (ref[0].id || ref[0] !== '$self' && ref[0] !== '$projection' && !ref[0].startsWith('$') && !_parent.param) {
      _parent.ref = [ '$self', ...prefix, ...ref ];
      cleanup.push(_parent);

      return true;
    }

    return false;
  };
}


module.exports = {
  flattenRefs,
};
