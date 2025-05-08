// Make internal properties of the XSN / augmented CSN visible
//
//  * Display links like _artifact as 'entity:"A"/element:"k"'.
//  * Use this form at other places to avoid listing the same property value twice.
//  * Use shorter display of the location, like in messages.
//  * Attach integer as __unique_id__ property value to all objects.
//
// This function should return a meaningful result in all circumstances:
//  * with --parse-only, with both CDL and CSN input,
//  * for the core compiler output and all transformations working on the XSN.

'use strict';

const msg = require('../base/messages');
const { CompilerAssertion } = require('../base/error');

const $inferred = Symbol.for('cds.$inferred');
const $location = Symbol.for('cds.$location');

class NOT_A_DICTIONARY {}       // used for console.log display

function locationString( loc ) {
  if (Array.isArray(loc))
    return loc.map( locationString );
  if (loc == null)
    return '';
  return (typeof loc === 'object' && loc.file)
    ? msg.locationString(loc)
    : `${ typeof loc }:${ msg.locationString(loc) }`;
}

let uniqueId = 0;

// some (internal) kinds are normally represented as links
const kindsRepresentedAsLinks = {
  // represent SELECTs in query / SET-args property as link:
  select: (art, parent) => art._main && parent !== art._main.$queries,
  // represent table alias in from / join-args property as link:
  $tableAlias: tableAliasAsLink,
  // represent "navigation elements" in _combined as links:
  $navElement: (art, parent) => art._parent && parent !== art._parent.elements &&
    art._parent.kind !== 'aspect',
  // represent mixin in $tableAliases as link:
  mixin: tableAliasAsLink,
  // represent $projection as link, as it is just another search name for $self:
  $self: (_a, _p, name) => name !== '$self',
};

function tableAliasAsLink( art, parent, name ) {
  return art._parent && art._parent.$tableAliases && // initXYZ() is run
    parent !== art._parent.$tableAliases &&          // not in $tableAliases
    !(art.$duplicates === true && name &&            // and its $duplicates
      parent === art._parent.$tableAliases[name].$duplicates);
}

/**
 * Reveal internal properties of `model` for the given artifact name (or path).
 * `path` could be a definition name or a `/`-separated XSN path such as
 * `name.space/S/E/elements/a/type/scope/`.
 *
 * @param {XSN.Model} model
 * @param {string} [nameOrPath]
 */
function revealInternalProperties( model, nameOrPath ) {
  // return model;
  const transformers = {
    messages: m => m,
    name: shortenName,
    location: locationString,
    $parens: locationString,    // array
    options: revealOptions,
    sources: dictionary,
    artifacts: artifactDictionary,
    definitions: artifactDictionary,
    vocabularies: dictionary,
    elements,
    columns,
    expand: columns,
    inline: columns,
    actions: dictionary,
    params: dictionary,
    enum: dictionary,
    foreignKeys: dictionary,
    excludingDict: dictionary,
    struct: dictionary,
    mixin: dictionary,
    args: dictionary,
    $tableAliases: dictionary,
    $duplicates: duplicates,
    $keysNavigation: dictionary,
    targetAspect,
    $layerNumber: n => n,
    $extra: e => e,
    _layerRepresentative: s => s.realname,
    _layerExtends: layerExtends,
    _origin: origin,
    $compositionTargets: d => d,   // dictionary( boolean )
    _extend: reveal,
    _annotate: reveal,
    _annotateS: artifactIdentifier,
    _deps: dependencyInfo,
    _status: primOrString,       // is a string anyway
    $annotations: as => as.map( $annotation ),
    $messageFunctions: () => '‹some functions›',
    $functions: () => '‹some functions›',
    $builtins: nameOrPath === '++' ? builtinsDictionary : () => '‹reveal with -R ++›',
    tokenStream: ts => `‹${ ts?.tokens?.length ?? '?' } tokens›`,
    parseListener: _ => '‹parseListener›',
  };
  uniqueId = -1;
  return revealXsnPath(nameOrPath, model);

  // Returns the desired artifact/dictionary in the XSN.
  //
  // Usage:
  //   1. Whole Model
  //      Simply pass `+`.
  //   2. Entity (e.g. in service)
  //      Use `S.E`, i.e. the artifact's name in XSN.
  //   3. Specific Element
  //      To get an element `e` of `S.E`, use `S.E/elements/e`, i.e. the
  //      JSON path delimited by "/" instead of "." (to avoid conflicts with artifact's FQN).
  //   4. All elements
  //      To list all elements, use `S.E/elements/`. The final slash is important.
  //   5. Other dictionaries or internal properties
  //      Use the JSON-like path delimited by "/". Add a final slash, e.g. `E.elements.a.kind/`.
  //
  // The string before the last slash ("/") is used as the property name to
  // reveal the properties. So if the last path segment is an element name, do
  // not add a slash or the name may be mistaken as a property name.
  //
  // Examples:
  //   `name.space/S/E/elements/a/kind/`
  //   `name.space/S/E/elements/a/type/scope/`
  function revealXsnPath( path, xsn ) {
    if (!path || path === '+' || path === '++')
      return reveal( xsn );

    path = path.split('/');
    if (path.length === 1) {
      const def = xsn.definitions?.[path[0]] || xsn.vocabularies?.[path[0]];
      if (!def)
        throw new CompilerAssertion(`reveal xsn: Unknown definition: “${ path[0] }”`);
      return reveal( def );
    }

    // with the code below, we might miss the right transformer function
    path.unshift('definitions');

    for (const segment of path) {
      if (xsn[segment])
        xsn = xsn[segment];
      else if (segment)         // huh, this should be a call error
        throw new CompilerAssertion(`Raw Output: Path segment "${ segment }" could not be found. Path: ${ JSON.stringify(path) }!"`);
    }
    const propName = path[path.length > 1 ? path.length - 2 : 0];
    const obj = {};
    obj[propName] = xsn;
    return reveal( obj );
  }

  function shortenName( node, parent ) {
    const name = reveal( node, parent );
    if (name && typeof name === 'object' && parent.kind) {
      const text = artifactIdentifier( parent );
      name['-->'] = text;
    }
    return name;
  }
  function dependencyInfo( deps ) {
    if (!Array.isArray(deps))
      return primOrString( deps );
    return deps
      .map( d => (d.location
        ? `${ artifactIdentifier( d.art ) } @${ locationString( d.location ) }`
        : artifactIdentifier( d.art )) );
  }

  function layerExtends( dict ) {
    const r = Object.create( Object.getPrototypeOf(dict)
      ? NOT_A_DICTIONARY.prototype
      : Object.prototype );
    for (const name in dict)
      r[name] = true;
    return r;
  }

  function $annotation( anno ) { // property for cds-lsp
    const { name, $flatten } = anno.value || anno;
    const value = ($flatten)
      ? { name: reveal( name ), $flatten: $flatten.map( $annotation ) }
      : `@${ name?.id }`;
    return { value, location: locationString( anno.location || anno.name.location ) };
  }

  function columns( nodes, query ) {
    // If we will have specified elements, we need another test to see columns in --parse-cdl
    return nodes && array( nodes,
                           c => ((c._parent && c._parent.elements)
                             ? artifactIdentifier( c, query )
                             : reveal( c, nodes )) );
  }

  function elements( dict, parent ) {
    // do not display elements of leading query as they are the same as the view elements:
    return (parent._main && parent._main._leadingQuery === parent)
      ? '{ ... }'
      : dictionary( dict );
  }

  function revealOptions( node, parent ) {
    return (parent === model || node !== model.options) ? reveal( node, parent ) : '{ ... }';
  }

  function artifactDictionary( node, parent ) {
    if (parent === model )
      return dictionary( node );    // no dictionary or no definitions section
    return builtinsDictionary( node );
  }

  function builtinsDictionary( node, parent ) {
    if (!node || typeof node !== 'object' || !model.definitions )
      return dictionary( node );    // no dictionary or no definitions section
    const dict = Object.create( Object.getPrototypeOf(node)
      ? NOT_A_DICTIONARY.prototype
      : Object.prototype );
    for (const name in node) {
      const art = node[name];
      dict[name] = (art.kind !== 'using')
        ? artifactIdentifier( art )
        : reveal( art, parent );
    }
    return dict;
  }

  function dictionary( node ) {
    if (!node || typeof node !== 'object')
      return primOrString( node );
    if (Array.isArray(node))  // with args
      return array( node, reveal );
    // Make unexpected prototype visible with node-10+:
    const r = Object.create( Object.getPrototypeOf(node)
      ? NOT_A_DICTIONARY.prototype
      : Object.prototype );
    for (const prop of Object.getOwnPropertyNames( node )) { // also non-enumerable
      if (node !== model.definitions || nameOrPath === '++' || !node[prop].builtin)
        r[prop] = reveal( node[prop], node, prop );
    }
    if (node[$inferred] && !node['[$inferred]'])
      r['[$inferred]'] = node[$inferred];
    if (node[$location] && !node['[$location]'])
      r['[$location]'] = locationString( node[$location] );
    return r;
  }

  function origin( node, parent ) {
    if (!node)
      return reveal( node, parent );
    return artifactIdentifier( node, parent );
  }

  function revealNonEnum( node, parent ) {
    if (node == null || typeof node !== 'object' )
      return primOrString( node );
    if (Array.isArray(node))
      return array( node, revealNonEnum );

    if (Object.getPrototypeOf( node ))
      return artifactIdentifier( node, parent );
    return artifactDictionary( node, parent );
  }

  function reveal( node, parent, name ) {
    if (node == null || typeof node !== 'object' )
      return node;
    if (Array.isArray(node))
      return array( node, n => reveal( n, node, name ) );

    const asLinkTest = kindsRepresentedAsLinks[node.kind];
    if (asLinkTest && asLinkTest( node, parent, name ))
      return artifactIdentifier( node, parent );

    const r = Object.create( Object.getPrototypeOf( node ) );
    // property to recognize === objects
    if (node.kind && node.__unique_id__ == null && node.$effectiveSeqNo == null && !node.builtin)
      Object.defineProperty( node, '__unique_id__', { value: uniqueId-- } );

    for (const prop of Object.getOwnPropertyNames( node )) { // also non-enumerable
      const func = transformers[prop] ||
            ({}.propertyIsEnumerable.call( node, prop ) ? reveal : revealNonEnum);
      r[prop] = func( node[prop], node );
    }
    return r;
  }

  function targetAspect( node, parent ) {
    // TODO: avoid repeated display of same target aspect (includes)
    if (node.elements && node.__unique_id__ == null && node.$effectiveSeqNo == null)
      Object.defineProperty( node, '__unique_id__', { value: uniqueId-- } );
    return reveal( node, parent );
  }

  function duplicates( node, parent ) {
    return reveal( node, parent, parent.name && parent.name.id );
  }
}

function array( node, fn ) {
  if (!Array.isArray( node ))
    return node;
  const r = node.map( n => fn( n, node ) );
  if (node[$location])
    r.push( { '[$location]': locationString( node[$location] ) } );
  return (node.$prefix) ? [ { $prefix: node.$prefix }, ...node ] : r;
}

function artifactIdentifier( node, parent ) {
  if (!node)
    return `${ node }`;
  if (Array.isArray(node))
    return node.map( a => artifactIdentifier( a, node ) );
  if (uniqueId && node.__unique_id__ == null && node.$effectiveSeqNo == null && !node.builtin)
    Object.defineProperty( node, '__unique_id__', { value: uniqueId-- } );
  const outerNum = node.$effectiveSeqNo || node.__unique_id__;
  let outer = outerNum != null ? `##${ outerNum }` : '';
  if (node._outer) { // anon aspect in targetAspect | items | $calcDepElement
    outer = (node.kind === '$annotation')
    // eslint-disable-next-line prefer-template
      ? `/${ quoted( '@' + node.name.id ) }`
      : `/${ node.kind || 'items' }${ outer }`;
    node = node._outer;
  }
  if (node === parent)
    return 'this';
  if (node.kind === 'source')
    return `source:${ quoted( node.location.file ) }`;
  if (node.kind === '$magicVariables')
    return '$magicVariables';
  if (!node.name) {
    try {
      return `${ locationString( node.location ) || '' }##${ outerNum }`;
      // return JSON.stringify(node);
    }
    catch (e) {
      return e.toString();
    }
  }
  switch (node.kind) {
    case undefined:
      if (node.name.id === '$self' && node.location.file === '')
        return `type:${ quoted( '$self' ) }##0`;
      return (node._artifact && node._artifact.kind)
        ? artifactIdentifier( node._artifact )
        : JSON.stringify(node.name);
    case 'builtin':
      return msg.artName(node);
    case 'source':
    case 'using':
      return `source:${ quoted( node.location && node.location.file )
      }/using:${ quoted( node.name.id ) }`;
    default: {
      let main = node._main;
      while (main && main._outer) // anonymous aspect
        main = main._outer._main;
      return `${ (main || node).kind || '<kind>' }:${ msg.artName( node ) }${ outer }`;
    }
  }
}

function primOrString( node ) {
  if (node == null || typeof node !== 'object')
    return node;
  if (Array.isArray(node))
    return array( node, primOrString );
  if (Object.getPrototypeOf( node ))
    return `${ node }`;
  return '<dict>';
}

function quoted( name, undef = '‹undefined›' ) {
  if (typeof name === 'number')
    return String(name);
  return (name ? `“${ name }”` : undef);
}

// To be used for tracing, e.g. by
// require('../model/revealInternalProperties').log(model, 'E_purposes')
function logXsnModel( model, name ) {
  // eslint-disable-next-line no-console
  console.log( require('util').inspect( revealInternalProperties( model, name ), false, null ) );
}

// To be used for tracing, e.g. by
// console.log(require('../model/revealInternalProperties').ref(type._artifact))
function xsnRef( node ) {
  uniqueId = 0;
  return artifactIdentifier( node );
}

module.exports = { reveal: revealInternalProperties, log: logXsnModel, ref: xsnRef };
