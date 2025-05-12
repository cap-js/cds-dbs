// For testing: reveal non-enumerable properties in CSN, display result of csnRefs

// Running `cdsc -E`, short for `cdsc --enrich-csn` displays additional
// information within the CSN, which might be useful for testing.

// An enumerable property `$location` appears in the JSON with the following value:

// * `File.cds:3:5` if the original CSN has a non-enumerable `$location` property
//   with value `{file: "File.cds", line: 3, col: 5}`.
// * `File.cds:3:5^` if the original CSN has _no_ `$location` property, for an
//   inferred member of a main artifact or member with `$location: `File.cds:3:5`;
//   the number of `^`s in the suffix is the member depth.

// Other enumerable properties in the JSON for non-enumerable properties in the
// original CSN:

// * `$parens`: the number of parentheses provided by the user around an expression
//   or query if the number is different to the usual (mostly 0, sometimes 1).
// * `$elements` (in client-style CSN only) for a non-enumerable `elements` property
//   for sub queries.

// The following properties in the JSON represent the result of the CSN API
// functions:

// * `_type`, `_includes` and `_targets` have as values the `$location`s of the
//   referred artifacts which are returned by function `artifactRef`.
// * `_links` and `_art` as sibling properties of `ref` have as values the
//   `$locations` of the artifacts/members returned by function `inspectRef` (`_art`
//   for ref in `from` only, where it is different to the last item of `_links`).
// * `_scope` and `_env` as sibling properties of `ref` have (string) values,
//   returned by function `inspectRef`, giving add/ info about the “ref base”.
// * `_origin` (in Universal CSN only) has as value the `$location` of the
//   prototype returned by function getOrigin().
// * `_test.inspect.csnpath` as sibling property of `ref` has an object value
//   with properties `_links` and `_scope` of a further `inspectRef` call;
//   it is only called, with `[‹art›, ...‹csnpath›]` as argument, if `‹art›`,
//   which is the referred artifact returned by the first `inspectRef` call,
//   has an annotation `@$test.inspect.csnpath` with array value `‹csnpath›`.

'use strict';

const { csnRefs, artifactProperties } = require('./csnRefs');
const { locationString } = require('../base/location');
const { CompilerAssertion } = require('../base/error');
const { isAnnotationExpression } = require('../base/builtins');
const shuffleGen = require('../base/shuffle');

function enrichCsn( csn, options = {} ) {
  const transformers = {
    elements: dictionary,
    definitions: dictionary,
    actions: dictionary,
    params: dictionary,
    enum: dictionary,
    mixin: dictionary,
    returns: definition,
    items: definition,
    ref: pathRef,
    type: simpleRef,
    targetAspect: simpleRef,
    target: simpleRef,
    includes: simpleRef,
    $origin,
    // TODO: excluding
    '@': assignment,
    $: () => { /* ignore properties like $location for performance */ },
  };
  // options.enrichCsn = 'DEBUG';
  let $$cacheObjectNumber = 0;   // for debugging
  const debugLocationInfo = options.enrichCsn === 'DEBUG' && Object.create(null);
  const special$self = !csn.definitions.$self && '$self';

  setLocations( csn, false, null );
  const {
    inspectRef,
    artifactRef,
    getOrigin,
    initDefinition,
    // eslint-disable-next-line camelcase
    __getCache_forEnrichCsnDebugging,
  } = csnRefs( csn, true );
  const { shuffleArray } = shuffleGen( options.testMode );

  const csnPath = [];
  if (csn.definitions)
    dictionary( csn, 'definitions', csn.definitions );
  if (csn.$location)
    reveal( csn, '$location', locationString( csn.$location ) );
  if (csn.$sources)
    reveal( csn, '$sources', csn.$sources );
  return csn;

  function standard( parent, prop, obj ) {
    if (!obj || typeof obj !== 'object' || !{}.propertyIsEnumerable.call( parent, prop ))
      return;

    csnPath.push( prop );
    if (Array.isArray(obj)) {
      obj.forEach( (n, i) => standard( obj, i, n ) );
    }
    else {
      // no shuffle here; we would need to sort the new properties otherwise
      for (const name of Object.getOwnPropertyNames( obj ) ) {
        const trans = transformers[name] || transformers[name.charAt(0)] || standard;
        trans( obj, name, obj[name] );
      }
      if (obj.$parens)
        reveal( obj, '$parens', obj.$parens );
      _cacheDebug( obj );
    }
    csnPath.pop();
  }

  function definition( parent, prop, obj ) {
    // call getOrigin() before standard() to set implicit protos inside standard():
    const origin = handleError( err => (err ? err.toString() : getOrigin( obj )) );
    standard( parent, prop, obj );
    if (obj.$origin === undefined && !obj.type && origin != null)
      obj._origin = refLocation( origin );
  }

  function dictionary( parent, prop, dict ) {
    if (!dict)                  // value null for inheritance interruption
      return;
    csnPath.push( prop );
    for (const name of shuffleArray( Object.getOwnPropertyNames( dict ) )) {
      if (prop === 'definitions')
        initDefinition( dict[name] );
      definition( dict, name, dict[name] );
    }
    if (!Object.prototype.propertyIsEnumerable.call( parent, prop ))
      parent[`$${ prop }`] = dict; // for $elements of sub queries in client-CSN
    csnPath.pop();
  }

  function assignment( parent, prop, obj ) {
    if (!obj || typeof obj !== 'object' || !{}.propertyIsEnumerable.call( parent, prop ))
      return;

    csnPath.push( prop );
    if (Array.isArray(obj)) {
      obj.forEach( (n, i) => assignment( obj, i, n ) );
    }
    else {
      const record = !isAnnotationExpression( obj ) && assignment;
      // is record without `=` and other expression property
      for (const name of Object.getOwnPropertyNames( obj ) ) {
        const trans = record || transformers[name] || transformers[name.charAt(0)] || standard;
        trans( obj, name, obj[name] );
      }
      if (!record && obj.$parens)
        reveal( obj, '$parens', obj.$parens );
    }
    csnPath.pop();
  }

  function refLocation( art ) {
    if (!art || typeof art !== 'object' || Array.isArray( art )) {
      if (catchRefError()) {
        return (typeof art === 'string')
          ? `<illegal ref = ${ art }>`
          : `<illegal ref: ${ typeof art }>`;
      }
      throw new CompilerAssertion( 'Illegal reference' );
    }
    else if (art.$location) {
      return art.$location;
    }

    if (catchRefError())
      return `<${ Object.keys( art ).join('+') }+!$location>`;
    throw new CompilerAssertion( 'Reference to object without $location' );
  }

  function simpleRef( parent, prop, ref ) {
    // try {
    const notFound = (catchRefError()) ? null : undefined;
    if (Array.isArray( ref )) {
      parent[`_${ prop }`] = ref.map( r => refLocation( artifactRef( r, notFound ) ) );
    }
    else if (typeof ref === 'string') {
      if (!ref.startsWith( 'cds.') && ref !== special$self)
        parent[`_${ prop }`] = refLocation( artifactRef( ref, notFound ) );
    }
    else if (!ref.elements) {
      parent[`_${ prop }`] = refLocation( artifactRef( ref, notFound ) );
    }
    else {                      // targetAspect, target
      csnPath.push( prop );
      dictionary( ref, 'elements', ref.elements );
      _cacheDebug( ref );
      csnPath.pop();
    }
    // } catch (e) {
    //   parent['_' + prop] = e.toString(); }
  }

  function $origin( parent, prop, ref ) {
    handleError( (err) => {
      if (err)
        parent._origin = err.toString();
      else if (Array.isArray( ref ) || typeof ref === 'string') // $origin: […] / "short-ref"
        parent._origin = refLocation( getOrigin( parent ) );
      else if ( ref )                                           // $origin: {…}
        standard( parent, prop, ref );
    } );
  }

  function pathRef( parent, prop, path, inspectionPath = csnPath ) {
    const inspection = handleError( err => ((err)
      ? { scope: err.toString() }
      : inspectRef( inspectionPath )));
    const {
      links, art, scope, $env,
    } = inspection;
    if (links)
      parent._links = links.map( l => refLocation( l.art ) );
    if (links && links[links.length - 1].art !== art)
      parent._art = refLocation( art );
    parent._scope = scope;
    if ($env)
      parent._env = $env;

    if (!prop)                  // recursive call for @$test.inspect.csnpath
      return;
    const testPath = art && art['@$test.inspect.csnpath'];
    if (testPath && parent.ref) {
      const further = {};
      pathRef( further, null, null, [ inspection, ...testPath ] );
      parent['_test.inspect.csnpath'] = further;
    }

    csnPath.push( prop );
    path.forEach( function step( s, i ) { // no shuffle, need index
      if (s && typeof s === 'object') {
        csnPath.push( i );
        if (s.args)
          standard( s, 'args', s.args );
        if (s.where)
          standard( s, 'where', s.where );
        csnPath.pop();
      }
    } );
    csnPath.pop();
  }

  function handleError( callback ) {
    if (!catchRefError())
      return callback();
    try {
      return callback();
    }
    catch (err) {
      return callback( err );
    }
  }

  function _cacheDebug( obj, subCache ) {
    if (options.enrichCsn !== 'DEBUG')
      return;
    const cache = subCache || __getCache_forEnrichCsnDebugging( obj );
    if (!cache)
      return;
    if (cache.$$objectNumber > 0) {
      obj.$$cacheObjectNumber = cache.$$objectNumber;
    }
    else {
      cache.$$objectNumber = (cache.$$objectNumber)
        ? -cache.$$objectNumber
        : ++$$cacheObjectNumber;
      obj.$$cacheObject = {};
      for (const name of Object.keys( cache )) {
        const val = cache[name];
        if (val === null || typeof val !== 'object') {
          obj.$$cacheObject[name] = val;
        }
        else if (name[0] === '_') {
          // _‹name›: link to CSN node, usually with kind & location
          obj.$$cacheObject[name]
            = (val.$location) ? locationString( val.$location ) : 'CSN node';
        }
        else if (name[0] !== '$' || !Object.getPrototypeOf( val )) {
          // ‹name›: dictionary of CSN nodes,
          // ‹$name›: dictionary of cache values if no prototype
          if (name !== '$aliases') {
            obj.$$cacheObject[name] = Object.keys( val ); // TODO: or dict?
          }
          else {
            const sub = Object.create(null);
            for (const n in val) {
              const alias = val[n];
              const c = {};
              _cacheDebug( c, alias );
              sub[n] = c.$$cacheObject;
            }
            obj.$$cacheObject[name] = sub;
          }
        }
        else if (name === '$origin$step') { // string value handled above
          const kind = Object.keys( val )[0];
          obj.$$cacheObject[name] = `${ kind }: ${ val[kind] }`;
        }
        else if (Array.isArray( val )) {
          // eslint-disable-next-line no-loop-func
          obj.$$cacheObject[name] = val.map( (item) => {
            if (!item.$$objectNumber)
              item.$$objectNumber = -(++$$cacheObjectNumber);
            return item.$$objectNumber;
          } );
        }
        else {
          if (!val.$$objectNumber)
            val.$$objectNumber = -(++$$cacheObjectNumber);
          obj.$$cacheObject[name] = val.$$objectNumber || -(++$$cacheObjectNumber);
        }
      }
    }
  }

  function debugLocation( loc, userProvided ) {
    if (debugLocationInfo && !userProvided) {
      loc = loc.replace( /\(\d+\)\^/, '^' );
      debugLocationInfo[loc] = (debugLocationInfo[loc] || 0) + 1;
      loc = `${ loc }(${ debugLocationInfo[loc] })`;
    }
    return loc;
  }

  function setLocations( node, prop, loc ) {
    if (!node || typeof node !== 'object')
      return;
    const isMember = artifactProperties.includes( prop );
    if (!isMember && node.$location) {
      if (typeof node.$location === 'string') // already set for nested 'items'
        return;
      loc = locationString( node.$location, true );
      if (!node.SELECT) // compatibility: $location of query both inside and as sibling of SELECT
        reveal( node, '$location', debugLocation( loc, !node.$generated ) );
    }
    else if (prop === true || prop === 'returns') { // in dictionary or returns
      loc = debugLocation( `${ loc }^` );
      node.$location = loc;
    }
    else if (prop === 'items') {
      let iloc = `${ loc }[]`;
      let obj = node;
      while (obj) {
        // should not appear in --enrich-csn, only for _origin info
        Object.defineProperty( obj, '$location', { value: iloc, enumerable: false } );
        obj = obj.items;
        iloc += '[]';
      }
    }
    if (Array.isArray( node )) {
      for (const item of node)
        setLocations( item, isMember, loc );
    }
    else {
      for (const name of Object.getOwnPropertyNames( node ))
        setLocations( node[name], isMember || name, loc );
    }
  }

  function catchRefError() {
    return !options.testMode || // false &&
      csnPath.some( p => typeof p === 'string' && p.charAt(0) === '@');
  }
}


function reveal( node, prop, value ) {
  Object.defineProperty( node, prop, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  } );
}

module.exports = enrichCsn;
