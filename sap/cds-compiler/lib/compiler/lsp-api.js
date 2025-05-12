'use strict';

// API for `@sap/cds-lsp`.
//
// THIS FILE IS CONSIDERED INTERNAL!
// We do not guarantee stability for any project besides the CAP LSP server.
//
// This files includes an iterator over "semantic tokens" in an XSN model.
// "Semantic tokens" are identifiers, but also the "return" parameter.
// See `internalDoc/lsp/IdentifierCrawling.md` for details.

const { CompilerAssertion } = require('../base/error');
const $inferred = Symbol.for( 'cds.$inferred' );

// TODO: Remove hints; they should not be necessary in the best case
const HINTS = {
  USING_ALIAS: 'using-alias',
  DEFINITION_NAME: 'definition',
  NAMESPACE_STATEMENT: 'namespace-statement',
};

// eslint-disable-next-line no-unused-vars
class LspSemanticTokenEvent {
  event; // 'reference' | 'definition',
  semanticToken;
  node;
  hint; // TODO: Remove
}

/**
 * All actions to report semantic tokens in a model.
 */
const artifactActions = {
  __proto__: null,

  // e.g. sources or services
  artifacts: dictOf( artifactTokens ),
  extensions: arrayOf( extensionTokens ),
  namespace: namespaceTokens,
  // e.g. via CSN input
  vocabularies: dictOf( artifactTokens ),
  definitions: dictOf( artifactTokens ),

  extern: artifactTokens,
  name: definitionNameTokens,
  path: pathReferenceTokens,

  type: artifactTokens,
  target: artifactTokens,
  targetAspect: artifactTokens,
  targetElement: artifactTokens,
  returns: returnsTokens,
  items: artifactTokens,
  elements: elementsTokens,

  enum: dictOf( artifactTokens ),
  foreignKeys: dictOf( artifactTokens ),
  actions: dictOf( artifactTokens ),
  params: dictOf( artifactTokens ),
  mixin: dictOf( artifactTokens ),
  excludingDict: dictOf( nameAsReference ),

  // Don't crawl `$tableAliases`, as they are set multiple times in queries
  // via different `$tableAliases`.
  //   $tableAliases: null,

  // NOT $queries, as that doesn't cover UNIONs (e.g. `orderBy` vs `$orderBy`)
  query: artifactTokens,

  from: artifactTokens,
  includes: arrayOf( artifactTokens ),
  columns: arrayOf( artifactTokens ),
  expand: arrayOf( artifactTokens ),
  inline: arrayOf( artifactTokens ),

  args: argsTokens,
  on: artifactTokens,
  default: artifactTokens,
  value: artifactTokens,
  sym: enumSymToken,
  where: artifactTokens,
  groupBy: artifactTokens,
  orderBy: artifactTokens,
  having: artifactTokens,
  suffix: artifactTokens,
  limit: artifactTokens,
  rows: artifactTokens,
  offset: artifactTokens,

  '@': annotationTokens,
};

/** Returns a generator that applies the given function on all entries and yields the result. */
function dictOf( func ) {
  return function* dictionary( dict ) {
    for (const [ item ] of iterateGeneric({ dict }, 'dict'))
      yield* func( item );
  };
}

/** Returns a generator that applies the given function on all entries and yields the result. */
function arrayOf( func ) {
  return function* array( arr ) {
    if (!Array.isArray(arr))
      return;
    for (const item of arr)
      yield* func( item );
  };
}

/** Generator equivalent of iterateGeneric of forEachGeneric() */
function* iterateGeneric( obj, prop ) {
  const dict = obj[prop];
  if (!dict)
    return;

  for (const name in dict) {
    obj = dict[name];
    if (Array.isArray( obj )) {
      for (const item of obj)
        yield [ item, name, prop ]; // parser or source duplicates (e.g. USING vs definition)
    }
    else {
      yield [ obj, name, prop ];
      if (Array.isArray( obj.$duplicates )) { // redefinitions
        for (const dup of obj.$duplicates)
          yield [ dup, name, prop ];
      }
    }
  }
}

/**
 * A generator that yields all semantic tokens in an XSN model.
 * Semantic tokens include identifiers (references/definitions) and the "returns" parameter.
 *
 * @param {XSN.Model} xsn
 * @param {CSN.Options} options
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* traverseSemanticTokens( xsn, options ) {
  if (!xsn)
    throw new CompilerAssertion('Expected valid XSN model for traverseSemanticTokens(…)');
  if (!options)
    throw new CompilerAssertion('Expected valid options for traverseSemanticTokens(…)');

  if (xsn.sources)
    yield* dictOf( artifactTokens )( xsn.sources );
}

/**
 * Report semantic tokens in artifacts, including definitions, elements, params, etc.
 *
 * @param {XSN.Artifact} art
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* artifactTokens( art ) {
  if (!art || art.builtin || art.$inferred)
    return null;

  if (Array.isArray( art )) {
    for (const entry of art)
      yield* artifactTokens( entry );
    return null;
  }

  for (const prop in art) {
    if (artifactActions[prop])
      yield* artifactActions[prop](art[prop], art);
    else if (prop.charAt(0) === '@')
      yield* artifactActions['@'](art[prop]);
  }

  return null;
}

/**
 * For an extension, yield all semantic tokens.
 * We don't use `artifactTokens` for it, because extensions are a special case:
 *  - they have a name, but actually refer to some other artifact.
 *  - their artifacts such as elements may overlap with existing definitions, because
 *    extensions are applied; if they were applied, `_parent` does not point to the
 *    extension, which means we can't use it to skip them in `artifactTokens`.
 *  - we only need to handle `annotate` and `extend` kinds specifically:
 *    if an extension was not applied, pass it to `artifactTokens`;
 *    if an extension was     applied, we only need to report its name (i.e. reference)
 *    and traverse over all artifacts
 *
 * @param {XSN.Extension} ext
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* extensionTokens( ext ) {
  if (ext.kind !== 'extend' && ext.kind !== 'annotate')
    return null;

  const wasApplied = ext.name._artifact && !ext.name._artifact.$inferred;
  if (!wasApplied) {
    yield* artifactTokens( ext );
    return null;
  }

  yield* nameAsReference( ext );

  // We need to traverse all dictionaries that could themselves contain
  // extensions.  Enum extensions or columns don't need to be traversed,
  // for example, because there can't be inner extensions.
  yield* dictOf( extensionTokens )( ext.params );
  yield* dictOf( extensionTokens )( ext.actions );
  yield* dictOf( extensionTokens )( ext.elements );

  if (ext.returns)
    yield* extensionTokens( ext.returns );

  // Artifact extensions are always definitions, and can't have nested `extend`s,
  // hence no need to traverse them with `extensionTokens`.
  yield* dictOf( artifactTokens )( ext.artifacts );

  return null;
}

/**
 * Report all semantic tokens in an annotation assignment.
 *
 * @param {XSN.Artifact} anno
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* annotationTokens( anno ) {
  // TODO: Also report annotation names
  if (anno.kind === '$annotation')
    yield* annotationValueTokens( anno );
}

function* argsTokens( args, art ) {
  if (Array.isArray(args)) {
    // e.g. unnamed function arguments
    yield* arrayOf( artifactTokens )( args );
  }
  else {
    // e.g. named arguments
    for (const [ param ] of iterateGeneric( art, 'args' )) {
      yield* nameAsReference( param );
      yield* artifactTokens( param );
    }
  }
}

function* enumSymToken( sym, expr ) {
  yield {
    event: 'reference',
    semanticToken: expr.sym,
    node: expr,
    hint: undefined,
  };
}

/**
 * A namespace is always considered a reference and not a definition.
 *
 * @param {XSN.Artifact} def
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* namespaceTokens( def ) {
  if (!def.name)
    return null;

  for (let i = 0; i < def.name.path.length; ++i) {
    yield {
      event: 'reference',
      semanticToken: def.name.path[i],
      node: def,
      hint: (i === def.name.path.length - 1) ? HINTS.NAMESPACE_STATEMENT : null,
    };
  }

  return null;
}

/**
 * An annotation value may contain expressions which we need to report.
 *
 * @param {object} anno
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* annotationValueTokens( anno ) {
  if (Array.isArray(anno)) {
    for (const entry of anno)
      yield* annotationValueTokens( entry );
  }
  else if (anno.$tokenTexts) {
    yield* artifactTokens( anno );
  }
  else if (Array.isArray(anno.val)) {
    yield* annotationValueTokens( anno.val );
  }
  else if (anno.struct) {
    for (const [ struct ] of iterateGeneric( anno, 'struct' ))
      yield* annotationValueTokens( struct );
  }
}

/**
 * A `returns` structure may contain sub-elements.  But we report the `returns`
 * token as well, as it is considered a token with semantic value.
 *
 * @param {XSN.Artifact} art
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* returnsTokens( art ) {
  if (art.kind === 'param') {
    // report the `returns` parameter
    yield {
      event: 'definition',
      semanticToken: art.name,
      node: art,
      hint: undefined,
    };
    yield* artifactTokens( art );
  }
}

/**
 * Report elements if they should be traversed.  They are not always traversed
 * to avoid duplication due to `expand` and `columns` also being traversed.
 *
 * @param {Record<string, XSN.Artifact>} elements
 * @param {XSN.Artifact} art
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* elementsTokens( elements, art ) {
  if (shouldTraverseElements( art ))
    yield* dictOf( artifactTokens )( elements );
}

/**
 * Report all references in `ref`.
 *
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* pathReferenceTokens( path, ref, user = ref, hint = null ) {
  if (!path)
    return null;

  // don't report cds.Association/cds.Composition
  // TODO: Or report the `Association` keyword, similar to `returns`?
  if (path.length === 1 && ref._artifact?.category === 'relation')
    return null;

  yield* artifactTokens( path );

  // parser prepends a fake `type of` segment, which we need to skip
  const root = ref.scope === 'typeOf' ? 1 : 0;
  for (let i = root; i < path.length; ++i) {
    if (!path[i].$inferred) { // e.g. `id` when expanded from `$user`
      yield {
        event: 'reference',
        semanticToken: path[i],
        node: user,
        hint,
      };
    }
  }

  return null;
}

/**
 * Some XSN nodes such as entries in `excludingDict` or named arguments are references
 * but don't have a `path` property, only a `name` property.  Report such names
 * as references.
 *
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* nameAsReference( ref, hint = null ) {
  if (!ref.name || ref.name.$inferred)
    return null;

  if (ref.name.path) {
    yield* pathReferenceTokens( ref.name.path, ref.name, ref, hint );
  }
  else {
    yield {
      event: 'reference',
      semanticToken: ref.name,
      node: ref,
      hint,
    };
  }
  return null;
}

/**
 * Traverse the name of a definition, and report N-1 path steps as references
 * and of course the definition itself.
 *
 * @returns {Generator<LspSemanticTokenEvent>}
 */
function* definitionNameTokens( name, art ) {
  if (!art.kind)
    return null; // e.g. parameter references
  if (art.kind === '$annotation')
    return null; // annotation name, e.g. in `@anno: (elem)`

  if ((name.$inferred && name.$inferred !== 'as') ||
    art.kind === 'select' || art.kind === '$join') {
    // Internal names such as numbers for SELECTs or the `$internal` names must
    // not be reported.
    return null;
  }

  if (art.kind === 'extend' || art.kind === 'annotate') {
    yield* nameAsReference( art );
    return null;
  }

  // Report references in a name (N-1 path steps).
  for (let i = 0; i < name.path?.length - 1; ++i) {
    yield {
      event: 'reference',
      semanticToken: name.path[i],
      node: art,
      hint: HINTS.DEFINITION_NAME,
    };
  }

  const hint = art.kind === 'using' ? HINTS.USING_ALIAS : null;

  if (name.path) {
    // Only take the last path step; all others are considered references.
    const implicitName = name.path[name.path.length - 1];
    yield {
      event: 'definition',
      semanticToken: implicitName,
      node: art,
      hint,
    };
  }
  else if (name.id) {
    // Not all names have a path; some (e.g. parameters) only have an ID.
    yield {
      event: 'definition',
      semanticToken: name,
      node: art,
      hint,
    };
  }

  return null;
}

/**
 * Returns true if `elements` of the given `art` should be traversed.
 * Elements are _not_ traversed, e.g. for `expand`, to avoid duplicates.
 *
 * @returns {boolean}
 */
function shouldTraverseElements( art ) {
  return (
    // $expand: 'origin'   -> normal expansion
    // $expand: 'annotate' -> additional annotation (needs to traverse annotation expressions)
    art.$expand !== 'origin' && !art.elements[$inferred] && (
      // sub-elements are always traversed except for `expand`, which is handled on its own.
      art.kind === 'element' && !art.expand ||
      // all non-query elements are traversed; because `_main` on bound actions may point
      // to a query, we handle parameters explicitly.
      art.kind === 'param' || !(art._main || art).$queries
    )
  );
}

/**
 * Given a LspSemanticTokenEvent, returns a generator that yields the referenced
 * object and its origin's until the deepest entry is found.
 *
 * @param obj
 * @returns {Generator<*, void, *>}
 */
function* getSemanticTokenOrigin( obj ) {
  let ref = obj.semanticToken;
  if (obj.event === 'definition') {
    ref = obj.node;
  }
  else {
    if (!ref?._artifact)
      return; // unknown -> abort
    // take first artifact for duplicates (best effort)
    ref = Array.isArray(ref._artifact) ? ref._artifact[0] : ref._artifact;
    yield ref;
  }

  if (!ref._effectiveType)
    return; // abort for unresolved references and cyclic ones

  while (ref._origin) {
    yield ref._origin;
    ref = ref._origin;
    if (!ref || typeof ref === 'string')
      break;
  }
}

module.exports = {
  traverseSemanticTokens,
  getSemanticTokenOrigin,
};
