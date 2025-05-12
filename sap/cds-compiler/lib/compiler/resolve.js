// Compiler phase "resolve": resolve all references

// The resolve phase tries to find the artifacts (and elements) for all
// references in the augmented CSN.  If there are unresolved references, this
// compiler phase fails with an error containing a vector of corresponding
// messages (alternatively, we could just store this vector in the CSN).

// References are resolved according to the scoping rules of CDS specification.
// That means, the first name of a reference path is not only searched in the
// current environments, but also in the parent environments, with the source
// as second-last, and the environment for builtins as the last search
// environment.

// For all type references, we set the property `type._artifact`, the latter is
// the actual type definition.

// If the referred type definition has a `parameters` property, we use it to
// transform the `$typeArgs` property (sibling to the `type` property`) to
// named properties.  See function `resolveTypeExpr` below for details.

// Example 'file.cds' (see './define.js' for the CSN before "resolve"):
//   type C { elem: String(4); }
//
// The corresponding definition of element "elem" looks as follows:
//   {
//     kind: 'element',
//     name: { id: 'elem', component: 'elem', location: ... }
//     type: { absolute: 'cds.String', _artifact: {...}, path: ...},
//     length: { val: 4, location: <of the number literal> },
//     location: ..., _parent: ...
//   }

// Potential file names:
// lookup-refs / memorize:  main refs loop (phase 2)
// monitor-refs: resolve-refs (not leading to new defs/elems)
// repair-props: rewrite, late extensions
// test-model: cycle detection, late tests (currently in checks)

'use strict';

const {
  forEachDefinition,
  forEachMember,
  forEachGeneric,
  forEachInOrder,
  isDeprecatedEnabled,
} = require('../base/model');
const { dictAdd } = require('../base/dictionaries');
const { weakLocation } = require('../base/location');
const { combinedLocation } = require('../base/location');
const { typeParameters } = require('./builtins');

const {
  pushLink,
  setLink,
  setArtifactLink,
  setMemberParent,
  withAssociation,
  dependsOn,
  dependsOnSilent,
  testExpr,
  targetMaxNotOne,
  traverseQueryPost,
  linkToOrigin,
  compositionTextVariant,
  targetCantBeAspect,
  userParam,
} = require('./utils');

const detectCycles = require('./cycle-detector');
const { CompilerAssertion } = require('../base/error');

const $location = Symbol.for( 'cds.$location' );

const $inferred = Symbol.for( 'cds.$inferred' );

// TODO: make this part of specExpected in shared.js
// (standard: not possible on last if !ref.$expected → ref.scope: '$exists')
const expWithFilter = [ 'from', 'expand', 'inline' ];

// Export function of this file.  Resolve type references in augmented CSN
// `model`.  If the model has a property argument `messages`, do not throw
// exception in case of an error, but push the corresponding error object to
// that property (should be a vector).
function resolve( model ) {
  const { options } = model;
  // Get shared functionality and the message function:
  const {
    info, warning, error, message,
  } = model.$messageFunctions;
  const {
    resolvePath,
    resolveDefinitionName,
    attachAndEmitValidNames,
    traverseExpr,
    traverseTypedExpr,
    effectiveType,
    getOrigin,
    getInheritedProp,
    hasTruthyProp,              // limited inheritance
    resolveTypeArgumentsUnchecked,
  } = model.$functions;
  Object.assign( model.$functions, {
    addForeignKeyNavigations,
    redirectionChain,
    resolveExprInAnnotations,
  } );

  const ignoreSpecifiedElements
    = isDeprecatedEnabled( options, 'ignoreSpecifiedQueryElements' );

  return doResolve();

  function doResolve() {
    // Phase 1: check paths in `usings` has been moved to kick-start.js Phase 2:
    // calculate/init view elements & collect views in order:
    // TODO: It might be that we need to call propagateKeyProps() and
    //       addImplicitForeignKeys() in populate.js, as we might need to know the
    //       foreign keys in populate.js (foreign key access w/o JOINs).

    // Phase 2+3: calculate keys along simple queries in collected views:
    model._entities = Object.values( model.definitions )
      .filter( art => art.$effectiveSeqNo )
      .sort( (x, y) => x.$effectiveSeqNo - y.$effectiveSeqNo );
    model._entities.forEach( setNavigationProjections );
    model._entities.forEach( propagateKeyProps );
    // While most dependencies leading have been added at this point, new
    // cycles could be added later (e.g. via assocs in where conditions),
    // i.e. keep cycle detection with messages at the end (or after phase 4).

    // Phase 4: resolve all artifacts:
    forEachDefinition( model, resolveRefs );
    forEachGeneric( model, 'vocabularies', resolveRefs );
    if (options.lspMode) {
      for (const name in model.sources)
        resolveDefinitionName( model.sources[name].namespace );
    }

    // report cyclic dependencies:
    detectCycles( model.definitions, ( user, art, location, semanticLoc ) => {
      if (location) {
        model.$assert = null;
        const msg = semanticLoc && 'target';
        error( 'ref-cyclic', [ location, semanticLoc || user ], {
          art, '#': msg,
        }, {
          std: 'Illegal circular reference to $(ART)',
          element: 'Illegal circular reference to element $(MEMBER) of $(ART)',
          target: 'Illegal circular reference to target $(ART)',
        } );
      }
    } );
    if (model.$assert) {
      error( '$internal-expecting-cyclic', null, {},
             'INTERNAL: the compiler should have issued an Error[ref-cyclic]' );
    }
    return model;
  }

  //--------------------------------------------------------------------------
  // Phase 2+3: calculate propagated KEYs
  //--------------------------------------------------------------------------

  /**
   * Set `_projection` links in navigation elements and creates $navElement hierarchy.
   *
   * @param {XSN.Artifact} view
   */
  function setNavigationProjections( view ) {
    if (!view.$queries)
      return;
    for (const query of view.$queries) {
      // traversing sub-elements not necessary, since we're in a view
      // TODO: Handle expand.
      forEachGeneric( query, 'elements', function navProjectionsForElement( elem ) {
        if (!elem._origin || elem.expand || !elem.value?.path)
          return;
        // TODO: what about elements where _origin is set without value?
        // TODO: or should we push elems with `expand` sibling to extra list for
        //       better messages?  (Whatever that means exactly.)

        if (elem._columnParent) {
          if (elem._columnParent?.kind !== '$inline')
            // we're traversing top-level elements of the query;
            // other _columnParent kinds can't happen
            throw new CompilerAssertion('found unexpected "expand", but expected "inline"');

          if (!isPathBreakout( elem.value )) {
            const fullPath = columnParentPath( elem );
            if (fullPath)
              setNavigationProjectionsForElementRef({ path: fullPath }, elem);
          }
        }
        else {
          setNavigationProjectionsForElementRef( elem.value, elem );
        }
      } );
    }
  }

  function setNavigationProjectionsForElementRef( ref, elem ) {
    const { path } = ref;
    const nav = pathNavigation( ref );
    if (nav.navigation) { // not set for $self.…
      // Path could start with table alias; get start index
      let index = path.indexOf(nav.item);
      if (index === -1)
        return; // should not happen

      let navItem = nav.navigation;
      if (!nav.item._navigation) // first non-table-alias
        setLink( nav.item, '_navigation', navItem );

      // We consider an element only projected if the path doesn't have
      // either arguments or filters; but we build up the navigation env
      // nonetheless, as it makes rewriting paths later on easier.
      let isComplexPath = !!(path[index].where || path[index].args);

      ++index;
      while (navItem && index < path.length) {
        const step = path[index];
        if (!step?.id)
          break;
        isComplexPath ||= !!(step.where || step.args);
        if (!navItem.elements?.[step.id]) {
          const elements = navItem._origin?.elements ||
            navItem._origin?.target?._artifact?.elements;
          if (!elements)
            break;
          // Only link available path steps (navigation tree).
          const origin = elements[step.id];
          const member = linkToOrigin( origin, step.id, navItem, 'elements',
                                       navItem.path?.location, true );
          member.$inferred = 'expanded';
          member.kind = '$navElement';
        }
        navItem = navItem.elements[step.id];
        setLink( step, '_navigation', navItem );
        ++index;
      }
      // Last path step, if found, is a projected, either complex or simple.
      if (index === path.length && navItem)
        pushLink( navItem, isComplexPath ? '_complexProjections' : '_projections', elem );
    }
  }

  function columnParentPath( elem ) {
    if (!elem._columnParent || !elem.value?.path || isPathBreakout( elem.value ))
      return elem.value?.path;

    const fullPath = [ ...elem.value.path ];
    let columnParent = elem._columnParent;
    while (columnParent) {
      if (columnParent.kind !== '$inline' || !columnParent.value?.path ||
          isPathBreakout( columnParent.value )) {
        // path breakout for e.g. `$self.{ foo }`, `1 as a .{ foo }`
        return null;
      }
      fullPath.unshift(...columnParent.value.path);
      columnParent = columnParent._columnParent;
    }
    return fullPath;
  }

  function propagateKeyProps( view ) {
    if (view.kind === 'type') {
      // we don't propagate keys to type projections, see #13575
      return;
    }
    // Second argument true ensure that `key` is only propagated along simple
    // view, i.e. ref or subquery in FROM, not UNION or JOIN.
    traverseQueryPost( view.query, true, ( query ) => {
      if (!withExplicitKeys( query ) && inheritKeyProp( query ) &&
          withKeyPropagation( query )) // now the part with messages
        inheritKeyProp( query, true );
    } );
  }

  function withExplicitKeys( query ) {
    for (const name in query.elements) {
      const elem = query.elements[name];
      if (elem.key && !elem.$duplicates) // also those from includes
        return true;
    }
    return false;
  }

  function inheritKeyProp( query, doIt ) {
    for (const name in query.elements) {
      const elem = query.elements[name];
      // no key prop for duplicate elements or additional specified elements:
      const key = !elem.$duplicates && !elem.expand && inheritedSourceKeyProp( elem );
      if (key) {
        if (!doIt)
          return true;
        elem.key = { location: elem.value.location, val: key.val, $inferred: 'query' };
      }
    }
    return false;
  }

  function inheritedSourceKeyProp( { value, _columnParent } ) {
    if (!value || !value.path)
      return null;
    const nav = !_columnParent && pathNavigation( value );
    const item = value.path[value.path.length - 1];
    if (nav?.navigation && nav.item === item)
      return item._artifact?.key;
    if (value.path.length !== 1 || _columnParent?.kind !== '$inline')
      return null;
    const hpath = _columnParent.value?.path;
    const head = hpath?.length === 1 && hpath[0]._navigation;
    return head?.kind === '$tableAlias' && item._artifact?.key;
  }

  function primarySourceNavigation( aliases ) {
    for (const name in aliases)
      return aliases[name].elements;
    return undefined;
  }

  function withKeyPropagation( query ) {
    const { from } = query;
    if (!from)                  // parse error SELECT FROM <EOF>
      return false;

    let propagateKeys = true;   // used instead early RETURN to get more messages
    const toMany = withAssociation( from, targetMaxNotOne, true );
    if (toMany) {
      propagateKeys = false;
      info( 'query-from-many', [ toMany.location, query ], { art: toMany }, {
        std: 'Key properties are not propagated because a to-many association $(ART) is selected',
        // eslint-disable-next-line @stylistic/js/max-len
        element: 'Key properties are not propagated because a to-many association $(MEMBER) of $(ART) is selected',
      } );
    }
    // Check that all keys from the source are projected:
    const notProjected = [];    // we actually push to the array
    const navElems = primarySourceNavigation( query.$tableAliases );
    for (const name in navElems) {
      const nav = navElems[name];
      if (nav.$duplicates)
        continue;
      const { key } = nav._origin;
      if (key?.val && !nav._projections?.length)
        notProjected.push( nav.name.id );
    }
    if (notProjected.length) {
      propagateKeys = false;
      info( 'query-missing-keys', [ from.location, query ], { names: notProjected },
            {
              std: 'Keys $(NAMES) have not been projected - key properties are not propagated',
              one: 'Key $(NAMES) has not been projected - key properties are not propagated',
            } );
    }
    // Check that there is no to-many assoc used in select item:
    for (const name in query.elements) {
      const elem = query.elements[name];

      if (!elem.$inferred && elem.value?.path) {
        const path = elem._columnParent ? columnParentPath( elem ) : elem.value.path;
        if (testExpr({ path }, selectTest, () => false, elem))
          propagateKeys = false;
      }
    }
    return propagateKeys;

    function selectTest( expr, user ) {
      const art = withAssociation( expr, targetMaxNotOne );
      if (art) {
        // ID published! Used in stakeholder project; if renamed, add to oldMessageIds
        info( 'query-navigate-many', [ art.location, user || query ], { art }, {
          std: 'Navigating along to-many association $(ART) - key properties are not propagated',
          // eslint-disable-next-line @stylistic/js/max-len
          element: 'Navigating along to-many association $(MEMBER) of $(ART) - key properties are not propagated',
          // eslint-disable-next-line @stylistic/js/max-len
          alias: 'Navigating along to-many mixin association $(MEMBER) - key properties are not propagated',
        } );
      }
      return art;
    }
  }

  //--------------------------------------------------------------------------
  // Phase 4:
  //--------------------------------------------------------------------------

  function adHocOrMainKind( elem ) {
    const main = elem._main;
    if (main) {
      do {
        elem = elem._parent;
        if (elem.targetAspect)
          return 'aspect';        // ad-hoc composition target aspect
      } while (elem !== main);
    }
    return elem.kind;
  }
  // TODO: have $applied/$extension/$status on extension with the following values
  //  - 'unknown': artifact to extend/annotate is not defined or contains unknown member
  //  - 'referred': contains annotation for element of referred type (not yet supported)
  //  - 'inferred': only contains extension for known member, but some inferred ones
  //    (inferred = elements from structure includes, query elements)
  //  - 'original': only contains extensions on non-inferred members

  // Resolve all references in artifact or element `art`.  Do so recursively in
  // all sub elements.
  // TODO: make this function smaller
  function resolveRefs( art ) {
    if (art.builtin)
      return;
    const parent = art._parent;
    const allowedInMain = [ 'entity', 'aspect', 'event' ].includes( adHocOrMainKind( art ) );
    const isTopLevelElement = parent && (parent.kind !== 'element' || parent.targetAspect);

    if (options.lspMode && art.name && !art._main)
      resolveDefinitionName( art );

    // Check KEY (TODO: make this an extra function)
    const { key } = art;
    if (key?.val && !key.$inferred) {
      // With unmanaged/composition as key, we complain at the `key` keyword, not
      // the `on` condition / the aspect, because the easiest fix would be to
      // simply remove the keyword.  Text and message-id are accordingly.
      // This fits nicely with exposing unmanaged/composition with explicit `key`.
      // We do not complain about unmanaged/composition inside struct keys.
      // (Actually, aspect compositions are not supported as sub elements anyway.)
      if (getInheritedProp( art, 'targetAspect' )) {
        error( 'def-invalid-key', [ key.location, art ], { '#': 'composition' } );
        // TODO: test with managed composition exposed with explicit KEY
      }
      else if (art.target && getInheritedProp( art, 'on' )) {
        error( 'def-invalid-key', [ key.location, art ], { '#': 'unmanaged' } );
      }
      else if (!allowedInMain || !isTopLevelElement) {
        warning( 'def-unsupported-key', [ art.key.location, art ],
                 { '#': allowedInMain ? 'sub' : 'std', keyword: 'key' }, {
                   std: '$(KEYWORD) is only supported for elements in an entity or an aspect',
                   sub: '$(KEYWORD) is only supported for top-level elements',
                 } );
      }
    }

    if (art.targetAspect && targetCantBeAspect( art, true )) {
      // If not for anonymous aspect, this message can only occur for CSN input →
      // we are more CSN specific (we could add more text variants, but this is
      // CSN input with an undocumented CSN property…) For an anonymous target
      // aspect, we could have more text variants, though…
      const msg = art.targetAspect.elements
        ? 'anonymous'
        : (art.target || !art._parent?.query && art._parent?.kind !== 'event') && 'std';
      error( 'type-unexpected-target-aspect', [ art.targetAspect.location, art ],
             { '#': msg || 'target', prop: 'targetAspect', otherprop: 'target' },
             {
               std: 'Unexpected property $(PROP)',
               anonymous: 'Unexpected anonymous target aspect',
               target: 'Unexpected property $(PROP), adding property $(OTHERPROP) might help',
             } );
    } // TODO: else resolvePath() + test for cds.Composition?

    if (art.includes && !allowedInMain) {
      // TODO: make this a check function for shared.js / or make it part of extend.js
      for (const include of art.includes) {
        const struct = include._artifact;
        if (struct && struct.kind !== 'type' && struct.elements &&
            Object.values( struct.elements ).some( e => e.targetAspect )) {
          error( 'type-managed-composition', [ include.location, art ],
                 { '#': struct.kind, art: struct } );
        }
      }
    }
    let obj = art;
    if (obj.type)             // TODO: && !obj.type.$inferred ?
      resolveTypeExpr( obj, art );
    const type = effectiveType( obj ); // make sure implicitly redirected target exists
    if (!obj.items && type && type.items) {
      // TODO: shouldn't be this part of populate.js ?
      const items = {
        location: weakLocation( (obj.type || obj).location ),
        $inferred: 'expanded',
      };
      setLink( items, '_outer', obj );
      setLink( items, '_parent', obj._parent );
      setLink( items, '_origin', type.items );
      obj.items = items;
      obj.$expand = 'origin';
    }
    if (obj.items) {            // TODO: make this a while in v6 (also items proxy)
      obj = obj.items || obj; // the object which has type properties
      effectiveType( obj );
    }
    if (obj.type) {             // TODO: && !obj.type.$inferred ?
      if (obj !== (art.returns || art)) // not already checked
        resolveTypeExpr( obj, art );
      // typeOf unmanaged assoc?  TODO: is this the right place to check this?
      // (probably better in rewriteAssociations)
      const elemtype = obj.type._artifact;
      if (elemtype && effectiveType( elemtype )) {
        const assocType = getAssocSpec( elemtype ) || {};
        if ((assocType.on || assocType.$assocFilter) && !obj.on)
          obj.on = { $inferred: 'rewrite' }; // TODO: no extra rewrite here
        if (assocType.targetAspect) {
          error( 'composition-as-type-of', [ obj.type.location, art ], {},
                 'A managed aspect composition element can\'t be used as type' );
          return;
        }
        else if (assocType.on || assocType.$assocFilter) {
          error( 'type-unexpected-assoc', [ obj.type.location, art ] );
          return;
        }

        // Check if relational type is missing its target or if it's used directly.
        if (elemtype.category === 'relation' &&
            !obj.target && !obj.targetAspect) {
          const isCsn = (obj._block && obj._block.$frontend === 'json');
          error( 'type-missing-target', [ obj.type.location, obj ],
                 { '#': isCsn ? 'csn' : 'std', type: elemtype }, {
                   // We don't say "use 'association to <target>" because the type could be used
                   // in action parameters, etc. as well.
                   std: 'The type $(TYPE) can\'t be used directly because it\'s compiler internal',
                   csn: 'Type $(TYPE) is missing a target',
                 } );
        }
      }
    }
    if (obj.target) {
      if (!obj.target.$inferred || obj.target.$inferred === 'aspect-composition')
        resolveTarget( art, obj );
      else
        // TODO: better write when inferred target must be redirected
        resolveRedirected( obj, obj.target._artifact );
    }
    else if (obj.kind === 'mixin') {
      // TODO: also check that the type is cds.Association or cds.Composition
      error( 'non-assoc-in-mixin', [ (obj.type || obj.name).location, art ], {},
             'Only unmanaged associations are allowed in mixin clauses' );
    }
    if (art.targetElement)      // in foreign keys
      resolvePath( art.targetElement, 'targetElement', art );

    // Resolve projections/views

    if (art.$queries)
      art.$queries.forEach( resolveQuery );

    // TODO: or should we set silent dependencies in init()?
    if (obj.elements) {           // silent dependencies
      forEachGeneric( obj, 'elements', elem => dependsOnSilent( art, elem ) );
    }
    else if (obj.targetAspect && obj.targetAspect.elements) { // silent dependencies
      forEachGeneric( obj.targetAspect, 'elements', elem => dependsOnSilent( art, elem ) );
    }

    if (obj.foreignKeys) {       // silent dependencies
      // Avoid strange ref-cyclic if managed composition is key (check comes later)
      // Done by addImplicitForeignKeys() for implicit keys.
      if (!art.foreignKeys?.[$inferred] && obj.$inferred !== 'aspect-composition')
        forEachGeneric( obj, 'foreignKeys', elem => dependsOnSilent( art, elem ) );
      addForeignKeyNavigations( art );
    }

    resolveExpr( art.default, 'default', art, art );

    // TODO: distinguish not by $syntax (it is semantics), but whether in query
    const valueCtx = (art.$syntax === 'calc') ? 'calc' : 'column';
    resolveExpr( art.value, valueCtx, art, art );
    if (art.type?.$inferred === 'cast')
      inferTypePropertiesFromCast( art );
    if (art.value) {
      if (art.$syntax === 'calc')
        checkCalculatedElement( art );
    }

    resolveExprInAnnotations( art );
    forEachMember( art, resolveRefs, art.targetAspect );
    // After the resolving of foreign keys (and adding implicit ones):
    if (obj.target?.$inferred === '')
      checkRedirectedUserTarget( art );

    if (!ignoreSpecifiedElements && art.elements$ && art.elements) {
      for (const id in art.elements$) {
        resolveRefs( art.elements$[id] );
        checkSpecifiedElement( art.elements[id], art.elements$[id] );
      }
    }

    // Set '@Core.Computed' in the Core Compiler to have it propagated...
    if (art.kind !== 'element' || art['@Core.Computed'])
      return;

    // For events and types, elements can't be @Core.Computed, as values are only used
    // to infer the element signature.  For virtual, we keep @Core.Computed, as it's
    // always been that way, even before type projections.
    const elementsCanBeComputed = art._main?.kind !== 'type' && art._main?.kind !== 'event';

    if (art.virtual?.val ||
        elementsCanBeComputed && art.value &&
        (!art.value._artifact || !art.value.path || // in localization view: _artifact, but no path
         art.value.stored?.val || // calculated elements on-write are always computed
         art.value._artifact.kind === 'builtin' ||
         art.value._artifact.kind === 'param' ||
         art.value.scope === 'param' )) {
      art['@Core.Computed'] = {
        name: {
          path: [ { id: 'Core.Computed', location: art.location } ],
          location: art.location,
        },
        $inferred: '$generated',
      };
    }

    if (art.kind === 'element' && art._effectiveType)
      checkLocalizedElement( art );
    return;

    /**
     * Check whether the signature of the specified element matches that of the inferred one.
     *
     * TODO: resolveRefs() is already too long → do not add sub functions
     *
     * TODO:
     *  - This function has a lot of quite similar code blocks; it should be refactored to
     *    combine them.
     *  - Some checks are not performed because of to.sql() backend "bugs", that affect the
     *    recompilation, such as flattening removing/not setting "key" where required.
     *
     * @param {XSN.Element} inferredElement
     * @param {XSN.Element} specifiedElement
     * @param {XSN.Element} user Only used for if specifiedElement is actually an `items`
     */
    function checkSpecifiedElement( inferredElement, specifiedElement, user = specifiedElement ) {
      if (!inferredElement || !specifiedElement)
        return;

      // Check explicit types: If either side has one, so must the other.
      const sType = specifiedElement.type?._artifact;
      const iTypeArt = getInheritedProp( inferredElement, 'type' )?._artifact;
      const iType = iTypeArt || inferredElement;
      // FIXME: The coding above returns incorrect iType for expand on associations

      // $enclosed: maybe composition was changed to association; we allow that change here.
      const compToAssoc = sType === model.definitions['cds.Association'] && inferredElement.target;

      // xor: could be missing a type;
      if (!specifiedElement.type && inferredElement.type) {
        error( 'query-mismatched-element', [ specifiedElement.location, user ], {
          '#': !specifiedElement.type ? 'missing' : 'extra', name: user.name.id, prop: 'type',
        } );
        return;
      }
      // If specified type is `null`, type could not be resolved.
      else if (!compToAssoc && sType && sType !== iType &&
               // Special case for $recompilation: allow one level of type indirection. See #12113.
               (!options.$recompile || sType !== iType.type?._artifact)) {
        const typeName = !iTypeArt && 'typeExtra' ||  // no inferred type prop
              iType?.name && sType?.name && 'typeName' || // both types are named
              'type';                                     // unknown type names
        const othertype = typeName !== 'type' && iType || '';
        error( 'query-mismatched-element', [
          specifiedElement.type.location || specifiedElement.location, user,
        ], {
          '#': typeName,
          name: user.name.id,
          type: sType,
          othertype,
        } );
        return;
      }

      // This relies on (element) expansion!  Check that both sides have the following properties.
      // On the inferred side, they are likely expanded.
      if (!hasXorPropMismatch( 'elements' ) && !hasXorPropMismatch( 'items' ) &&
          !hasXorPropMismatch( 'target' ) && !hasXorPropMismatch( 'enum' )) {
        // Element are already traversed via elements$ merging.

        // only check items, if the specified one is not expanded/inferred
        if (specifiedElement.items && !specifiedElement.items.$inferred)
          checkSpecifiedElement( inferredElement.items, specifiedElement.items, specifiedElement );

        if (specifiedElement.target?._artifact && inferredElement.target?._artifact &&
            specifiedElement.target._artifact !== inferredElement.target._artifact) {
          error( 'query-mismatched-element', [
            specifiedElement.target.location || specifiedElement.location, user,
          ], {
            '#': 'target',
            name: user.name.id,
            target: specifiedElement.target,
            art: inferredElement.target,
          } );
        }

        if (specifiedElement.foreignKeys) {
          const sKeys = Object.keys( specifiedElement.foreignKeys );
          /** @type {any} */
          let iAssoc = inferredElement;
          if (inferredElement._effectiveType !== 0) {
            while (iAssoc._origin && !iAssoc.foreignKeys && !iAssoc.on)
              iAssoc = iAssoc._origin;
          }
          const iKeys = Object.keys( iAssoc.foreignKeys || {} );
          const loc = [
            specifiedElement.foreignKeys[$location] || specifiedElement.location, user,
          ];
          if (iAssoc.on) {
            error( 'query-mismatched-element', loc, {
              '#': 'unmanagedToManaged', name: user.name.id,
            } );
          }
          else if (sKeys.length !== iKeys.length || sKeys.some( fkey => !iKeys.includes( fkey ) )) {
            error( 'query-mismatched-element', loc, {
              '#': 'foreignKeys', name: user.name.id,
            } );
          }
        }

        if (specifiedElement.virtual) {
          const iVirtual = getInheritedProp( inferredElement, 'virtual' )?.val || false;
          if (!specifiedElement.virtual.val !== !iVirtual) {
            error( 'query-mismatched-element', [
              specifiedElement.virtual.location || specifiedElement.location, user,
            ], {
              '#': 'prop', prop: 'virtual', name: user.name.id,
            } );
          }
        }

        // If cardinality is not specified, the compiler uses the inferred one.
        if (specifiedElement.cardinality) {
          // Users can change the origin's cardinality via filter: We can't rely on the origin.
          const ref = inferredElement.value?.path;
          const assocFilterCardinality = ref?.[ref.length - 1]?.cardinality;
          const sCardinality = specifiedElement.cardinality;
          const iCardinality = assocFilterCardinality || getInferredCardinality();
          if (!iCardinality) {
            error( 'query-mismatched-element', [
              sCardinality.location || specifiedElement.location, user,
            ], {
              '#': 'extra',
              prop: 'cardinality',
              name: user.name.id,
            } );
          }
          else {
            // Note: Cardinality does not have sourceMin (CSN "srcmin").
            const props = {
              targetMax: 'max',
              targetMin: 'min',
              sourceMax: 'src',
            };
            for (const prop in props) {
              if (sCardinality[prop]?.val === iCardinality[prop]?.val)
                continue;
              error( 'query-mismatched-element', [
                sCardinality[prop]?.location || sCardinality.location || specifiedElement.location,
                user,
              ], {
                // eslint-disable-next-line no-nested-ternary
                '#': !sCardinality[prop] ? 'missing' : (iCardinality[prop] ? 'prop' : 'extra'),
                prop: `cardinality.${ props[prop] }`,
                name: user.name.id,
              } );
            }
          }
        }

        if (specifiedElement.value) {
          error( 'query-unexpected-property', [
            specifiedElement.value.location || specifiedElement.location, user,
          ], {
            '#': 'calculatedElement', prop: 'value', name: user.name.id,
          } );
        }

        if (specifiedElement.key) { // TODO: `|| inferredElement.key?.val`, once to.sql is fixed
          // TODO: Do not use _origin chain for key; has been propagated in propagateKeyProps().
          const iKey = getInheritedProp( inferredElement, 'key' )?.val;
          // If "key" is specified or truthy in the inferred element, the values must match.
          if (!iKey !== !specifiedElement.key?.val) {
            error( 'query-mismatched-element', [
              specifiedElement.key?.location || specifiedElement.location, user,
            ], {
              '#': specifiedElement.key ? 'prop' : 'missing', prop: 'key', name: user.name.id,
            } );
          }
        }

        if (specifiedElement.enum && !specifiedElement.$expand) {
          // TODO: ".value" is necessary due to recompilation: The compiler does not copy
          //       "enum" out of ".value", i.e. casts, only "type", changing the _effectiveType.
          const iEnumValues = inferredElement.enum || inferredElement.value?.enum;
          const sEnumValues = specifiedElement.enum;
          for (const name in specifiedElement.enum) {
            // TODO: See TODO above; issue is cast()
            const sEnumEntry = sEnumValues[name];
            const iEnumEntry = iEnumValues[name]?._effectiveType || iEnumValues[name];
            if (!iEnumEntry) {
              error( 'query-mismatched-element', [ specifiedElement.location, user ], {
                '#': 'enumExtra', name: user.name.id, id: name,
              } );
              break;
            }
            else {
              // We allow implicit `val: "<name>"`.
              const iVal = iEnumEntry.value?.val || iEnumEntry.value?.['#'] || name;
              const sVal = sEnumEntry.value?.val || sEnumEntry.value?.['#'] || name;
              if (iVal !== sVal) {
                error( 'query-mismatched-element', [ specifiedElement.location, user ], {
                  '#': 'enumVal', name: user.name.id, id: name,
                } );
                break;
              }
            }
          }
        }
      }

      function hasXorPropMismatch( prop ) {
        // FIXME: `.value` check should be removed after #11183
        //   It appears the SQL backends expand a type in cast and add an `enum` property there.
        //   This property is directly in the `value` property, but not part of `inferredElement`
        //   which has a `type` property, but no `enum`.
        if (!inferredElement[prop] !== !specifiedElement[prop] &&
            !inferredElement.value?.[prop] !== !specifiedElement[prop]) {
          error( 'query-mismatched-element', [ specifiedElement.location, specifiedElement ], {
            '#': specifiedElement[prop] ? 'extra' : 'missing', name: user.name.id, prop,
          } );
          return true;
        }
        return false;
      }

      function getInferredCardinality() {
        let element = inferredElement;
        if (element._effectiveType !== 0) {
          while (getOrigin( element )) {
            const ref = element.value?.path;
            if (element.cardinality || ref?.[ref.length - 1]?.cardinality)
              break;
            element = getOrigin( element );
          }
        }
        const ref = element.value?.path;
        return element.cardinality || ref?.[ref.length - 1]?.cardinality;
      }
    }
  }

  /**
   * Issue warnings for restrictions concerning `localized`, i.e. for situations
   * where a (later) inherited `localized` does not lead to the texts entity
   * (element) being created, because the inherited info was not available then,
   * or would involve more work (localized sub elements).
   */
  function checkLocalizedElement( art ) {
    const parent = art._parent;
    if (!parent)
      return;                   // with duplicate defs
    const isSubElem = (parent.kind === 'element' || art._outer);
    if (isSubElem) {            // sub element or in MANY
      // Localized sub elements in types, aspects, parameters and non-query
      // entities are not problematic.  They are just not really useful there →
      // just report direct (not inherited) `localized` usage in non-inferred
      // elements then.  For non-query entities, always report.
      if (art._main?.kind !== 'entity' || art._main?.query || userParam( parent )
          ? !art.$inferred && art.localized?.val && art._main?.kind !== 'annotation'
          : getInheritedProp( art, 'localized' )) {
        const loc = (art.localized || art.type || art.value)?.location || art.location;
        warning( 'type-unsupported-localized', [ loc, art ], {},
                 'Localized sub elements are not supported' );
      }
    }
    else if (parent.kind === 'entity' && !art._main?.query &&
             art.$syntax !== 'calc' &&
             getInheritedProp( art, 'localized' )?.val &&
             // no inherited `localized` which wasn't known in generate.js
             // TODO: should we set `localized` to null otherwise?
             !hasTruthyProp( art, 'localized' )) {
      const loc = (art.localized || art.type)?.location || art.location;
      warning( 'type-missing-localized', [ loc, art ], { keyword: 'localized' },
               'Add keyword $(KEYWORD), can\'t derive early enough that the element is localized' );
    }
  }

  function checkCalculatedElement( art ) {
    const loc = [ art.value.location, art ];
    if (art._parent.kind === 'element') {
      // TODO: Support calculated elements in structures.
      //       The checks below are already aware of those.
      message( 'def-unsupported-calc-elem', loc, { '#': 'nested' } );
    }

    const allowedInKind = [ 'entity', 'aspect', 'element' ];
    let parent = art._parent;
    while (parent.kind === 'element')
      parent = parent._parent;

    if (!allowedInKind.includes( art._main.kind )) {
      if (art.$inferred === 'include') {
        // even for include-chains, we find the correct ref due to element-expansion.
        const include = art._main.includes.find( i => i._artifact === art._origin._main );
        error( 'ref-invalid-calc-elem', [ include.location || art.value.location, art ],
               { '#': art._main.kind } );
      }
      else {
        error( 'def-invalid-calc-elem', loc, { '#': art._main.kind } );
      }
    }
    else if (!allowedInKind.includes( parent.kind )) {
      error( 'def-invalid-calc-elem', loc, { '#': parent.kind } );
    }
    else if (effectiveType( art )?.elements && !art.$inferred) {
      // For inferred (e.g. included) calc elements, this error is already emitted at the origin.
      if (art.type)
        error( 'type-unexpected-structure', [ art.type.location, art ], { '#': 'calc' } );
      else
        error( 'ref-unexpected-structured', [ art.value.location, art ], { '#': 'expr' } );
    }
    else if (effectiveType( art )?.items && !art.$inferred) {
      // For inferred (e.g. included) calc elements, this error is already emitted at the origin.
      const isCast = art.type?.$inferred === 'cast';
      error( 'type-unexpected-many', [ (art.type || art.value).location, art ], {
        '#': (!art.type && 'calc-implicit') || (isCast && 'calc-cast') || 'calc',
        elemref: art.type ? undefined : { ref: art.value.path },
      } );
    }
    else {
      const noTruthyAllowed = [ 'localized', 'key', 'virtual' ];
      for (const prop of noTruthyAllowed) {
        if (art[prop]?.val) {
          // probably better than a parse error (which is good for DEFAULT vs calc),
          // also appears with parse-cdl:
          error( 'def-invalid-calc-elem', loc, { '#': prop } );
          return; // one error is enough
        }
      }
    }
  }

  /**
   * Return type containing the assoc spec (keys, on); note that no
   * propagation/rewrite has been done yet, cyclic dependency must have been
   * checked before!
   */
  function getAssocSpec( type ) {
    let unmanaged = null;
    while (type) {
      if (type.on)            // if unmanaged, continue trying to find targetAspect
        unmanaged = type;
      else if (type.foreignKeys || type.targetAspect)
        return type;
      else if (type.value?.path?.[type.value.path.length - 1]?.where)
        return { $assocFilter: true }; // filter -> always unmanaged
      type = getOrigin( type );
    }
    return unmanaged;
  }

  function inferTypePropertiesFromCast( elem ) {
    for (const prop of typeParameters.list) {
      if (elem.value[prop])
        elem[prop] = { ...elem.value[prop], $inferred: 'cast' };
    }
  }

  // Phase 4 - queries and associations --------------------------------------

  function resolveQuery( query ) {
    if (!query._main || !query._effectiveType) // parse error
      return;
    // TODO: or set silent dependencies in init?
    forEachGeneric( query, 'elements', elem => dependsOnSilent( query, elem ) );
    forEachGeneric( query, '$tableAliases', ( alias ) => {
      if (alias.kind === 'mixin')
        resolveRefs( alias );   // mixin element
      else if (alias.kind !== '$self')
        // pure path has been resolved, resolve args and filter now:
        resolveExpr( alias, 'from', query._parent );
    } );
    for (const col of query.$inlines)
      resolveExpr( col.value, 'column', col );
    // for (const col of query.$inlines)
    //   if (!col.value.path) throw new CompilerAssertion(col.name.element)
    if (query !== query._main._leadingQuery) // will be done later
      forEachGeneric( query, 'elements', resolveRefs );
    if (query.from)
      resolveJoinOn( query.from );
    if (query.where)
      resolveExpr( query.where, 'where', query );
    if (query.groupBy)
      resolveBy( query.groupBy, 'groupBy', 'groupBy' );
    resolveExpr( query.having, 'having', query );
    if (query.$orderBy)       // ORDER BY from UNION:
      // TODO clarify: can I access the tab alias of outer queries?  If not:
      // 4th arg query._main instead query._parent.
      resolveBy( query.$orderBy, 'orderBy-set-ref', 'orderBy-set-expr' );
    if (query.orderBy) {       // ORDER BY
    // search in `query.elements` after having checked table aliases of the current query
      resolveBy( query.orderBy, 'orderBy-ref', 'orderBy-expr' );
      // TODO: disallow resulting element ref if in expression!
      // Necessary to check it in the compiler as it might work with other semantics on DB!
      // (we could downgrade it to a warning if name is equal to unique source element name)
      // TODO: Some helping text mentioning an alias name would be useful
    }
    for (const limit of query.$limit || []) // LIMIT from UNION:
      resolveLimit( limit );
    if (query.limit)
      resolveLimit( query.limit );

    return;

    function resolveJoinOn( join ) {
      if (join && join.args) {  // JOIN
        for (const j of join.args)
          resolveJoinOn( j );
        if (join.on)
          resolveExpr( join.on, 'join-on', join );
      }
    }

    /**
     * Note the strange name resolution (dynamic part) for ORDER BY: the same
     * as for select items if it is an expression, but first look at select
     * item alias (i.e. like `$projection.NAME` if it is a path.  If it is an
     * ORDER BY of an UNION, do not allow any dynamic path in an expression,
     * and only allow the elements of the leading query if it is a path.
     *
     * This seems to be similar, but different in SQLite 3.22.0: ORDER BY seems
     * to bind stronger than UNION (see <SQLite>/src/parse.y), and the name
     * resolution seems to use select item aliases from all SELECTs of the
     * UNION (see <SQLite>/test/tkt2822.test).
     */
    function resolveBy( array, refMode, exprMode ) {
      for (const value of array ) {
        if (value)
          resolveExpr( value, (value.path ? refMode : exprMode), query );
      }
    }

    function resolveLimit( limit ) {
      if (limit.rows)
        resolveExpr( limit.rows, 'limit-rows', query );
      if (limit.offset)
        resolveExpr( limit.offset, 'limit-offset', query );
    }
  }

  function resolveTarget( art, obj ) {
    if (art !== obj && obj.on) {
      // Unmanaged assoc inside items.  Unmanaged assoc in param handled in resolveRefs()
      message( 'type-invalid-items', [ obj.on.location, art ], { '#': 'assoc', prop: 'items' } );
      setArtifactLink( obj.target, undefined );
      return;
    }
    const target = resolvePath( obj.target, 'target', art );

    if (obj._columnParent && obj.type && !obj.type.$inferred && art._main && art._main.query) {
      // New association inside expand/inline: The on-condition can't be properly checked,
      // so abort early. See #8797
      error( 'query-unexpected-assoc', [ obj.name.location, art ], {},
             'Unexpected new association in expand/inline' );
      return; // avoid subsequent errors
    }

    if (obj.on) {
      if (!art._main || !art._parent.elements && !art._parent.items && !art._parent.targetAspect) {
        // TODO: test of .items a bit unclear - we should somehow restrict the
        // use of unmanaged assocs in MANY, at least with $self
        // TODO: $self usage in anonymous aspects to be corrected in Core Compiler
        message( 'assoc-as-type', [ obj.on.location, art ],
                 { '#': compositionTextVariant( obj, 'comp' ) }, {
                   std: 'An unmanaged association can\'t be defined as type',
                   comp: 'An unmanaged composition can\'t be defined as type',
                 } );
        // TODO: also warning if inside structure
      }
      else {                    // if (obj.target._artifact)
        // TODO: extra with $inferred (to avoid messages)?
        resolveExpr( obj.on, art.kind === 'mixin' ? 'mixin-on' : 'on', art );
      }
    }
    else if (art.kind === 'mixin') {
      error( 'assoc-in-mixin', [ obj.target.location, art ], {},
             'Managed associations are not allowed for MIXIN elements' );
      return; // avoid subsequent errors
    }
    else if (obj.type && !obj.type.$inferred && art._parent && art._parent.kind === 'select') {
      // New association in views, i.e. parent is a query.
      error( 'query-expected-on-condition', [ obj.target.location, art ], {},
             'Expected ON-condition for published association' );
      return; // avoid subsequent errors
    }
    else if (target && !obj.foreignKeys && target.kind === 'entity') {
      // redirected or explicit type cds.Association, ...
      if (obj.type?._artifact?.internal)
        addImplicitForeignKeys( art, obj, target );
    }

    if (target && !target.$inferred) {
      if (!obj.type || obj.type.$inferred || obj.target.$inferred) { // REDIRECTED
        resolveRedirected( art, target );
      }
    }
  }


  function checkRedirectedUserTarget( art ) {
    const issue = { target: art.target._artifact };
    const tgtPath = art.target.path;
    const modelTarget = tgtPath[tgtPath.length - 1]._artifact; // Array#at comes with node-16.6
    // Check ON condition: no renamed target element
    traverseExpr( art.on, 'on-check', art, (expr) => {
      const { path } = expr;
      if (!expr?._artifact || path?.length < 2 || issue['#'])
        return traverseExpr.SKIP; // no path or with error or already found issue
      const head = (path[0]._navigation?.kind === '$self') ? 1 : 0;
      if (path[head]._artifact === art)
        checkAutoRedirectedPathItem( path[head + 1], modelTarget, issue );
      return traverseExpr.SKIP;
    } );
    // Check explicit+implicit foreign keys: no renamed target element
    const implicit = art.foreignKeys?.[$inferred];
    forEachGeneric( art, 'foreignKeys', (fkey) => {
      const { targetElement } = fkey;
      if (targetElement._artifact && !issue['#'])
        checkAutoRedirectedPathItem( targetElement.path[0], modelTarget, issue, implicit );
    } );
    // Check implicit foreign keys: same keys in same order
    if (implicit && !issue['#']) {
      const serviceKeys = keyElementNames( issue.target.elements );
      const modelKeys = keyElementNames( modelTarget.elements );
      if (modelKeys.length !== serviceKeys.length) {
        issue.id = modelKeys.find( id => !serviceKeys.includes( id ) );
        issue['#'] = 'missing';
      }
      else if (!modelKeys.every( (id, index) => id === serviceKeys[index] )) {
        issue['#'] = 'order';
      }
    }
    if (issue['#'])
      message( 'type-expecting-service-target', [ art.target.location, art ], issue );
  }

  function keyElementNames( elements ) {
    const names = [];
    for (const name in elements) {
      if (elements[name].key?.val)
        names.push( name );
    }
    return names;
  }

  function checkAutoRedirectedPathItem( pathItem, modelTarget, issue, isKey = false ) {
    if (!pathItem)              // $self.assoc
      return;
    let targetElem = pathItem._artifact;
    while (targetElem && targetElem._main !== modelTarget)
      targetElem = directOrigin( targetElem );
    if (targetElem?.name.id === pathItem.id && (!isKey || targetElem.key?.val))
      return;
    issue.id = pathItem.id;
    issue.line = pathItem.location.line;
    issue.col = pathItem.location.col;
    issue['#'] = (isKey ? 'key' : 'ref');
  }

  function directOrigin( elem ) {
    if (!elem._main.query || !elem._origin)
      return elem._origin;      // included element
    const { path } = elem.value;
    const kind = path[0]._navigation?.kind;
    // TODO: expand/inline (also Alias.*)
    return [ null, '$navElement', '$tableAlias' ][path.length] === (kind || true) && elem._origin;
  }

  function isQuasiVirtualAssociation( art ) {
    if (art.on)
      return false;
    if (art.foreignKeys != null)
      return !art.foreignKeys;
    const max = art.cardinality?.targetMax;
    return max && (typeof max.val !== 'number' || max.val > 1);
  }

  function addImplicitForeignKeys( art, obj, target ) {
    if (!art.$inferred && !art.virtual?.val && isQuasiVirtualAssociation( obj )) {
      if (!isDeprecatedEnabled( options, 'noQuasiVirtualAssocs' )) {
        // TODO: set `foreignKeys`, `ON` or `virtual` to false or similar to
        // indicate that it is already handled (and that we might not be able to
        // follow the assoc)?  Let us set foreignKeys to false
        obj.foreignKeys = false;
        return;               // no foreign keys for `Association to many Target`;
      }
    }
    obj.foreignKeys = Object.create( null );
    forEachInOrder( target, 'elements', ( elem, name ) => {
      if (elem.key?.val) {
        const location = weakLocation( obj.target.location );
        const key = {
          name: { location, id: elem.name.id, $inferred: 'keys' },
          kind: 'key',
          targetElement: { path: [ { id: elem.name.id, location } ], location },
          location,
          $inferred: 'keys',
        };
        setMemberParent( key, name, art );
        dictAdd( obj.foreignKeys, name, key );
        // the following should be done automatically, since we run resolveRefs after that
        setArtifactLink( key.targetElement, elem );
        setArtifactLink( key.targetElement.path[0], elem );
        // _origin/_effectiveType like we do in effectiveType() → … getOriginRaw():
        setLink( key, '_origin', '' );
        setLink( key, '_effectiveType', key );
        dependsOn( key, elem, location );
        // TODO TMP: instead, make managed composition of aspects and unmanaged
        // assocs not depend on their `on` condition (empty `_deps` after resolve)
        if (art.$inferred !== 'aspect-composition')
          dependsOnSilent( art, key );
      }
    } );
    obj.foreignKeys[$inferred] = 'keys';
  }

  /**
   * Add reference tree from foreign key reference back to foreign key of association.
   *
   * For `type T: Association to Target { foo as bar, elem.sub }`, this function adds:
   *
   *   '$keysNavigation': {
   *     foo: { _artifact: 'type:“T”/key:“bar”' },
   *     elem: {
   *       '$keysNavigation': { sub: { _artifact: 'type:“T”/key:“sub”' } }
   *     }
   *
   * This function complains if two foreign keys point to the same target element
   * (`Association to Target { foo as bar, foo }`) or overlapping target elements
   * (`Association to Target { elem.sub, elem }`).  In `resolvePath`, the compiler
   * already forbids to follow associations in foreign key refs.
   *
   * This ref tree could also be used in a core-compiler check which is now part
   * of to.sql: refs in the `on` condition of unmanaged associations cannot follow
   * associations other to foreign key refs.
   *
   * This ref tree is only created for originally defined managed associations
   * (including those created by the compiler, like the `up_` association), not
   * for derived association like for `type DerivedT: T`, or exposed ones.
   */
  function addForeignKeyNavigations( art, silent = false ) {
    art.$keysNavigation = Object.create( null );
    const keys = [];
    // Basically sort foreign keys according to length of target element ref.
    // This way, we complain about ref to sub element (`elem.sub`) even if it
    // comes earlier than the ref to structure element (`elem`).
    forEachGeneric( art, 'foreignKeys', ( key ) => {
      const path = key.targetElement?.path;
      if (path) {
        const arr = keys[path.length] || (keys[path.length] = []);
        arr.push( key );
      }
    } );
    for (const key of keys.flat()) {
      let dict = art.$keysNavigation;
      const { path } = key.targetElement;
      const last = path[path.length - 1];
      for (const item of path) {
        let nav = dict[item.id];
        if (!nav) {
          nav = {};
          dict[item.id] = nav;
          if (item === last)
            setArtifactLink( nav, key );
          else
            nav.$keysNavigation = Object.create( null );
        }
        else if (item === last || nav._artifact) {
          if (silent)
            break;
          const name = nav._artifact?.name.id;
          const text = (item !== last) ? 'sub' : 'std';
          error( 'duplicate-key-ref', [ item.location, key ], { '#': text, name }, {
            std: 'Foreign key $(NAME) already refers to the same target element',
            // eslint-disable-next-line @stylistic/js/max-len
            sub: 'Foreign key $(NAME) already refers to the target element whose sub element is again referred to here',
            // TODO: please add ideas for a better text, e.g. to (closed) PR #11325
          } );
          break;
        }
        dict = nav.$keysNavigation;
      }
    }
  }

  // TODO: add this somehow to tweak-assocs.js ?
  function resolveRedirected( elem, target ) {
    setLink( elem, '_redirected', null ); // null = do not touch path steps after assoc
    const assoc = getOrigin( elem );
    const origType = assoc && effectiveType( assoc );
    if (origType === 0)
      return;
    if (!origType?.target) {
      const loc = (elem.value?.path?.at(-1) || elem.value || elem).location;
      error( 'redirected-no-assoc', [ loc, elem ], {},
             'Only an association can be redirected' );
      return;
    }
    else if ((elem.value || elem.expand) && elem.type &&
        (!elem.type.$inferred || elem.type.$inferred === 'cast')) {
      error( 'type-invalid-cast', [ elem.type.location, elem ], { '#': 'assoc' } );
      return;
    }

    const origTarget = origType.target._artifact;

    if (target === origTarget && !elem.target.$inferred && !elem.on && !elem.foreignKeys) {
      // Only a managed redirection gets this info message.  Because otherwise
      // we'd have to check whether on-condition/foreignKeys are the same.
      // ID published! Used in stakeholder project; if renamed, add to oldMessageIds
      info( 'redirected-to-same', [ elem.target.location, elem ], { art: target },
            'The redirected target is the original $(ART)' );
    }

    // No check with user-provided ON/fKeys (remark: compiler deduceds ON/fKeys
    // _after_ redirecting the target = no $inferred test necessary):
    if (elem.foreignKeys || elem.on)
      return;          // TODO: or should we still bring an msg if nothing in common?

    const chain = redirectionChain( elem, target, origTarget );
    setLink( elem, '_redirected', chain );
  }

  /**
   * Get the redirection chain between a target and the original target.
   *
   * @param {XSN.Artifact} elem
   * @param {XSN.Artifact} target
   * @param {XSN.Artifact} origTarget
   * @param {boolean} [silent] Whether to report error and other messages.
   * @returns {XSN.Artifact[]|null}
   */
  function redirectionChain( elem, target, origTarget, silent = false ) {
    if (!origTarget || !target)
      return null;
    if (target === origTarget)
      return []; // e.g. explicit ON-condition/foreign keys or original target

    const chain = [];
    // now check whether target and origTarget are "related"
    // first: check via simple projections
    while (target.query) {
      const from = target.query.args ? {} : target.query.from;
      if (!from)
        return null;           // parse error - TODO: or UNION?
      if (!from.path) {
        if (silent)
          break;
        const isTarget = target === elem.target._artifact;
        const op = from.op?.val || target.query.op?.val;
        const variant = (!isTarget && 'std') || (op && 'targetOp') || 'target';
        info( 'redirected-to-complex', [ elem.target.location, elem ],
              { art: target, '#': variant, keyword: op || '' } );
        break;
      }
      target = from._artifact;
      if (!target)
        return null;
      chain.push( from );
      if (target === origTarget) {
        // found in simple projection chain
        chain.reverse();
        return chain;
      }
    }

    // there is a complex view in-between; search through table aliases
    let redirected = null;
    chain.reverse();
    let news = [ { chain, sources: [ target ] } ];
    const dict = Object.create( null );
    while (news.length) {
      const outer = news;
      news = [];
      for (const o of outer) {
        for (const s of o.sources) {
          const art = (s.kind === '$tableAlias') ? s._origin : s;
          if (art !== origTarget) {
            if (findOrig( o.chain, s, art ) && !redirected) // adds to news []
              redirected = false;   // do not report further error
          }
          else if (!redirected) {
            redirected = (s.kind === '$tableAlias') ? [ s, ...o.chain ] : o.chain;
          }
          else if (!silent) {
            error( 'redirected-to-ambiguous', [ elem.target.location, elem ], { art: origTarget },
                   'The redirected target originates more than once from $(ART)' );
            return null;
          }
          else {
            return null;
          }
        }
      }
    }
    if (!silent && redirected == null) {
      error( 'redirected-to-unrelated', [ elem.target.location, elem ], { art: origTarget },
             'The redirected target does not originate from $(ART)' );
    }
    return redirected;

    // B = proj on A, C = A x B, X = { a: assoc to A on a.Q1 = ...}, Y = X.{ a: redirected to C }
    // what does 'a: redirected to C' mean?
    // -> collect all elements Qi used in ON (corr: foreign keys)
    // -> only use an tableAlias which has propagation for all elements
    // no - error if the original target can be reached twice
    // even better: disallow complex view (try as error first)

    // eslint-disable-next-line no-shadow
    function findOrig( chain, alias, art ) {
      if (!art || dict[art.name.id])
        // some include ref or query source cannot be found, or cyclic ref
        return true;
      dict[art.name.id] = true;

      if (art.includes) {
        news.push( {
          chain: [ art, ...chain ],
          sources: art.includes
            .map( r => r._artifact )
            .filter( i => i ),  // _artifact may be `null` if the include cannot be found
        } );
      }
      const query = art._leadingQuery;
      if (!query)
        return false;           // non-query entity
      if (!query.$tableAliases) // previous error in query definition
        return true;
      const sources = [];
      for (const n in query.$tableAliases) {
        const a = query.$tableAliases[n];
        if (a.path && a.kind !== '$self' && a.kind !== 'mixin')
          sources.push( a );
      }
      if (alias.kind === '$tableAlias')
        news.push( { chain: [ alias, ...chain ], sources } );
      else
        news.push( { chain, sources } );
      return false;
    }
  }

  //--------------------------------------------------------------------------
  // General resolver functions
  //--------------------------------------------------------------------------

  // Resolve the type and its arguments if applicable.
  function resolveTypeExpr( art, user ) {
    const typeArt = resolvePath( art.type, 'type', user );
    if (typeArt)
      resolveTypeArgumentsUnchecked( art, typeArt, user );
    return typeArt;
  }

  function resolveExprInAnnotations( art ) {
    for (const anno in art) {
      if (anno.charAt(0) === '@') {
        const { name } = art[anno];
        const annoDef = model.vocabularies?.[name.id];
        if (annoDef)
          setLink( name, '_artifact', annoDef );
        resolveAnnoExpr( art[anno], art );
      }
    }
  }

  function resolveAnnoExpr( expr, art, anno = expr ) {
    if (expr.$tokenTexts) {
      if (!anno.kind)
        initAnnotationForExpression( anno, art );
      const type = anno === expr && anno.name;
      // TODO: it might be best to set an _artifact link also for property values
      // like in `@Anno: [ { foo: #EnumSymbol }]
      resolveExpr( expr, 'annotation', anno, type );
    }
    else if (expr.literal === 'array') {
      expr.val.forEach( val => resolveAnnoExpr( val, art, anno ) );
    }
    else if (expr.literal === 'struct') {
      Object.values( expr.struct ).forEach( val => resolveAnnoExpr( val, art, anno ) );
    }
  }

  /**
   * For faster processing, mark artifacts and annotations which contain anno expressions
   *
   * @param {object} anno
   * @param {XSN.Artifact} art
   */
  function initAnnotationForExpression( anno, art ) {
    anno.kind = '$annotation';
    setLink( anno, '_outer', art );
    art.$contains ??= {};
    art.$contains.$annotation = { // set in resolveExprNode
      $path: false,
      $self: false,
    };
    // Think about tagging parents too (like before #12636).
    // Might be useful for future recursive types.
  }

  function resolveExpr( expr, exprCtx, art, type = null ) {
    traverseTypedExpr( expr, exprCtx, art, type, resolveExprNode );
  }

  function resolveExprNode( expr, expected, user, type ) {
    if (expr.type) // e.g. cast( a as Integer )
      type = resolveTypeExpr( expr, user._user || user );

    if (expr.path) {
      type = resolveExprPath( expr, expected, user );
    }
    else if (expr.id) {
      type = resolvePathItem( expr, expected, user );
    }
    else if (expr.sym) {
      resolveEnumSymbol( expr, expected, user, type );
    }
    else if (expr.query) {
      // No traversal into query, art.$queries set in define.js
      // No subqueries for type projections, nor in annotation expressions.
      const { query } = expr;
      if (query._main?.kind === 'type' ||
         (!query.kind && !query._leadingQuery)) { // UNION has _leadingQuery
        error( 'expr-no-subquery', [ expr.location, user ], {
          '#': query._main?.kind === 'type' ? 'type' : 'std',
        }, {
          std: 'Subqueries are not supported here',
          type: 'Subqueries are not supported in type projections',
        } );
      }
      else if (query._main?.kind === 'event') {
        warning( 'expr-no-event-subquery', [ expr.location, user ],
                 'Subqueries are not supported in event projections' );
      }
    }
    return type;
  }

  function resolveExprPath( expr, expected, user ) {
    // TODO: re-think this $expected: 'exists' thing
    if (expr.$expected === 'exists') {
      if (expected !== 'annotation') { // `exists e[…]` allowed in annotation expressions
        error( 'expr-unexpected-exists', [ expr.location, user ], {},
               'An EXISTS predicate is not expected here' );
      }
      // We complain about the EXISTS before, as EXISTS subquery is also not supported
      // TODO: location of EXISTS, TODO: really do this in define.js
      expr.$expected = 'approved-exists'; // only complain once
    }
    const ref = resolvePath( expr, expected, user );

    if (expected === 'annotation') {
      user._outer.$contains.$annotation.$path = true;
      user._outer.$contains.$annotation.$self ||= expr.path[0]?._navigation?.kind === '$self';
    }

    // check whether arguments and filters are allowed on last path item;
    // references in those are to be resolved below even if not allowed
    // (for code completion)
    const last = expr.path[expr.path.length - 1];
    if (!last || !(last.args || last.where || last.cardinality) ||
        expr.$expected === 'approved-exists' ||
        user.expand || user.inline ||
        expWithFilter.includes( expected ) ||     // `from`, …
        last._navigation?.kind === '$tableAlias') // error already reported
      return ref;

    const type = effectiveType( last._artifact );
    const art = type && (type.kind === 'entity' ? type : type.target?._artifact);
    if (!art)
      return ref;               // error already reported via resolvePathItem()
    const unexpectedFilter = expected !== 'column' && expected !== 'calc' && 'std' ||
          isQuasiVirtualAssociation( type ) && 'model-only';
    if (last.args || last.where || last.cardinality)
      reportUnexpectedArgsAndFilter( last, expected, user, art, unexpectedFilter );
    // TODO: we should have different message-ids for the "last" stuff: adding
    // `.item` likely corrects the ref, probably with location at end of ref
    return ref;
  }

  function resolvePathItem( step, expected, user ) {
    // In FROM ref, first item artifact might be array (duplicate in same
    // `artifacts` dictionary)
    if (!step._artifact || Array.isArray( step._artifact ))
      return traverseExpr.SKIP; // cannot resolve filter refs for undef'd / duplicates

    const isAlias = step._navigation?.kind === '$tableAlias';
    if (isAlias)
      return reportUnexpectedArgsAndFilter( step, expected, user, { params: {} }, 'tableAlias' );
    const type = effectiveType( step._artifact );
    const art = type && (type.kind === 'entity' ? type : type.target?._artifact);
    if (!art) {
      const exp = (expected === 'from') ? 'from' : 'std';
      return (type && type.target)
        ? traverseExpr.SKIP     // something wrong with the association
        : reportUnexpectedArgsAndFilter( step, expected, user, { params: {} }, exp );
    }
    setLink( step, '_user', user._user || user );
    const { args } = step;
    if (!args)
      return null;
    if (Array.isArray( args )) {
      const loc = [ args[0]?.location || step.location, user ];
      error( 'expr-expected-named-argument', loc, {},
             'Expected named parameters for the entity' );
      // only via CSN input - TODO: or do in CSN parser?
      return null;
    }
    if (!art.params) {
      // remark: from the location, this should be 'expr-unexpected-arguments',
      // or probably better: use a text variant of expr-undefined-param
      error( 'expr-unexpected-argument', [ args[$location] || step.location, user ],
             { art, '#': 'no-params' } ); // TODO: own message-id ?
      return null;
    }

    for (const id in args) {
      const param = art.params[id];
      const { name } = args[id];
      setArtifactLink( name, param );
      if (!param) {
        error( 'expr-undefined-param', [ name.location, user ], { art, id },
               'Entity $(ART) has no parameter $(ID)' );
      }
      // no need to do s/th special for duplicate arguments in args[id].$duplicates
    }
    return null;
  }

  function resolveEnumSymbol( expr, expected, user, type ) {
    const { sym } = expr;
    // CSN input with both '#'+val (recompilation) → do not resolve
    if (!sym || expr.val !== undefined)
      return;
    // The parameter def for an argument, and the annotation def for an assignment
    // is in `type._artifact`, it is not `type` itself:
    type = type && effectiveType( type.id ? type._artifact : type );
    // Remark: type could be 0 for cyclic parameter type
    if (type && type.foreignKeys) {
      const keys = Object.values( type.foreignKeys );
      if (keys.length === 1) {
        const elem = resolvePath( keys[0].targetElement, 'targetElement', keys[0] );
        type = effectiveType( elem );
      }
    }
    const symbols = type && type.enum;
    if (!symbols) {
      if (user.kind !== '$annotation') { // TODO: better type deduction for annotations
        const msg = (user.kind === 'enum') ? 'symbolDef' : type && 'invalidType';
        warning( 'ref-unexpected-enum', [ expr.location, user ],
                 { '#': msg || 'untyped', enum: sym.id, type: type || '' } );
      }
    }
    else if (symbols[sym.id]) {
      setLink( sym, '_artifact', symbols[sym.id] );
    }
    else {
      // inferred enums can't be extended (yet): show underlying enum
      while (type.enum[$inferred])
        type = getOrigin( type );
      const err = message( 'ref-undefined-enum', [ sym.location, user ],
                           { id: sym.id, type } );
      if (options.newParser !== false || options.newparser !== false)
        attachAndEmitValidNames( err, symbols );
    }
  }

  function reportUnexpectedArgsAndFilter( step, expected, user, art, variant ) {
    if (step.args && art?.params) {
      const loc = [ step.args[$location] || step.location, user ];
      error( 'expr-unexpected-argument', loc, { '#': variant } );
    }
    if ((step.where || step.cardinality) && variant) {
      const location = combinedLocation( step.where, step.cardinality );
      // XSN TODO: filter$location including […]
      error( 'expr-unexpected-filter', [ location, user ], { '#': variant } );
    }
    return variant && traverseExpr.SKIP;
  }
}

/**
 * Return condensed info about reference in select item
 * - tableAlias.elem       -> { navigation: navElem, item: path[1], tableAlias }
 * - sourceElem (in query) -> { navigation: navElem, item: path[0], tableAlias }
 * - mixinElem             -> { navigation: mixinElement, item: path[0] }
 * - $projection.elem      -> also $self.item -> { item: path[1], tableAlias: $self }
 * - $self                 -> { item: undefined, tableAlias: $self }
 * - $parameters.P, :P     -> {}
 * - $now, current_date    -> {}
 * - undef, redef          -> {}
 * With 'navigation': store that navigation._artifact is projected
 * With 'navigation': rewrite its ON condition
 * With navigation: Do KEY propagation
 *
 * TODO: re-think this function, copied in populate.js and tweak-assocs.js
 */
function pathNavigation( ref ) {
  // currently, indirectly projectable elements are not included - we might
  // keep it this way!  If we want them to be included - be aware: cycles
  let item = ref.path && ref.path[0];
  const root = item && item._navigation;
  if (!root)
    return {};
  if (root.kind === '$navElement')
    return { navigation: root, item, tableAlias: root._parent };
  if (root.kind === 'mixin')
    return { navigation: root, item };
  item = ref.path[1];
  if (root.kind === '$self')
    return { item, tableAlias: root };
  if (root.kind !== '$tableAlias' || ref.path.length < 2)
    return {}; // should not happen
  // table alias
  return { navigation: root.elements?.[item.id], item, tableAlias: root };
}

function isPathBreakout( ref ) {
  if (!ref.path?.[0])
    return false;
  if (ref.scope === 'param')
    return true;
  const nav = (ref.path[0]._navigation || ref.path[0]._artifact);
  return nav && (nav.kind === '$self' || ref.path[0].id.charAt(0) === '$');
}

module.exports = resolve;
