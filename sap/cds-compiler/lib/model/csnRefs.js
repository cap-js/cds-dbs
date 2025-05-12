// CSN functionality for resolving references

// Resolving references in a CSN can be a bit tricky, because the semantics of
// a reference is context-dependent, especially if queries are involved.  This
// module provides the corresponding resolve/inspect functions.
//
// This module should work with both client-style CSN and Universal CSN.
//
// See below for preconditions / things to consider – the functions in this
// module do not issue user-friendly messages for invalid references in a CSN,
// such messages are (hopefully) issued by the compile() function.

// The main export function `csnRefs` of this module is called with a CSN as
// input and returns functions which analyse references in the provided CSN:
//
//     const { csnRefs } = require('../model/csnRefs');
//     function myCsnAnalyser( csn ) {
//       const { inspectRef } = csnRefs( csn );
//         …
//         const { links, art } = inspectRef( csnPath );
//         // → art is the CSN node which is referred to by the reference
//         // → links provides some info about each reference path step
//         …
//     }
//
// You can see the results of the CSN refs functions by using our client tool:
//     cdsc --enrich-csn MyModel.cds
// It is also used by our references tests, for details see ./enrichCsn.js.

// Terminology used in this file:
//
// - ref (reference): a { ref: <path> } object (or sometimes also a string)
//   referring an artifact or member (element, …)
// - path: an array of strings or { id: … } objects for the dot-connected names
//   used as reference
// - csnPath: an array of strings and numbers (e.g. ['definitions', 'S.E',
//   'query', 'SELECT', 'from', 'ref', 0, 'where', 2]); they are the property
//   names and array indexes which navigate from the CSN root to the reference.

// ## PRECONDITIONS / THINGS TO CONSIDER -------------------------------------

// The functions in this module expect
//
// 1. a well-formed CSN with valid references;
// 2. a compiled model, i.e. a CSN with all inferred information provided by
//    the compile() function for the CSN flavors `client` or `universal`
//    (including the (non-)enumerable `elements` property in `client` CSN);
// 3. no (relevant) CSN changes between the calls of the same instance of
//    inspectRef() - to enable caching.
//
// If any of these conditions are not given, our functions usually simply
// throw an exception (which might even be a plain TypeError), but it might
// also just return any value.  CSN processors can provide user-friendly error
// messages by calling the Core Compiler in case of exceptions.  For details,
// see internalDoc/CoreCompiler.md#use-of-the-core-compiler-for-csn-processors.

// During a transformation, care must be taken to adhere to these conditions.
// E.g. a structure flattening function cannot create an element `s_x` and
// delete `s` and then still expect inspectRef() to be able to resolve a
// reference `['s', 'x']`.

// There are currently 3 (SQL) backend issues for which we provide a workaround:
//
// - function `resolvePath`: issue with argument `arg` being falsy
// - function `artifactRef`: issue with non-string ref without definition
// - function `initColumnElement`: issue with column which is neither `*` nor
//   a `ref` with sibling `inline`, but still has no corresponding element

// The functions in this module also use an internal cache, which can be dropped
// for a single definition (main artifact) with function dropDefinitionCache().

// When modifying the CSN, caches might need to be invalidated.  In the following
// example, the second call of inspectRef() might lead to a wrong result or an
// exception if the assignment to `inspectRef` is not uncommented:
//
//     let { inspectRef } = csnRefs( csn );
//     const csnPath = ['definitions','P','projection','columns',0];
//     const subElement = inspectRef( csnPath );  // type T is involved
//     csn.definitions.T.type = 'some.other.type';
//     // ({ inspectRef } = csnRefs( csn ));      // drop caches
//     … = inspectRef( csnPath );  // type T - using the cached or the new?
//
// On request, we might add a functions for individual cache invalidations or
// low-level versions of inspectRef() for performance.

// ## NAME RESOLUTION OVERVIEW -----------------------------------------------

// The most interesting part of a reference is always: where to search for the
// name in its first path item?  The general search is always as follows, with
// the exact behavior being dependent on the “reference context” (e.g. “reference
// in a `on` condition of a `mixin` definition”):
//
// 1. We search in environments constructed by “defining” names “around” the
//    lexical position of the reference.  In a CSN, these could be the
//    (explicit and implicit) table alias names and `mixin` definitions of the
//    current query and its parent queries (according to the query hierarchy).
// 2. If the search according to (1) was not successful and the name starts
//    with a `$`, we could consider the name to be a “magic” variable with
//    `$self` (and `$projection`) being a special magic variable.
// 3. Otherwise, we would search in a “dynamic” environment, which could be
//    `‹csn›.definitions` for global references like `type`, the elements of
//    the current element's parent, the combined elements of the query source
//    entities, the resulting elements of the current query, or something
//    special (elements of the association's target, …).
//
// The names in further path items are searched in the “navigation” environment
// of the path so far - it does not need to depend on the reference context (as
// we do not check the validity here):
//
// 1. We search in the elements of the target entity for associations and
//    compositions, and in the elements of the current object otherwise.
// 2. If there is an `items`, we check for `elements`/`target` inside `items`.
// 3. `elements`/`target`/`items` inherited from the “effective type” are also
//    considered.

// For details about the name resolution in CSN, see
// internalDoc/CsnSyntax.md#helper-property-for-simplified-name-resolution
// and doc/NameResolution.md.  Here comes a summary.

// ## IMPLEMENTATION OVERVIEW ------------------------------------------------

// The main function `inspectRef` works as follows:
//
// 1. For ease of use, the input is the “CSN path” as explained above, e.g.
//    ['definitions', 'P', 'query', 'SELECT', 'from', 'ref', 0, 'where', 2]
// 2. This is condensed into a “reference context” string, e.g. `ref_where`;
//    that might also depend on sibling properties along the way, e.g.
//    ['definitions', 'P', 'query', 'SELECT', 'columns', 0, 'expand', 0] leads
//    to `expand` if there is a `‹csn›.definitions.P.query.SELECT.columns[0].ref`
//    and to `columns` otherwise.
// 3. Additionally, other useful CSN nodes are collected like the current query;
//    the queries of a definition are also prepared for further inspection.
// 4. If applicable, a “base environment” is calculated; e.g. references in
//    `ref_where` are resolved against the elements of the entity referred to
//    by the outer `ref`.
// 5. We look up the “reference semantics” in constant `referenceSemantics`
//    using the “reference context” string as key.
// 6. The property `lexical` determines whether to search in “lexical
//    environments” (table aliases and `mixin`s) starting from which query, and
//    whether to do something special for names starting with `$`.
// 7. The property `dynamic` determines where to search if the lexical search
//    was not successful.
// 8. The remaining reference path is resolved as well - the final referred CSN
//    node is returned as well as information about each path step.

// We usually cache calculated data.  For the following reasons, we now use a
// WeakMap as cache instead of adding non-enumerable properties to the CSN:
//
// - CSN consumers should not have access to the cached data, as we might
//   change the way how we calculate things.
// - Avoid memory leaks.
// - Natural cache invalidation if there is no handle anymore to the functions
//   returned by `csnRefs`.

// Our cache looks like follows:

// - Each object in the CSN could have an cache entry which itself is an object
//   which contains cached data.  Such data can be a link to a CSN node (like
//   `_effectiveType`/`elements`), scalar (like `$queryNumber`) or link to
//   another cache object (like `$next`).
// - A cache entry must not link to a cache object of another main definition;
//   otherwise, individual cache invalidation does not work.
// - Usually, each CSN object has an individual cache object.
// - For CSN queries nodes, cache objects are _shared_: both the CSN nodes
//   `‹query› = { SELECT: ‹select›, … }` and `‹select›` share the same cache
//   object; a UNION `‹set_query› = { SET: args: [‹query1›, …] }` and ‹query1›
//   (which can itself be a `SELECT` or `SET`) share also the same cache
//   object; this way, the relevant query elements are directly available.
// - The cache objects for all queries of an entity are initialized as soon as
//   any reference in the entity is inspected: with data for the query
//   hierarchy, query number, table aliases and links from a column to its
//   respective inferred element.
// - TODO: some `name` property would also be useful (set with `initDefinition`)

// Properties in cache:
//
// - _effectiveType on def/member/items: cached result of effectiveType()
// - _origin on def/member/items: the "prototype"
// - $origin on def/member/items: whether implicit _origin refs have been set for direct members
// - _parent: currently just use to allow ref to `up_` in anonymous aspect
//   for managed compositions;
//   in queries always the main artifact (see `$next` for name resolution)
// - _env on non-string path item: environment provided by the ref so far,
//    next path item is element in it
// - _ref on non-string `type` or `from` ref, or on alias: the referred def/elem
//
// - $queries on def: array of all queries of an entity
// - $queryNumber: the index position +1 of a query inside the $queries array
// - $aliases on query: dictionary of alias names to cache with _ref/_select and elements
// - _select: value of the `SELECT` property of a query (or value of `projection`)
// - elements: the elements of the query (original CSN elements from query or main)
// - _element on query column: the corresponding element

'use strict';


const BUILTIN_TYPE = {};
const { SemanticLocation, locationString } = require('../base/location');
const { ModelError, CompilerAssertion } = require('../base/error');
const { isAnnotationExpression } = require('../base/builtins');

// Properties in which artifact or members are defined - next property in the
// "csnPath" is the name or index of that property; 'args' (its value can be a
// dictionary) is handled extra here, also 'expand' and 'inline'
const artifactProperties = [ 'elements', 'columns', 'keys', 'mixin', 'enum',
  'params', 'actions', 'definitions', 'extensions' ]; // + 'args', see above

// Mapping the “reference context string” to the reference semantics
// - lexical: false | Function - determines where to look first for “lexical names”
// - dynamic: String - describes the dynamic environment (if in query)
// - assoc: String, with dynamic: 'global' - what to do with assoc steps
//   * 'target': always follow target, including last ref item
//   * other (& not provided) = follow target (targetAspect if no target) if not last ref item
const referenceSemantics = {
  $init: { $initOnly: true },
  type: { lexical: false, dynamic: 'global' },
  includes: { lexical: false, dynamic: 'global' },
  target: { lexical: false, dynamic: 'global' },
  targetAspect: { lexical: false, dynamic: 'global' },
  from: { lexical: false, dynamic: 'global', assoc: 'target' },
  keys: { lexical: false, dynamic: 'target' },
  keys_origin: { lexical: false, dynamic: 'target' },
  excluding: { lexical: false, dynamic: 'source' },
  expand: { lexical: justDollar, dynamic: 'expand' },   // ...using baseEnv
  inline: { lexical: justDollar, dynamic: 'inline' },   // ...using baseEnv
  ref_where: { lexical: justDollar, dynamic: 'ref-target' }, // ...using baseEnv
  on: { lexical: justDollar, dynamic: 'query' }, // assoc defs, redirected to
  annotation: { lexical: justDollar, dynamic: 'query' }, // anno top-level `ref`
  annotationExpr: { lexical: justDollar, dynamic: 'query' }, // annotation assignment
  // there are also 'on_join' and 'on_mixin' with default semantics
  orderBy_ref: { lexical: query => query, dynamic: 'query' },
  orderBy_expr: { lexical: query => query, dynamic: 'source' }, // ref in ORDER BY expression
  orderBy_set_ref: { lexical: query => query.$next, dynamic: 'query' }, // to outer SELECT (from UNION)
  // refs in ORDER BY expr in UNION not really allowed
  // only with table alias (of outer queries) or $self
  orderBy_set_expr: { lexical: query => query.$next, dynamic: false },
  // default: { lexical: query => query, dynamic: 'source' }
};

function justDollar() {
  return null;
}

/**
 * @param {CSN.Model} csn
 * @param {boolean|string} [universalReady]
 */
function csnRefs( csn, universalReady ) {
  // some users exchange the dict while using csn-refs !?! see test/testDraft.js
  // const { definitions } = csn;
  const cache = new WeakMap();
  setCache( BUILTIN_TYPE, '_origin', null );
  if (universalReady === 'init-all') {
    for (const name of Object.keys( csn.definitions || {}))
      initDefinition( name );
  }
  // Functions which set the new `baseEnv`:
  resolveRef.expandInline = function resolveExpandInline( ref, ...args ) {
    return cached( ref, '_env', () => navigationEnv( resolveRef( ref, ...args ).art ) );
  };
  resolveRef.ref_where = function resolveRefWhere( pathItem, baseRef, ...args ) {
    return cached( pathItem, '_env', () => {
      resolveRef( baseRef, ...args ); // sets _env cache for non-string ref items
      return getCache( pathItem, '_env' );
    } );
  };
  artifactRef.from = fromArtifactRef;
  return {
    effectiveType,
    artifactRef,
    getOrigin,
    queryForElements,
    inspectRef,
    queryOrMain,
    getColumn: elem => getCache( elem, '_column' ),
    getElement: col => getCache( col, '_element' ),
    /** Returns the column's name; either explicit, implicit or internal one. */
    getColumnName: col => getCache( col, '$as' ),
    $getQueries: def => getCache( def, '$queries' ), // unstable API
    initDefinition,
    dropDefinitionCache,
    targetAspect,
    msgLocations,
    __getCache_forEnrichCsnDebugging: obj => cache.get( obj ),
  };

  /**
   * Return the type relevant for name resolution, i.e. the object which has a
   * `target`, `elements`, `enum` property, or no `type` property.
   * (This function could be simplified if we would use JS prototypes for type refs.)
   *
   * @param {CSN.ArtifactWithRefs} art
   */
  function effectiveType( art ) {
    const cachedType = getCache( art, '_effectiveType' );
    if (cachedType !== undefined)
      return cachedType;

    const chain = [];
    let origin;
    while (getCache( art, '_effectiveType' ) === undefined &&
           (origin = cached( art, '_origin', getOriginRaw )) &&
           !art.elements && !art.target && !art.targetAspect && !art.enum && !art.items) {
      chain.push( art );
      setCache( art, '_effectiveType', 0 ); // initial setting in case of cycles
      art = origin;
    }
    if (!chain.length)
      return setCache( art, '_effectiveType', art );

    if (getCache( art, '_effectiveType' ) === 0)
      throw new ModelError( 'Circular type reference');
    const type = getCache( art, '_effectiveType' ) || art;
    chain.forEach( a => setCache( a, '_effectiveType', type ) );
    return type;
  }

  /**
   * @param {CSN.Artifact} art
   */
  function navigationEnv( art, staticAssoc ) {
    let env = effectiveType( art );
    // here, we do not care whether it is semantically ok to navigate into sub
    // elements of array items (that is the task of the core compiler /
    // semantic check)
    while (env.items)
      env = effectiveType( env.items );
    if (env.elements)           // shortcut
      return env;
    const target = (staticAssoc ? targetAspect( env ) : env.target || env.targetAspect);
    if (typeof target !== 'string')
      return target || env;
    return initDefinition( target );
  }

  /**
   * Return the object pointing to by the artifact reference (in 'type',
   * 'includes', 'target', raw 'from').
   *
   * @param {CSN.ArtifactReferencePath|string} ref
   * @param {any} [notFound] Value that is returned in case the artifact reference
   *                         could not be found.
   */
  function artifactRef( ref, notFound ) {
    // TODO: what about type ref?
    if (typeof ref === 'string') {
      const main = csn.definitions[ref];
      if (main)
        return initDefinition( ref );
      // notFound only meant for builtins and $self
      if (notFound !== undefined)
        return notFound;
    }
    else {
      const art = cached( ref, '_ref', artifactPathRef );
      if (art)
        return art;
      // Backend bug workaround, TODO: delete next 2 lines
      if (notFound !== undefined)
        return notFound;
    }
    throw new ModelError( `Unknown artifact reference: ${ typeof ref !== 'string' ? JSON.stringify(ref.ref) : ref }` );
  }

  function fromArtifactRef( ref ) {
    // do not cache while there is second param
    const art = artifactFromRef( ref );
    if (art)
      return art;
    throw new ModelError( `Unknown artifact reference: ${ typeof ref !== 'string' ? JSON.stringify(ref.ref) : ref }` );
  }

  function artifactPathRef( ref ) {
    const [ head, ...tail ] = ref.ref;
    let art = initDefinition( pathId( head ) );
    for (const elem of tail) {
      const env = navigationEnv( art );
      art = env.elements[pathId( elem )];
    }
    return art;
  }

  function artifactFromRef( ref, noLast ) {
    const [ head, ...tail ] = ref.ref;
    let art = initDefinition( pathId( head ) );
    for (const elem of tail) {
      const env = navigationEnv( art );
      art = env.elements[pathId( elem )];
    }
    if (noLast)                 // TODO: delete that param
      return art;
    return navigationEnv( art );
  }

  // Return target when resolving references in 'keys'
  function assocTarget( art, refCtx ) {
    // Call contexts:
    // 1. normal definition of association with explicit foreign keys
    // 2. auto-redirected association with renaming of foreign keys
    //    (currently: `keys` always available on inherited associations)
    // 3. user-induced redirection (in 'cast') with explicit foreign keys
    // 4. original provided association def inside $origin with explicit foreign keys
    //    (outside $origin like 2)
    const targetName = refCtx !== 'keys_origin' && art.target ||
                    art.$origin && art.$origin.target ||
                    art.cast.target;
    return initDefinition( targetName );
  }

  function getOrigin( art ) {
    return cached( art, '_origin', getOriginRaw );
  }

  function getOriginRaw( art ) {
    if (art.type) {               // TODO: make robust against "linked" = only direct
      return (art.type !== '$self' || csn.definitions.$self)
        ? artifactRef( art.type, BUILTIN_TYPE )
        : getCache( boundActionOrMain( art ), '_parent' );
    }
    if (typeof art.$origin === 'object') // null, […], {…}
      return getOriginExplicit( art.$origin );

    const parent = getCache( art, '_parent' );
    if (parent === undefined && universalReady) {
      const { $location } = art;
      const location = $location &&
            (typeof $location === 'string' ? $location : locationString( $location ));
      const def = Object.keys( art ).join('+') + (location ? `:${ location }` : '');
      throw new CompilerAssertion( `Inspecting non-initialized CSN node {${ def }}` );
    }
    const step = getCache( art, '$origin$step' );
    if (!step)
      return null;
    const origin = cached( parent, '_origin', getOriginRaw );
    return originNavigation( origin, step );
  }

  function getOriginExplicit( $origin ) { // null, […], {…}
    if (!$origin)
      return null;
    if (!Array.isArray( $origin )) // anonymous prototype in $origin
      return getOriginExplicit( $origin.$origin );
    const [ head, ...tail ] = $origin;
    // if (!main) throw Error(JSON.stringify({$origin,csn}))
    const main = initDefinition( head );
    return tail.reduce( originNavigation, main );
  }

  function originNavigation( art, step ) {
    if (!step)
      return null;
    if (!effectiveType( art ))
      throw new ModelError( 'Cyclic type definition' );
    if (typeof step === 'string')
      return navigationEnv( art, true ).elements[step];

    if (step.action)
      return effectiveArtFor( art, 'actions' )[step.action];
    if (step.param)
      return effectiveArtFor( art, 'params' )[step.param];
    if (step.returns)
      return effectiveArtFor( art, 'returns' );
    if (step.enum)
      return navigationEnv( art, true ).enum[step.enum];
    if (step.items)
      return effectiveType( art ).items;
    if (step.target)
      return targetAspect( effectiveType( art ) );
    throw new CompilerAssertion( `Illegal navigation step ${ Object.keys(step)[0] }` );
  }

  function effectiveArtFor( art, property ) {
    while (!art[property])
      art = getOrigin( art );
    return art[property];
  }

  function boundActionOrMain( art ) {
    while (art.kind !== 'action' && art.kind !== 'function') {
      const p = getCache( art, '_parent' );
      if (!p)
        return art;
      art = p;
    }
    return art;
  }

  function queryForElements( query ) {
    return query && cache.get( query.projection || query );
  }

  function initDefinition( main ) {
    const name = typeof main === 'string' && main;
    if (name) {
      main = csn.definitions[name];
      setCache( main, '$name', name );
    }
    // TODO: some --test-mode check that the argument is in ‹csn›.definitions ?
    if (!main || getCache( main, '$queries' ) !== undefined) // already computed
      return main;
    traverseDef( main, null, null, null, initNode );
    const queries = cached( main, '$queries', allQueries );
    for (const qcache of queries || []) {
      const { _select } = qcache;
      const { elements } = _select;
      if (elements) {
        for (const n of Object.keys( elements ))
          traverseDef( elements[n], _select, 'element', n, initNode );
      }
      if (_select.mixin) {
        for (const n of Object.keys( _select.mixin ))
          setCache( _select.mixin[n], '_parent', _select ); // relevant initNode() part
      }
    }
    return main;
  }

  function initNode( art, parent, kind, name ) {
    setCache( art, '_parent', parent );
    if (art.keys)
      setCache(art, '_keys', getKeysDict( art ));
    if (kind === 'target') {
      // Prevent re-initialization of anonymous aspect with initDefinition():
      // (that would be with parent: null which would be wrong)
      setCache( art, '$queries', null );
      return;
    }
    if (art.type || !kind)      // with type, top-level, query or mixin
      return;
    const { $origin } = art;
    if (typeof $origin === 'object') // null, […], {…}
      return;
    const step = $origin || name;
    if (parent.$origin ||
        parent.type && kind !== 'enum' && parent.$origin !== null ||
        getCache( parent, '$origin$step' ))
      setCache( art, '$origin$step', (kind === 'element' ? step : { [kind]: step }) );
  }

  function dropDefinitionCache( main ) {
    const queries = getCache( main, '$queries' );
    if (!queries)               // not yet initialized
      return;
    if (!cache.delete( main ))  // not yet initialized
      return;
    for (const qcache of queries || []) {
      const { _select } = qcache;
      for (const n of Object.keys( _select.mixin || {} ))
        cache.delete( _select.mixin[n] );
      dropColumnsCache( _select.columns );
      traverseDef( _select, null, null, null, a => cache.delete( a ) ); // elements
    }
    traverseDef( main, null, null, null, a => cache.delete( a ) );
  }

  function dropColumnsCache( select ) {
    if (!select)
      return;
    for (const col of select.columns || select.expand || select.inline || []) {
      dropColumnsCache( col );
      cache.delete( select );
    }
  }

  /**
   * @param {CSN.Path} csnPath
   *
   * - return value `art`: the “resulting” CSN node of the reference
   *
   * - return value `links`: array of { art, env } in length of ref.path where
   *   art = the definition or element reached by the ref path so far
   *   env = the “navigation environment” provided by `art`
   *         (not set for last item, except for `from` reference or with filter)
   *
   * - return value `scope`
   *   global: first item is name of definition
   *   param:  first item is parameter of definition (with param: true)
   *   parent: first item is elem of parent (definition or outer elem)
   *   target: first item is elem in target (for keys of assocs)
   *   $magic: magic variable (path starts with $magic, see also $self)
   *   $self:  first item is $self or $projection
   *   // now values only in queries:
   *   mixin:  first item is mixin
   *   alias:  first item is table alias
   *   source: first item is element in a source of the current query
   *   query:  first item is element of current query
   *   ref-target: first item is element of target of outer ref item
   *           (used for filter condition)
   *   expand: ref is "path continuation" of a ref with EXPAND
   *   inline: ref is "path continuation" of a ref with INLINE
   *
   * - return value `$env` is set with certain values of `scope`:
   *   with 'alias': the query number _n_ (the _n_th SELECT)
   *   with 'source': the table alias name for the source entity
   */
  function inspectRef( csnPath ) {
    return analyseCsnPath( csnPath, csn, resolveRef );
  }

  function resolveRef( ref, refCtx, main, query, parent, baseEnv ) {
    const path = (typeof ref === 'string') ? [ ref ] : ref.ref;
    if (!Array.isArray( path ))
      throw new ModelError( 'References must look like {ref:[...]}' );
    if (main)                   // TODO: improve, for csnpath starting with art
      initDefinition( main );

    const head = pathId( path[0] );
    if (ref.param) {
      const boundOrMain = (query || !main.actions || parent === main)
        ? main               // shortcut (would also have been return by function)
        : boundActionOrMain( parent );
      return resolvePath( path, boundOrMain.params[head], boundOrMain, 'param' );
    }
    const semantics = referenceSemantics[refCtx] || {};
    if (semantics.$initOnly)
      return undefined;
    if (semantics.dynamic === 'global' || ref.global)
      return resolvePath( path, csn.definitions[head], null, 'global', semantics.assoc );


    const qcache = query && cache.get( query.projection || query );
    // first the lexical scopes (due to query hierarchy) and $magic: ---------
    if (semantics.lexical !== false) {
      const tryAlias = path.length > 1 || ref.expand || ref.inline;
      let ncache = qcache && (semantics.lexical ? semantics.lexical( qcache ) : qcache);
      while (ncache) {
        const alias = tryAlias && ncache.$aliases[head];
        if (alias) {
          return resolvePath( path, alias._select || alias._ref, null,
                              'alias', ncache.$queryNumber );
        }
        const mixin = ncache._select.mixin?.[head];
        if (mixin && {}.hasOwnProperty.call( ncache._select.mixin, head )) {
          setCache( mixin, '_parent', qcache._select );
          return resolvePath( path, mixin, null, 'mixin', ncache.$queryNumber );
        }
        ncache = ncache.$next;
      }
      if (head.charAt(0) === '$') {
        if (head !== '$self' && head !== '$projection')
          return { scope: '$magic' };
        const self = qcache && qcache.$queryNumber > 1 ? qcache._select : main;
        return resolvePath( path, self, null, '$self' );
      }
    }
    // now the dynamic environment: ------------------------------------------
    if (semantics.dynamic !== false) {
      if (semantics.dynamic === 'target') { // ref in keys
        const target = assocTarget( parent, refCtx );
        return resolvePath( path, target.elements[head], target, 'target' );
      }
      if (baseEnv) {               // ref-target (filter condition), expand, inline
        if (semantics.dynamic !== 'query')
          return resolvePath( path, baseEnv.elements[head], baseEnv, semantics.dynamic );
        // in an ON condition of an association inside inner expand/inline:
        const elemParent = getCache( parent, '_element' );
        if (elemParent)         // expand in expand
          return resolvePath( path, elemParent.elements[head], null, 'query' );
      }
      if (!query) {                // outside queries - TODO: items?
        let art = parent.elements?.[head];
        if (parent.keys) {
          const keysDict = getCache( parent, '_keys' );
          art = keysDict[head];
        } // Ref to up_ in anonymous aspect
        else if (!art && head === 'up_') {
          const up = getCache( parent, '_parent' );
          const target = up && typeof up.target === 'string' && csn.definitions[up.target];
          if (target && target.elements) {
            initDefinition( up.target );
            art = target.elements.up_;
          }
        }
        return resolvePath( path, art, parent, 'parent' );
      }

      if (!qcache)
        throw new CompilerAssertion( `Query not in cache at: ${ locationString(query.$location) }` );

      if (semantics.dynamic === 'query') {
        // TODO: for ON condition in expand, would need to use cached _element
        // TODO: test and implement - Issue #11792!
        return resolvePath( path, qcache.elements[head], null, 'query' );
      }
      for (const name in qcache.$aliases) {
        const alias = qcache.$aliases[name];
        const found = alias.elements[head];
        if (found)
          return resolvePath( path, found, alias._ref, 'source', name );
      }
    }
    // console.log(query.SELECT,qcache,qcache.$next,main)
    throw new ModelError( `Path item 0=${ head } refers to nothing, refCtx: ${ refCtx }` );
  }

  /**
   * @param {CSN.Path} path
   * @param {CSN.Artifact} art
   * @param {CSN.Artifact} parent
   * @param {string} [scope]
   * @param [extraInfo]
   */
  function resolvePath( path, art, parent, scope, extraInfo ) {
    if (!art && path.length > 1) {
      // TODO: For path.length===1, it may be that `art` is undefined, e.g. for CSN paths such
      //       as `[…, 'on', 1]` where the path segment refers to `=`.
      // TODO: Check the call-side.
      const loc = locationString(parent?.$location);
      throw new ModelError(`Path item 0='${ pathId(path[0]) }' refers to nothing; in ${ loc }; path=${ JSON.stringify(path) }`);
    }
    const staticAssoc = extraInfo === 'static' && scope === 'global';
    /** @type {{idx, art?, env?}[]} */
    const links = path.map( (_v, idx) => ({ idx }) );
    // TODO: backends should be changed to enable uncommenting:
    // if (!art)    // does not work with test3/Associations/KeylessManagedAssociation/
    //   throw new ModelError( `Path item 0=${ pathId( path[0] )
    //       } refers to nothing, scope: ${ scope }`);
    links[0].art = art;
    for (let i = 1; i < links.length; ++i) { // yes, starting at 1, links[0] is set above
      parent = navigationEnv( art, staticAssoc );
      links[i - 1].env = parent;
      if (typeof path[i - 1] !== 'string')
        setCache( path[i - 1], '_env', parent );
      if (!parent.elements)
        throw new ModelError( `${ parent.from ? 'Query ' : '' }elements not available: ${ Object.keys( parent ).join('+') }`);
      art = parent.elements[pathId( path[i] )];
      if (!art) {
        const { env } = links[i - 1];
        const loc = env.name && env.name.$location || env.$location;
        throw new ModelError( `Path item ${ i }=${ pathId( path[i] ) } refers to nothing; in ${ locationString( loc ) }; path=${ JSON.stringify(path) }` );
      }
      links[i].art = art;
    }
    const last = path[path.length - 1];
    const fromRef = scope === 'global' && extraInfo === 'target';
    if (fromRef || typeof last !== 'string') {
      const env = navigationEnv( art );
      links[links.length - 1].env = env;
      if (fromRef) {
        art = env;
        parent = null;
      }
      if (typeof last !== 'string')
        setCache( last, '_env', env );
    }
    return (extraInfo && scope !== 'global')
      ? {
        links, art, parent, scope, $env: extraInfo,
      }
      : {
        links, art, parent, scope,
      };
  }

  /**
   * Return [ Location, SemanticLocation ] from `csnPath`.
   */
  function msgLocations( csnPath ) {
    let location = csn?.$location;
    const artifact = new SemanticLocation();
    /** @type object */
    let obj = csn;
    let index = 0;
    let inlinePathIndex = null;
    if (typeof csnPath[0] === 'object')
      startPath( csnPath[0] );

    /* eslint-disable no-return-assign */
    const pathFunctions = {
      definitions: name => absolute( name, 'type' ),
      vocabularies: name => absolute( name, 'annotation' ),
      extensions,
      projection,
      SELECT: projection,
      // TODO: alias
      mixin: name => nameInProp( name, 'mixin' ),
      actions: name => nameInProp( name, 'action' ),
      params: name => nameInProp( name, 'param' ),
      returns: () => (artifact.param = ''),
      elements: name => elements( name, artifact.select == null ? null : 'element' ),
      columns: elements,
      expand: elements,
      inline: elements,
      keys: pos => elements( pos, 'key' ),
      enum: name => elements( name, 'enum' ),
      item: () => (artifact.innerKind = 'item'),
      // targetAspect: () => (artifact.innerKind = 'aspect')
      '@': suffix,
    }; /* eslint-enable no-return-assign */

    while (obj && index < csnPath.length) {
      const step = csnPath[index++];
      obj = obj[step];
      const fn = pathFunctions[step] || pathFunctions[step.charAt( 0 )];
      if (fn)
        fn( csnPath[index] );
      if (obj?.$location)
        location = obj.$location;
    }
    return [ location, artifact ];

    function startPath( art ) {
      const parent = getCache( art, '_parent' );
      if (parent) {
        if (!art.SELECT && !art.projection)
          throw new CompilerAssertion( 'CSN path starts with object other than def or query' );
      }
      obj = csn.definitions;
      absolute( getCache( parent || art, '$name' ), 'type' );
      obj = art;
      location = art.$location || parent?.$location || csn.$location;
    }

    function absolute( name, defaultKind ) {
      obj = obj[name];
      artifact.mainKind = obj.kind || defaultKind;
      artifact.absolute = name;
      ++index;
    }
    function extensions( pos ) {
      obj = obj[pos];
      artifact.mainKind = obj.annotate ? 'annotate' : 'extend';
      artifact.absolute = obj.annotate || obj.extend;
      ++index;
    }
    function projection() {
      let select = getCache( obj, '$queryNumber' );
      if (select === 1) {
        const parent = getCache( obj, '_parent' );
        if (parent && getCache( parent, '$queries' )?.length === 1)
          select = 0;
      }
      artifact.select = select;
    }
    function nameInProp( name, prop ) {
      obj = obj[name];
      artifact[prop] = name;
      ++index;
    }
    function elements( name, kind ) {
      obj = obj[name];
      const elem = (typeof name === 'string') ? name : !obj.inline && columnAlias( obj );
      if (obj.inline) {         // inline
        inlinePathIndex ??= artifact.element.length;
      }
      else if (inlinePathIndex != null) { // inline before: remove inline col indexes
        if (elem)
          artifact.element.length = inlinePathIndex;
        inlinePathIndex = null;
      }
      artifact.element.push( elem || name + 1);
      artifact.innerKind = kind || undefined;
      ++index;
    }
    function suffix( prop ) {
      artifact.suffix = prop;
      obj = null;               // stop
    }
  }
  /**
   * Get the array of all (sub-)queries (value of the `SELECT`/`projection`
   * property) inside the given `main` artifact (of `main.query`).
   *
   * @param {CSN.Definition} main
   * @returns {CSN.Query[]}
   */
  function allQueries( main ) {
    const all = [];
    const projection = main.query || main.projection && main;
    if (!projection)
      return null;
    traverseQuery( projection, null, null, function memorize( query, fromSelect, parentQuery ) {
      if (query.ref) {          // ref in from
        // console.log('SQ:',query,cache.get(query))
        const as = query.as || implicitAs( query.ref );
        const _ref = cached( query, '_from', artifactFromRef );
        getCache( fromSelect, '$aliases' )[as] = { _ref, elements: _ref.elements, _parent: query };
      }
      else {
        const qcache = getQueryCache( parentQuery );
        if (query !== main)
          cache.set( query, qcache );

        if (fromSelect) {
          const $queryNumber = all.length + 1;
          const alias = query.as || `$_select_${ $queryNumber }__`;
          getCache(fromSelect, '$aliases')[alias] = qcache;
        }

        const select = query.SELECT || query.projection;
        if (select) {
          cache.set( select, qcache ); // query and query.SELECT have the same cache qcache
          qcache._select = select;
          qcache._parent = main;
          all.push( qcache );
        }
      }
    } );
    all.forEach( function initElements( qcache, index ) {
      qcache._parent = main;
      qcache.$queryNumber = index + 1;
      const { elements } = (index ? qcache._select : main);
      qcache.elements = elements;
      const { columns } = qcache._select;
      if (elements && columns)
        columns.map( (col, colIndex) => initColumnElement( col, colIndex, qcache ) );
      else if (columns && !elements)
        throw new ModelError( `Query elements not available: ${ Object.keys( (index ? qcache._select : main) ).join('+') }`);
    } );
    return all;
  }

  /**
   * Return the cache object for a new query.
   * Might re-use cache object with the `parentQuery`, or use `parentQuery`
   * for link to next lexical environment.
   */

  function getQueryCache( parentQuery ) {
    if (!parentQuery)
      return { $aliases: Object.create(null) };
    const pcache = cache.get( parentQuery.projection || parentQuery );
    if (!parentQuery.SET)       // SELECT / projection: real sub query
      return { $aliases: Object.create(null), $next: pcache };
    // the parent query is a SET: that is not a sub query
    // (works, as no sub queries are allowed in ORDER BY)
    return (!pcache._select)    // no leading query yet
      ? pcache                  // share cache with parent query
      : { $aliases: Object.create(null), $next: pcache.$next };
  }

  function initColumnElement( col, colIndex, parentElementOrQueryCache, externalElements ) {
    if (col === '*')
      return;
    if (col.inline) {
      col.inline.map( c => initColumnElement( c, null, parentElementOrQueryCache, externalElements ) );
      return;
    }
    setCache( col, '_parent',   // not set for query (has property _select)
              !parentElementOrQueryCache._select && parentElementOrQueryCache );
    let as = columnAlias( col );
    if (!as && colIndex !== null)
      as = `$_column_${ colIndex + 1 }`;
    setCache( col, '$as', as );
    let type = parentElementOrQueryCache;
    if (col.cast)
      traverseType( col.cast, col, 'column', colIndex, initNode );

    while (type.items)
      type = type.items;
    if (!type.elements) {
      // in OData backend, the sub elements from a column with expand might have
      // been “externalized” into a named type.  No backward _column link is
      // possible this way, of course...
      type = artifactRef( type.type );
      externalElements = true;
    }
    const elem = setCache( col, '_element', type.elements[as] );
    if (elem && !externalElements) // TODO to.sql: something is strange if `elem` is not set
      setCache( elem, '_column', col );
    if (col.expand)
      col.expand.map( c => initColumnElement( c, null, elem, externalElements ) );
  }

  // property name convention in cache:
  // - $name: to other cache object (with proto), dictionary (w/o proto), or scalar
  // - _name, name: to CSN object value (_name) or dictionary (name)

  function setCache( obj, prop, val ) {
    let hidden = cache.get( obj );
    if (!hidden) {
      hidden = {};
      cache.set( obj, hidden );
    }
    // TODO: we might keep the following with --test-mode
    // if (hidden[prop] !== undefined) {
    //   console.log('RS:',prop,hidden[prop],val,obj)
    //   throw Error('RESET')
    // }
    hidden[prop] = val;
    return val;
  }

  function getCache( obj, prop ) {
    const hidden = cache.get( obj );
    return hidden && hidden[prop];
  }

  function cached( obj, prop, calc ) {
    let hidden = cache.get( obj );
    if (!hidden) {
      hidden = {};
      cache.set( obj, hidden );
    }
    else if (hidden[prop] !== undefined) {
      return hidden[prop];
    }
    const val = calc( obj );
    hidden[prop] = val;
    return val;
  }
}

/**
 * Foreign keys are stored in an array; for easier name resolution, create
 * a dictionary of them.
 */
function getKeysDict( art ) {
  const dict = Object.create(null);
  for (const key of art.keys)
    dict[key.as || implicitAs( key.ref )] = key;
  return dict;
}

/**
 * Return value of a query SELECT for the query node, or the main artifact,
 * i.e. a value with an `elements` property.
 * TODO: only used in forRelationalDB - move somewhere else
 *
 * @param {object} query node (object with SET or SELECT property)
 * @param {object} main definition
 */
function queryOrMain( query, main ) {
  while (query.SET)
    query = query.SET.args[0];
  if (query.SELECT && query.SELECT.elements)
    return query.SELECT;
  let leading = main.query || main;
  while (leading.SET)
    leading = leading.SET.args[0];
  // If an entity has both a projection and query property, the param `query`
  // can be the entity itself (when inspect is called with a csnPath containing
  // 'projection'), but `leading` can be its `query` property:
  if ((leading === query || leading === query.query) && main.elements)
    return main;
  throw new ModelError( `Query elements not available: ${ Object.keys( query ).join('+') }`);
}

/**
 * Traverse query in pre-order
 *
 * The callback is called on the following XSN nodes inside the query `query`:
 * - a query node, which has property `SET` or `SELECT` (or `projection`),
 * - a query source node inside `from` if it has property `ref`,
 * - NOT on a `join` node inside `from`.
 *
 * @param {CSN.Query} query
 * @param {CSN.QuerySelect} fromSelect for query in `from`
 * @param {CSN.Query} parentQuery for a sub query (ex those in `from`)
 * @param {(query: CSN.Query&CSN.QueryFrom, select: CSN.QuerySelectEnriched, parentQuery: CSN.Query) => void} callback
 */
function traverseQuery( query, fromSelect, parentQuery, callback ) {
  const select = query.SELECT || query.projection;
  if (select) {
    callback( query, fromSelect, parentQuery );
    traverseFrom( select.from, select, parentQuery, callback );
    for (const prop of [ 'columns', 'where', 'having' ]) {
      // all properties which can have sub queries (`join-on` also can)
      const expr = select[prop];
      if (expr)
        expr.forEach( q => traverseExpr( q, query, callback ) );
    }
  }
  else if (query.SET) {
    callback( query, fromSelect, parentQuery );
    const { args } = query.SET;
    for (const q of args || [])
      traverseQuery( q, null, query, callback );
  }
}

/**
 * @param {CSN.QueryFrom} from
 * @param {CSN.QuerySelect} fromSelect
 * @param {CSN.Query} parentQuery
 * @param {(from: CSN.QueryFrom, select: CSN.QuerySelect, parentQuery: CSN.Query) => void} callback
 */
function traverseFrom( from, fromSelect, parentQuery, callback ) {
  if (from.ref) {
    callback( from, fromSelect, parentQuery );
  }
  else if (from.args) {         // join
    from.args.forEach( arg => traverseFrom( arg, fromSelect, parentQuery, callback ) );
    if (from.on)                // join-on, potentially having a sub query (in xpr)
      from.on.forEach(arg => traverseExpr( arg, fromSelect, callback ));
  }
  else {                        // sub query in FROM
    traverseQuery( from, fromSelect, parentQuery, callback );
  }
}

function traverseExpr( expr, parentQuery, callback ) {
  if (expr.SELECT || expr.SET)
    traverseQuery( expr, null, parentQuery, callback );
  for (const prop of [ 'args', 'xpr' ]) {
    // all properties which could have sub queries (directly or indirectly),
    const val = expr[prop];
    if (val && typeof val === 'object') {
      const args = Array.isArray( val ) ? val : Object.values( val );
      args.forEach( e => traverseExpr( e, parentQuery, callback ) );
    }
  }
}

function traverseDef( node, parent, kind, name, callback ) {
  callback( node, parent, kind, name );
  if (node.params) {
    for (const n of Object.keys( node.params ))
      traverseType( node.params[n], node, 'param', n, callback );
  }
  if (node.returns)
    traverseType( node.returns, node, 'returns', true, callback );
  traverseType( node, true, kind, name, callback );
  if (node.actions) {
    for (const n of Object.keys( node.actions ))
      traverseDef( node.actions[n], node, 'action', n, callback );
  }
}

function traverseType( node, parent, kind, name, callback ) {
  if (parent !== true)
    callback( node, parent, kind, name );
  const target = targetAspect( node );
  if (target && typeof target === 'object' && target.elements) {
    callback( target, node, 'target', true );
    node = target;
  }
  else if (node.items) {
    let items = 0;
    while (node.items) {
      callback( node.items, node, 'items', ++items );
      node = node.items;
    }
  }
  if (node.elements) {
    for (const n of Object.keys( node.elements ))
      traverseDef( node.elements[n], node, 'element', n, callback );
  }
  if (node.enum) {
    for (const n of Object.keys( node.enum ))
      traverseDef( node.enum[n], node, 'enum', n, callback );
  }
}

function targetAspect( art ) {
  const { $origin } = art;
  return art.targetAspect ||
    $origin && typeof $origin === 'object' && !Array.isArray( $origin ) && $origin.target ||
    art.target;
}

function pathId( item ) {
  return (typeof item === 'string') ? item : item.id;
}

function implicitAs( ref ) {
  if (typeof ref !== 'string')
    ref = ref[ref.length - 1];
  const id = (typeof ref === 'string') ? ref : ref.id; // inlined `pathId`
  return id.substring( id.lastIndexOf('.') + 1 );
}

function startCsnPath( csnPath, csn ) {
  const head = csnPath[0];
  if (typeof head !== 'string') {
    const {
      main, parent, art, query,
    } = head;
    return {
      index: 1, main, parent, art, query,
    };
  }
  if (csnPath.length < 2 || head !== 'definitions' && head !== 'vocabularies')
    throw new CompilerAssertion( 'References outside definitions and vocabularies not supported yet' );
  const art = csn[head][csnPath[1]];
  return {
    index: 2, main: art, parent: art, art, query: null,
  };
}


/**
 * @param {CSN.Path} csnPath
 * @param {CSN.Model} csn
 * @param {any} resolve
 */
function analyseCsnPath( csnPath, csn, resolve ) {
  /** @type {any} */
  let refCtx = null;
  /** @type {boolean|string|number} */
  let isName = false;
  let baseRef = null;
  let baseCtx = null;
  let baseEnv = null;
  let {
    index, main, parent, art, query,
  } = startCsnPath( csnPath, csn );
  let obj = art;

  for (; index < csnPath.length; index++) {
    if (!obj && !resolve)
      // For the semantic location, use current object as best guess
      break;

    const prop = csnPath[index];
    if (refCtx === 'annotation' && typeof obj === 'object') {
      // we do not know yet whether the annotation value is an expression or not →
      // loop over outer array and records (structure values):
      if (Array.isArray( obj ) || !isAnnotationExpression( obj )) {
        obj = obj[prop];
        continue;
      }
      refCtx = 'annotationExpr';
    }
    // array item, name/index of artifact/member, (named) argument
    if (isName || Array.isArray( obj ) || prop === 'returns') {
      // TODO: call some kind of resolve.setOrigin()
      if (isName === 'actions') {
        art = obj[prop];
        parent = art;   // param refs in annos for actions are based on the action, not the entity
      }
      else if (typeof isName === 'string' || prop === 'returns') {
        parent = art;
        art = obj[prop];
      }
      else if (refCtx === 'orderBy') {
        const isSelect = isSelectQuery( query );
        // use _query_ elements with direct refs (consider sub-optimal CSN,
        // representation of the CAST function), otherwise source elements:
        if (obj[prop].ref && !obj[prop].cast)
          refCtx = (isSelect ? 'orderBy_ref' : 'orderBy_set_ref');
        else
          refCtx = (isSelect ? 'orderBy_expr' : 'orderBy_set_expr');
      }
      isName = false;
    }
    else if (artifactProperties.includes( String(prop) )) {
      if (refCtx === 'target' || refCtx === 'targetAspect') { // with 'elements'
        // $self refers to the anonymous aspect
        if (resolve)
          resolve( '', '$init', main );
        main = obj;
        art = obj;
        parent = obj;
      }
      isName = prop;
      // if we want to allow auto-redirect of user-provided target with renamed keys:
      // (TODO: no, we do not allow that anymore)
      refCtx = (refCtx === '$origin' && prop === 'keys') ? 'keys_origin' : prop;
    }
    else if (prop === 'items' || prop === 'returns') {
      art = obj[prop];
    }
    else if (prop === 'args') {
      isName = true;            // for named arguments
    }
    else if (prop === 'SELECT' || prop === 'SET' || prop === 'projection') {
      query = obj;
      parent = null;
      baseEnv = null;
      refCtx = prop;
    }
    else if (prop === 'where' && refCtx === 'ref') {
      if (resolve)
        baseEnv = resolve.ref_where( obj, baseRef, baseCtx, main, query, parent, baseEnv );
      refCtx = 'ref_where';
    }
    else if (prop === 'expand' || prop === 'inline') {
      if (obj.ref) {
        if (resolve)
          baseEnv = resolve.expandInline( obj, baseCtx, main, query, parent, baseEnv );
        refCtx = prop;
      }
      isName = prop;
    }
    else if (prop === 'on') {
      if (refCtx === 'from')
        refCtx = 'on_join';
      else if (refCtx === 'mixin')
        refCtx = 'on_mixin';
      else
        refCtx = 'on';          // will use query elements with REDIRECTED TO
    }
    else if (prop === 'ref') {
      baseRef = obj;            // needs to be inspected for filter conditions
      baseCtx = refCtx;
      refCtx = prop;
    }
    else if (prop === 'orderBy') {
      refCtx = 'orderBy';
    }
    else if (prop[0] === '@') {
      refCtx = 'annotation';
    }
    else if (prop !== 'xpr' && prop !== 'list') {
      // 'xpr' and 'list' do not change the ref context, all other props do:
      refCtx = prop;
    }
    obj = obj[prop];
  }
  // console.log( 'CPATH:', csnPath, refCtx, obj, parent.$location );
  if (!resolve)
    return { query };           // for constructSemanticLocationFromCsnPath
  return resolve( obj, refCtx, main, query, parent, baseEnv );
}

// A SELECT which is (unnecessarily) put into parentheses, the CSN
// representation uses SET without `op` and args of length 1:
function isSelectQuery( query ) {
  while (query.SET) {
    const { args } = query.SET;
    if (args.length !== 1)
      return false;
    query = args[0];
  }
  return true;
}

/**
 * Alias is either explicit or implicit from reference or function without arguments.
 * If the column is an expression without explicit alias, `false` is returned.
 * Use csnRefs.getColumnName() instead.
 *
 * @returns {string}
 */
function columnAlias( col ) {
  return col.as || (!col.args && col.func) || (col.ref && implicitAs( col.ref ));
}

module.exports = {
  csnRefs,
  traverseQuery,
  artifactProperties,
  implicitAs,
  getKeysDict,
  analyseCsnPath,
  pathId,
  columnAlias,
};
