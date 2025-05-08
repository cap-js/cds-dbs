// Compiler phase 1 = "define": transform dictionary of AST-like XSNs into XSN

// The 'define' phase (function 'define' below) is the first phase of the compile
// function.  In it, the compiler
//
//  - collects definitions and extensions from the XSN representation of CDL and
//    CSN sources (“ASTs”) into _one_ XSN model,
//  - sets “structural” links between XSN nodes and completes the “name”,
//    some links and names inside `extensions` are set at a later stage
//  - reports errors for: “late” syntax errors (when it is more convenient to do
//    it here instead of doing it in both CDL and CSN parser), “structural” errors
//    and “duplicate definition errors”

// The 'define' phase is the only compile() phase which is also called for
// parse.cdl.  See file ./finalize-parse-cdl.js for details.

// --------- TODO: begin in extra markdown document -----------------------------

// An XSN for a source looks like
//   { kind: 'source', artifacts: <dictionary of artifact defs>, namespace: {}, ... }
//
// The property `artifacts` of a source contains the top-level definitions.
// Definitions inside a context are not listed here (as opposed to
// `definitions`, see below), but inside the property `artifacts` of that context.

// The 'define' phase (function 'define' below) enriches a dictionary of
// (file names to) AST-like XSNs and restructure them a little bit, the result
// is called XSN ("augmented CSN"):
//   { sources: <dictionary of ASTs>, definitions: <dictionary of artifact defs> }
//
// The property `sources` is the input argument (dictionary of source ASTs).
//
// The property `definitions` is set by this compiler phase.  It contains the
// definitions of all main artifacts (i.e. not elements) from all sources, the
// key is the absolute name of that artifact.  These definitions are the same
// objects as the definitions accessible via `sources` and `artifacts` of the
// corresponding source/context.
//
// You get the compact "official" CSN format by applying the function exported
// by "../json/to-csn.js" to the XSN.

// Example 'file.cds':
//   namespace A;
//   context B {
//     type C { elem: String(4); }
//   }
// Check the augmented CSN by compiling it with
//   cdsc --raw-output + file.cds
//
// ┌───────────────┐           ┌───────────────────────────────────────────┐
// │    sources    │           │                 definitions               │
// └──┬────────────┘           └──┬────────────────────────────┬───────────┘
//    │                           │                            │
//    │ ['file.cds']              │ ['A.B']                    │ ['A.B.C']
//    ↓                           ↓                            ↓
// ┌───────────────┐  _parent  ┌────────────────┐  _parent  ┌──────────────┐
// │ kind:'source' │←──────────┤ kind:'context' │←──────────┤ kind: 'type' │
// │ artifacts: ───┼──────────→│ artifacts: ────┼──────────→│ ...          │
// └───────────────┘   ['B']   └────────────────┘   ['C']   └──────────────┘
//
// The _parent properties are not shown in the JSON - they are used for name
// resolution, see file './resolver.js'.

// An artifact definition looks as follows (example: context "A.B" above):
//   {
//     kind: 'context',
//     name: { path: [ { id: 'B'} ], absolute: 'A.B', location: { <for the id "B"> } },
//     artifacts: <for contexts, a dictionary of artifacts defined within>,
//     location: { <of the complete artifact definition> } },
//     _parent: <the parent artifact, here the source 'file.cds'>
//   }
// The properties `name.absolute`, `name.component` and `_parent` are set
// during this compiler phase.

// The definition of an entity or a structured type would contain an `elements`
// property instead of an `artifacts` property.

// An element definition looks as follows (example: "elem" above):
//   {
//     kind: 'element',
//     name: { id: 'elem', component: 'elem', location: { <for the id "elem"> } }
//     type: { path: [ { id: 'String', location: ... } ] },
//     $typeArgs: [ { number: '4', location: ... } ]
//     location: { <of the complete element definition> } },
//     _parent: <the parent artifact, here the type "A.B.C">
//   }
// --------- TODO: end in extra markdown document -------------------------------

// Sub phase 1 (addXYZ) - only for main artifacts
//  - set _block links for main definitions, vocabulary and extensions
//  - store definitions (including context extensions), NO duplicate check
//  - artifact name check
//  - Note: the only allow name resolving is resolveUncheckedPath(),
//    TODO: make sure that _no_ _artifact link is set
//  - POST: all user-written definitions are in model.definitions

// Sub Phase 2 (initXYZ)
//  - set _parent, _main (later: _service?) links, and _block links of members
//  - add _subArtifacts dictionary and "namespace artifacts" for name resolution
//  - duplicate checks
//  - structure checks ?
//  - annotation assignments
//  - POST: resolvePath() can be called for artifact references (if complete model)

// More sub phases...

// The main difficulty is the correct behavior concerning duplicate definitions
//  - For code completion, all duplicate definitions must be further checked.
//  - We need a unique object for the _subArtifacts dictionary.
//  - We must have a property at the artifact whether there are duplicates in order
//    to avoid consequential or repeated errors.
//  - But: The same artifact is added to multiple dictionaries.
//  - Solution part 1: $duplicates as property of the artifact or member
//    for `definitions`, `_artifacts`, member dictionaries, `vocabulary`
//    dictionary of the whole model, `$tableAliases` dictionary of queries.
//  - Solution part 2: array value in dictionary for duplicates in CDL `artifacts`
//    dictionary, `_combined` dictionary for query search, `$tableAliases`
//    of JOIN restrictions, `vocabulary` dictionary of a CDL input source.

'use strict';

const {
  forEachGeneric,
  forEachInOrder,
  forEachMember,
} = require('../base/model');
const { weakLocation } = require('../base/location');
const shuffleGen = require('../base/shuffle');
const {
  dictAdd, dictAddArray, dictForEach, pushToDict,
} = require('../base/dictionaries');
const { kindProperties, dictKinds } = require('./base');
const {
  setLink,
  setMemberParent,
  createAndLinkCalcDepElement,
  storeExtension,
  dependsOnSilent,
  pathName,
  targetCantBeAspect,
} = require('./utils');
const { compareLayer } = require('./moduleLayers');
const { initBuiltins } = require('./builtins');
const { isInReservedNamespace } = require('../base/builtins');

const $location = Symbol.for( 'cds.$location' );
const $inferred = Symbol.for( 'cds.$inferred' );

/**
 * Export function of this file.  Transform argument `sources` = dictionary of
 * AST-like CSNs into augmented CSN.  If a vector is provided for argument
 * `messages` (usually the combined messages from `parse` for all sources), do
 * not throw an exception in case of an error, but push the corresponding error
 * object to that vector.  If at least one AST does not exist due to a parse
 * error, set property `lintMode` of `options` to `true`.  Then, the resolver
 * does not report errors for using directives pointing to non-existing
 * artifacts.
 *
 * @param {XSN.Model} model Model with `sources` property that contain AST-like CSNs.
 */
function define( model ) {
  const { options } = model;
  // Get simplified "resolve" functionality and the message function:
  const {
    error, warning, info, messages, message,
  } = model.$messageFunctions;
  const {
    resolveUncheckedPath,
  } = model.$functions;
  const { shuffleDict, shuffleArray } = shuffleGen( options.testMode );

  Object.assign( model.$functions, {
    shuffleDict,
    shuffleArray,
    initArtifact,
    initMembers,
    initSelectItems,
  } );

  let boundSelfParamType = true; // special `$self` for binding param must still be initialised

  return doDefine();

  /**
   * Main function of the definer.
   */
  function doDefine() {
    if (options.deprecated &&
        messages.every( m => m.messageId !== 'api-deprecated-option' )) {
      warning( 'api-deprecated-option', {}, {
        prop: 'deprecated', '#': (options.beta ? 'beta' : 'std'),
      }, {
        std: 'With option $(PROP), recent features are disabled',
        beta: 'With option $(PROP), beta features and other recent features are disabled',
      } );
    }
    model.definitions = Object.create( null );
    setLink( model, '_entities', [] ); // for entities with includes
    model.$entity = 0;
    model.$compositionTargets = Object.create( null );
    model.$collectedExtensions = Object.create( null );

    initBuiltins( model );
    const sourceNames = shuffleArray( Object.keys( model.sources ) );
    for (const name of sourceNames)
      addSource( model.sources[name] );
    for (const name of sourceNames)
      initNamespaceAndUsing( model.sources[name] );
    dictForEach( model.definitions, initArtifact );
    dictForEach( model.vocabularies, initVocabulary );
    dictForEach( model.$collectedExtensions, e => e._extensions.forEach( initExtension ) );

    addI18nBlocks();

    const { $self } = model.definitions;
    if ($self) {
      message( 'name-deprecated-$self', [ $self.name.location, $self ], { name: '$self' },
               'Do not use $(NAME) as name for an artifact definition' );
    }
  }

  // Phase 1: ----------------------------------------------------------------
  // Functions called from top-level: addSource()

  /**
   * Add definitions of the given source AST, both CDL and CSN
   *
   * @param {XSN.SourceAst} src
   */
  function addSource( src ) {
    // handle sub model from parser
    if (!src.kind)
      src.kind = 'source';

    let namespace = src.namespace?.name;
    let prefix = '';
    if (namespace?.path && !namespace.path.broken) {
      namespace.id = pathName( namespace.path );
      prefix = `${ namespace.id }.`;
    }
    if (isInReservedNamespace( prefix )) {
      error( 'reserved-namespace-cds', [ src.namespace.name.location, src.namespace.name ],
             { name: 'cds' },
             'The namespace $(NAME) is reserved for CDS builtins' );
      namespace = null;
    }
    if (src.$frontend !== 'json') { // CDL input
      // TODO: set _block to builtin
      if (src.artifacts) {
        // addArtifact() adds usings to src.artifacts: shuffleDict must be assigned first
        src.artifacts = shuffleDict( src.artifacts );
        addPathPrefixes( src.artifacts, prefix ); // before addUsing
      }
      else if (src.usings || namespace) {
        src.artifacts = Object.create( null );
      }
      if (src.usings)
        shuffleArray( src.usings ).forEach( u => addUsing( u, src ) );
      if (namespace?.id)        // successfully set a full name for namespace
        addNamespace( namespace, src );
      if (src.artifacts) {      // addArtifact needs usings for context extensions
        src.artifacts = shuffleDict( src.artifacts );
        dictForEach( src.artifacts, a => addArtifact( a, src, prefix ) );
      }
    }
    else if (src.definitions) {      // CSN input
      prefix = '';                   // also for addVocabulary() below
      dictForEach( shuffleDict( src.definitions ), def => addDefinition( def, src, prefix ) );
    }
    if (src.vocabularies) {
      if (!model.vocabularies)
        model.vocabularies = Object.create( null );
      dictForEach( shuffleDict( src.vocabularies ), v => addVocabulary( v, src, prefix ) );
    }
    if (src.extensions) {       // requires using to be known!
      src.extensions.forEach( e => addExtension( e, src ) );
    }
  }

  function addDefinition( art, block, prefix ) {
    art.name.id ??= prefix + pathName( art.name.path );
    const absolute = art.name.id;
    // TODO: check reserved, see checkName()/checkLocalizedObjects() of checks.js
    if (absolute === 'cds' || isInReservedNamespace( absolute )) {
      error( 'reserved-namespace-cds', [ art.name.location, art ], { name: 'cds' },
             'The namespace $(NAME) is reserved for CDS builtins' );
      const builtin = model.definitions[absolute];
      if (builtin && builtin.builtin) // if already a builtin...
        return;
      // otherwise we just define it...
    }
    else if (art.query && (absolute === 'localized' || absolute.startsWith( 'localized.' ))) {
      // Due to recompilation, we don't emit this info message for JSON frontend.
      if (block.$frontend !== 'json') {
        info( 'ignored-localized-definition', [ art.name.location, art ], {},
              'This definition in the namespace "localized" is ignored' );
      }
      return;
    }
    setLink( art, '_block', block );
    // dictAdd might set $duplicates
    dictAdd( model.definitions, absolute, art );
  }

  // If 'A.B.C' is in 'artifacts', also add 'A' for name resolution
  function addPathPrefixes( artifacts, prefix ) {
    for (const name in artifacts) {
      const d = artifacts[name];
      const a = Array.isArray( d ) ? d[0] : d;
      a.name.id ??= prefix + pathName( a.name.path );
      const index = name.indexOf( '.' );
      if (index < 0)
        continue; // also for newly added (i.e. does not matter whether visited or not)
      const using = name.substring( 0, index );
      if (artifacts[using])
        continue;
      // TODO: enable optional locations
      const location = a.name.path?.[0]?.location || a.location;
      const absolute = prefix + using;
      artifacts[using] = {
        kind: 'using',          // !, not namespace - we do not know artifact yet
        name: { id: using, location, $inferred: 'as' },
        extern: { location, id: absolute },
        location,
        $inferred: 'path-prefix',
      };
    }
  }


  /**
   * Add the names of a USING declaration to the top-level search environment
   * of the source, and set the absolute name referred by the USING
   * declaration.
   *
   * @param {XSN.Using} decl Node to be expanded and added to `src`
   * @param {XSN.SourceAst} src
   */
  function addUsing( decl, src ) {
    setLink( decl, '_block', src );
    if (decl.usings) {
      // e.g. `using {a,b} from 'file.cds'` -> recursive
      decl.usings.forEach( u => addUsing( u, src ) );
      return;
    }
    const path = decl.extern?.path;
    if (!path || path.broken || !path[0]) // syntax error
      return;
    decl.extern.id = pathName( path );
    if (!decl.name)
      decl.name = { ...path.at(-1), $inferred: 'as' };
    const name = decl.name.id;
    // TODO: check name: no "."
    const found = src.artifacts[name];
    // a real `using` declaration is “nicer” than a compiler-generated one:
    if (found && found.$inferred === 'path-prefix' && found.extern.id === decl.extern.id)
      src.artifacts[name] = decl;
    else
      dictAddArray( src.artifacts, name, decl );
  }

  // must be called after addUsing().
  function addNamespace( namespace, src ) {
    // create using for own namespace:
    // TODO: should we really do that (in v6)?  See also initNamespaceAndUsing().
    const last = namespace.path.at(-1);
    const { id } = last;
    if (src.artifacts[id] || last.id.includes( '.' ))
      // not used as we have a definition/using with that name, or dotted last path id
      return;
    src.artifacts[id] = {
      kind: 'using',
      name: { id, location: last.location, $inferred: 'as' },
      extern: namespace,
      location: namespace.location,
      $inferred: 'namespace',
    };
  }
  function addArtifact( art, block, prefix ) {
    if (art.kind === 'using')
      return;
    addDefinition( art, block, prefix );
    if (art.artifacts) {
      const p = `${ art.name.id }.`;
      // path prefixes (usings) must be added before extensions in artifacts:
      addPathPrefixes( art.artifacts, p );
      dictForEach( art.artifacts, a => addArtifact( a, art, p ) );
    }
    if (art.extensions) {       // requires using to be known!
      art.extensions.forEach( e => e.name && addExtension( e, art ) );
    }
  }

  function addExtension( ext, block ) {
    setLink( ext, '_block', block );
    const absolute = ext.name && resolveUncheckedPath( ext.name, '_extensions', ext );
    if (!absolute)                    // broken path
      return;
    delete ext.name.path[0]._artifact; // might point to wrong JS object in phase 1
    ext.name.id = absolute; // definition might not be there yet, no _artifact link
    const location = { file: '' }; // stupid required location
    const late = model.$collectedExtensions[absolute] ||
          (model.$collectedExtensions[absolute] = {
            kind: 'annotate',
            name: { id: absolute, location },
            $inferred: '',
            location,
          });
    pushToDict( late, '_extensions', ext );
    if (!ext.artifacts)
      return;

    // Directly add the artifacts of context and service extension:
    if (!model.$blocks)
      model.$blocks = Object.create( null );
    // Set block number for debugging (--raw-output):
    // eslint-disable-next-line no-multi-assign
    ext.$effectiveSeqNo = model.$blocks[absolute] = (model.$blocks[absolute] || 0) + 1;
    // add "namespace" for the case that ext.artifacts is empty (TODO: later)
    // now add all definitions in ext.artifacts:
    const prefix = `${ absolute }.`;
    dictForEach( ext.artifacts, a => addArtifact( a, ext, prefix ) );
  }

  function initExtension( parent ) {
    forEachMember( parent, function initExtensionMember( sub, name, prop ) {
      if (sub.kind !== 'extend' && sub.kind !== 'annotate')
        return;                 // for defs inside, set somewhere else - TODO: rethink
      if (prop === 'params' && name === '') // RETURNS
        sub.name = { id: '', location: sub.location };
      setLink( sub, '_block', parent._block );
      setLink( sub, '_parent', parent );
      setLink( sub, '_main', parent._main || parent );
      initExtension( sub );
    } );
    if (parent.kind !== 'extend')
      return;
    // TODO: sub queries? expand/inline?
    parent.columns?.forEach( c => setLink( c, '_block', parent._block ) );
    if (parent.scale && !parent.precision) {
      // TODO: where could we store the location of the name?
      error( 'syntax-missing-type-property', [ parent.scale.location ],
             { prop: 'scale', otherprop: 'precision' },
             'Type extension with property $(PROP) must also have property $(OTHERPROP)' );
      parent.scale = undefined; // no consequential error
    }
  }

  function addVocabulary( vocab, block, prefix ) {
    setLink( vocab, '_block', block );
    const { name } = vocab;
    name.id ??= prefix + pathName( name.path );
    dictAdd( model.vocabularies, name.id, vocab );
  }

  /**
   * Add (optional) translations into the XSN model.
   */
  function addI18nBlocks() {
    // TODO: the sequence should be in sync with extend / annotate / future $sources
    const sortedSources = Object.keys( model.sources )
      .filter( name => !!model.sources[name].i18n )
      .sort( (a, b) => compareLayer( model.sources[a], model.sources[b] ) );

    if (sortedSources.length === 0)
      return;

    if (!model.i18n)
      model.i18n = Object.create( null );

    for (const name of sortedSources)
      addI18nFromSource( model.sources[name] );
  }

  /**
   * Add the source's translations to the model. Warns if the source's translations
   * do not match the ones from previous sources.
   *
   * @param {XSN.SourceAst} src
   */
  function addI18nFromSource( src ) {
    for (const langKey of Object.keys( src.i18n )) {
      if (!model.i18n[langKey])
        model.i18n[langKey] = Object.create( null );

      for (const textKey of Object.keys( src.i18n[langKey] )) {
        const sourceVal = src.i18n[langKey][textKey];
        const modelVal = model.i18n[langKey][textKey];
        if (!modelVal) {
          model.i18n[langKey][textKey] = sourceVal;
        }
        else if (modelVal.val !== sourceVal.val) {
          // TODO: behave like annotation assignments?  message-id?
          warning( 'i18n-different-value', sourceVal.location,
                   { prop: textKey, otherprop: langKey } );
        }
      }
    }
  }

  // Phase 2 ("init"), top-level & main -----------------------------------------
  // Functions called from top-level: initNamespaceAndUsing(), initArtifact(),
  // initVocabulary(), initExtension()

  // TODO: message ids
  function checkRedefinition( art ) {
    if (!art.$duplicates || !art.name.id ||
        art.$errorReported === 'syntax-duplicate-extend')
      return;
    if (art.kind === 'annotate' || art.kind === 'extend')
      return; // extensions are merged into a super-annotate; $duplicates are only kept for LSP
    if (art._main) {
      error( 'duplicate-definition', [ art.name.location, art ], {
        name: art.name.id,
        '#': kindProperties[art.kind].normalized || art.kind,
      } );
    }
    else if (!art.builtin) {
      // TODO: better messages with definitions with the same name as builtin,
      // especially if there is just one
      error( 'duplicate-definition', [ art.name.location, art ], {
        name: art.name.id,
        '#': (art.kind === 'annotation' ? 'annotation' : 'absolute' ),
      } );
    }
  }

  function initNamespaceAndUsing( src ) {
    if (src.$frontend && src.$frontend !== 'cdl')
      return;
    if (src.namespace) {
      const decl = src.namespace.name;
      if (!decl.id)             // parsing may have failed
        return;
      if (!model.definitions[decl.id]) {
        // TODO: make it possible to have no location
        const ns = { kind: 'namespace', name: decl, location: decl.location };
        model.definitions[decl.id] = ns;
        initArtifactParentLink( ns, model.definitions );
      }
      const last = decl.path[decl.path.length - 1];
      const builtin = model.$builtins[last.id];
      if (builtin && !builtin.internal &&
          src.artifacts[last.id] && src.artifacts[last.id].extern === decl) {
        warning( 'ref-shadowed-builtin', [ decl.location, null ], // no home artifact
                 { id: last.id, art: decl.id, code: `using ${ builtin.name.id };` },
                 '$(ID) now refers to $(ART) - consider $(CODE)' );
      }
      // setArtifactLink( decl, model.definitions[absolute] ); // TODO: necessary?
    }
    if (!src.usings)
      return;
    for (const name in src.artifacts) {
      const entry = src.artifacts[name];
      if (!Array.isArray( entry )) // no local name duplicate
        continue;
      for (const decl of entry) {
        if (!decl.$duplicates) { // do not have two duplicate messages
          error( 'duplicate-using', [ decl.name.location, decl ], { name },
                 'Duplicate definition of top-level name $(NAME)' );
        }
      }
    }
  }

  function initArtifact( art, reInit = false ) {
    if (!reInit)
      initArtifactParentLink( art, model.definitions );
    const block = art._block;
    checkRedefinition( art );
    initDollarSelf( art );      // $self
    initMembers( art, art, block );
    if (art.params)
      initDollarParameters( art ); // $parameters
    if (art.query) {
      initArtifactQuery( art );
      restrictToSimpleProjection( art );
    }
  }

  /**
   * Restrict the query of `art` to only simple projections, i.e. those without 'group by', etc.
   *
   * @param {XSN.Artifact} art
   */
  function restrictToSimpleProjection( art ) {
    const { query } = art;

    if (art.kind !== 'type')
      return; // TODO(v6): Also for event

    if (!query.from?.path)
      return; // union, sub-select, etc. should already be rejected

    const check = (prop, keyword) => (query[prop] && { prop: query[prop], keyword });
    const unexpectedQueryProp = check( 'where', 'where' ) ||
      check( 'groupBy', 'group by' ) ||
      check( 'limit', 'limit' ) ||
      check( 'having', 'having' ) ||
      check( 'orderBy', 'order by' ) ||
      null;

    if (unexpectedQueryProp) {
      error( 'query-unexpected-prop', [ unexpectedQueryProp.prop.location, query ], {
        '#': art.kind,
        keyword: unexpectedQueryProp.keyword,
      }, {
        std: 'Unexpected $(KEYWORD) for projection clause used as type expression',
        type: 'Unexpected $(KEYWORD) for type definition',
        event: 'Unexpected $(KEYWORD) for event definition',
      } );
      return;
    }

    const firstCondition = query.from.path.find(step => step.where)?.where;
    if (firstCondition) {
      error( 'query-unexpected-filter', [ firstCondition.location, query ], { '#': art.kind }, {
        std: 'Unexpected filter in query source for projection clause used as type expression',
        type: 'Unexpected filter in projection clause of type definition',
        event: 'Unexpected filter in projection clause of event definition',
      } );
    }
  }

  function initArtifactQuery( art ) {
    art.$queries = [];
    setLink( art, '_from', [] ); // for sequence of resolve steps - TODO: remove
    if (!setLink( art, '_leadingQuery', initQueryExpression( art.query, art ) ) )
      return;                   // null or undefined in case of parse error
    // if (art._leadingQuery !== art.$queries [0]) throw Error('FOO');
    setLink( art._leadingQuery, '_$next', art );
    if (art.elements) { // specified element via compilation of client-style CSN
      // TODO: consider this part of a revamped on-demand 'extend' functionality
      setLink( art, 'elements$', art.elements );
      delete art.elements;
    }
  }

  function initVocabulary( art ) {
    initArtifactParentLink( art, model.vocabularies );
    checkRedefinition( art );
    const block = art._block;
    initMembers( art, art, block );

    if (art.query) {
      initArtifactQuery( art );
      error( 'def-unsupported-projection', [ art.location, art ], null,
             'Projections for annotation definitions are not supported' );
    }
  }

  function initArtifactParentLink( art, definitions, path, pathIndex ) {
    setLink( art, '_parent', null );
    const { id } = art.name;
    const dot = id.lastIndexOf( '.' );
    if (dot < 0)
      return;
    const prefix = id.substring( 0, dot );
    let parent = definitions[prefix];
    if (!parent) {
      path ??= art.name.path;
      pathIndex ??= path?.length - 1;
      const pathItemOrName = (path && pathIndex) ? path[--pathIndex] : art.name;
      const location = weakLocation( pathItemOrName.location );
      parent = { kind: 'namespace', name: { id: prefix, location }, location };
      definitions[prefix] = parent;
      initArtifactParentLink( parent, definitions, path, pathIndex );
    }
    setLink( art, '_parent', parent );
    if (!parent._subArtifacts)
      setLink( parent, '_subArtifacts', Object.create( null ) );
    if (art.$duplicates !== true) // no redef or "first def"
      parent._subArtifacts[id.substring( dot + 1 )] = art; // not dictAdd()
  }

  // Init special things: -------------------------------------------------------

  function initDollarSelf( art ) {
    // TODO: use setMemberParent() ?
    const self = {
      name: { id: '$self', location: art.location },
      kind: '$self',
      location: art.location,
    };
    setLink( self, '_parent', art );
    setLink( self, '_main', art ); // used on main artifact
    setLink( self, '_origin', art );
    art.$tableAliases = Object.create( null );
    art.$tableAliases.$self = self;
  }

  function initDollarParameters( art ) {
    // TODO: use setMemberParent() ?
    const parameters = {
      name: { id: '$parameters' },
      kind: '$parameters',
      location: art.location,
      deprecated: true, // hide in code completion
    };
    setLink( parameters, '_parent', art );
    setLink( parameters, '_main', art );
    // Search for :const after :param.  If there will be a possibility in the
    // future that we can extend <query>.columns, we must be sure to use
    // _block of that new column after :param (or just allow $parameters there).
    setLink( parameters, '_block', art._block );
    if (art.params) {
      parameters.elements = art.params;
      parameters.$tableAliases = art.params; // TODO: find better name - $lexical?
    }
    art.$tableAliases.$parameters = parameters;
  }

  // From here til EOF, reexamine code ---------------------------------------
  // See populate:
  // - userQuery() or _query property?
  // - initFromColumns()
  // - ensureColumnName()

  // Init queries: --------------------------------------------------------------

  // art is:
  // - entity/event/type for top-level queries (including UNION args)
  // - $tableAlias for sub query in FROM - TODO: what about UNION there?
  // - $query for real sub query (in columns, WHERE, ...), again: what about UNION there?
  function initQueryExpression( query, art ) {
    if (!query)                 // parse error
      return query;
    if (query.from) {      // select
      initQuery();
      initTableExpression( query.from, query, [] );
      if (query.mixin)
        initMixins( query, art );
      if (!query.$tableAliases.$self) { // same as $projection
        const self = {
          name: { id: '$self', location: query.location },
          kind: '$self',
          location: query.location,
        };
        setLink( self, '_origin', query );
        setLink( self, '_parent', query );
        setLink( self, '_main', query._main );

        const projection = { ...self, deprecated: true }; // hide in code completion
        setLink( projection, '_origin', query );
        setLink( projection, '_parent', query );
        setLink( projection, '_main', query._main );

        query.$tableAliases.$self = self;
        query.$tableAliases.$projection = projection;
      }
      initSubQuery( query );    // check for SELECT clauses after from / mixin
    }
    else if (query.args) {      // UNION, INTERSECT, ..., query in parens
      const leading = initQueryExpression( query.args[0], art );
      for (const q of query.args.slice(1))
        initQueryExpression( q, art );
      setLink( query, '_leadingQuery', leading );
      if (leading) {
        if (query.orderBy) {
          leading.$orderBy ??= [ ];
          leading.$orderBy.push( ...query.orderBy );
        }
        if (query.limit) {
          leading.$limit ??= [ ];
          leading.$limit.push( query.limit );
        }
      }
      // ORDER BY and LIMIT to be evaluated in leading query
    }
    else { // with parse error (`select from <EOF>`, `select from E { *, ( select }`)
      return undefined;
    }
    return query._leadingQuery || query;

    function initQuery() {
      const main = art._main || art;
      setLink( query, '_$next',
               (art.kind === '$tableAlias' ? art._parent._$next : art ) );
      setLink( query, '_block', art._block );
      query.kind = 'select';
      query.name = { location: query.location, id: main.$queries.length + 1 };
      setMemberParent( query, null, main );
      // console.log(art.kind,art.name,query.name,query._$next.name)
      main.$queries.push( query );
      setLink( query, '_parent', art ); // _parent should point to alias/main/query
      query.$tableAliases = Object.create( null ); // table aliases and mixin definitions
      dependsOnSilent( main, query );
    }
  }

  // table is table expression in FROM, becomes an alias
  function initTableExpression( table, query, joinParents ) {
    if (!table)                 // parse error
      return;
    if (table.path) {           // path in FROM
      if (!table.path.length || table.path.broken)
        // parse error (e.g. final ',' in FROM), projection on <eof>
        return;
      if (!table.name) {
        const last = table.path[table.path.length - 1];
        const dot = last?.id?.lastIndexOf( '.' );
        const id = (dot >= 0) ? last.id.substring( dot + 1 ) : last.id || '';
        // TODO: if we have too much time, we can calculate the real location with '.'
        table.name = { $inferred: 'as', id, location: last.location };
      }
      addAsAlias();
      // _origin is set when we resolve the ref
      if (query._parent.kind !== 'select')
        query._main._from.push( table ); // store tabref if outside "real" subquery
      // (tab refs on the right of union are unnecessary)
    }
    else if (table.query) {
      if (!table.name?.id) {
        // We don't worry about duplicate names here.
        const id = `$_select_${ query._main.$queries.length + 1 }__`;
        table.name = { id, location: table.location, $inferred: '$internal' };
      }
      addAsAlias();
      // Store _origin to leading query of table.query for name resolution
      setLink( table, '_origin', initQueryExpression( table.query, table ) );
    }
    else if (table.join) {
      if (table.on) {
        setLink( table, '_$next', query ); // or query._$next?
        setLink( table, '_block', query._block );
        table.kind = '$join';
        table.name = { location: query.location }; // param comes later
        table.$tableAliases = Object.create( null ); // table aliases and mixin definitions
        joinParents = [ ...joinParents, table ];
      }
      if (table.args) {
        table.args.forEach( (tab, index) => {
          // set for A2J such that for every table alias `ta`:
          // ta === (ta._joinParent
          //        ? ta._joinParent.args[ta.$joinArgsIndex] // in JOIN
          //        : ta._parent.from )                      // directly in FROM
          // Note for --raw-output: _joinParent pointing to CROSS JOIN node has not name
          if (!tab)             // parse error; time for #6241
            return;             // (parser method to only add non-null to array)
          setLink( tab, '_joinParent', table );
          tab.$joinArgsIndex = index;
          initTableExpression( tab, query, joinParents );
        } );
      }
      if (table.on) {         // after processing args to get the $tableAliases
        setMemberParent( table, query.name.id, query ); // sets _parent,_main
        initSubQuery( table );  // init sub queries in ON
        const aliases = Object.keys( table.$tableAliases || {} );
        // Use first table alias name on the right side of the join to name the
        // (internal) query, should only be relevant for --raw-output, not for
        // user messages or references - TODO: correct if join on left?
        table.name.id = aliases[1] || aliases[0] || '<unknown>';
        setLink( table, '_user', query ); // TODO: do not set kind/name
        setLink( table, '_$next', query._$next );
        // TODO: probably set this to query if we switch to name restriction in JOIN
      }
    }
    return;

    function addAsAlias() {
      table.kind = '$tableAlias';
      setMemberParent( table, table.name.id, query );
      setLink( table, '_block', query._block );
      dictAdd( query.$tableAliases, table.name.id, table, ( name, loc, tableAlias ) => {
        if (tableAlias.name.$inferred === '$internal') {
          const semanticLoc = tableAlias.query?.name ? tableAlias.query : tableAlias;
          // TODO: the semanticLoc query is not initialized yet, and thus cannot
          // be used here
          error( 'name-missing-alias', [ tableAlias.location, semanticLoc ],
                 { '#': 'duplicate', code: 'as ‹alias›' } );
        }
        else {
          error( 'duplicate-definition', [ loc, table ], { name, '#': 'alias' } );
        }
      } );
      // also add to JOIN nodes for name restrictions:
      for (const p of joinParents) {
        // for JOIN alias restriction, we cannot use $duplicates, as it is
        // already used for duplicate aliases of queries:
        dictAddArray( p.$tableAliases, table.name.id, table );
      }
      if (table.name?.id[0] === '$' && table.name.$inferred !== '$internal') {
        message( 'name-invalid-dollar-alias', [ table.name.location, table ], {
          '#': (table.name.$inferred ? '$tableImplicit' : '$tableAlias'),
          name: '$',
          keyword: 'as',
        } );
      }
    }
  }

  function initSubQuery( query ) {
    if (query.on)
      initExprForQuery( query.on, query );
    // TODO: MIXIN with name = ...subquery (not yet supported anyway)
    initSelectItems( query, query.columns, query );
    if (query.where)
      initExprForQuery( query.where, query );
    if (query.having)
      initExprForQuery( query.having, query );
    initMembers( query, query, query._block );
  }

  function initExprForQuery( expr, query ) {
    // TODO: use traverseExpr()
    if (Array.isArray( expr )) { // TODO: old-style $parens ?
      expr.forEach( e => initExprForQuery( e, query ) );
    }
    else if (!expr) {
      return;
    }
    else if (expr.query) {
      initQueryExpression( expr.query, query );
    }
    else if (expr.args) {
      const args = Array.isArray( expr.args ) ? expr.args : Object.values( expr.args );
      args.forEach( e => initExprForQuery( e, query ) );
    }
    else if (expr.path && expr.$expected === 'exists') {
      // TODO: does really the parser has to set $expected?
      expr.$expected = 'approved-exists';
      approveExistsInChildren( expr );
    }
  }

  function initMixins( query, art ) {
    forEachInOrder( query, 'mixin', initMixin );

    function initMixin( mixin, name ) {
      setLink( mixin, '_block', art._block );
      setMemberParent( mixin, name, query );
      checkRedefinition( mixin );
      if (!(mixin.$duplicates)) {
        // TODO: do some initMembers() ?  If people had annotation
        // assignments on the mixin... (also for future mixin definitions
        // with generated values)
        dictAdd( query.$tableAliases, name, query.mixin[name], ( dupName, loc ) => {
          error( 'duplicate-definition', [ loc, query ], { name: dupName, '#': 'alias' } );
        } );
        if (mixin.name.id[0] === '$') {
          message( 'name-invalid-dollar-alias', [ mixin.name.location, mixin ],
                   { '#': 'mixin', name: '$' } );
        }
      }
    }
  }

  function initSelectItems( parent, columns, user, inExtension = false ) {
    let wildcard = !!inExtension; // no `extend … with columns { * }`
    // TODO: forbid expand/inline in ref-where, outside queries (CSN), ...
    let hasItems = false;
    for (const col of columns || parent.expand || parent.inline || []) {
      if (!col)                 // parse error
        continue;
      hasItems = true;
      if (!columns) {           // expand or inline
        if (parent.value)
          setLink( col, '_columnParent', parent ); // also set for '*' in expand/inline
        else if (parent._columnParent)
          setLink( col, '_columnParent', parent._columnParent );
      }
      if (col.val === '*') {
        if (!wildcard) {
          wildcard = col;
        }
        else if (wildcard === true) { // in `extend … with columns {…}`
          error( 'ext-unexpected-wildcard', [ col.location, parent ], { code: '*' },
                 'Unexpected $(CODE) (wildcard) in an extension' );
          col.val = null;       // do not consider it for expandWildcard()
        }
        else {
          // a late syntax error (this code also runs with parse-cdl), i.e.
          // no semantic loc (wouldn't be available for expand/inline anyway)
          // TODO: why here and not in parser?
          error( 'syntax-duplicate-wildcard', [ col.location, null ], {
            '#': (wildcard.location.col ? 'col' : 'std'),
            prop: '*',
            line: wildcard.location.line,
            col: wildcard.location.col,
          }, {
            std: 'You have provided a $(PROP) already in line $(LINE)',
            col: 'You have provided a $(PROP) already at line $(LINE), column $(COL)',
          } );
          // TODO: extra text variants for expand/inline? - probably not
          col.val = '**';       // do not consider it for expandWildcard()
        }
      }
      // Either expression (value), expand, new virtual or new association
      else if (col.value || col.name) {
        if (!col._block)
          setLink( col, '_block', parent._block );
        if (col.inline) { // `@anno elem.{ * }` does not work
          if (col.doc) {
            message( 'syntax-unexpected-anno', [ col.doc.location, col ],
                     { '#': 'doc', code: '.{ ‹inline› }' } );
          }
          // col.$annotations no available for CSN input, have to search.
          // Message about first annotation should be enough to avoid spam.
          const firstAnno = Object.keys( col ).find( key => key.startsWith( '@' ) );
          if (firstAnno) {
            message( 'syntax-unexpected-anno', [ col[firstAnno].name.location, col ],
                     { code: '.{ ‹inline› }' } );
          }
        }
        // TODO: allow sub queries? at least in top-level expand without parallel ref
        if (columns && !inExtension) // not (yet) in `extend … with columns {…}`
          initExprForQuery( col.value, parent );
        initSelectItems( col, null, user ); // TODO: use col as user (i.e. remove param)
      }

      initItemsLinks( col, parent._block );
    }

    if (hasItems && !wildcard && parent.excludingDict && !options.$recompile) {
      // TODO: the SQL backend should probably delete `excluding` when expanding `*`
      // TODO: use `parent` for semantic location; requires `_parent`/... links.
      warning( 'query-ignoring-excluding', [ parent.excludingDict[$location], user ],
               { prop: '*' },
               'Excluding elements without wildcard $(PROP) has no effect' );
    }
  }

  /**
   * If we have a valid top-level exists, exists in filters of sub-expressions can be translated,
   * since we will have a top-level subquery after exists-processing in the forRelationalDB.
   *
   * Recursively drill down into:
   * - the .path
   * - the .args
   * - the .where.args
   *
   * Any $expected === 'exists' encountered along the way are turned into 'approved-exists'
   *
   * working:     exists toE[exists toE] -> select from E where exists toE
   * not working: toE[exists toE] -> we don't support subqueries in filters
   *
   * @param {object} exprOrPathElement starts w/ an expr but then subelem from .path or .where.args
   */
  function approveExistsInChildren( exprOrPathElement ) {
    if (!exprOrPathElement) // may be null in case of parse error
      return;
    if (exprOrPathElement.$expected === 'exists')
      exprOrPathElement.$expected = 'approved-exists';
    // Drill down
    if (Array.isArray(exprOrPathElement.args))
      exprOrPathElement.args.forEach( elem => approveExistsInChildren( elem ) );
    else if (exprOrPathElement.where?.args)
      exprOrPathElement.where.args.forEach( elem => approveExistsInChildren( elem ) );
    else if (exprOrPathElement.path)
      exprOrPathElement.path.forEach( elem => approveExistsInChildren( elem ) );
  }
  // TODO: we might issue 'expr-unexpected-exists' and 'expr-no-subquery' already in
  // define.js (using a to-be-written expression traversal function in utils.js)

  // Members (elements, enum, actions, params): ---------------------------------

  /**
   * Set property `_parent` for all elements in `parent` to `parent` and do so
   * recursively for all sub elements.
   *
   * If not for extensions: construct === parent
   *
   * Param `initExtensions` is for parse.cdl - TODO delete
   *
   * TODO: separate extension!
   */
  function initMembers( construct, parent, block, initExtensions = false ) {
    // TODO: split extend from init
    const main = parent._main || parent;
    const isQueryExtension = construct.kind === 'extend' && main.query;
    let obj = initItemsLinks( construct, block );
    if (obj.target && targetIsTargetAspect( obj )) {
      obj.targetAspect = obj.target;
      delete obj.target;
    }
    const { targetAspect } = obj;
    if (targetAspect) {
      if (obj.foreignKeys) {
        error( 'type-unexpected-foreign-keys', [ obj.foreignKeys[$location], construct ] );
        delete obj.foreignKeys; // continuation semantics: not specified
      }
      if (obj.on && !obj.target) {
        error( 'type-unexpected-on-condition', [ obj.on.location, construct ] );
        delete obj.on;          // continuation semantics: not specified
      }
      if (targetAspect.elements)
        initAnonymousAspect();
    }
    if (obj !== parent && obj.elements && parent.enum) { // applying the extension
      initElementsAsEnum();
    }
    else {
      if (checkDefinitions( construct, parent, 'elements', obj.elements || false ))
        forEachInOrder( obj, 'elements', init );
      if (checkDefinitions( construct, parent, 'enum', obj.enum || false ))
        forEachGeneric( obj, 'enum', init );
    }

    if (obj.foreignKeys)
      forEachInOrder( obj, 'foreignKeys', init );
    if (checkDefinitions( construct, parent, 'actions' ))
      forEachGeneric( construct, 'actions', init );
    if (checkDefinitions( construct, parent, 'params' ))
      forEachInOrder( construct, 'params', init );
    const { returns } = construct;
    if (returns) {
      const { kind } = construct;
      returns.kind = (kind === 'extend' || kind === 'annotate') ? kind : 'param';
      init( returns, '' );      // '' is special name for returns parameter
    }
    return;

    function initElementsAsEnum() {
      // in extensions, extended enums are represented as elements
      let hasElement = false;
      for (const n in obj.elements) {
        const e = obj.elements[n];
        if (e.kind === 'extend')
          continue;
        const noVal = e.value?.val === undefined && e.value?.sym === undefined;
        // TODO: forbid #symbol as enum value
        if (e.$syntax === 'element' || // `extend … with elements` or `extend with { element … }`
            noVal && e.$syntax !== 'enum' || // no value in CDL input
            e.virtual || e.key || e.masked || e.type || e.elements || e.items || e.stored) {
          // We do not want to complain separately about all element properties:
          error( 'ext-unexpected-element', [ e.location, construct ],
                 { name: e.name.id, code: 'extend … with enum' },
                 // eslint-disable-next-line @stylistic/js/max-len
                 'Unexpected elements like $(NAME) in an extension for an enum. Additionally, use $(CODE) when extending enums' );
          // Don't emit 'ext-expecting-enum' if this error is emitted.
          return;
        }
        e.kind = 'enum';
        if (noVal || e.$syntax !== 'enum')
          hasElement = true;    // warning with CDL input or `name: {}` in CSN input
      }
      if (hasElement) {
        // This message is similar to the one above.  In v6, we could probably
        // turn this warning into an error, remove `$syntax: 'element' (also in
        // language.g4), and use the above `ext-unexpected-element` only for CSN input.
        warning( 'ext-expecting-enum', [ obj.elements[$location], construct ],
                 { code: 'extend … with enum' }, 'Use $(CODE) when extending enums' );
      }
      forEachGeneric( { enum: obj.elements }, 'enum', init );
    }

    function initAnonymousAspect() {
      // TODO: main?
      const inEntity = parent._main?.kind === 'entity';
      // TODO: also allow indirectly (component in component in entity)?
      setLink( targetAspect, '_outer', obj );
      setLink( targetAspect, '_parent', parent._parent );
      setLink( targetAspect, '_main', null ); // for name resolution

      parent = targetAspect;
      construct = parent;     // avoid extension behavior
      targetAspect.kind = 'aspect';   // TODO: probably '$aspect' to detect
      setLink( targetAspect, '_block', block );
      initDollarSelf( targetAspect );
      // allow ref of up_ in anonymous aspect inside entity
      // (TODO: complain if used and the managed composition is included into
      // another entity - might induce auto-redirection):
      if (inEntity && !targetAspect.elements.up_) {
        const up = {
          name: { id: 'up_' },
          kind: '$navElement',
          location: obj.location,
        };
        setLink( up, '_parent', targetAspect );
        setLink( up, '_main', targetAspect ); // used on main artifact
        // recompilation case: both target and targetAspect → allow up_ in that case, too:
        const name = obj.target && resolveUncheckedPath( obj.target, 'target', obj );
        const entity = name && model.definitions[name];
        if (entity && entity.elements)
          setLink( up, '_origin', entity.elements.up_ );
        // processAspectComposition/expand() sets _origin to element of
        // generated target entity
        targetAspect.$tableAliases.up_ = up;
      }
      obj = targetAspect;
    }

    function init( elem, name, prop ) {
      if (!elem.kind)           // wrong CSN input
        elem.kind = dictKinds[prop];
      if (!elem.name && !elem._outer) {
        const ref = elem.targetElement || elem.kind === 'element' && elem.value;
        if (ref && ref.path) {
          elem.name = Object.assign( { $inferred: 'as' },
                                     ref.path[ref.path.length - 1] );
        }
        else {                  // RETURNS, parser robustness
          elem.name = { id: name, location: elem.location };
        }
      }
      // if (!kindProperties[ elem.kind ]) console.log(elem.kind,elem.name)
      if ((elem.kind === 'extend' || elem.kind === 'annotate') && !initExtensions) {
        storeExtension( elem, name, prop, parent, block );
        return;
      }
      if (isQueryExtension && elem.kind === 'element') {
        error( 'extend-query', [ elem.location, construct ], // TODO: searchName ?
               { code: 'extend projection' },
               'Use $(CODE) to add select items to the query entity' );
        return;
      }

      const bl = elem._block || block;
      setLink( elem, '_block', bl );
      const existing = parent[prop]?.[name];
      const add = construct !== parent && (!existing || elem.$inferred !== 'include');
      // don't dump with `entity T {}; extend T with { extend e {}; e {}; e {} };`:
      if (elem.$duplicates === true && add)
        elem.$duplicates = null;
      setMemberParent( elem, name, parent, add && prop );
      // console.log(message( null, elem.location, elem, {}, 'Info', 'INIT').toString())
      checkRedefinition( elem );
      initMembers( elem, elem, bl, initExtensions );
      if (boundSelfParamType && (elem.kind === 'action' || elem.kind === 'function'))
        initBoundSelfParam( elem.params, elem._main );

      // for a correct home path, setMemberParent needed to be called

      if (!elem.value || elem.kind !== 'element' ||
          elem.$syntax === 'enum' && parent.kind === 'extend') // ambiguous in parse-cdl
        return;
      // -> it's a calculated element
      if (!elem.type && elem.value?.type) {  // top-level CAST( expr AS type )
        if (!elem.target)
          elem.type = { ...elem.value.type, $inferred: 'cast' };
      }
      elem.$syntax = 'calc';
      // TODO: it is not just "syntax" - maybe better test for `$calcDepElement`?
      createAndLinkCalcDepElement( elem );

      // Special case (hack) for calculated elements that use composition+filter:
      // See "Notes on `$enclosed`" in `ExposingAssocWithFilter.md` for details.
      if (elem.target && elem.value.path?.[elem.value.path.length - 1]?.where) {
        delete elem.type;
        delete elem.on;
        delete elem.target;
      }
    }
  }

  function initBoundSelfParam( params, main ) {
    if (!params)
      return;
    if (boundSelfParamType === true) { // first try
      const def = model.definitions.$self;
      if (def) {
        boundSelfParamType = false;
        return;
      }
      boundSelfParamType = '$self';
    }
    const first = params[Object.keys( params )[0] || ''];
    const type = first?.type || first?.items?.type; // this sequence = no derived type
    const path = type?.path;
    if (path?.length === 1 && path[0]?.id === '$self') { // TODO: no where: ?
      const $self = main.$tableAliases?.$self ||
                    main.kind === 'extend' && { name: { id: '$self' } };
      // remark: an 'extend' has no "table alias" `$self` (relevant for parse-cdl)
      setLink( type, '_artifact', $self );
      setLink( path[0], '_artifact', $self );
    }
  }

  /**
   * Initialize artifact links inside `obj.items` (for nested ones as well).
   * Does nothing, it `obj.items` does not exist.
   *
   * @param {XSN.Artifact} obj
   * @param {object} block
   * @return {XSN.Artifact}
   */
  function initItemsLinks( obj, block ) {
    let { items } = obj;
    while (items) {
      setLink( items, '_outer', obj );
      setLink( items, '_parent', obj._parent );
      setLink( items, '_block', block );
      obj = items;
      items = obj.items;
    }
    return obj;
  }

  // To be reworked -------------------------------------------------------------

  // TODO: is only necessary for extensions - make special for extend/annotate
  function checkDefinitions( construct, parent, prop, dict = construct[prop] ) {
    // TODO: do differently, see also annotateMembers() in resolver
    // To have been checked by parsers:
    // - artifacts (CDL-only anyway) only inside [extend] context|service
    if (!dict)
      return false;
    const feature = kindProperties[parent.kind][prop];
    if (feature &&
        (feature === true || construct.kind !== 'extend' || feature( prop, parent )))
      return true;
    const location = dict[$location];

    // TODO: a bit inconsistent = not a simple switch on `prop`…
    if (prop === 'actions') {
      if (Object.keys( dict ).length) {
        error( 'def-unexpected-actions', [ location, construct ], {}, // TODO: ext-
               'Actions and functions only exist top-level and for entities' ); // or aspects
      }
      else {
        warning( 'ext-ignoring-actions', [ location, construct ], {},
                 'Actions and functions only exist top-level and for entities' );
        return false;
      }
    }
    else if (parent.kind === 'action' || parent.kind === 'function') {
      error( 'ext-unexpected-action', [ construct.location, construct ], { '#': parent.kind }, {
        std: 'Actions and functions can\'t be extended, only annotated', // TODO: → ext-unsupported
        action: 'Actions can\'t be extended, only annotated',
        function: 'Functions can\'t be extended, only annotated',
      } );
    }
    else if (prop === 'params') {
      if (!feature) {
        // Note: This error can't be triggered at the moment.  But as we likely want to
        //       allow extensions with params in the future, we keep the code.
        error( 'def-unexpected-params', [ location, construct ], {},
               'Parameters only exist for entities, actions or functions' );
      }
      else {
        // remark: we could allow this
        error( 'extend-with-params', [ location, construct ], {},
               'Extending artifacts with parameters is not supported' );
      }
    }
    else if (feature) {         // allowed in principle, but not with extend
      if (!Object.keys( dict ).length) {
        warning( 'ext-ignoring-elements', [ location, construct ], {},
                 'Only structures with directly specified elements can be extended by elements' );
        return false;
      }
      else if (parent.$inferred === 'include') { // special case for better error message
        const variant = (construct.enum || construct.elements) ? 'elements' : 'std';
        error( 'ref-expected-direct-structure', [ location, construct ],
               { '#': variant, art: parent } );
      }
      else {
        error( 'extend-type', [ location, construct ], {},
               'Only structures or enum types can be extended with elements/enums' );
      }
    }
    else if (prop === 'elements') {
      error( 'def-unexpected-elements', [ location, construct ], {},
             'Elements only exist in entities, types or typed constructs' );
    }
    else if (prop === 'columns') {
      error( 'extend-columns', [ location, construct ], { art: construct } );
    }
    else { // if (prop === 'enum') {
      error( 'def-unexpected-enum', [ location, construct ], {},
             'Enum symbols can only be defined for types or typed constructs' );
    }
    return construct === parent;
  }

  /**
   * Return whether the `target` is actually a `targetAspect`
   */
  function targetIsTargetAspect( elem ) {
    const { target } = elem;
    if (target.elements)        // CSN parser ensures: has no targetAspect then
      return true;

    if (elem.targetAspect) {
      // Ensure that a compiled CSN is parseable - not inside query, only on element
      return false;
    }
    if (targetCantBeAspect( elem ) || options.parseCdl)
      return false;
    // Compare this check with check in acceptEntity() called by resolvePath()
    // Remark:  do not check `on` and `foreignKeys` here, we want error for those, not the aspect
    const name = resolveUncheckedPath( target, 'target', elem );
    const aspect = name && model.definitions[name];
    return (aspect?.kind === 'aspect' || aspect?.kind === 'type') && // type is sloppy
      aspect.elements && !aspect.elements[$inferred];
  }
}

module.exports = define;
