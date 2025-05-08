// Simple compiler utility functions

// This file contains small utility functions which do not access the complete
// XSN or functions instantiated using the XSN.

// Please do not add functions “for completeness”, this is not an API file for
// others but only by the core compiler.

// TODO: split this file into utils/….js, add some functions from lib/base/model.js

'use strict';

const { dictAdd, pushToDict, dictFirst } = require('../base/dictionaries');
const { Location, weakLocation } = require('../base/location');
const { XsnName, XsnArtifact } = require('./xsn-model');

const $inferred = Symbol.for( 'cds.$inferred' );

// for links, i.e., properties starting with an underscore '_':

function pushLink( obj, prop, value ) {
  const p = obj[prop];
  if (p)
    p.push( value );
  else
    Object.defineProperty( obj, prop, { value: [ value ], configurable: true, writable: true } );
}

// for annotations:

function annotationVal( anno ) {
  // XSN TODO: set val but no location for anno short form
  return anno && (anno.val === undefined || anno.val);
}
function annotationIsFalse( anno ) {                   // falsy, but not null (unset)
  return anno && (anno.val === false || anno.val === 0 || anno.val === '');
}
function annotationHasEllipsis( anno ) {
  const { val } = anno || {};
  return Array.isArray( val ) && val.find( v => v.literal === 'token' && v.val === '...' );
}
function annotationLocation( anno ) {
  const { name, location } = anno;
  return {
    file: name.location.file,
    line: name.location.line,
    col: name.location.col,
    endLine: location.endLine,
    endCol: location.endCol,
  };
}

/**
 * Set compiler-calculated annotation value.
 *
 * @param {XSN.Artifact} art
 * @param {string} anno
 * @param {XSN.Location} [location]
 * @param {*} [val]
 * @param {string} [literal]
 */
function setAnnotation( art, anno, location = art.location, val = true, literal = 'boolean' ) {
  if (art[anno])  // do not overwrite user-defined including null
    return;
  art[anno] = {
    name: { path: [ { id: anno.slice(1), location } ], location },
    val,
    literal,
    $inferred: '$generated',
    location,
  };
}

// Do not share this function with CSN processors!

// The link (_artifact,_effectiveType,...) usually has the artifact as value.
// Falsy values are:
// - undefined: not computed yet, parse error (TODO: null), no ref
// - null: ref to unknown, param:true if that is not allowed (TODO: false)
// - false (only complete ref): multiple definitions, rejected
// - 0 (for _effectiveType only): circular reference
// - '' (for _origin only): no origin provided
function setLink( obj, prop, value ) {
  Object.defineProperty( obj, prop, { value, configurable: true, writable: true } );
  return value;
}
// And a variant with the most common `prop`:
function setArtifactLink( obj, value ) {
  Object.defineProperty( obj, '_artifact', { value, configurable: true, writable: true } );
  return value;
}

function linkToOrigin( origin, name, parent, prop, location, silentDep ) {
  // TODO: should `key` propagation be part of this?
  location ||= weakLocation( origin.name.location ); // not ??=
  const elem = {
    name: { location, id: origin.name.id },
    kind: origin.kind,
    location,
  };
  if (origin.name.$inferred)
    elem.name.$inferred = origin.name.$inferred;
  if (parent)
    setMemberParent( elem, name, parent, prop ); // TODO: redef in template
  setLink( elem, '_origin', origin );
  // TODO: should we use silent dependencies also for other things, like
  // included elements?  (Currently for $inferred: 'expanded' only)
  // TODO: shouldn't we always use silent dependencies in this function?
  if (silentDep)
    dependsOnSilent( elem, origin );
  else
    dependsOn( elem, origin, location );
  return elem;
}

function proxyCopyMembers( art, dictProp, originDict, location, kind, tmpDeprecated ) {
  art[dictProp] = Object.create( null );
  // TODO: set $inferred ? for dict?
  for (const name in originDict) {
    const origin = originDict[name];
    if (origin !== undefined) {
      const member = linkToOrigin( origin, name, art, dictProp,
                                   location || origin.location, true );
      member.$inferred = 'expanded';
      // TODO throughout the compiler: do not set art.‹prop›.$inferred if art.$inferred
      if (kind)
        member.kind = kind;
      else if (origin.key && !tmpDeprecated)
        // TODO(v6): remove tmpDeprecated once `_noKeyPropagationWithExpansions` is removed
        member.key = Object.assign( { $inferred: 'expanded' }, origin.key );
      if (kind && origin.masked)  // TODO: remove!
        member.masked = Object.assign( { $inferred: 'nav' }, origin.masked );
    }
  }
}

/**
 * Set the member `elem` to have a _parent link to `parent` and a corresponding
 * _main link.  Also set the member's name accordingly, where argument `name`
 * is most often the property `elem.name.id`.
 *
 * If argument `prop` is provided, add `elem` to the dictionary of that name,
 * e.g. `elements`.
*/
function setMemberParent( elem, name, parent, prop ) {
  if (prop) {              // extension or structure include
    // TODO: consider nested ARRAY OF and RETURNS, COMPOSITION OF type
    const p = parent.items || parent.targetAspect || parent;
    if (p[prop] === undefined)
      p[prop] = Object.create( null );
    dictAdd( p[prop], name, elem );
  }
  if (parent._outer && parent._outer.items) // TODO: remove for items, too
    parent = parent._outer;
  setLink( elem, '_parent', parent );
  setLink( elem, '_main', parent._main || parent );
}

function createAndLinkCalcDepElement( elem ) {
  const r = { kind: '$calculation' }; // no name, like /items
  elem.$calcDepElement = r;
  setLink( r, '_outer', elem );
}

/**
 * Adds a dependency user -> art with the given location.
 *
 * @param {XSN.Artifact} user
 * @param {XSN.Artifact} art
 * @param {XSN.Location} location
 * @param {XSN.Artifact} [semanticLoc]
 */
function dependsOn( user, art, location, semanticLoc = undefined ) {
  while (user._outer && !user.kind)
    user = user._outer;
  if (!user._deps)
    setLink( user, '_deps', [] );
  user._deps.push( { art, location, semanticLoc } );
}

/**
 * Same as "dependsOn" but the dependency from user -> art is silent,
 * i.e. not reported to the user.
 *
 * @param {XSN.Artifact} user
 * @param {XSN.Artifact} art
 */
function dependsOnSilent( user, art ) {
  while (user._outer && !user.kind)
    user = user._outer;
  if (!user._deps)
    setLink( user, '_deps', [] );
  user._deps.push( { art } );
}

function storeExtension( elem, name, prop, parent, block ) {
  if (prop === 'enum')
    prop = 'elements';
  setLink( elem, '_block', block );
  const kind = `_${ elem.kind }`; // _extend or _annotate
  if (!parent[kind])
    setLink( parent, kind, {} );
  // if (name === '' && prop === 'params') {
  //   pushToDict( parent[kind], 'returns', elem ); // not really a dict
  //   return;
  // }
  if (!parent[kind][prop])
    parent[kind][prop] = Object.create( null );
  pushToDict( parent[kind][prop], name, elem );
}

/** @type {(a: any, b: any) => boolean} */
const testFunctionPlaceholder = () => true;

/**
 * Return path step if the path navigates along an association whose final type
 * satisfies function `test`; "navigates along" = last path item not considered
 * without truthy optional argument `alsoTestLast`.
 */
function withAssociation( ref, test = testFunctionPlaceholder, alsoTestLast = false ) {
  for (const item of ref.path || []) {
    const art = item && item._artifact; // item can be null with parse error
    if (art && art._effectiveType && art._effectiveType.target && test( art._effectiveType, item ))
      return (alsoTestLast || item !== ref.path[ref.path.length - 1]) && item;
  }
  return false;
}

/**
 * Return string 'A.B.C' for parsed source `A.B.C` (is vector of ids with
 * locations).
 *
 * @param {XSN.Path} path
 */
function pathName( path ) {
  return (path && !path.broken) ? path.map( id => id.id ).join( '.' ) : '';
}

/**
 * Generates an XSN path out of the given name. Path segments are delimited by a dot.
 * Each segment will have the given location assigned.
 *
 * @param {CSN.Location} location
 * @param {string} name
 * @returns {XSN.Path}
 */
function splitIntoPath( location, name ) {
  return name.split( '.' ).map( id => ({ id, location }) );
}

/**
 * @param {CSN.Location} location
 * @param  {...any} args
 */
function augmentPath( location, ...args ) {
  return { path: args.map( id => ({ id, location }) ), location };
}

function copyExpr( expr, location ) {
  if (!expr || typeof expr !== 'object')
    return expr;
  else if (Array.isArray( expr ))
    return expr.map( e => copyExpr( e, location ) );

  const proto = Object.getPrototypeOf( expr );
  if (proto && proto !== Object.prototype && proto !== XsnName.prototype &&
      // do not copy object from special classes outside the compiler domain&&
      proto !== XsnArtifact.prototype && proto !== Location.prototype)
    return expr;
  const r = Object.create( proto );
  for (const prop of Object.getOwnPropertyNames( expr )) {
    const pd = Object.getOwnPropertyDescriptor( expr, prop );
    if (!proto)
      r[prop] = copyExpr( pd.value, location );

    else if (!pd.enumerable || prop.charAt(0) === '$')
      Object.defineProperty( r, prop, pd );

    else if (prop === 'location')
      r[prop] = location || pd.value;

    else
      r[prop] = copyExpr( pd.value, location );
  }
  return r;
}

function testExpr( expr, pathTest, queryTest, user ) {
  // TODO: also check path arguments/filters
  if (!expr || typeof expr === 'string') { // parse error or keywords in {xpr:...}
    return false;
  }
  else if (Array.isArray( expr )) {
    return expr.some( e => testExpr( e, pathTest, queryTest, user ) );
  }
  else if (expr.path) {
    return pathTest( expr, user );
  }
  else if (expr.query) {
    return queryTest( expr.query, user );
  }
  else if (expr.op && expr.args) {
    // unnamed args => array
    if (Array.isArray( expr.args ))
      return expr.args.some( e => testExpr( e, pathTest, queryTest, user ) );
    // named args => dictionary
    for (const namedArg of Object.keys( expr.args )) {
      if (testExpr( expr.args[namedArg], pathTest, queryTest, user ))
        return true;
    }
  }
  return false;
}

// Return true if the path `item` with a final type `assoc` has a max target
// cardinality greater than one - either specified on the path item or assoc type.
function targetMaxNotOne( assoc, item ) {
  // Semantics of associations without provided cardinality: [*,0..1]
  const cardinality = item.cardinality || assoc.cardinality;
  return cardinality && cardinality.targetMax && cardinality.targetMax.val !== 1;
}

/**
 * Call function `callback(art)` for each user-defined main artifact and member
 * `art` of the model reachable from the dictionary `model[prop]`.  User-defined
 * artifacts are those with no or a falsy `art.$inferred` value, i.e. this
 * function is useful for checks.
 *
 * The callback function is not called on the following artifacts:
 * - `enum` symbol definitions (use forEachUserDict() yourself if needed)
 * - the anonymous aspect in the `target`/`targetAspect` property (but the
 *   callback function is called on its elements).
 * - table aliases
 *
 * The callback function is also called on duplicates.  For example, if there are
 * two entities named `E`, the callback function is called on both.
 * It is also called on columns with `inline`.
 *
 * See also function forEachDefinition(), currently in lib/base/model.js.
 */
function forEachUserArtifact( model, prop, callback ) { // not enums
  forEachUserDict( model, prop, function main( art ) {
    callback( art );
    forEachUserDict( art, 'params', function param( par ) {
      callback( par );
      forEachUserElementAndFKey( par, callback );
    } );
    if (art.$queries) {
      for (const query of art.$queries) {
        callback( query );
        forEachUserDict( query, 'mixin', callback );
        forEachUserElementAndFKey( query, callback );
        if (query.$inlines)     // e.g. not with `entity V as projection on V;`
          query.$inlines.forEach( callback );
      }
    }
    else if (art.returns) {
      callback( art.returns );
      forEachUserElementAndFKey( art.returns, callback );
    }
    else {
      forEachUserElementAndFKey( art, callback );
    }
    forEachUserArtifact( art, 'actions', callback );
  } );
}

/**
 * Call function `callback(art)` for each user-defined element and foreign key
 * reachable from artifact `art`.  Do not (again) call the callback function on
 * `art` itself, even if it is an element.
 *
 * Consider that we have (nested) `array of`/`many` types, but do not call the
 * callback function on the array item itself (only on elements inside).
 */
function forEachUserElementAndFKey( art, callback ) {
  while (art.items)
    art = art.items;
  if (art.target) {
    forEachUserDict( art, 'foreignKeys', callback );
    return;
  }
  if (art.targetAspect)
    art = art.targetAspect;
  forEachUserDict( art, 'elements', function element( elem ) {
    callback( elem );
    forEachUserElementAndFKey( elem, callback );
  } );
}

function forEachUserDict( art, prop, callback ) {
  const dict = art[prop];
  if (!dict || dict[$inferred])
    return;
  for (const name in dict) {
    const obj = dict[name];
    if (obj.$inferred)
      continue;
    callback( obj, name, prop );
    if (Array.isArray( obj.$duplicates )) // redefinitions
      obj.$duplicates.forEach( o => callback( o, name, prop ) );
  }
}

/**
 * Call `callback( expr, exprCtx, query )` on all direct expressions `expr` of
 * `query`, where `exprCtx` is the expression context used as key for the
 * `referenceSemantics` in shared.js.
 *
 * Indirect expressions are not called, these are:
 * - the `from` reference (expression of the table alias)
 * - the ON-condition of mixins (expression of the mixin)
 * - the expressions in columns (expression of the column/element)
 */
function forEachQueryExpr( query, callback ) { // see resolveQuery()
  forEachJoinOn( query, query.from, callback );
  // TODO: run over $inlines ?
  if (query.where)
    callback( query.where, 'where', query );
  if (query.groupBy)
    forEachExprArray( query, query.groupBy, 'groupBy', 'groupBy', callback );
  if (query.having)
    callback( query.having, 'having', query );
  if (query.$orderBy)
    forEachExprArray( query, query.$orderBy, 'orderBy-set-ref', 'orderBy-set-expr', callback );
  if (query.orderBy)
    forEachExprArray( query, query.orderBy, 'orderBy-ref', 'orderBy-expr', callback );
}

function forEachJoinOn( query, from, callback ) {
  if (!from?.join)
    return;                     // TODO: run over from.path here?
  for (const tab of from.args)
    forEachJoinOn( query, tab, callback );
  if (from.on)
    callback( from.on, 'join-on', query );
}

function forEachExprArray( query, array, refContext, exprContext, callback ) {
  for (const expr of array) {
    if (expr)
      callback( expr, (expr.path ? refContext : exprContext), query );
  }
}

// Query tree post-order traversal - called for everything which contributes to the query
// i.e. is necessary to calculate the elements of the query
// except "real ones": operands of UNION etc, JOIN with ON, and sub queries in FROM
// NOTE: does not run on non-referred sub queries!  Consider using ‹main›.$queries instead!
function traverseQueryPost( query, simpleOnly, callback ) {
  if (!query)                   // parser error
    return;
  if (!query.op) {              // in FROM (not JOIN)
    if (query.query)            // subquery
      traverseQueryPost( query.query, simpleOnly, callback );
    return;
  }
  if (simpleOnly) {
    const { from } = query;
    if (!from || from.join)     // parse error or join
      return;                   // ok are: path or simple sub query (!)
  }
  if (query.from) {             // SELECT
    traverseQueryPost( query.from, simpleOnly, callback );
    // console.log('FC:')
    callback( query );
    // console.log('FE:')
  }
  else if (query.args) {             // JOIN, UNION, INTERSECT
    if (!query.join && simpleOnly == null) {
      // enough for elements: traverse only first args for UNION/INTERSECT
      // TODO: we might use this also when we do not rewrite associations
      // in non-referred sub queries
      traverseQueryPost( query.args[0], simpleOnly, callback );
    }
    else {
      for (const q of query.args)
        traverseQueryPost( q, simpleOnly, callback );
      // The ON condition has to be traversed extra, because it must be evaluated
      // after the complete FROM has been traversed.  It is also not necessary to
      // evaluate it in populateQuery().
    }
  }
  // else: with parse error (`select from <EOF>`, `select distinct from;`)
}

// Call callback on all queries in dependency order, i.e. starting with query Q
// 1. sub queries in FROM sources of Q
// 2. Q itself, except if non-referred query, but with right UNION parts
// 3. sub queries in ON in FROM of Q
// 4. sub queries in columns, WHERE, HAVING
function traverseQueryExtra( main, callback ) {
  if (!main.$queries)
    return;
  // with a top-level UNION, $queries[0] is just the left
  traverseQueryPost( main.query, false, (q) => { // also with right of UNION (to be compatible)
    setLink( q, '_status', 'extra' );
    callback( q );
  } );
  for (const query of main.$queries.slice(1)) {
    if (query._status === 'extra' || query._parent.kind === '$tableAlias')
      continue; // if parent is alias, query is FROM source -> run by traverseQueryPost
    // we are now in the top-level (parent is entity) or a non-referred query (parent is query)
    setLink( query, '_status', 'extra' ); // do not call callback() in non-referred query
    // console.log( 'A:', query.name,query._status)
    traverseQueryPost( query, null, (q) => {
      if (q._status !== 'extra') {
        // console.log( 'T:', q.name)
        setLink( q, '_status', 'extra' );
        callback( q );
      }
      // else console.log( 'E:', q.name)
    } );
  }
}

/**
 * Returns what was available at view._from[0] before:
 * (think first whether to really use this function)
 */
function viewFromPrimary( view ) {
  let query = view.$queries?.[0];
  while (query?._origin?.kind === 'select') // sub query in from
    query = query._origin;
  return dictFirst( query?.$tableAliases );
}

/**
 * About Helper property $expand for faster the XSN-to-CSN transformation
 * - null/undefined: artifact, member, items does not contain expanded members
 * - 'origin': all expanded (sub) elements have no new target/on and no new annotations
 *             that value is only on elements, types, and params -> no other members
 *             when set, only on elem/art with expanded elements
 * - 'target': all expanded (sub) elements might only have new target/on, but
 *             no individual annotations on any (sub) member
 *             when set, traverse all parents where the value has been 'origin' before
 * - 'annotate': at least one inferred (sub) member has an individual annotation,
 *               not counting propagated ones; set up to the definition (main artifact)
 *               (only set with anno on $inferred elem), annotate “beats” target
 * Usage according to CSN flavor:
 * - gensrc: do not render inferred elements (including expanded elements),
 *           collect annotate statements with value 'annotate'
 * - client: do not render expanded sub elements if artifact/member is no type, has a type,
 *           has $expand = 'origin', and all its _origin also have $expand = 'origin'
 *           (might sometimes render the elements unnecessarily, which is not wrong)
 * - universal: do not render expanded sub elements if $expand = 'origin'
 */
function setExpandStatus( elem, status ) {
  // set on element
  while (elem._main) {
    elem = elem._parent;
    if (status === 'annotate' ? elem.$expand === 'annotate' : elem.$expand !== 'origin')
      return;
    elem.$expand = status;    // meaning: expanded, containing assocs
    for (let line = elem.items; line; line = line.items)
      line.$expand = status; // to-csn just uses the innermost $expand
  }
}

function setExpandStatusAnnotate( elem, status ) {
  for (;;) {
    if (elem.$expand === status)
      return;                 // already set
    elem.$expand = status;    // meaning: expanded, containing annos
    for (let line = elem.items; line; line = line.items)
      line.$expand = status; // to-csn just uses the innermost $expand
    if (!elem._main)
      return;
    elem = elem._parent;
  }
}

function isDirectComposition( art ) {
  const path = art.type?.path;
  return path?.length === 1 && path[0].id === 'cds.Composition';
}

function targetCantBeAspect( elem, calledForTargetAspectProp ) {
  // Remark: we do not check `on` and `keys` here - the error should complain
  // at the `on`/`keys`, not the aspect
  if (!isDirectComposition( elem ) || elem.targetAspect && !calledForTargetAspectProp)
    return (elem.type && !elem.type.$inferred) ? 'std' : 'redirected';
  if (!elem._main)
    return elem.kind;           // type or annotation
  // TODO: extra for "in many"?
  let art = elem;
  while (art.kind === 'element')
    art = art._parent;
  if (![ 'entity', 'aspect', 'event' ].includes( art.kind ))
    return (art.kind !== 'mixin') ? art.kind : 'select';
  return ((art.query || art.kind === 'event') && !(calledForTargetAspectProp && elem.target))
    ? art.kind
    : elem._parent.kind === 'element' && 'sub';
}

function userQuery( user ) {
  // TODO: we need _query links set by the definer
  while (user._main) {
    if (user.kind === 'select' || user.kind === '$join')
      return user;
    user = user._parent;
  }
  return null;
}

function userParam( user ) {
  while (user._main) {
    if (user.kind === 'param')
      return user;
    user = user._parent;
  }
  return null;
}

function pathStartsWithSelf( ref ) {
  const head = ref && !ref.scope && ref.path?.[0];
  if (head?._navigation?.kind === '$self')
    return true;
  if (head?._artifact?.kind === 'builtin') // CDS variable
    return false;
  return undefined;
}

function columnRefStartsWithSelf( col ) {
  for (; col; col = col._columnParent) {
    const ref = col.value;
    const head = ref && !ref.scope && ref.path?.[0];
    if (head?._navigation?.kind === '$self')
      return true;
    if (head?._artifact?.kind === 'builtin') // CDS variable
      return false;
  }
  return false;
}

/**
 * Remark: this function is based on an early check that no target element is
 * covered more than once by a foreign key: then…
 * we only need to check that all foreign key references are primary keys and
 * that the number of foreign and primary keys are the same.
 */
function isAssocToPrimaryKeys( assoc ) {
  let keyCount = 0;
  const { foreignKeys } = assoc;
  if (!foreignKeys)
    return undefined;
  for (const name in foreignKeys) {
    const fk = foreignKeys[name];
    const elem = fk.targetElement._artifact;
    if (!elem || fk.$duplicates)
      return undefined;
    if (!elem.key?.val)
      return false;
    ++keyCount;
  }

  const elements = assoc.target._artifact?.elements;
  if (!elements)
    return undefined;
  for (const name in elements) {
    if (elements[name].key?.val)
      --keyCount;
  }
  return keyCount === 0;
}

// only if _effectiveType has been computed:
function getUnderlyingBuiltinType( art ) {
  while (art?._effectiveType && !art.builtin)
    art = art._origin || art.type?._artifact;
  return art;
}

function definedViaCdl( art ) {
  // return !!art._block?.artifacts;
  // TODO: the above code would work when _block links are correctly set on
  // members of duplicate extensions, see test3/Extensions/DuplicateExtend/.  The
  // following is a workaround to make at least ref to builtins work:
  const { $frontend } = art._block || art;
  return $frontend !== 'json' && $frontend !== '$internal';
}

// For error messages: ----------------------------------------------------------

// (To be) used for the location in error messages
function artifactRefLocation( ref ) {
  return (ref._artifact?._main)
    ? ref.path[ref.path.length - 1].location
    : ref.location;
}

function compositionTextVariant( art, composition, association = 'std' ) {
  const builtin = getUnderlyingBuiltinType( art );
  return (!builtin._main && builtin.name.id === 'cds.Composition')
    ? composition
    : association;
}

module.exports = {
  pushLink,
  annotationVal,
  annotationIsFalse,
  annotationHasEllipsis,
  annotationLocation,
  setAnnotation,
  setLink,
  setArtifactLink,
  linkToOrigin,
  proxyCopyMembers,
  dependsOn,
  dependsOnSilent,
  setMemberParent,
  createAndLinkCalcDepElement,
  storeExtension,
  withAssociation,
  pathName,
  augmentPath,
  splitIntoPath,
  copyExpr,
  testExpr,
  targetMaxNotOne,
  forEachUserArtifact,
  forEachQueryExpr,
  traverseQueryPost,
  traverseQueryExtra,
  viewFromPrimary,
  setExpandStatus,
  setExpandStatusAnnotate,
  isDirectComposition,
  targetCantBeAspect,
  userQuery,
  userParam,
  pathStartsWithSelf,
  columnRefStartsWithSelf,
  isAssocToPrimaryKeys,
  getUnderlyingBuiltinType,
  definedViaCdl,
  artifactRefLocation,
  compositionTextVariant,
};
