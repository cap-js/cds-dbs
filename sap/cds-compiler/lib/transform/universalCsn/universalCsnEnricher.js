'use strict';

const { setProp } = require('../../base/model');
const shuffleGen = require('../../base/shuffle');
const { setAnnotationIfNotDefined, makeClientCompatible } = require('./utils');
const {
  forEachDefinition,
  getUtils,
  applyTransformations,
  implicitAs,
} = require('../../model/csnUtils');
const { isBuiltinType, propagationRules } = require('../../base/builtins');
const {
  forEachValue, forEach,
} = require('../../utils/objectUtils');
const { setCoreComputedOnViewsAndCalculatedElements } = require('./coreComputed');

/**
 * Loop through a universal CSN and enrich it with the properties/annotations
 * from the source definition - modifies the input model in-place
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 */
module.exports = (csn, options) => {
  const csnUtils = getUtils(csn, 'init-all');
  const {
    initDefinition, getOrigin, getQueryPrimarySource, artifactRef, getColumn,
  } = csnUtils;
    // Properties on definition level that we treat specially.
  const definitionPropagationRules = {
    __proto__: null,
    '@': nullStopsPropagation,
    // Example: `type E : F;` does not have `elements`, but they are required for e.g. OData.
    elements: onlyTypeDef,
    type: always,
    doc: options.propagateDocComments ? nullStopsPropagation : null,
    length: always,
    precision: always,
    scale: always,
    srid: always,
    localized: always,
    target: always,
    targetAspect: always,
    cardinality: always,
    enum: always,
    items: always,
    params: skip, // TODO: (comment is from propagator.js) actually only with parent action
    returns: always,
    notNull: always,
    keys: always,
  };

  const ruleToFunction = {
    __proto__: null,
    never: skip,
    onlyViaParent: skip,        // TODO: not correct
    onlyViaArtifact,
    notWithPersistenceTable,
  };

  for (const rule in propagationRules)
    definitionPropagationRules[rule] = ruleToFunction[propagationRules[rule]];

  // Properties on member level that we treat specially
  const memberPropagationRules = {
    key: skip,
    enum: notWithTypeOrigin,
    masked: skip,
    virtual: notWithTypeRef,
    items: specialItemsRules,
    elements: (prop, target, source) => {
      if (source.kind === 'type')
        return;
      if (!target.type || target.type && !target.type.ref && hasAnnotationOnSubelement(source.elements)) {
        let needsInitialization = !target[prop];
        if (needsInitialization)
          target[prop] = Object.create(null);
        // Propagate elements thing by thing, applying the appropriate rules
        // to not propagate key in subelements for example
        forEach(source[prop], (name) => {
          if (!target[prop][name]) {
            target[prop][name] = {};
            needsInitialization = true;
          }
          copyProperties(source[prop][name], target[prop][name], getMemberPropagationRuleFor);
        });
        if (needsInitialization) // make it safe to call getOrigin
          initDefinition(target);
      }
    }, // overwrite from defProps
    kind: skip,
    val: always,
    type: notWithItemsOrElements,
    target: notWithItemsOrElements,
    keys: specialKeysRules,
    cardinality: notWithItemsOrElements,
  };

  if (options.testMode) {
    const { shuffleDict } = shuffleGen( options.testMode );
    csn.definitions = shuffleDict( csn.definitions );
  }
  generate();

  propagateOnMemberLevel();

  // In this first loop through the model, missing properties in universal CSN
  // are propagated so the CSN can become client one
  forEachDefinition(csn, propagateOnArtifactLevel);

  // The $origin properties need to be removed separately
  // as the values are used in csnRef::getOrigin that is used during
  // the propagation above.
  // Currently, testMode-only for comparison against client CSN.
  if (options.testMode)
    makeClientCompatible(csn);

  /**
   * Before we can start propagating stuff along $origin chains,
   * we have to perform some pre-processing on the csn:
   * - @Core.Computed annotation is not set in the Universal CSN and must be calculated
   * - Annotations on built-in types in the `csn.extensions` must be applied
   * - Annotations for localized and auto-exposed are not set in Universal CSN, the compiler
   *   helps us and attaches a `$generated` property which indicates a compiler generated
   *   entity for which we must attach the annotations in this pre-processing step
   * - setting properties coming from $origin object (anonymous prototype)
   */
  function generate() {
    /**
     * `@Core.Computed' must be calculated manually as this annotation
     * is not set in the universal csn flavor.
     */
    setCoreComputedOnViewsAndCalculatedElements( csn, csnUtils );
    /**
     * Construct an extensions object which maps a built-in type to it's annotations
     */
    const extensions = Object.create( null );
    if (csn.extensions) {
      for ( const extension of csn.extensions ) {
        const annotations = Object.create( null );
        forEach( extension, ( key, val ) => {
          if (!key.startsWith( '@' ))
            return;
          annotations[key] = val;
        } );
        extensions[extension.annotate] = annotations;
      }
    }
    applyTransformations(csn, {
      virtual: ( parent, prop, virtual, path) => {
        // if we are not in columns, we must add `@Core.Computed`,
        // even for `virtual: null`, this is e.g. the case for parameters.
        // This strange behavior of `@Core.Computed` has historic reasons (due to annotation propagation).
        if (path[path.length - 2] !== 'columns')
          setAnnotationIfNotDefined( parent, '@Core.Computed', true );
      },
      target: (parent, prop, target) => {
        if (!(parent.type && parent.type === 'cds.Composition'))
          return;
        if (typeof target === 'string') {
          const artifact = artifactRef(target);
          if (artifact.kind === 'aspect') {
            parent.targetAspect = target;
            if (parent.targetAspect === target)
              delete parent.target;
            return;
          }
        }

        setTargetAspectIfRequired(parent);
      },
      type: ( parent, prop, type ) => {
        const annotationsForBuiltinType = extensions[type];
        Object.assign( parent, annotationsForBuiltinType );
      },
      $generated: ( parent, prop, $generated, path ) => {
        const rootArtifact = csn.definitions[path[1].slice(0, -6)];
        if ( $generated === 'exposed' ) {
          setAnnotationIfNotDefined( parent, '@cds.autoexposed', true );
          const origin = getOrigin( parent );
          if ( origin.$generated === 'localized' && origin.kind === 'entity' ) // generated .texts entity that was then autoexposed
            attachAnnosForTextsTable( parent, rootArtifact );
        }
        else if ( $generated === 'localized' && parent.kind === 'entity' ) { // generated .texts entity
          attachAnnosForTextsTable( parent, rootArtifact );
        }
      },
      $origin: ( parent, prop, $origin ) => {
        if (typeof $origin === 'string' || Array.isArray($origin))
          return;
        // if $origin is an object, we have to check
        // if there are properties in this object
        // which are not directly set on the `parent`
        // and if not -> assign them
        forEach($origin, (key, val) => {
          if (key !== '$origin' && !parent[key])
            parent[key] = val;
        });
      },

    });

    /**
     * Get the thing we are supposed to use for setting targetAspect
     *
     * @param {object} root
     * @returns {object|string|null}
     */
    function getTargetAspectBase( root ) {
      if (root.target && root.target.elements) {
        return root.target;
      }
      else if (root.$origin) {
        if (Array.isArray(root.$origin) && root.$origin[root.$origin.length - 1].target)
          return getOrigin(root);
        else if (root.$origin.target)
          return root.$origin.target;
        return null;
      }
      return null;
    }
    /**
     * Set targetAspect on root and on any subelements of targetAspect if required.
     *
     * We can detect that via
     * - root.$origin either directly or as part of an array has target
     * - root.target has .elements
     *
     * @see getTargetAspectBase for details on how we find our "start"
     * @param {object} root
     */
    function setTargetAspectIfRequired( root ) {
      if (root.$origin || root.target && root.target.elements) {
        const base = getTargetAspectBase(root);
        if (base && (base.elements || typeof base === 'string' && csn.definitions[base].kind === 'aspect')) {
          root.targetAspect = base;
          if (root.target && root.target.elements)
            delete root.target;
          if (base.elements) {
            // anonymous aspect - we need to set targetAspect on subnodes
            // things are simpler in here, no need to check the origin
            const stack = [ root.targetAspect.elements ];
            while (stack.length > 0) {
              const elements = stack.pop();
              forEach(elements, (name, element) => {
                if (element.target) {
                  if (typeof element.target === 'string') {
                    const art = artifactRef(element.target);
                    if (art.kind === 'aspect') {
                      element.targetAspect = element.target;
                      delete element.target;
                    }
                  }
                  else if (element.target.elements) {
                    element.targetAspect = element.target;
                    delete element.target;
                    stack.push(element.targetAspect.elements);
                  }
                }
              });
            }
          }
        }
      }
    }
  }

  /**
   * Walk over properties on member level and propagate all relevant properties
   * from its prototype.
   */
  function propagateOnMemberLevel() {
    applyTransformations(csn, {
      actions: (parent, prop, actions) => {
        forEachValue(actions, (action) => {
          if (!action.kind) // bound actions might not have a kind, only functions
            action.kind = 'action';
          propagateMemberPropsFromOrigin(action);
        });
      },
      params: (parent, prop, params) => {
        forEachValue(params, (param) => {
          const propagateToParams = (param.type !== '$self' || csn.definitions.$self) &&
            (typeof param.type !== 'string' || csn.definitions[param.type]?.kind !== 'entity');
          propagateMemberPropsFromOrigin(param, {
            '@': !propagateToParams, items: true, elements: true, enum: true, virtual: true,
          });
        });
      },
      returns: (parent, prop, returns) => {
        // Only propagate to `returns` (return parameter) if return type is not an entity.
        // If returns.type is an array, it is an element ref. If it's not found, it's likely builtin.
        const propagateToParams = typeof returns.type === 'string' ? csn.definitions[returns.type]?.kind !== 'entity' : true;
        propagateMemberPropsFromOrigin(returns, { '@': !propagateToParams, items: true, elements: true });
        if (returns.target)
          calculateForeignKeys(returns);
      },
      items: (parent, prop, items) => {
        // items in items must be propagated
        // `specialItemsRule()` does not cover this case
        propagateMemberPropsFromOrigin(items, { '@': true, doc: true }, { items: onlyWithTypeRef });
      },
      elements: (parent, prop, elements) => {
        forEachValue(elements, (e) => {
          // within query elements we have to propagate the `enum` prop
          const skipEnum = !parent.query && !parent.projection ? { enum: true } : null;
          propagateMemberPropsFromOrigin(e, skipEnum);
        });
      },
      enum: (parent, prop, enumProp) => forEachValue( enumProp, e => propagateMemberPropsFromOrigin(e) ),
      target: (parent) => {
        if (parent.type && typeof parent.target === 'string' && !parent.keys && !parent.on)
          calculateForeignKeys(parent);
      },
      SELECT: (parent, prop, SELECT, path, artifact) => {
        if ( SELECT.mixin && artifact.query )
          propagateToPublishedMixin(artifact.query, artifact);
      },
    }, []);

    /**
     * Propagate properties to the `member` from its prototype.
     * For that to work we calculate the prototype chain of the member and
     * propagate properties along this prototype chain until we reach the `member`
     * passed to this function.
     *
     * @param {CSN.Element}  member
     * @param {object}       [except] List of properties which should not be propagated along the origin chain
     *                                     of the `member`
     * @param {object}       [force]  Overwrite any member propagation rules or any except and always propagate the corresponding keys
     */
    function propagateMemberPropsFromOrigin( member, except = null, force = null ) {
      const memberChain = getOriginChain(member);
      const virtualOrigin = Object.create(null); // To collect stuff across the origin chain - currently only for .items via type-of

      if (memberChain.length) {
        for (let i = memberChain.length - 1; i >= 0; i--) { // start from the bottom and propagate member props upwards
          const { origin, target } = memberChain[i];
          if (target._status !== 'propagated' && !skipMemberPropagation(origin)) {
            copyProperties(origin, target, getMemberPropagationRuleFor, except, force);

            // For a `type of` with .items, we want to take stuff from types (which we skip for "normal" propagation, see specialItemsRules).
            // So for a `type of` we also propagate stuff from the virtual origin (which we don't give a "kind", therefore skipping that part of the check)
            if (target.type?.ref)
              copyProperties(virtualOrigin, target, getMemberPropagationRuleFor, except);

            if (!target.kind)
              setProp(target, '_status', 'propagated');
          }

          if (i > 0) // function needs to be adapted if we need more info
            copyProperties(origin, virtualOrigin, key => (key === 'items' ? always : skip));
        }
      }
      // If $origin is an object, it is the anonymous prototype of `member`
      // e.g. if outer query element has an element of a subquery as it's prototype
      // annotations are part of the $origin object and must be copied over to the `member`
      // --> annotations on anonymous prototypes have precedence over those coming from base type
      if (member.$origin && Object.keys(member.$origin).length > 0)
        copyProperties(member.$origin, member, getMemberPropagationRuleFor, except);

      /**
       * @param {CSN.Element} origin
       * @returns {boolean} whether props from the members origin should be propagated
       * @todo check if still necessary
       */
      function skipMemberPropagation( origin ) {
        // For empty members (`{}`), the origin was set in a previous call to `getOrigin(definition)`.
        return !origin;
      }
    }

    /**
     * Some properties must only be copied over if the target
     * is a type reference pointing to an element of a type or
     * an aspect.
     *
     * @param {string} prop
     * @param {CSN.Element} target
     * @param {CSN.Element} source
     */
    function onlyWithTypeRef( prop, target, source ) {
      const typeIsTypeRef = Boolean(typeof target.type === 'object' && target.type.ref);
      if (typeIsTypeRef) {
        const referencedArtifact = csn.definitions[target.type.ref[0]];
        if (referencedArtifact.kind in { type: true, aspect: true })
          target[prop] = source[prop];
      }
    }
  }

  /**
   * Identify the sources of the passed object and propagate the relevant
   * properties/annotations along it's $origin chain.
   *
   * @param {object} art Target object for propagation
   */
  function propagateOnArtifactLevel( art ) {
    // check if art was already processed by the status flag
    // TODO: clean up later on, together with validator clean up probably or
    //       when this module is meant to be used standalone -> use internal cache to store already processed definitions?
    if (art._status === 'propagated')
      return;

    const chain = getOriginChain(art);

    if (chain.length) {
      chain.reverse();
      chain.forEach(chainLink => definitionPropagation(chainLink.target, chainLink.origin, chain[0].origin));
    }

    /**
     * @param {CSN.Element} targetDefinition
     * @param {CSN.Element} targetsOrigin
     * @param {CSN.Element} rootOrigin
     */
    function definitionPropagation( targetDefinition, targetsOrigin, rootOrigin ) {
      // if target was already processed -> continue
      if (targetDefinition._status === 'propagated')
        return;
      // propagate relevant definition level properties
      // we check for kind as in the future the function should be
      // generic and work for parts of CSN
      if (targetDefinition.kind) {
        propagateDefProps(targetDefinition, targetsOrigin, rootOrigin);
        if (targetDefinition.target && !targetDefinition.keys && !targetDefinition.on) // Association/Composition type
          calculateForeignKeys(targetDefinition);
      }

      setProp(targetDefinition, '_status', 'propagated');

      /**
       * Propagate from 'source' to 'target' the relevant properties
       * for CSN definitions. For type definitions, also walk up the origin-chain if needed to get .elements
       *
       * @param {CSN.Definition} definition
       * @param {CSN.Definition|CSN.Element} source
       * @param {CSN.Definition|CSN.Element} root
       */
      function propagateDefProps( definition, source, root ) {
        copyProperties(source, definition, getDefinitionPropagationRuleFor);
        // If $origin is an object, it is the anonymous prototype of `definition`
        // e.g. for structure includes annotations are part of the $origin object and must be copied over to the `definition`
        // --> annotations on anonymous prototypes have precedence over those coming from base type
        if (definition.$origin && Object.keys(definition.$origin).length > 0)
          copyProperties(definition.$origin, definition, getDefinitionPropagationRuleFor);

        // We need to propagate .elements to type artifacts - but our direct origin might not have .elements,
        // because they are not propagated to members. We check if our root had elements (so we know that we should have some as well)
        // and then walk the origin-chain until we find the first .elements
        if (definition.kind === 'type' && root.elements && !definition.elements) {
          const firstOriginWithElements = getFirstOriginWithElements(source);
          definition.elements = firstOriginWithElements.elements;
        }
      }
    }

    /**
     * Walk the origin-chain until we find the first origin with .elements and return it
     *
     * @param {CSN.Artifact|CSN.Element} start
     * @returns {CSN.Artifact|CSN.Element|null} Null if no origin with .elements was found
     */
    function getFirstOriginWithElements( start ) {
      let target = start;
      let firstOriginWithElements;
      do {
        firstOriginWithElements = getOrigin(target);
        if (firstOriginWithElements && firstOriginWithElements.elements)
          return firstOriginWithElements;

        target = firstOriginWithElements;
      } while (firstOriginWithElements);

      return null;
    }
  }

  /**
   * Walk the origin-chain until we find the first origin with .elements and return it
   *
   * collect chain of origins and propagate
   * from the farthest to the nearest one to the target
   *
   * @param {CSN.Artifact|CSN.Element} start
   * @returns {object[]} chain of origin - target
   * @todo Optimize: Only return the chain until the first propagated thing?
   */
  function getOriginChain( start ) {
    const chain = [];
    let target = start;
    let origin;
    do {
      origin = getOrigin(target);
      if (origin) {
        chain.push({ target, origin });
        target = origin;
      }
    } while (origin);

    return chain;
  }

  /**
   * Propagate type properties like cardinality from the mixin definition to the published mixin element.
   * To do that, we scan the elements and mark all associations, we then build a mapping from element name -> column
   * and use that to check if we have a matching mixin element.
   *
   * If we find a match, we propagate the properties.
   *
   * @param {CSN.Query} query
   * @param {CSN.Artifact} artifact
   */
  function propagateToPublishedMixin( query, artifact ) {
    const elements = query.SELECT.elements || artifact.elements;
    forEachValue(elements, (element) => {
      if (element.target) {
        const column = getColumn(element);
        if (column?.ref) {
          const mixin = query.SELECT.mixin[implicitAs(column.ref)] || {};
          copyProperties(mixin, element, getMemberPropagationRuleFor);
        }
      }
    });
  }

  /**
   * @param {CSN.Element} member
   */
  function calculateForeignKeys( member ) {
    // Managed assocs in universal CSN have don't have 'keys'
    // if they are not explicitly defined - PR#8064.

    // Beware that since cds-compiler v6, managed _to-many_ associations don't get 'keys'.
    const max = member.cardinality?.max ?? 1;
    if (typeof max !== 'number' || max > 1)
      return; // to-many assoc

    const target = artifactRef(member.target);
    const targetKeys = Object.keys(target.elements).filter(key => target.elements[key].key);
    member.keys = targetKeys.map(
      keyName => ({ ref: [ keyName ] })
    );
  }

  /**
   * `@cds.autoexposed` for example, is propagated only if at definition level and only if
   * the primary source (left-most) does not follow an association.
   *
   * @param {string} prop
   * @param {CSN.Definition} target
   * @param {CSN.Definition} source
   */
  function onlyViaArtifact( prop, target, source ) {
    if (!target.kind)
      return;
    const primarySourceRef = getQueryPrimarySource(target.query || target.projection);
    const artRef = primarySourceRef ? artifactRef.from(primarySourceRef) : source;
    if (!artRef.target)
      target[prop] = source[prop];
  }

  /**
   * Get the custom rule from "memberProps" (or default to "defProps") for the property copying
   *
   * @param {string} key identifier of the csn prop we are looking for
   * @returns {Function} which can be used to apply custom propagation rules for certain props
   */
  function getMemberPropagationRuleFor( key ) {
    return memberPropagationRules[key] || memberPropagationRules[key.charAt(0)] || getDefinitionPropagationRuleFor(key);
  }

  /**
   * Get the custom rule from "defProps" for the property copying
   *
   * @param {string} key identifier of the csn prop we are looking for
   * @returns {Function} which can be used to apply custom propagation rules for certain props
   */
  function getDefinitionPropagationRuleFor( key ) {
    return definitionPropagationRules[key] || definitionPropagationRules[key.charAt(0)];
  }

  /**
   * Set the annotations for a localized `rootArtifact` on it's `parent`.
   *
   * @param {CSN.Artifact} parent
   * @param {CSN.Artifact} rootArtifact The artifact that had the localized
   */
  function attachAnnosForTextsTable( parent, rootArtifact ) {
    const isFioriDraftEnabled = rootArtifact && (rootArtifact['@fiori.draft.enabled'] || getOriginChain(rootArtifact).some(({ origin }) => origin['@fiori.draft.enabled']));
    if (isFioriDraftEnabled) {
      setAnnotationIfNotDefined(parent, '@assert.unique.locale', [ { '=': 'locale' } ]);
      forEach(rootArtifact.elements, (name, element) => {
        if (element.key)
          parent['@assert.unique.locale'].push({ '=': name });
      });
    }
    else {
      setAnnotationIfNotDefined(parent, '@odata.draft.enabled', false);

      // key elements (except for locale) must get "@odata.containment.ignore": true
      forEach(parent.elements, (name, element) => {
        if (name !== 'locale' && element.key)
          setAnnotationIfNotDefined(element, '@odata.containment.ignore', true);
      });
    }
  }
};

/**
 * Simply copy the properties of "from" to  "to" - but don't overwrite existing properties.
 *
 * Apply the custom rules from "memberProps" and "defProps" for the copying!
 *
 * @param {object} from
 * @param {object} to
 * @param {Function} getCustomRule getter for the `memberProps` or `defProps`
 *                                 which shall be used for retrieving custom rules
 * @param {object} [except] array of properties which should not be propagated
 * @param {object} [force] Force propagation of the contained keys via a custom rule.
 */
function copyProperties( from, to, getCustomRule, except = null, force = null ) {
  const keys = Object.keys(from);
  // Copy over properties from the origin element to the target.
  for (const key of keys) {
    if (except && !(force && force[key]) && (except[key] || except[key.charAt(0)]))
      continue;
    if (!(key in to)) {
      const func = force && force[key] ? force[key] : getCustomRule(key);
      if (func)
        func(key, to, from);
    }
  }
}

/**
 * Recursively check if some element in the elements has an annotation.
 *
 * @param {object} elements
 * @returns {boolean} whether some element in the elements has an annotation
 */
function hasAnnotationOnSubelement( elements ) {
  for (const element of Object.values(elements)) {
    if (Object.keys(element).some(key => key.startsWith('@')))
      return true;
    else if (element.elements)
      return hasAnnotationOnSubelement(element.elements);
  }

  return false;
}


/**
 * Does nothing. Is used as a placeholder
 * in our member- and definition propagation
 * rules.
 */
function skip() {
  // Do nothing
}

/**
 * Always copy `prop` from `source` to `target`
 *
 * @param {string} prop
 * @param {object} target
 * @param {object} source
 */
function always( prop, target, source ) {
  const val = source[prop];
  if (Array.isArray(val))
    target[prop] = [ ...val ];
  else
    target[prop] = val;
}

/**
 * Execute only if the target definition is a user-defined type.
 *
 * @param {string} prop
 * @param {CSN.Definition} target
 * @param {CSN.Definition} source
 */
function onlyTypeDef( prop, target, source ) {
  if (target.kind !== 'type')
    return;
  target[prop] = source[prop];
}

/**
 * Copy `prop` from `source` to `target`
 * If the `target` is annotated with `@cds.persistence.table`,
 * this function does nothing.
 *
 * @param {string} prop
 * @param {object} target
 * @param {object} source
 */
function notWithPersistenceTable( prop, target, source ) {
  const tableAnno = target['@cds.persistence.table'];
  if (tableAnno === undefined || tableAnno === null)
    target[prop] = source[prop];
}

/**
 * Copy `prop` from `source` to `target`
 * If the `source` has `source.kind === 'type'`
 * this function does nothing.
 *
 * @param {string} prop
 * @param {CSN.Element} target
 * @param {CSN.Element} source
 */
function notWithTypeOrigin( prop, target, source ) {
  if (source.kind !== 'type')
    target[prop] = source[prop];
}

/**
 * The value `null` tells us to skip the propagation of the property.
 * This is the case e.g. for `doc` or for annotations.
 *
 * @param {string} prop
 * @param {CSN.Element} target
 * @param {CSN.Element} source
 */
function nullStopsPropagation( prop, target, source ) {
  if (source[prop] !== null)
    target[prop] = source[prop];
}

/**
 * Special propagation rules for .items - depending on the exact type of .items and the
 * way it was referenced (type of, direct type, direct many), we need to propagate (or not).
 *
 * We do not propagate it
 * - from a type
 * - from a type ref
 * - from a custom type
 *
 * In a projection/simple view, our target and source will not have a type - we need to copy the .items there regardless of the type stuff.
 *
 * @param {string} prop
 * @param {CSN.Element} target
 * @param {CSN.Element} source
 */
function specialItemsRules( prop, target, source ) {
  if (source.kind !== 'type' && ((!source.type && !target.type) || !(source[prop].type && source[prop].type.ref || !isBuiltinType(source[prop].type))))
    target[prop] = source[prop];
}

/**
 * Don't propagate property `keys` if there is an ON-condition.  This happens for
 * published managed associations with filters in views, which are transformed into
 * unmanaged associations, i.e. get an ON-condition.
 *
 * Besides that, rules from notWithItemsOrElements() apply.
 *
 * @param {string} prop
 * @param {CSN.Element} target
 * @param {CSN.Element} source
 */
function specialKeysRules( prop, target, source ) {
  if (target.on === undefined)
    notWithItemsOrElements( prop, target, source );
}

/**
 * Don't propagate certain properties if the target already has a .items or .elements
 *
 * This happens with .expand/.inline
 *
 * @param {string} prop
 * @param {CSN.Element} target
 * @param {CSN.Element} source
 */
function notWithItemsOrElements( prop, target, source ) {
  if (!target.items && !target.elements || !source.target)
    target[prop] = source[prop];
}

/**
 * Some properties must not be copied over if the type of this member
 * is a reference to another element.
 *
 * @param {string} prop
 * @param {CSN.Element} target
 * @param {CSN.Element} source
 */
function notWithTypeRef( prop, target, source ) {
  const typeIsTypeRef = Boolean(typeof target.type === 'object' && target.type.ref);
  if (!typeIsTypeRef)
    target[prop] = source[prop];
}
