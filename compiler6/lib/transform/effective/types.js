'use strict';

const {
  applyTransformations,
  applyTransformationsOnNonDictionary,
  applyTransformationsOnDictionary,
} = require('../../model/csnUtils');
const { forEachKey } = require('../../utils/objectUtils');
const { cloneCsnDict, cloneCsnNonDict } = require('../../model/cloneCsn');

/**
 * Resolve all references to structured types in entities to the underlying elements.
 * Resolve all simple type refs to their cds builtin type.
 *
 * When setting the elements, we deeply clone them from the type to avoid accidental changes
 * since they are linked by a reference.
 * @todo What about annotations on the type?
 * @param {CSN.Model} csn will be transformed
 * @param {object} csnUtils
 * @param {object} transformers
 * @param {CSN.Options} options
 * @returns {Function} Callback to resolve types in action returns later - as for them, $self would lead to unresolvable constructs at this point
 * so we can call this callback after flattening is done - then we can safely resolve their types.
 */
function resolveTypes( csn, csnUtils, transformers, options ) {
  const { flattenStructStepsInRef } = transformers;
  const later = [];
  applyTransformations(csn, {
    type: (parent) => {
      resolveType(csnUtils, parent);
    },
  }, [ (definitions, artifactName, artifact) => {
    // In a non-flat model, replacing types with some $self inside causes issues for actions (bound or unbound)
    // we remember them and replace them after flattening.
    if (artifact.kind === 'action' || artifact.kind === 'function') // TODO: We still process them, this does not abort that? I am pretty sure at least...
      later.push([ { [artifactName]: artifact }, [ 'definitions' ] ]);
    else if (artifact.actions)
      later.push([ artifact.actions, [ 'definitions', artifactName, 'actions' ] ]);
  } ], { skipStandard: { returns: true }, processAnnotations: true, skipDict: { actions: true } });

  // Type refs like E:struct.sub can not be resolved later, as struct will be flattened. So we rewrite it to E:struct_sub here.
  later.forEach(([ action, actionPath ]) => {
    applyTransformationsOnDictionary(action, {
      type: (parent, prop, type, path) => {
        if (type.ref)
          type.ref = flattenStructStepsInRef(type.ref, path.concat('type'))[0];
      },
    }, {}, actionPath);
  });

  // TODO: Directly push the .returns into the later so we have a more minimal looping
  return function resolveTypesInActions(refreshedCsnUtils) {
    later.forEach(([ action ]) => {
      applyTransformationsOnDictionary(action, {
        type: (parent) => {
          resolveType(refreshedCsnUtils, parent);
        },
      });
    });
  };


  /**
   * Resolve a type to its
   * - elements
   * - items
   * - basic builtin
   *
   * Drill down into .elements and .items
   *
   * @param {object} parent Object with a .type property
   */
  function resolveType( csnUtils, parent ) {
    // TODO: I assume there can be cases with a type ref but still having .elements already? Subelement anno?
    const final = csnUtils.getFinalTypeInfo(parent.type);
    if (final?.elements) {
      // We do full clones so users don't get unexpected linkage later
      if (!parent.elements)
        parent.elements = cloneCsnDict(final.elements);
      delete parent.type;
    }
    else if (final && final.items) {
      if (!parent.items)
        parent.items = cloneCsnNonDict(final.items);
      delete parent.type;
    }
    else if (final?.type && (options.resolveSimpleTypes || parent.type.ref?.length > 1)) {
      forEachKey(final, (key) => { // copy `type` + properties (default, etc.)
        if (parent[key] === undefined || key === 'type')
          parent[key] = final[key];
      });
    }

    // Drill down - there might be other type references
    const stack = [ ];
    if (parent.elements || parent.items)
      stack.push(parent);
    while (stack.length > 0) {
      const obj = stack.pop();
      if (obj.elements) {
        applyTransformationsOnDictionary(obj.elements, {
          type: getTypeTransformer(csnUtils, stack),
        }, { skipDict: { actions: true } });
      }
      else if (obj.items) {
        applyTransformationsOnNonDictionary(obj, 'items', {
          type: getTypeTransformer(csnUtils, stack),
        }, { skipDict: { actions: true } });
      }
    }
  }

  /**
   * Function to transform a type to its most basic thing
   * @param {object[]} stack
   * @returns {Function}
   */
  function getTypeTransformer( csnUtils, stack ) {
    return function typeTransformer( _parent, _prop, _type ) {
      const finalSub = csnUtils.getFinalTypeInfo(_type);

      if (finalSub?.elements) {
        // We do full clones so users don't get unexpected linkage later
        if (!_parent.elements)
          _parent.elements = cloneCsnDict(finalSub.elements);
        delete _parent.type;
        stack.push( _parent );
      }
      else if (finalSub?.items) {
        if (!_parent.items)
          _parent.items = cloneCsnNonDict(finalSub.items);
        delete _parent.type;
        stack.push( _parent );
      }
      else if (finalSub?.type) {
        _parent.type = finalSub.type;
      }
    };
  }
}

module.exports = {
  resolve: resolveTypes,
};
