// Transform XSN (augmented CSN) into CSN

// The transformation works as follows: we transform a value in the XSN
// according to the following rules:
//
//  - if it is a non-object, return it directly
//  - if it is an array, return it with all items transformed recursively
//  - if it is another object, return it with all property values transformed
//    according to function `transformers.<prop>` or (if it does not exist)
//    recursively to the rule; properties with value `undefined` are deleted

'use strict';

const { locationString } = require('../base/messages');
const { isBetaEnabled } = require('../base/model');
const { pathName } = require('../compiler/utils');
const { CompilerAssertion } = require('../base/error');

const compilerVersion = require('../../package.json').version;
const creator = `CDS Compiler v${ compilerVersion }`;
const csnVersion = '2.0';

const normalizedKind = {
  param: 'param',
  action: 'action',
  function: 'action',
  enum: 'enum',
};

/** @type {boolean|string} */
let gensrcFlavor = true;       // good enough here...
let universalCsn = false;
let strictMode = false;        // whether to dump with unknown properties (in standard)
let withLocations = false;
let withDocComments = false;
let structXpr = false;
let dictionaryPrototype = null;

// Properties for dictionaries, set in compileX() and TODO: parseX(), must be
// stored with symbols as keys, as we do not want to disallow any key name:
const $inferred = Symbol.for('cds.$inferred');

// XSN $inferred values mapped to Universal CSN $generated values:
const inferredAsGenerated = {
  autoexposed: 'exposed',
  'localized-entity': 'localized',
  localized: 'localized',       // on elements (texts, localized, language)
  // remark: not on 'localize-origin' = other elements of inferred base entity
  'composition-entity': 'composed', // ('aspect-composition' on element not in CSN)
};

// IMPORTANT: the order of these properties determine the order of properties
// in the resulting CSN !!!  Also check const `csnPropertyNames`.
const transformers = {
  // early and modifiers (without null / not null) ---------------------------
  kind,
  id: n => n,                   // in path item
  doc: docComment,
  '@': anno,
  virtual: value,
  key: value,
  unique: value,
  masked: value,
  params,
  // early expression / query properties -------------------------------------
  op: o => ((o.val !== 'SELECT' && o.val !== '$query') ? o.val : undefined),
  from,                         // before elements!
  // join done in from()
  // func   // in expression()
  quantifier: ( q, csn ) => {
    csn[q.val] = true;
  },
  all: ignore,                  // XSN TODO use quantifier
  // type properties (without 'elements') ------------------------------------
  localized: value,
  type,
  $typeArgs: (node, csn, xsn) => {
    const typeArgs = xsn.$typeArgs;
    // One or two arguments are interpreted as either length or precision/scale.
    if (typeArgs?.length === 1) {
      csn.length = value(typeArgs[0]);
    }
    else if (typeArgs?.length === 2) {
      csn.precision = value(typeArgs[0]);
      csn.scale = value(typeArgs[1]);
    }
  },
  length: value,
  precision: value,
  scale: value,
  srid: value,
  cardinality,                 // also in pathItem: after 'id', before 'where'
  targetAspect,
  target,
  $enclosed: value,            // comp+filter since v5
  foreignKeys,
  enum: enumDict,
  items,
  includes: arrayOf( artifactRef ), // also entities
  // late expressions / query properties -------------------------------------
  mixin: insertOrderDict,       // only in queries with special handling
  columns,
  expand: ignore,               // do not list for select items as elements
  inline: ignore,               // do not list for select items as elements
  excludingDict,
  groupBy: arrayOf( expression ),
  where: condition,             // also pathItem after 'cardinality' before 'args'
  having: condition,
  args,                        // also pathItem after 'where', before 'on'/'orderBy'
  suffix: ignore,              // handled in exprInternal()
  orderBy: arrayOf( orderBy ), // TODO XSN: make `sort` and `nulls` sibling properties
  sort: value,
  nulls: value,
  limit: standard,
  rows: expression,
  offset: expression,
  on: onCondition,
  // definitions, extensions, members ----------------------------------------
  notNull: value,
  default: expression,
  targetElement,                // special display of foreign key
  value: enumValueOrCalc,       // do not list for select items as elements
  query,
  elements,
  actions: sortedDict,          // TODO: just normal dictionary
  returns,                      // storing the return type of actions
  // special: top-level, cardinality -----------------------------------------
  sources,
  definitions: sortedDict,
  vocabularies: sortedDict,
  extensions,                   // is array
  i18n,
  messages: ignore,
  options: ignore,
  sourceMin: renameTo( 'srcmin', value ),
  sourceMax: renameTo( 'src', value ),
  targetMin: renameTo( 'min', value ),
  targetMax: renameTo( 'max', value ),
  // late protected ----------------------------------------------------------
  name: ignore,             // as is provided extra (for select items, in FROM)
  $syntax: dollarSyntax,
  // location is not renamed to $location as the name is well established in
  // XSN and too many places (also outside the compiler) had to be adapted
  location,                     // non-enumerable $location in CSN
  $extra: (e, csn) => {
    Object.assign( csn, e );
  },
  // IGNORED -----------------------------------------------------------------
  artifacts: ignore,             // well-introduced, hence not $artifacts
  blocks: ignore,                // FIXME: make it $blocks
  builtin: ignore,               // XSN: $builtin, check: "cds" namespace exposed by transformers?
  origin: ignore,              // TODO remove (introduce non-enum _origin link)
  // $inferred is not renamed to $generated (likely name of a future CSN
  // property) as too many places (also outside the compiler) had to be adapted
  $: ignore,
  // '_' not here, as non-enumerable properties are not transformed anyway
  expectedKind: ignore, // TODO: may be set in extensions but is unused
};

// Dictionary mapping XSN property names to corresponding CSN property names
// which should appear at that place in order.
const csnPropertyNames = {
  virtual: [ 'abstract' ],      // abstract is compiler v1 CSN property
  kind: [ 'annotate', 'extend', '$origin' ], // TODO: $origin better at the end? see addOrigin()
  op: [ 'join', 'func', 'xpr' ],    // TODO: 'func','xpr' into 'quantifier'?  TODO: 'global'(scope)?
  quantifier: [
    'some', 'any', 'distinct',  // 'all' explicitly listed
    'ref',
    'param', 'val', 'literal', 'SELECT', 'SET',
  ],
  foreignKeys: [ 'keys' ],
  excludingDict: [ 'excluding' ],
  limit: [ 'rows' ],  // 'offset',
  query: [ 'projection' ],
  elements: [ '$elements' ],    // $elements for --enrich-csn
  sources: [ 'namespace', '$sources' ],
  sourceMin: [ 'srcmin' ],
  sourceMax: [ 'src' ],
  targetMin: [ 'min' ],
  targetMax: [ 'max' ],
  name: [ 'as', 'cast' ],
  location: [ '$env', '$location' ], // --enrich-csn
  expectedKind: [
    '_origin', '_type', '_targetAspect', '_target', '_includes', '_links', '_art', '_scope',
  ],                            // --enrich-csn
};

const propertyOrder = (function orderPositions() {
  const r = {};
  let i = 0;
  for (const n in transformers) {
    r[n] = ++i;
    for (const c of csnPropertyNames[n] || [])
      r[c] = ++i;
  }
  return r;
}());

// sync with definition in from-csn.js:
// Note: Order here is also the property order in CSN.
const typeProperties = [
  'target', 'elements', 'enum', 'items',
  'cardinality', // for association publishing in views
  'type', 'length', 'precision', 'scale', 'srid', 'localized', 'notNull',
  'foreignKeys', 'on',      // for explicit ON/keys with REDIRECTED
  '$typeArgs', // for unresolved type arguments, e.g. through parseCql
];
// Properties which cause a `cast` property to be rendered
const castProperties = [
  'target', 'enum', 'items', 'type',
];

const csnDictionaries = [
  'args', 'params', 'enum', 'mixin', 'elements', 'actions', 'definitions', 'vocabularies',
];
const csnDirectValues = [ 'val' ]; // + all starting with '@' - TODO: still relevant

/**
 * Compact the given XSN model and transform it into CSN.
 *
 * @param {XSN.Model} model
 * @param {CSN.Options} options
 * @returns {CSN.Model}
 */
function compactModel( model, options = model.options || {} ) {
  initModuleVars( options );
  const csn = {};
  const srcDict = model.sources || Object.create( null ); // not dictionaryPrototype!
  if (options.parseCdl) {                                 // TODO: make it a csnFlavor?
    const using = usings( srcDict );
    if (using.length)
      csn.requires = using;
  }
  // 'namespace' for complete model is 'namespace' of first source
  // (not a really useful property at all, avoids XSN inspection by Umbrella)
  for (const first in srcDict) {
    const { namespace } = srcDict[first];
    if (namespace?.name?.path)
      csn.namespace = pathName( namespace.name.path );
    break;
  }
  set( 'definitions', csn, model );
  if (Object.keys(model.vocabularies || {}).length > 0)
    set( 'vocabularies', csn, model );
  const exts = extensions( model.extensions || [], csn, model );
  if (exts && exts.length)
    csn.extensions = exts;
  set( 'i18n', csn, model );
  set( 'sources', csn, model );
  // Set $location, use $extra properties of first source as resulting $extra properties
  for (const first in srcDict) {
    const loc = srcDict[first].location;
    if (loc && loc.file) {
      Object.defineProperty( csn, '$location', {
        value: { file: loc.file }, configurable: true, writable: true, enumerable: withLocations,
      } );
    }
    set( '$extra', csn, srcDict[first] );
    break;
  }

  if (!options.testMode) {
    csn.meta = Object.assign( {}, model.meta, { creator } );
    csn.$version = csnVersion;
  }
  return csn;
}

function renameTo( csnProp, func ) {
  return function renamed( val, csn, node, prop ) {
    const sub = func( val, csn, node, prop );
    if (sub !== undefined)
      csn[csnProp] = sub;
  };
}

function arrayOf( func ) {
  return ( val, ...nodes ) => val.map( v => func( v, ...nodes ) );
}

/**
 * Create a CSN `requires` array of dependencies.
 *
 * @param {object} srcDict Dictionary of source files to their AST/XSN.
 */
function usings( srcDict ) {
  const sourceNames = Object.keys(srcDict);
  if (sourceNames.length === 0)
    return [];

  // Take the first file as parseCdl should only receive one file.
  const source = srcDict[sourceNames[0]];
  const requires = [];
  if (source && source.dependencies)
    source.dependencies.map(dep => dep && requires.push(dep.val));

  // Make unique and sort
  return Array.from(new Set(requires)).sort();
}

/**
 * @param {XSN.Extension[]} node
 * @param {object} csn
 * @param {object} model
 */
function extensions( node, csn, model ) {
  if (model.kind && model.kind !== 'source')
    return undefined;
  const exts = node.map( definition );
  if (gensrcFlavor) {
    for (const name of Object.getOwnPropertyNames( model.definitions || {} ).sort()) {
      const art = model.definitions[name];
      // From definitions (without redefinitions) with potential inferred elements:
      const result = { annotate: Object.create(null) };
      attachAnnotations( result, 'annotate', { [name]: art }, art.$inferred );
      if (result.annotate[name])
        exts.push( { annotate: name, ...result.annotate[name] } );
    }
  }
  return exts.sort(             // TODO: really sort with parse.cdl?
    (a, b) => (a.annotate || a.extend).localeCompare( b.annotate || b.extend )
  );
}

/**
 * @param {XSN.i18n} i18nNode
 * @returns {CSN.i18n}
 */
function i18n( i18nNode ) {
  const csn = Object.create( dictionaryPrototype );
  for (const langKey in i18nNode) {
    const langDict = i18nNode[langKey];
    if (!csn[langKey])
      csn[langKey] = Object.create( dictionaryPrototype );
    for (const textKey in langDict)
      csn[langKey][textKey] = langDict[textKey].val;
  }
  return csn;
}

function sources( srcDict, csn, model ) {
  let names = model._sources || Object.keys( srcDict );
  const $sources = names.length && srcDict[names[0]].$sources;
  if ($sources) {
    setHidden( csn, '$sources', normalize$sources( $sources ) );
    return undefined;
  }
  if (model._sortedSources)
    names = model._sortedSources.map( s => s.realname );
  names = (!strictMode) ? names : normalize$sources( names.map( relativeName ) );
  setHidden( csn, '$sources', names );
  return undefined;

  function relativeName( name ) {
    const loc = srcDict[name].location;
    return loc && loc.file || name;
  }
  function normalize$sources( src ) {
    return strictMode
      ? src.map( name => locationString( name, true ) )
      : src;
  }
}

function attachAnnotations( annotate, prop, dict, inferred, insideReturns = false ) {
  const annoDict = Object.create( dictionaryPrototype );
  const names = Object.keys( dict );
  if (strictMode)
    names.sort();
  for (const name of names) {
    const entry = dict[name];
    const inf = inferred || entry.$inferred; // is probably always inferred if parent was
    const sub = (inf) ? annotationsAndDocComment( entry ) : {};
    if (entry.$expand === 'annotate') {
      if (entry.actions)
        attachAnnotations( sub, 'actions', entry.actions, inf );
      else if (entry.params)
        attachAnnotations( sub, 'params', entry.params, inf );
      const obj = entry.returns || entry;
      const many = obj.items || obj;
      const elems = (many.targetAspect || many).elements;
      if (elems)
        attachAnnotations( sub, 'elements', elems, inf, entry.returns );
      else if (many.enum)       // make 'enum' annotations appear in 'elements' annotate
        attachAnnotations( sub, 'elements', many.enum, inf, entry.returns );
      else if (entry.foreignKeys) // make 'foreignKeys' annotations appear in 'elements' annotate
        attachAnnotations( sub, 'elements', entry.foreignKeys, inf );
    }
    if (Object.keys( sub ).length)
      annoDict[name] = sub;
  }
  if (Object.keys( annoDict ).length) {
    if (insideReturns)
      annotate.returns = { elements: annoDict };
    else
      annotate[prop] = annoDict;
  }
}

function standard( node ) {
  if (node.$inferred && gensrcFlavor)
    return undefined;
  if (Array.isArray(node))
    return node.map( standard );
  const csn = {};
  // To avoid another object copy, we sort according to the prop names in the
  // XSN input node, not the CSN result node.  Not really an issue...
  const keys = Object.keys( node ).sort( compareProperties );
  for (const prop of keys) {
    if (node[prop] !== undefined) {
      const transformer = transformers[prop] || transformers[prop.charAt(0)] || unexpected;
      const sub = transformer( node[prop], csn, node, prop );
      if (sub !== undefined)
        csn[prop] = sub;
    }
  }
  return csn;
}

function unexpected( val, csn, node, prop ) {
  if (strictMode) {
    const loc = val && val.location || node.location;
    throw new CompilerAssertion( `Unexpected property ${ prop } in ${ locationString(loc) }` );
  }
  // otherwise, just ignore the unexpected property
}

function set( prop, csn, node ) {
  const val = node[prop];
  if (val === undefined)
    return;
  const sub = transformers[prop]( node[prop], csn, node, prop );
  if (sub !== undefined)
    csn[prop] = sub;
}

function targetAspect( val, csn, node ) {
  if (universalCsn) {
    if (val.$inferred)
      return undefined;
    if (node.target) {          // TODO: use addOrigin() for this
      csn.$origin = { target: (val.elements) ? standard( val ) : artifactRef( val, true ) };
      return undefined;
    }
  }
  const ta = (val.elements)
    ? addLocation( val.location, standard( val ) )
    : artifactRef( val, true );
  if (!gensrcFlavor && !universalCsn || node.target && !node.target.$inferred)
    return ta;
  // For compatibility, put aspect in 'target' with parse.cdl and csn flavor 'gensrc'
  csn.target = ta;
  return undefined;
}

function target( val, csn, node ) {
  if (val.elements)
    return standard( val );       // elements in target (parse-cdl)
  // Mention user-provided target in $origin if outside query entity:
  if (val.$inferred === '' && universalCsn && !gensrcFlavor && !node._main?.query) {
    if (!csn.$origin)
      csn.$origin = {};
    csn.$origin.target = artifactRef( val, '.path' ); // TODO: to addOrigin()
  }
  if (!universalCsn || gensrcFlavor || node.on)
    return artifactRef( val, !gensrcFlavor || val.$inferred !== '' || '.path' );
  const tref = artifactRef( val, true );
  const proto = node.type && !node.type.$inferred ? node.type._artifact : node._origin;
  return (proto && proto.target && artifactRef( proto.target, true ) === tref)
    ? undefined
    : tref;
}

function items( obj, csn, node ) {
  if (!keepElements( node, obj ))
    return undefined;
  return standard( obj );   // no 'elements' with inferred elements with gensrc
}

function elements( dict, csn, node ) {
  if (node.from ||              // do not directly show query elements here
      gensrcFlavor && (node.query || node.type) ||
      !keepElements( node ))
    // no 'elements' with SELECT or inferred elements with gensrc;
    // hidden or visible 'elements' will be set in query()
    return undefined;
  // TODO(!): inside `annotate`, use sorted with --test-mode
  if (dict === 0)
    return undefined;
  // In "super annotate" statements, use sorted dictionary
  return (node.$inferred === '') ? sortedDict( dict ) : insertOrderDict( dict );
}

function enumDict( dict, csn, node ) {
  if (gensrcFlavor && dict[$inferred] ||
      !keepElements( node ))
    // no 'elements' with SELECT or inferred elements with gensrc;
    // hidden or visible 'elements' will be set in query()
    return undefined;
  if (universalCsn && node.type && !node.type.$inferred && node.$expand === 'annotate' &&
      node.type._artifact && !node.type._artifact.builtin)
    // derived type of enum type with individual annotations: also set $origin
    csn.$origin = originRef( node.type._artifact );
  return insertOrderDict( dict );
}

function enumerableQueryElements( select ) {
  return (universalCsn && select !== select._main._leadingQuery);
}

// Should we render the elements?  (and items?)
function keepElements( node, line ) {
  if (universalCsn)
    // $expand = null/undefined: not elements not via expansion
    // $expand = 'target'/'annotate': with redirections / individual annotations
    return node.$expand !== 'origin';
  if (!node.type || node.kind === 'type')
    return true;
  // keep many SimpleType/Entity
  if (line) {
    if (!node.type)
      return true;
    const array = node.type._artifact; // see function items() in propagator.js
    const ltype = line.type && line.type._artifact;
    if (!array ||     // reference errors
        array._main && !line.elements && !line.enum && !line.items && !line.notNull &&
        (!ltype || !ltype._main)) // many Foo:bar -> not SimpleType
      return true;
  }
  // even if expanded elements have no new target or direct annotation,
  // they might have got one via propagation – any new target/annos during their
  // way from the original structure type definition to the current usage
  while (node) {
    if (node.$expand !== 'origin')
      return true;
    node = node._origin;
  }
  // all in _origin chain only have expanded elements with 'origin':
  return false;                 // no need to render elements
}

/**
 * For gensrcFlavor and namespace/builtin annotation extraction:
 * return annotations from definition and annotations.
 * The call side should check that node.$inferred is truthy.
 *
 * @param {object} node
 */
function annotationsAndDocComment( node ) {
  const csn = {};
  const transformer = transformers['@'];
  const keys = Object.keys( node ).filter( a => a.charAt(0) === '@' ).sort();
  for (const prop of keys) {
    const val = node[prop];
    // val.$priority isn't set for computed annotations like @Core.Computed
    // and @odata.containment.ignore
    // transformer (= value) takes care to exclude $inferred annotation assignments
    const sub = transformer( val );
    // As value() just has one value, so we do not provide ( val, csn, node, prop )
    // which would be more robust, but makes some JS checks unhappy
    if (sub !== undefined)
      csn[prop] = sub;
  }
  if (node.doc) {
    const doc = transformers.doc(node.doc);
    if (doc !== undefined)
      csn.doc = doc;
  }
  return csn;
}

const specialDollarValues = {
  ':': undefined,
  udf: 'udf',
  calcview: 'calcview',
};

function dollarSyntax( node, csn ) {
  // eslint-disable-next-line no-prototype-builtins
  if (specialDollarValues.hasOwnProperty( node ))
    return specialDollarValues[node];
  setHidden( csn, '$syntax', node );
  return undefined;
}

function ignore() { /* no-op: ignore property */ }

function location( loc, csn, xsn ) {
  if (xsn.kind && xsn.kind.charAt(0) !== '$' && xsn.kind !== 'select' && // TODO: also for 'select'
      (!xsn.$inferred || !xsn._main)) {
    // Also include $location for elements in queries (if not via '*' except for autoexposed)
    addLocation( xsn.name && xsn.name.location || loc, csn );
  }
}

/**
 * Adds the given location to the CSN.
 *
 * @param {CSN.Location} loc
 * @param {object} csn
 */
function addLocation( loc, csn ) {
  if (loc?.file) {
    // Remove endLine/endCol:
    // Reasoning: $location is mostly attached to definitions/members but the name
    // is often not the reason for an error or warning.  So we gain little benefit for
    // two more properties. It is also an indication that the location is not exact.
    const val = { file: loc.file, line: loc.line, col: loc.col };
    if (withLocations === 'withEndPosition' && loc.endLine) {
      val.endLine = loc.endLine;
      val.endCol = loc.endCol;
    }
    Object.defineProperty( csn, '$location', {
      value: val, configurable: true, writable: true, enumerable: withLocations,
    } );
  }
  return csn;
}

function insertOrderDict( dict ) {
  const keys = Object.keys( dict );
  return dictionary( dict, keys );
}

function sortedDict( dict, _csn, _node, prop ) {
  const keys = Object.keys( dict );
  if (strictMode)
    keys.sort();
  return dictionary( dict, keys, prop );
}

function params( dict ) {
  const keys = Object.keys( dict );
  return (keys.length)          // TODO: still?
    ? insertOrderDict( dict )
    : undefined;
}

function dictionary( dict, keys, prop ) {
  const csn = Object.create( dictionaryPrototype );
  for (const name of keys) {
    const def = definition( dict[name], null, null, prop );
    if (def !== undefined)
      csn[name] = def;
  }
  return csn;
}

function foreignKeys( dict, csn, node ) {
  if (!dict ||              // `Association to many Target` without specified keys
      universalCsn && dict[$inferred] === 'keys' ||
      !target( node.target, csn, node ) )
    return;

  if (gensrcFlavor) {
    if (dict[$inferred])
      return;
  }
  csn.keys = [];
  for (const n in dict)
    csn.keys.push( definition( dict[n] ) );
}

function returns( art, csn, node, prop ) {
  // TODO: currently, the `returns` structure might just have been created by the propagator
  // if that is the case, there should be no reason to store it in universal CSN
  if (universalCsn && (art.$inferred === 'proxy' || node.$expand === 'origin'))
    return undefined;
  return definition( art, csn, node, prop );
}

function definition( art, csn, _node, prop ) {
  if (!art || typeof art !== 'object' || art.builtin)
    return undefined;           // TODO: complain with strict
  // Do not include namespace definitions or inferred construct (in gensrc):
  if (art.kind === 'namespace' || art.$inferred && gensrcFlavor)
    return undefined;
  if (art.kind === 'key') { // foreign key
    const key = standard( art );
    if (!art.$inferred) // override location; otherwise only alias would be used
      addLocation( art.targetElement.location, key );
    return extra( key, art );
  }

  const c = standard( art );
  // The XSN of actions in extensions do not contain a returns yet - TODO?
  const elems = c.elements;
  if (elems && (prop === 'actions' || art.$syntax === 'returns')) {
    delete c.elements;
    c.returns = { elements: elems };
  }
  // precondition already fulfilled: art.kind !== 'key'
  addOrigin( c, art, art );
  return c;
}

/**
 * Create $origin specification for query/projection.
 */
function queryOrigin( xsn ) {
  const source = xsn._from[0]._origin;
  let $origin;
  if (xsn.includes)
    // includesOrigin() does originRef() on the first include.
    // Use it to behave the same as entity includes.
    $origin = includesOrigin( [ { _artifact: source }, ...xsn.includes ], xsn );
  else
    $origin = originRef( source );
  return $origin;
}

/**
 * Create $origin specification for `includes` of `art`.
 */
function includesOrigin( includes, art ) {
  const $origin = originRef( includes[0]._artifact );
  if (includes.length === 1)
    return $origin;
  const result = { $origin };
  for (const incl of includes.slice(1)) {
    const aspect = incl._artifact;
    for (const prop in aspect) {
      if ((prop.charAt(0) === '@' || prop === 'doc') &&
          (!art[prop] || art[prop].$inferred)) {
        const annoVal = aspect[prop];
        if (annoVal.val !== null)
          // materialize non-null annos (whether direct or inherited)
          result[prop] = value( Object.create( annoVal, { $inferred: { value: null } } ) );
      }
    }
  }
  return (Object.keys( result ).length === 1) ? $origin : result;
}

/**
 * Calculated elements via `includes` can inherit annotations from sibling elements.
 * These annotations need to be put into `$origin`, because `$origin` points to
 * the calculated element, not the simple ref's artifact.
 */
function calculatedElementOrigin( csn, xsn, origin ) {
  const $origin = originRef( origin );
  const result = { $origin };
  for (const prop in xsn) {
    if ((prop.charAt(0) === '@' || prop === 'doc') && !origin[prop] && xsn[prop].$inferred) {
      const annoVal = xsn[prop];
      if (annoVal.val !== null)
        // materialize non-null annos (whether direct or inherited)
        result[prop] = value( Object.create( annoVal, { $inferred: { value: null } } ) );
    }
  }
  return (Object.keys( result ).length === 1) ? undefined : result;
}

function addOrigin( csn, xsn, node ) {
  if (!universalCsn)
    return;
  if (hasExplicitProp( xsn.type, 'cast' )) {
    const main = xsn._main || xsn;
    let count = 0;
    let source = xsn;
    while (source && source._main === main) {
      source = source.value && source.value._artifact;
      ++count;
    }
    if (count > 0 && source && source.kind !== 'builtin')
      csn.$source = originRef( source, xsn );
    else if (count > 1)
      csn.$source = null;
    return;
  }
  if (xsn._from) {
    const source = xsn._from[0]._origin;
    csn.$origin = queryOrigin( xsn );
    if (source.params && !xsn.params)
      csn.params = null;        // discontinue `params` inheritance
    if (source.actions && !xsn.actions)
      csn.actions = null;       // discontinue `actions` inheritance
    return;
  }
  else if (xsn.includes) {
    csn.$origin = includesOrigin( xsn.includes, xsn );
    if (xsn.$inferred === 'composition-entity' || xsn.$inferred === 'localized-entity')
      inferredPropertiesForOrigin( csn, node );
    return;
  }
  let origin = getOrigin( node );
  if (xsn.$inferred === 'composition-entity') {
    csn.$origin = originRef( origin, xsn );
    inferredPropertiesForOrigin( csn, node );
    return;
  }
  else if (xsn.$inferred === 'localized-entity') {
    inferredPropertiesForOrigin( csn, node );
    return;
  }
  else if (!isMember( xsn ) || xsn.kind === 'select') {
    return;
  }
  // from here on: member:
  // TODO: write a xsnNode._csnOrigin, which is useful to decide whether to write
  //       $origins for its members
  const parent = getParent( xsn );
  const parentOrigin = getOrigin( parent );
  // console.log( 'X:',xsn, origin, parent, parentOrigin, getParent( origin ) );
  if (!origin) {
    if (parent && parentOrigin &&
        (parent.kind !== 'select' || parent === parent._main._leadingQuery) &&
        !(parent.enum && !parent.$origin && parent.type))
      csn.$origin = null;
    return;
  }
  if (parent?.kind !== 'select' && parentOrigin?.kind !== 'select' &&
      parentOrigin === getParent( origin )) {
    // implicit prototype or shortened reference
    const { id } = origin.name || {};

    if (id && xsn.name && id !== xsn.name.id) {
      csn.$origin = id;
    }
    else if (xsn._calcOrigin) {
      const calcOrigin = calculatedElementOrigin( csn, xsn, origin );
      if (calcOrigin)
        csn.$origin = calcOrigin;
    }

    return;
  }
  if (origin.kind === 'mixin') {
    set( 'type', csn, origin );
    set( 'cardinality', csn, origin );
    // currently, target and on are always set - nothing to do here
    return;
  }
  // Skip all proxies which do not make it into the CSN, as there are no
  // individual annotations or redirection targets on it:
  while (origin._parent && origin._parent.$expand === 'origin')
    origin = origin._origin || origin.type._artifact;
  const ref = originRef( origin, xsn );
  if (ref) {
    csn.$origin = ref;
    return;
  }
  // An element of a query with a query in FROM: -----------------------------
  const anon = definition( origin );   // use $origin: {...} if necessary
  // as there are no implicit $origin prototypes on sub query elements (yet),
  // we do not have to care about $origin not being set
  const { $origin } = anon;
  if ($origin && typeof $origin === 'object' && !Array.isArray( $origin )) {
    // repeated anon: flatten
    csn.$origin = Object.assign( $origin, anon );
    return;
  }
  // Annotations and 'doc' must keep the distinction between direct or inherited,
  // other properties can as well be set as direct element properties
  const annos = {};
  for (const prop of Object.keys( anon )) {
    if (prop.charAt(0) === '@' || prop === 'doc')
      annos[prop] = anon[prop];
    else if (prop === '$source')
      csn[prop] = anon[prop];   // overwrite from inner
    else if (prop !== '$location' && prop !== '$origin' && !(prop in csn))
      csn[prop] = anon[prop];
  }
  if (Object.keys( annos ).length) {
    if (!csn.type && $origin)
      annos.$origin = $origin;
    csn.$origin = annos;
  }
  else if (!csn.type) {
    addOrigin( csn, xsn, origin );
  }
}

/**
 * Copy properties with $inferred === 'parent-origin' to $origin.
 * This indicates that the property is neither direct nor can be inferred through $origin.
 *
 * @param csn
 * @param node
 */
function inferredPropertiesForOrigin( csn, node ) {
  let hasProp = false;
  const props = {};
  for (const prop of Object.keys(node)) {
    if (node[prop]?.$inferred === 'parent-origin') {
      hasProp = true;
      props[prop] = value({ ...node[prop], $inferred: false });
    }
  }
  const origin = csn.$origin;
  if (hasProp) {
    csn.$origin = props;
    if (origin)
      csn.$origin.$origin = origin;
  }
}

function getParent( art ) {
  const parent = art._parent;
  const main = parent._main;
  return (main && parent === main._leadingQuery) ? main : parent;
}

function isMember( art ) {
  // TODO: introduce art.kind = '$aspect' for anonymous aspect (is a member) ?
  return !!(art._main || art._outer);
}

// function getDefinition( art ) {
//   let main = art._main || art;
//   while (main._outer)           // anonymous aspect
//     main = main._outer._main;
//   return main;
// }

// XSN `_origin` is (currently?) not the same as _origin in Universal CSN...
// TODO: at least with expand, set it correctly (alias: keep, assoc: to entity, $builtin: no)
function getOrigin( art ) {
  if (art.$noOrigin)
    return undefined;
  const { _origin } = art;
  if (_origin)                  // also for query entities
    return (_origin.kind === 'builtin') ? undefined : _origin;

  if (hasExplicitProp( art.type, 'cast' ))
    return art.type._artifact;
  // must come after checking _origin, since entities can have both queries and
  // includes as well -> the query wins
  if (art.includes)
    return art.includes[0]._artifact;
  return undefined;
}

function hasExplicitProp( ref, alsoLikeExplicit ) {
  return ref && (!ref.$inferred || ref.$inferred === alsoLikeExplicit );
}

/**
 * @param art
 * @param [user]
 * @return {boolean|string[]}
 */
function originRef( art, user ) {
  const r = [];
  // do not use name.element, as we might allow `.`s in name
  let parent = art;
  if (parent._outer && parent.kind === 'aspect')
    r.push( { target: true } );
  while (isMember( parent ) && parent.kind !== 'select') {
    const nkind = normalizedKind[parent.kind];
    const name = parent.name || parent._outer.name;
    if (name.id && parent.kind !== '$inline' || !r.length)
      // Return parameter is in XSN - kind: 'param', name.id: ''
      // eslint-disable-next-line no-nested-ternary
      r.push( !nkind ? name.id : name.id ? { [nkind]: name.id } : { returns: true } );
    parent = parent._parent;
  }
  if (user && parent._main && parent._main === user._main && parent !== user._main._leadingQuery)
    // well, an element of an query in FROM (TODO: try with sub elem), but not the leading query
    return false;               // do not write, probably use $origin: {...}
  // for sub query in FROM in sub query in FROM, we could condense the info

  r.push( (parent._main || parent).name.id );
  r.reverse();
  return r;
}

function kind( k, csn, node ) {
  if (k === 'annotate' || k === 'extend') {
    // We just use `name.id` because it is very likely a "constructed"
    // extensions.  The CSN parser must produce name.path like for other refs.
    if (!node._main)
      csn[k] = node.name.id || artifactRef( node.name, true );
    else if (k === 'extend')
      csn.kind = k;
  }
  else if (k === 'action' && node._main && universalCsn && node.$inferred) {
    // Universal CSN:  do not mention kind: 'action' on expanded action
  }
  else if (k === 'aspect' && (node._outer || node.$inferred)) {
    return;                     // do not show kind for anonymous aspect
  }
  else if (![
    'element', 'key', 'param', 'enum', 'select', '$join',
    '$tableAlias', 'annotation', 'mixin',
  ].includes(k)) {
    csn.kind = k;
  }
  const generated = universalCsn && inferredAsGenerated[node.$inferred];
  if (typeof generated === 'string')
    csn.$generated = generated;
}

function type( node ) {
  if (!universalCsn)
    return artifactRef( node, !node.$extra );
  if (node.$inferred && node.$inferred !== 'cast')
    return undefined;
  return artifactRef( node, !node.$extra );
}

function cardinality( node ) {
  if (!universalCsn)
    return standard( node );
  if (node.$inferred)
    return undefined;
  return standard( node );
}

function artifactRef( node, terse ) {
  // When called as transformer function, a CSN node is provided as argument
  // for `terse`, i.e. it is usually truthy, except for FROM
  if (node.$inferred && gensrcFlavor)
    return undefined;
  // Works also on XSN directly coming from parser and with XSN from CDL->CSN transformation
  // Shortcut for many cases:
  const art = node._artifact;
  if (art && (!art._main || art.kind === '$self') && terse && terse !== '.path')
    return art.name.id;
  let { path } = node;
  if (!path)
    return undefined;           // TODO: complain with strict
  if (!path.length)
    return [];

  const head = path[0];
  const root = head._artifact;
  const main = root?._main || root;
  const id = (main?.extern || main?.name)?.id;
  const scope = node.scope || path.length;

  if (typeof scope === 'number' && scope > 1) {
    const item = path[scope - 1];
    const name = item._artifact?.name;
    const absolute = name?.id ||
      `${ id || head.id }.${ path.slice( 1, scope ).map( i => i.id ).join('.') }`;
    path = [ Object.assign( {}, item, { id: absolute } ), ...path.slice( scope ) ];
  }
  else if (scope === 'typeOf') {     // TYPE OF without ':' in path
    if (!root) {
      throw new CompilerAssertion( `Unexpected TYPE OF in ${ locationString(node.location) }`);
    }
    else if (!root._main) {
      path = [ { id }, ...path.slice(1) ];
    }
    else {
      path = path.slice(1).reverse();
      let parent = root;
      while (parent._main) {
        path.push( { id: parent.name.id } );
        parent = parent._parent;
        parent = parent._outer || parent; // for anonymous aspect
      }
      path.push( { id } );
      path.reverse();
    }
  }
  else if (root && id !== head.id) {
    path = [ Object.assign( {}, head, { id } ), ...path.slice( 1 ) ];
  }
  const ref = path.map( pathItem );
  return (!terse || ref.length !== 1 || typeof ref[0] !== 'string')
    ? extra( { ref }, node )
    : ref[0];
}

function pathItem( item ) {
  if (!item.args &&
      !item.where &&
      !item.groupBy &&
      !item.having &&
      !item.limit &&
      !item.orderBy &&
      !item.cardinality &&
      !item.$extra &&
      !item.$syntax)
    return item.id;
  return standard( item );
}

function args( node ) {
  if (Array.isArray(node))
    return node.map( expression );
  const dict = Object.create( dictionaryPrototype );
  for (const param in node)
    dict[param] = expression( node[param] );
  return dict;
}

function anno( node ) {
  if (!node)
    return true;                // `@aBool` short for `@aBool: true`
  if (universalCsn && node.$inferred) {
    // TODO: return undefined for all values of node.$inferred (except 'NULL')?
    if (node.$inferred === 'prop' || node.$inferred === '$generated' || // via propagator.js
        node.$inferred === 'parent-origin')
      return undefined;
    else if (node.$inferred === 'NULL')
      return null;
  }
  if (node.$inferred && gensrcFlavor)
    return undefined;
  if (node.$tokenTexts) // expressions in annotation values
    return Object.assign({ '=': node.$tokenTexts }, expression( node ));
  return value(node);
}

function docComment( doc ) {
  // Value is `true` if options.docComment is falsey for CDL input.
  if (withDocComments && doc?.val !== true)
    return value( doc );
  return undefined;
}

function value( node ) {
  // "Short" value form, e.g. for annotation assignments
  if (!node)
    return true;                // `@aBool` short for `@aBool: true`
  if (universalCsn && node.$inferred) {
    // TODO: return undefined for all values of node.$inferred (except 'NULL')?
    if (node.$inferred === 'prop' || node.$inferred === '$generated' || // via propagator.js
        node.$inferred === 'parent-origin')
      return undefined;
    else if (node.$inferred === 'NULL')
      return null;
  }
  if (node.$inferred && gensrcFlavor)
    return undefined;
  if (node.$tokenTexts)
    return Object.assign({ '=': node.$tokenTexts }, expression( node ));
  if (node.path) {
    const ref = pathName( node.path );
    return extra( { '=': node.variant ? `${ ref }#${ pathName(node.variant.path) }` : ref }, node );
  }
  if (node.literal === 'enum')
    return enumValue( node );
  if (node.literal === 'array')
    return node.val.map( value );
  if (node.literal === 'token' && node.val === '...')
    return extra( { '...': !node.upTo || value( node.upTo ) } );
  if (node.literal !== 'struct')
    // no val (undefined) as true only for annotation values (and struct elem values)
    return node.name && !('val' in node) || node.val;
  const r = Object.create( dictionaryPrototype );
  for (const prop in node.struct)
    r[prop] = value( node.struct[prop] );
  return r;
}

function enumValue( node ) {
  if (node.val !== undefined)   // with `val` via CSN input (e.g. recompilation)
    return extra( { '#': node.sym.id, val: node.val }, node );
  const r = extra( { '#': node.sym.id }, node );
  const sym = node.sym._artifact;
  // add calculated `val`, but not for chained symbols:
  if (sym && (!gensrcFlavor || gensrcFlavor === 'column') && !sym.value?.sym)
    r.val = sym.value ? sym.value.val : sym.name.id;
  return r;
}

function targetElement( val, csn, node ) {
  const key = addExplicitAs( { ref: val.path.map( pathItem ) },
                             node.name, neqPath( val ) );
  Object.assign(csn, key);
}

function enumValueOrCalc( v, csn, node ) {
  if (v.$inferred && (universalCsn || gensrcFlavor))
    return undefined;
  // Enum values in CSN are without outer `value: { … }`:
  if (node.kind === 'enum') {
    Object.assign( csn, expression( v ) );
  }
  // In XSN, there are combined elem/column objects: do not represent column
  // expression when presented as element in CSN

  // node.$syntax set in define.el(!), but not inside an `extend`, a _parent might
  // not be set always for parse-only, especially with CSN input
  else if (node.$syntax === 'calc' ||
           !node._parent || node._parent.kind === 'extend') {
    const stored = v.stored ? { stored: value(v.stored) } : {};
    return Object.assign( stored, expression( v ) );
  }
  return undefined;
}

function onCondition( cond ) {
  if (gensrcFlavor) {
    if (cond.$inferred)
      return undefined;
  }
  return condition( cond );
}

function condition( node ) {
  const expr = exprInternal( node, 'no' );
  return (Array.isArray( expr ))
    ? flattenInternalXpr( expr, node.op?.val )
    : !expr.cast && !expr.func && expr.xpr || [ expr ];
}

function expression( node ) {
  if (node?.$inferred && (gensrcFlavor || universalCsn || node.$inferred === 'NULL'))
    return undefined; // Note: No `null` for universal CSN at the moment
  const expr = exprInternal( node, 'no' );
  return (Array.isArray( expr ))
    ? { xpr: flattenInternalXpr( expr, node.op?.val ) }
    : expr;
}

function exprInternal( node, xprParens ) {
  if (typeof node === 'string')
    return node;
  if (!node)                    // make to-csn robust
    return {};
  if (node.scope === 'param') {
    if (node.path)
      return extra( { ref: node.path.map( pathItem ), param: true }, node );
    return { ref: [ node.param.val ], param: true }; // CDL rule for runtimes
  }
  if (node.path) {
    const ref = node.path.map( pathItem );
    // auto-corrected ORDER BY refs without table alias, or EXTEND … WITH COLUMN
    // refs to source element shadowed by alias name:
    if (node.path.$prefix)
      ref.unshift( node.path.$prefix );
    // we would need to consider node.global here if we introduce that
    return extra( { ref }, node );
  }
  if (node.literal) {
    if (node.literal === 'enum')
      return enumValue( node );
    else if (typeof node.val === node.literal || node.val === null)
      return extra( { val: node.val }, node );
    else if (node.literal === 'token')
      return node.val;          // * in COUNT(*)
    return extra( { val: node.val, literal: node.literal }, node );
  }
  if (node.func) {              // TODO XSN: remove op: 'call', func is no path
    const call = { func: node.func.path[0].id };
    if (node.args)       // no args from CSN input for CURRENT_DATE etc
      call.args = args( node.args );
    if (node.suffix)
      call.xpr = condition( { op: { val: 'ixpr' }, args: node.suffix } );
    // remark: node.suffix.map( expression ) would add $parens: 1 for xpr after "over"
    return extra( call, node );
  }
  if (node.query)
    return query( node.query, null, null, null, (node.$parens ? 1 - node.$parens.length : 1) );
  if (!node.op)                 // parse error
    return { xpr: [] };

  let { val } = node.op;
  switch (val) {
    case 'nary':
    case 'ixpr':
    case 'xpr':
      break;
    case '?:':
      return ternaryOperator( node );
    case 'cast':
      return cast( expression( node.args[0] ), node );
    case 'list':
      return extra( { list: node.args.map( expression ) }, node, 0 );
    default: {   // CSN v0 input (A2J: '='/'and'): binary (n-ary) and unary prefix
      if (!node.args.length)
        return { xpr: [] };
      const nary = [];
      for (const item of node.args)
        nary.push( { val, literal: 'token' }, item );
      val = 'nary';
      node = {
        op: { val },
        args: (nary.length > 2 ? nary.slice(1) : nary),
        $parens: node.$parens,
      };
    }
  }
  const rargs = node.args.map( exprInternal );
  if (val === 'xpr' || node.$parens)
    return extra( { xpr: flattenInternalXpr( rargs, val ) }, node, (xprParens === 'no' ? 0 : 1) );
  return rargs.length === 1 ? rargs[0] : flattenInternalXpr( rargs, val );
}


const naryOperators = {
  __proto__: null,
  '.': true,
  '*': true,
  '/': true,
  '+': true,
  '-': true,
  '||': true,
  and: true,
  or: true,
};

function flattenInternalXpr( array, xprOp ) {
  if (!structXpr)
    return array.flat( Infinity );
  // TODO: do not rely on 'nary' - this dosn't work with CSN input have an
  // `xpr: [{val:1},'+',{val:2},'+',{val:3}]`.
  const { length } = array;
  if (length < 5 || length % 2 === 0)
    return array;
  const op = array[1];
  if (typeof op !== 'string' || !naryOperators[op] ||
      xprOp !== 'nary' &&       // for old CDL parser
      array.some( ( item, idx ) => item !== op && idx % 2 === 1 ))
    return array;
  // nary: [ ‹a›, '+', ‹b›, '+', ‹c› ] → [ [ ‹a›, '+', ‹b› ], '+', ‹c› ]
  let left = array.slice( 0, 3 );
  let index = 3;
  while (index < array.length)
    left = [ left, array[index++], array[index++] ];
  return left;
}

function ternaryOperator( node ) {
  const rargs = [
    'case',
    'when', exprInternal(node.args[0]),
    'then', exprInternal(node.args[2]),
    'else', exprInternal(node.args[4]),
    'end',
  ];

  if (node.$parens?.length)
    return { xpr: flattenInternalXpr( rargs, 'xpr' ) };
  return flattenInternalXpr( rargs, 'xpr' );
}

function query( node, csn, xsn, _prop, expectedParens = 0 ) {
  if (node.op.val === 'SELECT') {
    if (xsn && xsn.query === node && xsn.$syntax === 'projection' &&
       node.from && node.from.path) {
      csn.projection = addLocation( node.location, standard( node ) );
      return undefined;
    }
    const select = { SELECT: extra( standard( node ), node, expectedParens ) };
    // one paren pair is not put into XSN - TODO: change that?
    const elems = node.elements;
    if (elems && node._main && node !== node._main._leadingQuery && gensrcFlavor !== true) {
      // Set hidden 'elements' for csnRefs.js.  In select-item subqueries,
      // gensrcFlavor might have been set to 'column' and must be set to the
      // original value 'false' - otherwise no element appears.
      const gensrcSaved = gensrcFlavor;
      try {
        gensrcFlavor = false;
        if (enumerableQueryElements( node ))
          select.SELECT.elements = insertOrderDict( elems );
        else
          setHidden( select.SELECT, 'elements', insertOrderDict( elems ) );
      }
      finally {
        gensrcFlavor = gensrcSaved;
      }
    }
    // the $location is better put inside the SELECT value, not as sibling (but
    // we keep it as sibling also for compatibility):
    addLocation( node.location, select.SELECT );
    return addLocation( node.location, select );
  }
  const union = {};
  // for UNION, ... ----------------------------------------------------------
  set( 'op', union, node );
  set( 'quantifier', union, node );
  // set( 'args', union, node ):
  union.args = node.args.map( query );
  set( 'orderBy', union, node );
  set( 'limit', union, node );
  set( '$extra', union, node );
  return addLocation( node.location, { SET: union } );
}

function columns( xsnColumns, csn, xsn ) {
  const csnColumns = [];
  if (xsnColumns) {
    for (const col of xsnColumns) {
      if (col.val === '*')
        csnColumns.push( '*' );
      else
        addElementAsColumn( col, csnColumns );
    }
  }
  else {            // null = use elements - TODO: still used by A2J? -> remove
    for (const name in xsn.elements)
      addElementAsColumn( xsn.elements[name], csnColumns );
  }
  return csnColumns;
}

function excludingDict( xsnDict, csn, xsn ) {
  if (xsn.kind !== 'element')
    csn.excluding = Object.keys( xsnDict );
}

function from( node ) {
  // TODO: can we use the normal standard(), at least with JOIN?
  if (node.join) {
    const join = { join: node.join.val };
    set( 'cardinality', join, node );
    join.args = node.args.map( from );
    set( 'on', join, node );
    return extra( join, node );
  }
  else if (node.query) {
    return addExplicitAs( query( node.query, null, null, null, 1 ), node.name );
  }

  const ref = artifactRef( node, false );
  return extra( addExplicitAs( ref, node.name, (id) => {
    let name = ref.ref ? ref.ref[ref.ref.length - 1] : ref;
    name = name && name.id || name;
    if (!name)
      return false;
    const dot = name.lastIndexOf('.');
    return name.substring( dot + 1 ) !== id;
  }), node );
}

function addElementAsColumn( elem, cols ) {
  if (elem.$inferred === '*')
    return;
  // only list annotations here which are provided directly with definition
  const col = (gensrcFlavor) ? annotationsAndDocComment( elem ) : {};
  // with `client` flavor, assignments are available at the element
  const gensrcSaved = gensrcFlavor;

  try {
    gensrcFlavor = gensrcFlavor || 'column';
    set( 'virtual', col, elem );
    // TODO if (!elem.key?.$specifiedElement)
    set( 'key', col, elem );
    const expr = expression( elem.value );
    Object.assign( col, (expr.cast ? { xpr: [ expr ] } : expr) );
    gensrcFlavor = gensrcSaved; // for not having annotations in inline etc
    if (elem.expand)
      col.expand = columns( elem.expand );
    if (elem.inline)
      col.inline = columns( elem.inline );
    gensrcFlavor = gensrcFlavor || 'column';
    if (elem.excludingDict)
      col.excluding = Object.keys( elem.excludingDict );
    // yes, the AS comes after the EXPAND
    addExplicitAs( col, elem.name, neqPath( elem.value ) );
    // elements of sub queries (in expr) are hidden (not set via Object.assign):
    if (!expr.cast && expr.elements)
      setHidden( col, 'elements', expr.elements );
    // CDL-style cast with explicit type properties
    if (castProperties.findIndex(prop => (elem[prop] &&
        !elem[prop].$inferred && !elem[prop][$inferred])) > -1)
      cast( col, elem );
  }
  finally {
    gensrcFlavor = gensrcSaved;
  }
  if (elem.value && !elem.$inferred) {
    const parens = elem.value.$parens;
    if (parens)
      setHidden( col, '$parens', parens.length );
    addLocation( (parens ? parens[parens.length - 1] : elem.value.location), col );
  }
  else if (elem.name && !elem.name.$inferred) {
    addLocation( elem.name.location, col );
  }
  cols.push( extra( col, elem ) );
}

function orderBy( node ) {
  const expr = expression( node );
  if (node.sort)
    expr.sort = node.sort.val;
  if (node.nulls)
    expr.nulls = node.nulls.val;
  return expr;              // extra properties are before sort/nulls - who cares?
}

function extra( csn, node, expectedParens = 0 ) {
  if (node) {
    if (node.$extra)
      Object.assign( csn, node.$extra );
    const parens = (node.$parens ? node.$parens.length : 0);
    if (parens !== expectedParens)
      setHidden( csn, '$parens', parens );
  }
  return csn;
}

function cast( csn, node ) {
  let r = csn;
  if (csn.cast)
    r = { xpr: [ csn ], cast: {} };
  else
    r.cast = {};                // TODO: what about $extra in cast?
  for (const prop of typeProperties)
    set(prop, r.cast, node);
  return r;
}

function setHidden( obj, prop, val ) {
  Object.defineProperty( obj, prop, {
    value: val, configurable: true, writable: true, enumerable: false,
  } );
}

function addExplicitAs( node, name, implicit ) {
  if (name?.id && name.$inferred !== '$internal' &&
      (!name.$inferred || !node.ref && !node.func || implicit && implicit(name.id) ))
    node.as = name.id;
  return node;
}

function neqPath( ref ) {
  const path = ref && (ref.path || !ref.args && ref.func && ref.func.path);
  return function test( id ) {
    const last = path && path[path.length - 1];
    return !last || last.id !== id;
  };
}

const annoOrder = propertyOrder['@'];

// Usually sort according to the "natural" property order; sort annotations
// alphabetically with --test-mode and "as set" (fragile, node >=12) without.
function compareProperties( a, b ) {
  if (a === b)
    return 0;
  const oa = propertyOrder[a] || propertyOrder[a.charAt(0)] || 9999;
  const ob = propertyOrder[b] || propertyOrder[b.charAt(0)] || 9999;
  return oa - ob || (strictMode || oa !== annoOrder || 0) && (a < b ? -1 : 1);
}

function compactQuery( q ) {    // TODO: options
  initModuleVars();
  return q && query( q );
}

function compactExpr( e ) {     // TODO: options
  initModuleVars();
  return e && expression( e );
}

/**
 * @param {CSN.Options} options
 */
function initModuleVars( options = { csnFlavor: 'gensrc' } ) {
  const flavor = options.csnFlavor || options.toCsn?.flavor;
  gensrcFlavor = options.parseCdl || flavor === 'gensrc';
  universalCsn = flavor === 'universal' &&
                 isBetaEnabled( options, 'enableUniversalCsn' ) &&
                 !options.parseCdl;
  strictMode = options.testMode;
  const proto = options.dictionaryPrototype;
  // eslint-disable-next-line no-nested-ternary
  dictionaryPrototype = (typeof proto === 'object') // including null
    ? proto
    : (proto) ? Object.prototype : null;
  withLocations = options.withLocations;
  withDocComments = options.docComment !== false;
  structXpr = options.structXpr;
}

module.exports = {
  compactModel,
  compactQuery,
  compactExpr,
  csnDictionaries,
  csnDirectValues,
  csnPropertyOrder: propertyOrder,
};
