// Populate views with elements, elements with association targets, ...

// The functionality in this file is the heart of the Core Compiler and the
// most complex part.  It essentially implements the function `environment`
// used when resolving element references: when starting a references at a
// certain definition or element, which names are allowed next?
//
// To calculate that info, the compiler might need the same info for other
// definitions.  In other words: it calls itself recursively (using an iterative
// algorithm where appropriate).  To be able to calculate that info on demand,
// the definitions need to have enough information, which must have been set in
// an earlier compiler phase.  It is essential to do things in the right order.

// TODO: It might be that we need to call propagateKeyProps() and
// addImplicitForeignKeys() in populate.js, as we might need to know the
// foreign keys in populate.js (foreign key access w/o JOINs).

'use strict';

const {
  isDeprecatedEnabled,
  forEachDefinition,
  forEachMember,
  forEachGeneric,
} = require('../base/model');
const {
  dictAdd, dictAddArray, dictFirst, dictForEach,
} = require('../base/dictionaries');
const { weakLocation, weakRefLocation } = require('../base/location');
const { CompilerAssertion } = require('../base/error');

const { kindProperties } = require('./base');
const {
  setLink,
  setArtifactLink,
  annotationVal,
  annotationIsFalse,
  annotationLocation,
  linkToOrigin,
  setMemberParent,
  dependsOn,
  proxyCopyMembers,
  setExpandStatus,
  setExpandStatusAnnotate,
  dependsOnSilent,
  columnRefStartsWithSelf,
} = require('./utils');
const { typeParameters } = require('./builtins');

const $inferred = Symbol.for( 'cds.$inferred' );
const $location = Symbol.for( 'cds.$location' );

/**
 * These properties are copied from specified elements.
 */
const typePropertiesFromSpecifiedElements = {
  // 'key' is special case, see setSpecifiedElementTypeProperties()
  // TODO: Decide on behavior if an actual key does not have "key" property in specified elements,
  //       and another non-key is marked key in them.
  // key: 'if-undefined',
  default: 1,
  notNull: 1,
  localized: 1,
  ...typeParameters.expectedLiteralsFor,
};

// Export function of this file.
function populate( model ) {
  const { options } = model;
  // Get shared functionality and the message function:
  const {
    info, warning, error, message,
  } = model.$messageFunctions;
  const {
    resolvePath,
    nestedElements,
    attachAndEmitValidNames,
    initArtifact,
    extendArtifactBefore,
    extendArtifactAfter,
  } = model.$functions;
  Object.assign( model.$functions, {
    effectiveType,
    getOrigin,
    getInheritedProp,
    mergeSpecifiedForeignKeys,
  } );
  // let depth = 100;

  let effectiveSeqNo = 0;   // artifact number set after having set _effectiveType
  /** @type {any} may also be a boolean */
  let newAutoExposed = [];

  const ignoreSpecifiedElements
        = isDeprecatedEnabled( model.options, 'ignoreSpecifiedQueryElements' );

  forEachDefinition( model, traverseElementEnvironments );
  while (newAutoExposed.length) {
    // console.log( newAutoExposed.map( a => a.name.id ) )
    const all = newAutoExposed;
    newAutoExposed = [];
    all.forEach( traverseElementEnvironments );
  }
  newAutoExposed = true;      // internal error if auto-expose after here
  return;

  /** Make sure that effectiveType() is called on all members and items */
  function traverseElementEnvironments( art ) {
    // We leave out foreign keys (as they are traversed via forEachMember).
    // Keys are handled in tweak-assocs.js
    if (art.kind === 'key')
      return;
    let type = effectiveType( art );
    while (type?.items)
      type = effectiveType( type.items );
    if (art.$queries)
      art.$queries.forEach( traverseElementEnvironments );
    if (art.mixin)
      dictForEach( art.mixin, effectiveType );
    if (art.targetAspect?.elements)
      effectiveType( art.targetAspect );
    if (art !== art._main?._leadingQuery) // already done
      forEachMember( art, traverseElementEnvironments );
  }


  //--------------------------------------------------------------------------
  // The central functions for path resolution - must work on-demand
  //--------------------------------------------------------------------------

  /**
   * Return the artifact having properties which are relevant for further name
   * resolution on `art`: `target`, `elements`, `items`, also `enum`.  Make sure
   * that these properties actually exist, are complete and auto-corrected.  Cache
   * the result in property `_effectiveType`.
   *
   * - actions, functions: returns `art`, might have expanded `params`/`returns`
   * - artifacts with direct or inherited `target`, `elements`, `items`, `enum`:
   *   returns `art`, these properties might have been auto-redirected / expanded
   * - artifacts with direct or inherited scalar type: the built-in type
   * - other artifacts: the last artifact in the origin-chain, i.e. the one which
   *   has neither a type nor some value path.
   * - returns 0 with cyclic dependencies (with recursive element expansions, we
   *   have `elements: 0` instead).
   * - returns null if a relevant reference points to nothing or is corrupted
   * - returns false if a relevant reference points to a duplicate definition
   *
   * This function also infers type relevant properties:
   *
   * - views and queries: returns `art` with inferred query `elements`
   * - column with `expand`: returns `art`, usually with inferred `elements`/`items`
   * - more to come
   *
   * At the moment, it is assumed that includes, expansions, and localized has
   * been applied earlier.
   *
   * Properties which are (usually) not relevant for the name resolution, like
   * `length` and `cardinality`, cannot be simply accessed on the effective
   * artifact.  The effective artifact alone is not enough to check whether an
   * artifact is an association or composition; it also does not give you the
   * information about the technical base type of an enum.
   *
   * Calculating an effective association/composition implies calculating its
   * target entity (including redirections), but not induce calculating the
   * target's elements.  Calculating an effective structure (entities, …) does
   * not imply calculating the effective types of its elements.  Calculating an
   * effective array does not imply calculating its effective line type.
   */
  function effectiveType( art ) {
    if (!art)
      return art;
    // if (--depth) throw Error(`ET: ${ Object.keys(art) }`)
    if (art._effectiveType !== undefined)
      return art._effectiveType;

    // console.log(message( null, art.location, art, {}, 'Info','FT').toString())
    const chain = [];
    // console.log( 'ET-START:', art.kind, art.name )
    while (art && art._effectiveType === undefined) {
      setLink( art, '_effectiveType', 0 ); // initial setting in case of cycles
      chain.push( art );
      art = getOrigin( art );
      // console.log( 'ET-GO:', art?.name )
    }
    if (art)
      art = art._effectiveType;
    if (art === 0) {
      model.$assert = 'cycle';
      // throw Error(`CYCLE: ${ chain.length }`);
      return art;
    }
    chain.reverse();
    for (const a of chain) {
      // Ensure that the _effectiveType of the parent has been calculated.  This
      // is usually the case, but might not be for elements of anonymous target
      // aspects.  Without it, extensions/annotations might get lost.
      // For a query and its parent (usually the query entity!), it is the other way
      // around: to calculate the _effectiveType of the query entity, we might need
      // to calculate the _effectiveType of a query in FROM first.
      if (a.kind !== 'select')
        effectiveType( a._outer || a._main && a._parent );
      // TODO: forbid $self+$self.elem inline, see expandWildcard()
      // Without type, value.path or _origin at beginning, link to itself:
      extendArtifactBefore( a );
      art = populateArtifact( a, art ) || a;
      setLink( a, '_effectiveType', art );
      a.$effectiveSeqNo = ++effectiveSeqNo;
      // console.log('PE:',require('../model/revealInternalProperties').ref(a))
      if (a.elements$ || a.enum$)
        mergeSpecifiedElementsOrEnum( a );
      // console.log( 'ET-DO:', effectiveSeqNo, a?.kind, a?.name, a._extensions?.elements?.length )
      extendArtifactAfter( a ); // after setting _effectiveType (for messages)
      if (a.typeProps$)
        setSpecifiedElementTypeProperties( a );
    }
    // console.log( 'ET-END:', art?.kind, art?.name )
    return art;
  }

  function populateArtifact( art, origEffective ) {
    // Name-resolution relevant properties directly at artifact:
    // ‹view›.elements of input must have been moved (to elements$) before!
    // console.log('Q:',art.elements,art.enum,art.items,!!art.query)
    // console.log('PA:',require('../model/revealInternalProperties').ref(art))
    if (art.includes)           // first version of includes via effectiveTpe()
      art.includes.forEach( i => effectiveType( i._artifact ) );
    if (art.elements != null || art.enum != null || art.items != null)
      return art;
    if (art.target) {
      // make sure that target._artifact is set:
      const target = resolvePath( art.target, 'target', art );
      // try to implicitly redirect explicitly provided target:
      if (target && !origEffective?.target && art.kind !== 'mixin')
        redirectImplicitly( art, art );
      if (!art.expand)
        return art;
    }
    else if (art.targetAspect) { // target aspect in aspect
      return art;
    }

    // With properties to be calculated: ----------------------------------------
    if (art.query && art.kind !== '$tableAlias') { // query entity
      const leading = art.$queries[0];
      if (!leading)             // parse error
        return null;
      if (leading._effectiveType !== undefined) {
        // You cannot refer to a query of another artifact:
        throw new CompilerAssertion(
          `Unexpected _effectiveType on leading query of ${ art.name.id }`
        );
      }
      // TODO: try just return (effectiveType( leading )) === 0 ? 0 : art;
      setLink( leading, '_effectiveType', 0 ); // relevant to detect invalid $self.*
      populateQuery( leading );
      setLink( leading, '_effectiveType', leading );
      leading.$effectiveSeqNo = ++effectiveSeqNo;
      return art;
    }
    if (art.from)
      return populateQuery( art );

    if (art.expand) {
      // TODO: test that there is no CDL-style cast with expand
      // (we could allow that later: then some basic structural check is needed)
      if (!art.value) {
        initFromColumns( art, art.expand );
        if (origEffective?.target) // consider `{ … } as x: AssocType
          redirectImplicitly( art, origEffective );
      }
      else if (art.value.path) {
        expandFromColumns( art );
      }
      // TODO: if we allow CDL-style cast with expand in the future, we need to
      // redirectImplicitly when casting to assoc type
      return art;
    }
    if (!origEffective || origEffective.builtin) // TODO: builtin test needed?
      return origEffective;

    // With inherited auto-corrected name-resolution-relevant properties: -------
    if (origEffective.target)
      return redirectImplicitly( art, origEffective ) ? art : origEffective;
    if (origEffective.elements)
      return expandElements( art, origEffective ) ? art : origEffective;
    if (origEffective.enum)
      return expandEnum( art, origEffective ) ? art : origEffective;
    if (origEffective.items)
      return expandItems( art, origEffective ) ? art : origEffective;
    if (origEffective.params || origEffective.returns)
      return expandParams( art, origEffective );
    return origEffective;
  }

  // TODO: test it in combination with top-level CAST function
  // TODO: we could probably "extend" this function to all other cases where we
  // set an _origin in Universal CSN

  // TODO: add 2nd arg `considerSecondary` used in effectiveType(): prefers a
  // predecessor without _effectiveType (includes, joins)
  function getOrigin( art ) {
    // Be careful when using it with art.target or art.enum or art.elements
    if (!art)
      return undefined;         // TODO: null?
    // if (--depth) throw Error(`GOR: ${ Object.keys(art) }`)
    if (art._origin !== undefined)
      return art._origin;
    if (art.type)               // not stored in _origin
      return resolvePath( art.type, 'type', art );
    return setLink( art, '_origin', getOriginRaw( art ) );
  }

  function getOriginRaw( art ) {
    if (!art._main) {
      if (art.query)
        return getOrigin( art.$queries?.[0] );
      // TODO: if we add the `includes` mechanism, use resolveUncheckedPath() for
      // includes here, because the accept function for includes requires the
      // elements to have been calculated!
    }
    else {
      // TODO: write checks for path in enum?
      if (art.value?.path)
        return resolvePath( art.value, (art.$syntax === 'calc' ? 'calc' : 'column'), art );
      if (art.kind === 'select') {
        const alias = dictFirst( art.$tableAliases );
        // With parse errors, the first “alias” might be $self.  Using its origin
        // would lead to a cyclic processing dependency.
        return (alias.kind === '$tableAlias') ? getOrigin( alias ) : null;
      }
      // init sets _origin for alias to sub query, only need to handle ref here:
      if (art.kind === '$tableAlias') {
        // do not call effectiveType() on the source to avoid a deeper callstack
        const source = resolvePath( art, 'from', art._parent );
        if (!source?._main)
          return source;        // direct entity (or undefined)
        // Before having done the resolvePath cleanup, do not rely on resolvePath
        // to call effectiveType() on the last assoc of a from ref:
        // TODO: check this with test3/Queries/DollarSelf/CorruptedSource.err.cds
        const assoc = effectiveType( source );
        return assoc?.target._artifact;
      }
    }
    return '';
  }

  function getInheritedProp( art, prop ) {
    while (art?._effectiveType) {
      if (art[prop] !== undefined)
        return art[prop];
      art = getOrigin( art );
    }
    return undefined;
  }

  function userQuery( user ) {
    // TODO: should we set _query links in define.js?
    while (user._main) {
      if (user.kind === 'select' || user.kind === '$join')
        return user;
      user = user._parent;
    }
    return null;
  }

  // Expansions --------------------------------------------------------------


  function expandItems( art, origin ) {
    if (art.items)
      return false;
    if (origin.items === 0 || art.$inferred === 'expanded' && isInRecursiveExpansion( art )) {
      art.items = 0;            // circular
      return true;
    }
    const location = weakRefLocation( art.type || art.value ) || weakLocation( art.location );
    art.items = { $inferred: 'expanded', location };
    setLink( art.items, '_outer', art );
    setLink( art.items, '_parent', art._parent );
    setLink( art.items, '_origin', origin.items );
    if (!art.$expand)
      art.$expand = 'origin';   // if value stays, elements won't appear in CSN
    return true;
  }

  function expandElements( art, struct ) {
    if (art.kind === '$tableAlias') {
      proxyCopyMembers( art, 'elements', struct.elements, art.path?.location, '$navElement' );
      return true;
    }
    if (art.elements || art.kind === '$inline' ||
        // no element expansions for "non-proper" types like
        // entities (as parameter types) etc:
        struct.kind !== 'type' && struct.kind !== 'element' && struct.kind !== 'param' &&
        !struct._outer)
      return false;
    if (struct.elements === 0 || art.$inferred === 'expanded' && isInRecursiveExpansion( art )) {
      art.elements = 0;         // circular
      return true;
    }
    const ref = art.type || art.value || art.name;
    const location = weakRefLocation( ref ) || weakLocation( art.location );
    // console.log( message( null, location, art, {target:struct,art}, 'Info','EXPAND-ELEM')
    //              .toString(), Object.keys(struct.elements))
    proxyCopyMembers( art, 'elements', struct.elements, location,
                      null, isDeprecatedEnabled( options, '_noKeyPropagationWithExpansions' ) );
    // Set elements expansion status (the if condition is always true, as no
    // elements expansion will take place on artifact with existing other
    // member property):
    if (!art.$expand)
      art.$expand = 'origin';   // if value stays, elements won't appear in CSN
    // TODO: have some art.elements[SYM.$inferred] = 'expanded';
    return true;
  }

  function expandEnum( art, origin ) {
    if (art.enum)
      return false;
    const ref = art.type || art.value || art.name;
    const location = weakRefLocation( ref ) || weakLocation( art.location );
    proxyCopyMembers( art, 'enum', origin.enum, location );
    // Set elements expansion status (the if condition is always true, as no
    // elements expansion will take place on artifact with existing other
    // member property):
    if (!art.$expand)
      art.$expand = 'origin';   // if value stays, elements won't appear in CSN
    art.enum[$inferred] = 'expanded';
    return true;
  }

  function expandParams( art, origin ) {
    if (!origin._main)
      return origin;            // not with entity (should not happen)
    if (origin.params)
      proxyCopyMembers( art, 'params', origin.params, null );

    if (origin.returns) {
      // TODO: make linkToOrigin() work for returns, kind/name?
      const location = weakLocation( origin.returns.location );
      art.returns = {
        name: Object.assign( {}, art.name, { id: '', location } ),
        kind: 'param',
        location,
        $inferred: 'expanded',
      };
      setLink( art.returns, '_parent', art );
      setLink( art.returns, '_main', art._main || art );
      setLink( art.returns, '_origin', origin.returns );
    }
    if (!art.$expand)
      art.$expand = 'origin';   // if value stays, elements won't appear in CSN
    return art;
  }

  /**
   * Return true iff `art` is from a recursive expansion, i.e.  if any of its
   * expanded parents (including _outer) has the same non-expansion-origin.
   */
  function isInRecursiveExpansion( art ) {
    const current = nonExpandedArtifact( art );
    if (current.$inCycle)
      return true;
    const cycle = [ current ];
    while (art.$inferred === 'expanded') {
      art = outerOrParent( art );
      const origin = nonExpandedArtifact( art );
      cycle.push( origin );
      if (origin.$inCycle || origin === current) {
        for (const a of cycle)
          a.$inCycle = true;
        return true;
      }
    }
    return false;
  }

  function outerOrParent( art ) {
    if (art._outer)
      return art._outer;
    art = art._parent;
    // TODO: think about setting _parent of elements in `items` object holding
    // `elements`, not the most outer `items` -> return art._outer || art._parent
    while (art.items)
      art = art.items;
    return art;
  }

  function nonExpandedArtifact( art ) {
    while (art.$inferred === 'expanded')
      art = art._origin;
    return art;
  }

  //--------------------------------------------------------------------------
  // Views
  //--------------------------------------------------------------------------

  // TODO: delete XSN._entities
  // TODO: delete ENTITY._from - use _origin? instead _from[0]
  // TODO (after on-demand ext): delete XSN.$entity

  /**
   * Merge _specified_ elements with _inferred_ elements in the given view/element,
   * where specified elements can appear through CSN.
   *
   * We only copy annotations.
   *
   * This is important to ensure re-compilability.
   *
   * TODO: make this part of a revamped on-demand 'extend' functionality.
   *
   * @param art
   */
  function mergeSpecifiedElementsOrEnum( art ) {
    let wasAnnotated = false;

    for (const id in (art.elements || art.enum)) {
      const ielem = art.elements ? art.elements[id] : art.enum[id];  // inferred element
      const selem = art.elements$ ? art.elements$[id] : art.enum$[id]; // specified element
      // TODO: the positions are very strange, at least for enums
      // see e.g. for test3/Queries/SpecifiedElements/SpecifiedElements.err.csn
      // better to complain at the end position of the enum dict
      if (!selem) {
        info( 'query-missing-element', [ ielem.name.location, art ], {
          '#': ielem.kind === 'enum' ? 'enum' : 'std', id,
        } );
      }
      else {
        for (const prop in selem) {
          // just annotation assignments and doc comments for the moment
          if (prop.charAt(0) === '@' || prop === 'doc') {
            ielem[prop] = selem[prop];
            // required for gensrc mode of to-csn.js, otherwise the annotation
            // may be lost during recompilation.
            ielem[prop].$priority = 'annotate';
            wasAnnotated = true;
          }
          else if (typePropertiesFromSpecifiedElements[prop] && !ignoreSpecifiedElements) {
            // If ignoreSpecifiedElements is set, we ignore type properties of specified elements,
            // similar to how it was done in cds-compiler v3. Only annotations are copied.
            if (!ielem.typeProps$)
              setLink( ielem, 'typeProps$', Object.create( null ) );
            // Note: At this point in time, effectiveType() was likely not called on the
            // element, yet. Setting it here, we can't compare it to its value from _origin.
            ielem.typeProps$[prop] = selem[prop];
          }
        }

        selem.$replacement = true;
        if (selem.elements)
          setLink( ielem, 'elements$', selem.elements );
        if (selem.enum)
          setLink( ielem, 'enum$', selem.enum );
        if (selem.foreignKeys)
          setLink( ielem, 'foreignKeys$', selem.foreignKeys );
      }
    }

    if (wasAnnotated)
      setExpandStatusAnnotate( art, 'annotate' );

    // TODO: We don't check enum$, yet! We first need to fix expansion for
    //       `cast(elem as EnumType)` (see #9421)
    for (const id in art.elements$) {
      const specifiedElement = art.elements$[id];
      // TODO: Custom kind?
      specifiedElement.$isSpecifiedElement = true;
      if (!specifiedElement.$replacement) {
        const loc = [ specifiedElement.name.location, specifiedElement ];
        error( 'query-unspecified-element', loc, { id } );
      }
    }
  }

  /**
   * Merge _specified_ foreign keys with _inferred_ foreign keys in the given view/element,
   * where specified elements can appear through CSN.
   *
   * We only copy annotations.
   *
   * This is important to ensure re-compilability.
   *
   * TODO: make this part of a revamped on-demand 'extend' functionality.
   *
   * @param art
   */
  function mergeSpecifiedForeignKeys( art ) {
    if (!art.foreignKeys)
      return; // TODO: Warn if there are no foreign keys?

    let wasAnnotated = false;

    for (const id in art.foreignKeys) {
      const ielem = art.foreignKeys[id];  // inferred element
      const selem = art.foreignKeys$[id]; // specified element
      if (!selem) {
        info( 'query-missing-element', [ ielem.name.location, art ], { '#': 'foreignKeys', id } );
      }
      else {
        for (const prop in selem) {
          // just annotation assignments and doc comments for foreign keys
          if (prop.charAt(0) === '@' || prop === 'doc') {
            ielem[prop] = selem[prop];
            // required for gensrc mode of to-csn.js, otherwise the annotation
            // may be lost during recompilation.
            ielem[prop].$priority = 'annotate';
            wasAnnotated = true;
          }
        }
        selem.$replacement = true;
      }
    }
    if (wasAnnotated)
      setExpandStatusAnnotate( art, 'annotate' );

    for (const id in art.foreignKeys$) {
      const specifiedElement = art.foreignKeys$[id];
      if (!specifiedElement.$replacement) {
        const loc = [ specifiedElement.name.location, specifiedElement ];
        error( 'query-unspecified-element', loc, { '#': 'foreignKeys', id } );
      }
    }
  }

  /**
   * Set type properties of specified elements on the inferred artifact, but only
   * assign them if their values differs from the inferred ones (for better locations).
   *
   * @param {XSN.Artifact} art
   */
  function setSpecifiedElementTypeProperties( art ) {
    for (const prop in art.typeProps$) {
      let o = art;
      if (o._effectiveType !== 0) { // cyclic
        while (!o[prop] && getOrigin( o ))
          o = getOrigin( o );
      }

      if (typePropertiesFromSpecifiedElements[prop] === 'if-undefined') {
        if (!o[prop])
          art[prop] = art.typeProps$[prop];
      }
      else if (!o[prop] || art.typeProps$[prop].val !== o[prop]?.val) {
        art[prop] = art.typeProps$[prop];
      }
    }
  }

  function populateQuery( query ) {
    if (query._combined || !query.from || !query.$tableAliases)
      // already done (TODO: re-check!) or $join query or parse error
      return query;
    setLink( query, '_combined', Object.create( null ) );
    query.$inlines = [];
    forEachGeneric( query, '$tableAliases', resolveTabRef );
    initFromColumns( query, query.columns );
    if (query.excludingDict) {
      for (const name in query.excludingDict)
        resolveExcluding( name, query._combined, query.excludingDict, query );
    }
    // TODO: should we to set some falsy values? E.g. with $self.*, cyclic from?
    // Yes, when element names cannot fully be determined (wrong source ref,
    // cyclic, ...)  BTW, similar with `includes`
    return query;

    function resolveTabRef( alias ) {
      // effectiveType() must not be called on $self, is unnecessary for mixins:
      // (we might have those already)
      if (alias.kind === 'mixin' || alias.kind === '$self')
        return;
      if (!alias.elements) // could be false in hierarchical JOIN - TODO: necessary?
        effectiveType( alias ); // element → $navElement expansion for $tableAlias

      forEachGeneric( { elements: alias.elements }, 'elements', ( elem, name ) => {
        if (elem.$duplicates !== true)
          dictAddArray( query._combined, name, elem, null ); // not dictAdd()
      } );
    }
  }

  function resolveExcluding( name, env, excludingDict, user ) {
    const found = env[name];
    if (found) { // set links for LSP; if Array, then via multiple query sources ($navElement)
      const art = (Array.isArray(found) && found.map(f => f._origin)) ||
        (found.kind === '$navElement' && found._origin) ||
        found;
      setArtifactLink( excludingDict[name].name, art );
      return;
    }
    /** @type {object} */
    // console.log(name,Object.keys(env),Object.keys(excludingDict))
    const compileMessageRef = info(
      'ref-undefined-excluding', [ excludingDict[name].location, user ], { name },
      'Element $(NAME) has not been found'
    );
    attachAndEmitValidNames( compileMessageRef, env );
  }

  // query columns -----------------------------------------------------------

  function expandFromColumns( elem ) {
    const path = elem.value?.path;
    if (!path || path.broken)
      return null;
    // If we allow CDL-style casts of `expand`s to associations in the future, we
    // need to ignore an explicit type, i.e. not getOrigin():
    const assoc = resolvePath( elem.value, 'column', elem );
    if (!effectiveType( assoc )?.target)
      return initFromColumns( elem, elem.expand );
    const { targetMax } = path[path.length - 1].cardinality ||
                          getInheritedProp( assoc, 'cardinality' ) || {};
    if (targetMax && (targetMax.val === '*' || targetMax.val > 1)) {
      elem.items = { location: elem.expand[$location] };
      setLink( elem.items, '_outer', elem );
    }
    return initFromColumns( elem, elem.expand );
  }

  // TODO: make this function shorter - make part of this (e.g. setting
  // parent/name) also be part of definer.js
  // TODO: query is actually the elemParent, where the new elements are added to
  // top-level: ( query, query.columns )
  // inline: ( queryOrColParent, col.inline, col )
  // expand: ( col, col.expand )
  function initFromColumns( query, columns, inlineHead = undefined ) {
    const elemsParent = query.items || query;
    if (!inlineHead) {
      elemsParent.elements = Object.create( null );
      if (query._main._leadingQuery === query) // never the case for 'expand'
        query._main.elements = elemsParent.elements;
    }

    const isExpand = (query.expand === columns);
    if (!columns)
      columns = [ { val: '*' } ];

    for (let i = 0; i < columns.length; ++i) {
      const col = columns[i];
      if (col.val === '*') {
        const siblings = wildcardSiblings( columns, query );
        expandWildcard( col, siblings, inlineHead, query );
      }
      // If neither expression (value), expand, new virtual nor new association.
      if (!col.value && !col.name)
        continue;             // error should have been reported by parser
      if (col.inline) {
        const q = userQuery( query );
        q.$inlines.push( col );
        col.kind = '$inline';
        col.name = { id: `.${ q.$inlines.length }`, $inferred: '$internal' };
        // TODO: really use $inferred: '$internal', not '$inline' ? Re-check.
        // a name for this internal symtab entry (e.g. '.2' to avoid clashes
        // with real elements) is only relevant for `cdsc -R`/debugging
        // TODO: use number = column position if "top-level", negative numbers otherwise
        // (is also relevant for the semantic location - only use positive)
        dependsOnSilent( q, col );
        // or use userQuery( query ) in the following, too?
        setMemberParent( col, null, query );
        initFromColumns( query, col.inline, col );
      }
      else if (!col.$replacement) {
        const id = ensureColumnName( col, i, query, isExpand );
        col.kind = 'element';
        dictAdd( elemsParent.elements, id, col, ( name, location ) => {
          error( 'duplicate-definition', [ location, query ], { name, '#': 'element' } );
        } );
        setMemberParent( col, id, query );
      }
    }
    forEachGeneric( query, 'elements', initElem );
    return true;
  }

  /**
   * TODO: probably do this already in definer.js
   *
   * @param col
   * @param {number} colIndex
   * @param query
   * @param {boolean} insideExpand
   *     Whether the column is inside 'expand'.
   *     Anonymous 'expands' don't have a column parent, hence why we need to know this explicitly.
   */
  function ensureColumnName( col, colIndex, query, insideExpand ) {
    if (col.name)
      return col.name.id;
    if (col.inline || col.val === '*' || col.val === '**') // '**' = duplicate '*'
      return '';
    const path = col.value &&
        (col.value.path || !col.value.args && col.value.func?.path);
    if (path) {
      const last = path.length && !path.broken && path[path.length - 1];
      if (last) {
        col.name = { id: last.id || '', location: last.location, $inferred: 'as' };
        return col.name.id;
      }
    }
    else if (insideExpand || col.expand ||
        col.value && (col._columnParent || query._parent.kind !== 'select')) {
      // _columnParent => inline/expand with path head; _parent -> only allowed in sub-selects
      error( 'query-req-name', [ col.value?.location || col.location, query ], {},
             'Alias name is required for this select item' );
    }
    else if (col.value) {
      col.name = {
        // NOTE: If the alias is changed, corresponding name-clash tests must be updated as well!
        id: `$_column_${ colIndex + 1 }`,
        location: col.value.location || col.location,
        $inferred: '$internal',
      };
      return col.name.id;
    }
    // invent a name for code completion in expression, see also #10596
    col.name = {
      id: '',
      location: col.value && col.value.location || col.location,
      $inferred: 'none',
    };
    return '';
  }

  function initElem( elem ) {
    // TODO: we could share code with initMembers/init() in define.js
    if (elem.type && !elem.type.$inferred)
      return;                 // explicit type -> enough or getOrigin()
    if (elem.$inferred) {
      // redirectImplicitly( elem, elem._origin );
      return;
    }
    if (!elem.type && elem.value?.type) {  // top-level CAST( expr AS type )
      if (!elem.target) {  // TODO: we might issue an error if there is a target
        elem.type = { ...elem.value.type, $inferred: 'cast' };
        // TODO: What about other direct properties in cast such as items/enum/...?
      }
    }
    if (elem.foreignKeys)       // REDIRECTED with explicit foreign keys
      forEachGeneric( elem, 'foreignKeys', (key, name) => initKey( key, name, elem ) );
  }

  function initKey( key, name, elem ) {
    setLink( key, '_block', elem._block );
    setMemberParent( key, name, elem ); // TODO: set _block here if not present?
  }

  // col ($replacement set before *)
  // false if two cols have same name
  function wildcardSiblings( columns, query ) {
    const siblings = Object.create( null );
    if (!columns)
      return siblings;

    let seenWildcard = null;
    let colIndex = 0;
    for (const col of columns) {
      const id = ensureColumnName( col, colIndex, query, false );
      if (id) {
        col.$replacement = !seenWildcard;
        siblings[id] = !(id in siblings) && col;
      }
      else if (col.val === '*') {
        seenWildcard = true;
      }
      ++colIndex;
    }
    return siblings;
  }

  // TODO: disallow $self.elem.* and $self.*, toSelf.* (circular dependency)
  function expandWildcard( wildcard, siblingElements, colParent, query ) {
    const { elements } = query.items || query;
    let location = wildcard.location ||
                   weakRefLocation( query.from ) ||
                   weakLocation( query.location );
    const inferred = query._main.$inferred;
    const excludingDict = (colParent || query).excludingDict || Object.create( null );

    const envParent = wildcard._columnParent;
    const env = wildcardColumnEnv( wildcard, query );
    if (!env)
      return;

    for (const name in env) {
      const navElem = env[name];
      // TODO: remove all access to masked (use 'grep')
      if (excludingDict[name] || navElem.masked && navElem.masked.val)
        continue;
      const sibling = siblingElements[name];
      if (sibling) {          // is explicitly provided (without duplicate)
        if (!inferred && !envParent) // not yet for expand/inline
          reportReplacement( sibling, navElem, query );
        if (!sibling.$replacement) {
          sibling.$replacement = true;
          sibling.kind = 'element';
          dictAdd( elements, name, sibling, ( _name, loc ) => {
            // there can be a definition from a previous inline with the same name:
            error( 'duplicate-definition', [ loc, query ], { name, '#': 'element' } );
          } );
          setMemberParent( sibling, name, query );
        }
        // else {
        //   sibling.$inferred = 'query';
        // }
      }
      else if (Array.isArray( navElem )) {
        const names = navElem.filter( e => !e.$duplicates )
          .map( e => `${ e._parent.name.id }.${ e.name.id }` );
        if (names.length) {
          error( 'wildcard-ambiguous', [ location, query ], { id: name, names },
                 'Ambiguous wildcard, select $(ID) explicitly with $(NAMES)' );
        }
      }
      else {
        location = weakLocation( location );
        // Usually, the location of a `*`-inferred element is the location of the `*`.
        // For inferred entities, it is the location of the corresponding source elem
        // (from all generated entities, only auto-exposed are “wildcard projections”):
        const elemLocation = !query._main.$inferred && location;
        const origin = envParent ? navElem : navElem._origin;
        const elem = linkToOrigin( origin, name, query, null, elemLocation );
        if (origin.$calcDepElement) // TODO: this will be changed in the next PR
          dependsOn( elem, origin.$calcDepElement, location );

        // TODO: check assocToMany { * }
        dictAdd( elements, name, elem, ( _name, loc ) => {
          // there can be a definition from a previous inline with the same name:
          error( 'duplicate-definition', [ loc, query ], { name, '#': 'element' } );
        } );
        if (!query._main.$inferred || origin.$inferred)
          elem.$inferred = '*';
        elem.name.$inferred = '*'; // matters for A2J
        if (envParent)
          setWildcardExpandInline( elem, envParent, origin, name, location );
        else
          setElementOrigin( elem, navElem, name, elem.location );
      }
    }
    if (envParent || query.kind !== 'select') {
      // already done in populateQuery (TODO: change that and check whether
      // `*` is allowed at all in definer)
      if (!colParent || colParent.value._artifact) {
        // avoid "not found" messages if columnParent can't be found
        const user = colParent || query;
        for (const name in user.excludingDict)
          resolveExcluding( name, env, excludingDict, query );
      }
    }
  }

  function wildcardColumnEnv( wildcard, query ) { // etc.  wildcard._columnParent;
    // if (envParent) console.log( 'CE:', envParent._origin, query );
    const colParent = wildcard._columnParent;
    if (!colParent)
      return userQuery( query )._combined; // see combinedSourcesOrParentElements

    const head = resolvePath( colParent.value, 'column', colParent );
    // eslint-disable-next-line no-nested-ternary
    if (!head
        ? !columnRefStartsWithSelf( colParent )
        : head._main
          ? userQuery( head ) !== userQuery( query )
          : head._main !== query._main)
      return nestedElements( wildcard );

    error( 'def-unexpected-wildcard', [ wildcard.location, colParent ], { code: '*' },
           'Unexpected $(CODE) (wildcard) after $self/association to self reference' );
    model.$assert = null;       // explains cyclic dependencies
    return null;
  }

  function reportReplacement( sibling, navElem, query ) {
    // TODO: bring this much less often = only if shadowed elem does not appear
    // in expr and if not projected as other name.
    // Probably needs to be reported at a later phase
    const path = sibling.value && sibling.value.path;
    if (!sibling.target || sibling.target.$inferred || // not explicit REDIRECTED TO
        path && path[path.length - 1].id !== sibling.name.id) { // or renamed
      const { id } = sibling.name;
      if (Array.isArray( navElem )) {
        // ID published! Used in stakeholder project; if renamed, add to oldMessageIds
        info( 'wildcard-excluding-many', [ sibling.name.location, query ],
              { id, keyword: 'excluding' },
              // eslint-disable-next-line @stylistic/js/max-len
              'This select item replaces $(ID) from two or more sources. Add $(ID) to $(KEYWORD) to silence this message' );
      }
      else {
        // ID published! Used in stakeholder project; if renamed, add to oldMessageIds
        info( 'wildcard-excluding-one', [ sibling.name.location, query ],
              { id, alias: navElem._parent.name.id, keyword: 'excluding' },
              // eslint-disable-next-line @stylistic/js/max-len
              'This select item replaces $(ID) from table alias $(ALIAS). Add $(ID) to $(KEYWORD) to silence this message' );
      }
    }
  }

  function setWildcardExpandInline( queryElem, columnParent, origin, name, location ) {
    setLink( queryElem, '_columnParent', columnParent );
    const path = [ { id: name, location } ];
    queryElem.value = { path, location }; // TODO: can we omit that?  We have _origin
    setArtifactLink( path[0], origin );
    setLink( queryElem, '_origin', origin );
    // set _projections when inline with table alias:
    // const alias = columnParent?.value?.path?.[0]?._navigation;
    // if (alias?.kind === '$tableAlias')
    //   pushLink( alias.elements[name], '_projections', queryElem );
  }

  // called by expandWildcard():
  function setElementOrigin( queryElem, navElem, name, location ) {
    const sourceElem = navElem._origin;
    const alias = navElem._parent;
    // always expand * to path with table alias (reason: columns $user etc)
    const path = [ { id: alias.name.id, location }, { id: name, location } ];
    queryElem.value = { path, location };
    setLink( path[0], '_navigation', alias );
    setArtifactLink( path[0], alias._origin );
    setArtifactLink( path[1], sourceElem );
    // TODO: or should we set the _artifact/_effectiveType directly to the target?
    setArtifactLink( queryElem.value, sourceElem );
    // pushLink( navElem, '_projections', queryElem );
    // TODO: _effectiveType?
  }

  //--------------------------------------------------------------------------
  // Auto-Redirections
  //--------------------------------------------------------------------------

  // Conditions for redirecting target of assoc in elem
  // - we (the elem) are in a service
  // - target provided in assoc is not defined in current service
  // - elem is to be auto-redirected (included elem, elem from main query, ...)
  // - assoc is not defined in current service (or was not to be auto-redirected)
  function redirectImplicitly( elem, assoc ) {
    // PRE: elem has no target, assoc has target prop
    if (elem.kind === '$tableAlias')
      return false;
    // Specified elements could lead to warnings that seem unfixable by the user.
    // TODO: Custom kind?
    if (elem.$isSpecifiedElement)
      return false;
    const assocTarget = assoc.target._artifact;
    let target = assocTarget;
    // console.log( info( null, [ elem.location, elem ], {target,art:assoc,name:''+assoc.target},
    //              'RED').toString())
    if (!target)
      return false;             // error in target ref
    const { location } = elem.value || elem.type || elem.name || elem;
    const service = (elem._main || elem)._service;
    if (service && service !== target._service && assocIsToBeRedirected( elem )) {
      if (service !== (assoc._main || assoc)._service ||
          !assocIsToBeRedirected( assoc ) ||
          elem === assoc)
        target = redirectImplicitlyDo( elem, assoc, target, service );
    }
    if (elem === assoc) {    // redirection of user-provided target
      if (assocTarget === target) // no change (due to no implicit redirection)
        return true;
      elem.target.$inferred = '';
      setArtifactLink( elem.target, target );
      return true;
    }
    if (target !== assocTarget)
      setExpandStatus( elem, 'target' ); // (might) also set in rewriteCondition
    elem.target = {
      path: [ { id: target.name.id, location } ],
      scope: 'global',
      location,
      $inferred: (target !== assocTarget ? 'IMPLICIT' : 'rewrite' ),
    };
    setArtifactLink( elem.target, target );
    setArtifactLink( elem.target.path[0], target );
    return true;
  }

  function assocIsToBeRedirected( assoc ) {
    if (assoc.kind === 'mixin')
      return false;
    const query = userQuery( assoc );
    return !query || query._main._leadingQuery === query;
  }

  function redirectImplicitlyDo( elem, assoc, target, service ) {
    // console.log('ES:',elem.name.id,elem.name.element);
    if (assoc._main === target && elem._main?.kind === 'entity' &&
        elem._main?._ancestors?.includes( target )) {
      // source and target of the model association are the same entity, and
      // the current main artifact is a suitable auto-redirection target → return it
      return elem._main;
    }
    const elemScope = preferredElemScope( target, service, elem, assoc._main || assoc );
    const exposed = minimalExposure( target, service, elemScope );

    if (!exposed.length) {
      const origTarget = target;
      if (isAutoExposed( target ))
        target = createAutoExposed( origTarget, service, elemScope );
      const desc = origTarget._descendants ||
            setLink( origTarget, '_descendants', Object.create( null ) );
      if (!desc[service.name.id]) // could be the target itself (no repeated msgs)!
        desc[service.name.id] = [ target ];
      else
        desc[service.name.id].push( target );
    }
    else if (exposed.length === 1) {
      return exposed[0];
    }
    else if (elem === assoc) {
      // `assoc: Association to ModelEntity`: user-provided target is to be auto-redirected
      warning( 'type-ambiguous-target',
               [ elem.target.location, elem ],
               {
                 target,
                 // art: definitionScope( target ), - TODO extra debug info in message
                 sorted_arts: exposed,
               }, {
                 // eslint-disable-next-line @stylistic/js/max-len
                 std: 'Replace target $(TARGET) by one of $(SORTED_ARTS); can\'t auto-redirect this association if multiple projections exist in this service',
                 // eslint-disable-next-line @stylistic/js/max-len
                 two: 'Replace target $(TARGET) by $(SORTED_ARTS) or $(SECOND); can\'t auto-redirect this association if multiple projections exist in this service',
               } );
      // continuation semantics: no auto-redirection
    }
    else {
      // referred (and probably inferred) assoc (without a user-provided target at that place)
      // HINT: consider bin/cdsv2m.js when changing the following message text
      // No grouped and sub messages yet (TODO v6): mention at all target places with all assocs
      const withAnno = annotationVal( exposed[0]['@cds.redirection.target'] );
      for (const proj of exposed) {
        // TODO: def-ambiguous-target (just v6, as the current is infamous and used in options),
        message( 'redirected-implicitly-ambiguous',
                 [ weakLocation( proj.name.location ), proj ],
                 {
                   '#': withAnno && 'justOne',
                   target,
                   art: elem,
                   // art: definitionScope( target ), - TODO extra debug info in message
                   anno: 'cds.redirection.target',
                   sorted_arts: exposed,
                 }, {
                   // eslint-disable-next-line @stylistic/js/max-len
                   std: 'Add $(ANNO) to one of $(SORTED_ARTS) to select the entity as redirection target for $(TARGET) in this service; can\'t auto-redirect $(ART) otherwise',
                   // eslint-disable-next-line @stylistic/js/max-len
                   two: 'Add $(ANNO) to either $(SORTED_ARTS) or $(SECOND) to select the entity as redirection target for $(TARGET) in this service; can\'t auto-redirect $(ART) otherwise',
                   // eslint-disable-next-line @stylistic/js/max-len
                   justOne: 'Remove $(ANNO) from all but one of $(SORTED_ARTS) to have a unique redirection target for $(TARGET) in this service; can\'t auto-redirect $(ART) otherwise',
                 } );
      }
      // continuation semantics: no implicit redirections
    }
    return target;
  }

  // Return projections of `target` in `service`.  Sorted by
  // - first, only consider projections with @cds.redirection.target=true
  // - exclude all indirect projections, i.e. those which are projection on others in list
  //
  // To avoid repeated messages: if already tried to do autoexposure, return
  // auto-exposed entity when successful, or `target` otherwise (no/failed autoexposure)
  function minimalExposure( target, service, elemScope ) {
    const descendants = scopedExposure( target._descendants &&
                                        target._descendants[service.name.id] ||
                                        [],
                                        elemScope, target );
    const preferred = descendants.filter( d => annotationVal( d['@cds.redirection.target'] ) );
    const exposed = preferred.length ? preferred : descendants;
    if (exposed.length < 2)
      return exposed || [];
    let min = [];
    for (const e of exposed) {
      if (min.every( m => m._ancestors?.includes( e ) )) {
        min = [ e ];
      }
      else if (min.length !== 1 || !e._ancestors?.includes( min[0] )) {
        if (elemScope === '' && options.testMode)
          throw new CompilerAssertion( `Scope for ${ target } in service ${ service } is empty`);
        if (elemScope === '')
          return [];
        min.push( e );
      }
    }
    return min;
  }

  // Scoped redirections -----------------------------------------------------


  function preferredElemScope( target, service, elem, assocMain ) {
    const assocScope = definitionScope( assocMain );
    const targetScope = definitionScope( target );
    if (targetScope === assocScope) { // intra-scope in model
      const elemScope = definitionScope( elem._main || elem );
      // without the if, compile.recompile.json versus expected csn.json in
      // test3/Redirections/AutoExposeDeepScoped would fail
      if (targetScope === target ||  // model target is scope root
          assocScope === assocMain || // unscoped assoc source in model
          elemScope !== (elem._main || elem)) // scoped assoc source in service
        return elemScope;         // own scope, then global
    }
    if (targetScope === target)  // unscoped target in model / other service
      return false;              // all (there could be no scoped autoexposed)
    // scoped target in model:
    const exposed = minimalExposure( targetScope, service, false );
    // console.log('PES:',elem.name.id,elem.name.element,exposed.map(e=>e.name.id))
    if (exposed.length === 1)   // unique redirection for target scope: use that
      return exposed[0];
    // TODO: warning if exposed.length >= 2?  Probably not
    // TODO: use excessive testing for the following
    // Now re-scope according to naming of auto-exposed entity:
    const autoScopeName = autoExposedName( targetScope, service, false );
    const autoScope = model.definitions[autoScopeName];
    // console.log('AEN:',autoScopeName,autoScope&&(autoScope.$inferred || autoScope.kind))
    if (autoScope)
      return autoScope;
    const { location } = service.name;
    const nullScope = {
      kind: 'namespace', name: { id: autoScopeName, location }, location,
    };
    model.definitions[autoScopeName] = nullScope;
    initArtifact( nullScope );
    return nullScope;
  }

  function scopedExposure( descendants, elemScope, target ) {
    if (!elemScope)             // no scoped redirections
      return descendants;
    // try scope as target first, even if it has @cds.redirection.target: false
    if (isDirectProjection( elemScope, target ))
      return [ elemScope ];
    const scoped = descendants.filter( d => elemScope === definitionScope( d ) );
    if (scoped.length)          // use scoped new targets if present
      return scoped;
    // otherwise return new targets outside any scope
    return descendants.filter( d => d === definitionScope( d ) );
  }

  // Return the scope of a definition.  It is the last parent of the definition
  // which is not a context/service/namespace, or the definition itself.
  // If inside service, it is the direct child of the (most inner) service.
  function definitionScope( art ) {
    let base = art;
    while (art._parent) {
      if (art._parent.kind === 'service')
        return art;
      art = art._parent;
      if (!kindProperties[art.kind].artifacts)
        base = art;
    }
    return base;
  }

  function isDirectProjection( proj, base ) {
    return proj.kind === 'entity' && // not event
      // direct proj (TODO: or should we add them to another list?)
      // TODO: delete ENTITY._from - maybe not...
      proj.query && proj.query.op && proj.query.op.val === 'SELECT' &&
      proj._from && proj._from.length === 1 &&
      base === resolvePath( proj._from[0], 'from', proj.query );
  }

  // Auto-exposure -----------------------------------------------------------

  // TODO: do something in kick-start.js ?
  function isAutoExposed( target ) {
    if (target.$autoexpose !== undefined)
      return target.$autoexpose;
    const origTarget = target;
    const chain = [];
    const alias1 = target._from?.[0]; // TODO: delete ENTITY._from ?
    let source = alias1 && resolvePath( alias1, 'from', alias1._parent );
    // query source ref might not have been resolved yet, cycle avoided as
    // setAutoExposed() sets $autoexpose and a second call on same art would
    // return false
    while (target.$autoexpose === undefined && setAutoExposed( target ) && source) {
      // stop at first ancestor with annotation or at non-query entity
      chain.push( target );
      target = source;
      const alias = target._from?.[0]; // TODO: delete ENTITY._from ?
      source = alias && resolvePath( alias, 'from', alias._parent );
    }
    const autoexpose = target.$autoexpose;
    if (typeof autoexpose === 'boolean') {
      for (const a of chain)
        a.$autoexpose = autoexpose;
    }
    return origTarget.$autoexpose;
  }

  // TODO: less auto-exposed for compositions (see lengthy discussions)
  function setAutoExposed( art ) {
    const anno = art['@cds.autoexpose'];
    if (anno && anno.val !== null) { // XSN TODO: set val, but no location for anno short form
      // @cds.autoexpose:true or @cds.autoexpose:false
      art.$autoexpose = anno.val === undefined || !!anno.val;
      return false;
    }
    // no @cds.autoexpose or @cds.autoexpose:null
    art.$autoexpose = model.$compositionTargets[art.name.id] ? true : null;
    return true;                // still check for inherited @cds.autoexpose
  }

  function autoExposedName( target, service, elemScope ) {
    const absolute = target.name.id;
    const base = definitionScope( target );
    if (base === target)
      return `${ service.name.id }.${ absolute.substring( absolute.lastIndexOf( '.' ) + 1 ) }`;
    // for scoped (e.g. calculated) entities, use exposed name of base:
    const exposed = minimalExposure( base, service, elemScope );
    // console.log(exposed.map( a => a.name.id ));
    const sbasename = (exposed.length === 1 && exposed[0] !== base) // same with no/failed expose
      ? exposed[0].name.id
      : autoExposedName( base, service, elemScope );
    return sbasename + absolute.slice( base.name.id.length );
  }


  function createAutoExposed( target, service, elemScope ) {
    const absolute = autoExposedName( target, service, elemScope );
    const autoexposed = model.definitions[absolute];
    if (autoexposed && (autoexposed.kind !== 'namespace')) {
      if (isDirectProjection( autoexposed, target )) {
        const anno = autoexposed['@cds.redirection.target'];
        if (annotationIsFalse( anno )) {
          // It would probably be cleaner to ignore a dubious
          // `@cds.redirection.target: false` earlier, but that is not easy to detect
          // due to the name of the auto-exposed entity with scoped redirections
          if (!anno.$errorReported) {
            info( 'anno-redirecting-anyway',
                  [ annotationLocation( anno ), autoexposed ],
                  { target, art: absolute, code: '@cds.redirection.target: false' },
                  '$(TARGET) is auto-redirected to $(ART) even with $(CODE)' );
            anno.$errorReported = 'anno-redirecting-anyway';
          }
        }
        else if (autoexposed._parent === service ||
                 !annotationVal( autoexposed['@cds.autoexposed'] )) {
          // existing def not auto-exposed, or un-scoped auto-exposed: should not happen
          if (options.testMode)
            throw new CompilerAssertion( `Tried to auto-expose ${ target.name.id } twice`);
        }
        return autoexposed;
      }
      message( 'def-duplicate-autoexposed', [ service.name.location, service ],
               { target, art: absolute },
               'Name $(ART) of auto-exposed entity for $(TARGET) collides with other definition' );
      info( null, [ target.name.location, target ],
            { art: service },
            'Expose this (or the competing) entity explicitly in service $(ART)' );
      if (autoexposed.$inferred !== 'autoexposed')
        return target;
      const firstTarget = autoexposed.query.from._artifact;
      message( 'def-duplicate-autoexposed', [ service.name.location, service ],
               { target: firstTarget, art: absolute },
               'Name $(ART) of auto-exposed entity for $(TARGET) collides with other definition' );
      info( null, [ firstTarget.name.location, firstTarget ],
            { art: service },
            'Expose this (or the competing) entity explicitly in service $(ART)' );
      autoexposed.$inferred = 'def-duplicate-autoexposed';
      return target;
    }
    // console.log(absolute)
    const location = weakRefLocation( target.name );
    const from = { path: [ { id: target.name.id, location } ], location };
    let art = {
      kind: 'entity',
      name: { location, id: absolute },
      location,
      query: { location, op: { val: 'SELECT', location }, from },
      $syntax: 'projection',
      $inferred: 'autoexposed',
      '@cds.autoexposed': {
        name: { path: [ { id: 'cds.autoexposed', location } ], location },
        $inferred: '$generated',
      },
    };
    // forward target parameters to projection
    if (target.params) {
      art.params = Object.create( null );
      // is art.query.from.path[0].$syntax: ':' required?
      from.path[0].args = Object.create( null );
      forEachGeneric( target, 'params', (p, pn) => {
        art.params[pn] = linkToOrigin( p, pn, art, 'params' );
        from.path[0].args[pn] = {
          name: { id: p.name.id, location },
          location,
          scope: 'param',
          path: [ { id: pn, location } ],
        };
      } );
    }
    // TODO: do we need to tag the generated entity with elemScope = 'auto'?
    if (autoexposed) {
      Object.assign( autoexposed, art );
      art = autoexposed;
    }
    else {
      model.definitions[absolute] = art;
    }
    setLink( art, '_service', service );
    setLink( art, '_block', model.$internal );
    initArtifact( art, !!autoexposed );
    effectiveType( art );
    // TODO: try to set locations of elements locations of orig target elements
    newAutoExposed.push( art );
    return art;
  }
}

module.exports = populate;
