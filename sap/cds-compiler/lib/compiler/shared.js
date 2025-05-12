// Compiler functions and utilities shared across all phases

'use strict';

const { CompilerAssertion } = require('../base/error');
const { searchName } = require('../base/messages');

const {
  setLink,
  setArtifactLink,
  dependsOn,
  pathName,
  userQuery,
  definedViaCdl,
  targetCantBeAspect,
  pathStartsWithSelf,
  columnRefStartsWithSelf,
  isAssocToPrimaryKeys,
  artifactRefLocation,
} = require('./utils');

const $inferred = Symbol.for( 'cds.$inferred' );
const $location = Symbol.for( 'cds.$location' );

/**
 * Main export function of this file.  Attach "resolve" functions shared for phase
 * "define" and "resolve" to `model.$functions`, where argument `model` is the XSN.
 *
 * Before calling `resolvePath`, make sure that the following function
 * in model.$function is set:
 * - `effectiveType`
 *
 * @param {XSN.Model} model
 */
// TODO: yes, this function will be renamed
function fns( model ) {
  const { options } = model;
  const {
    info, error, warning, message,
  } = model.$messageFunctions;
  const Functions = model.$functions;

  const referenceSemantics = {
    // global: ------------------------------------------------------------------
    using: {                    // only used to produce error message
      isMainRef: 'all',
      lexical: null,
      dynamic: modelDefinitions,
      notFound: undefinedDefinition,
    },
    // only used for the main annotate/extend statements, not inner ones:
    annotate: {
      isMainRef: 'all',
      lexical: userBlock,
      dynamic: modelDefinitions,
      notFound: undefinedForAnnotate,
      accept: extendableArtifact,
    },
    extend: {
      isMainRef: 'no-generated',
      lexical: userBlock,
      dynamic: modelDefinitions,
      notFound: undefinedDefinition,
      accept: extendableArtifact,
    },
    _extensions: {
      isMainRef: 'all',
      lexical: userBlock,
      dynamic: modelDefinitions,
      notFound: () => null,     // without message
    },
    include: {
      isMainRef: 'no-generated',
      lexical: userBlock,
      dynamic: modelBuiltinsOrDefinitions,
      notFound: undefinedDefinition,
      accept: acceptStructOrBare,
    },
    _include: {                 // cyclic include: no accept
      isMainRef: 'no-generated',
      lexical: userBlock,
      dynamic: modelBuiltinsOrDefinitions,
      notFound: undefinedDefinition,
    },
    target: {
      isMainRef: 'no-autoexposed',
      lexical: userBlock,
      dynamic: modelBuiltinsOrDefinitions,
      notFound: undefinedDefinition,
      accept: acceptEntity,
      noDep: true,
      // special `scope`s for auto-redirections:
      global: () => ({ isMainRef: 'all', dynamic: modelDefinitions }),
    },
    targetAspect: {
      isMainRef: 'no-autoexposed',
      lexical: userBlock,
      dynamic: modelBuiltinsOrDefinitions,
      notFound: undefinedDefinition,
      accept: acceptAspect,
    },
    from: {
      isMainRef: 'no-autoexposed',
      lexical: userBlock,
      dynamic: modelBuiltinsOrDefinitions,
      navigation: environment,
      notFound: undefinedDefinition,
      accept: acceptQuerySource,
      noDep: '',                // dependency special for from
    },
    type: {
      isMainRef: 'no-autoexposed',
      lexical: userBlock,
      dynamic: modelBuiltinsOrDefinitions,
      navigation: staticTarget,
      notFound: undefinedDefinition,
      accept: acceptTypeOrElement,
      // special `scope`s for CDL parser - TYPE OF (TODO generated?), cds.Association:
      typeOf: typeOfSemantics,
      global: () => ({
        isMainRef: 'no-autoexposed',
        dynamic: modelDefinitions,
        navigation: staticTarget, // TODO: Object.assign() with main
      }),
    },
    // element references without lexical scope (except $self/$projection): -----
    targetElement: {
      lexical: null,
      dollar: false,
      dynamic: targetElements,
      navigation: targetNavigation,
      notFound: undefinedTargetElement,
      param: paramSemantics,
    },
    filter: {
      lexical: justDollarAliases,
      dollar: true,
      dynamic: targetElements,
      notFound: undefinedTargetElement,
      param: paramSemantics,
    },
    'calc-filter': {
      lexical: justDollarAliases,
      dollar: true,
      dynamic: targetElements,
      navigation: calcElemNavigation,
      notFound: undefinedTargetElement,
      param: paramUnsupported,
    },
    default: {
      lexical: null,
      dollar: true,
      dynamic: () => Object.create( null ),
      notFound: undefinedVariable,
      param: paramUnsupported,
    },
    'limit-rows': {
      lexical: null,
      dollar: true,
      dynamic: () => Object.create( null ),
      notFound: undefinedVariable,
      param: paramSemantics,
    },
    'limit-offset': 'limit-rows',
    // general element / variable references --------------------------------------
    where: {
      lexical: tableAliasesAndSelf,
      dollar: true,
      dynamic: combinedSourcesOrParentElements,
      notFound: undefinedSourceElement,
      check: checkRefInQuery,
      param: paramSemantics,
    },
    having: 'where',
    groupBy: 'where',
    column: {
      lexical: tableAliasesAndSelf,
      dollar: true,
      dynamic: combinedSourcesOrParentElements,
      notFound: undefinedSourceElement,
      check: checkColumnRef,
      param: paramSemantics,
      nestedColumn: () => ({       // in expand and inline
        lexical: justDollarAliases,
        dollar: true,
        dynamic: nestedElements,
        notFound: undefinedNestedElement,
        check: checkColumnRef,
        param: paramSemantics,
      }),
    },
    'from-args': {
      lexical: null,
      dollar: true,
      dynamic: () => Object.create( null ),
      notFound: undefinedVariable,
      param: paramSemantics,
    },
    calc: {
      lexical: justDollarAliases,
      dollar: true,
      dynamic: parentElements,
      navigation: calcElemNavigation,
      notFound: undefinedParentElement,
      param: paramUnsupported,
    },
    'join-on': {
      lexical: tableAliasesAndSelf,
      dollar: true,
      dynamic: combinedSourcesOrParentElements,
      rejectRoot: rejectOwnExceptVisibleAliases,
      notFound: undefinedSourceElement,
      param: paramSemantics,
    },
    on: {     // unmanaged assoc: outside query, redirected or new assoc in column
      lexical: justDollarAliases,
      dollar: true,
      dynamic: parentElements,
      navigation: assocOnNavigation,
      notFound: undefinedParentElement,
      accept: acceptElemOrVarOrSelf,
      check: checkAssocOn,
      param: paramUnsupported,
      nestedColumn: () => ({       // in expand and inline
        lexical: justDollarAliases,
        dollar: true,
        dynamic: parentElements,
        navigation: assocOnNavigation,
        notFound: undefinedParentElement,
        rewriteProjectionToSelf: true,
      }),
      rewriteProjectionToSelf: true,
    },
    'mixin-on': {
      lexical: tableAliasesAndSelf,
      dollar: true,
      dynamic: combinedSourcesOrParentElements,
      navigation: assocOnNavigation,
      notFound: undefinedSourceElement,
      accept: acceptElemOrVarOrSelf,
      check: checkAssocOn,
      param: paramSemantics, // TODO: check that assocs containing param in ON is not published
    },
    'orderBy-ref': {
      lexical: tableAliasesAndSelf,
      dollar: true,
      dynamic: parentElements,
      notFound: undefinedOrderByElement,
      check: checkOrderByRef,
      param: paramSemantics,
    },
    'orderBy-expr': {
      lexical: tableAliasesAndSelf,
      dollar: true,
      dynamic: combinedSourcesOrParentElements,
      notFound: undefinedSourceElement,
      check: checkRefInQuery,
      param: paramSemantics,
    },
    'orderBy-set-ref': {
      lexical: tableAliasesAndSelf, // TODO: reject own tab aliases
      dollar: true,
      dynamic: queryElements,
      rejectRoot: rejectOwnAliasesAndMixins,
      notFound: undefinedParentElement,
      check: checkOrderByRef,
      param: paramSemantics,
    },
    'orderBy-set-expr': {
      lexical: tableAliasesAndSelf, // TODO: reject own tab aliases
      dollar: true,
      dynamic: () => Object.create( null ),
      rejectRoot: rejectAllOwn,
      notFound: undefinedVariable,
      check: checkRefInQuery,
      param: paramSemantics,
    },
    annotation: { // annotation assignments
      lexical: justDollarAliases,
      dollar: true,
      dynamic: parentElementsOrKeys,
      navigation: assocOnNavigation,
      noDep: true,
      notFound: undefinedParentElement,
      messageMap: {
        'ref-undefined-element': 'anno-undefined-element',
        'ref-undefined-param': 'anno-undefined-param',
      },
      param: paramSemantics,
      nestedColumn: () => ({
        lexical: justDollarAliases,
        dollar: true,
        dynamic: parentElements,
        navigation: assocOnNavigation,
        notFound: undefinedParentElement,
        rewriteProjectionToSelf: true,
      }),
    },
    // TODO: introduce some kind of inheritance
    // used by xpr-rewrite.js to resolve rewritten path roots.
    annoRewrite: { // annotation assignments
      lexical: justDollarAliases,
      dollar: true,
      dynamic: parentElements,
      navigation: assocOnNavigation,
      noDep: true,
      notFound: null,           // no error, just falsy links
      param: paramSemantics,
      nestedColumn: () => ({
        lexical: justDollarAliases,
        dollar: true,
        dynamic: parentElements,
        navigation: assocOnNavigation,
        notFound: undefinedParentElement,
        rewriteProjectionToSelf: true,
      }),
    },
  };

  Object.assign( model.$functions, {
    traverseExpr,
    traverseTypedExpr,
    resolveUncheckedPath,
    resolveTypeArgumentsUnchecked, // TODO: move to some other file
    resolvePathRoot,
    resolvePath,
    resolveDefinitionName,
    checkExpr,
    checkOnCondition,
    navigationEnv,
    nestedElements,
    attachAndEmitValidNames,
  } );
  traverseExpr.STOP = Symbol( 'STOP' );
  traverseExpr.SKIP = Symbol( 'SKIP' );
  traverseTypedExpr.STOP = traverseExpr.STOP;
  traverseTypedExpr.SKIP = traverseExpr.SKIP;
  return;

  // Expression traversal function ----------------------------------------------

  /**
   * Recursively traverse the expression `expr` and call `callback` on the expression nodes.
   *
   * …
   *
   * Sub queries are not further traversed, but `callback` is called on the
   * expression node having the property `query`.
   *
   * Callbacks can influence the traversal by returning a symbol:
   *
   *  - `traverseExpr.STOP`: the traversal is stopped immediately
   *  - `traverseExpr.SKIP` on a node with a `path` property: the path items
   *    with its filters and arguments are not traversed
   *  - `traverseExpr.SKIP` on a path item: the expression in the `where`
   *    condition is not traversed
   */
  function traverseExpr( expr, exprCtx, user, callback ) {
    if (!expr || typeof expr === 'string') // parse error or keywords in {xpr:...}
      return null;

    let exit = null;
    // `type` property for `cast, `query` for sub query
    if (expr.path || expr.type || expr.query) {
      exit = callback( expr, exprCtx, user );
      if (exit === traverseExpr.STOP)
        return exit;
    }
    if (expr.path && exit !== traverseExpr.SKIP) {
      for (const step of expr.path) {
        if (step && (step.args || step.where || step.cardinality) &&
            traversePathItem( step, exprCtx, user, callback ))
          return traverseExpr.STOP;
      }
    }
    if (expr.args) {
      const args = Array.isArray( expr.args ) ? expr.args : Object.values( expr.args );
      for (const arg of args ) {
        if (traverseExpr( arg, exprCtx, user, callback ) === traverseExpr.STOP)
          return traverseExpr.STOP;
      }
    }
    if (expr.suffix) {
      for (const arg of expr.suffix) {
        if (traverseExpr( arg, exprCtx, user, callback ) === traverseExpr.STOP)
          return traverseExpr.STOP;
      }
    }
    return false;
  }

  function traversePathItem( step, exprCtx, user, callback ) {
    const exit = callback( step, exprCtx, user );
    if (exit === traverseExpr.STOP)
      return true;
    if (step.where && exit !== traverseExpr.SKIP &&
        traverseExpr( step.where,
                      // TODO: use property in fn dictionary above
                      ( exprCtx === 'calc' || exprCtx === 'calc-filter'
                        ? 'calc-filter'
                        : 'filter' ),
                      step, callback ) === traverseExpr.STOP)
      return true;
    if (step.args) {
      const ctx = (exprCtx === 'from') ? 'from-args' : exprCtx;
      const args = Array.isArray( step.args ) ? step.args : Object.values( step.args );
      // TODO: there should be no array `args` on path item
      for (const arg of args) {
        if (traverseExpr( arg, ctx, user, callback ) === traverseExpr.STOP)
          return true;
      }
    }
    return false;
  }

  // Special expression traversal function for `resolveExpr`.  Let's see
  // later whether we can use this version as the general one.
  // If we continue to have separate ones, remove the STOP stuff – it is not
  // needed for `resolveExpr`.

  function traverseTypedExpr( expr, exprCtx, user, type, callback ) {
    if (!expr || typeof expr === 'string') // parse error or keywords in {xpr:...}
      return null;

    let { args } = expr;
    let exit = null;
    // `type` property for `cast, `query` for sub query
    if (expr.path || expr.type || expr.sym || expr.query) {
      exit = callback( expr, exprCtx, user, type );
      if (exit === traverseExpr.STOP)
        return exit;
      // `args` with `cast` function
    }
    else if (!args) {
      // empty on purpose
    }
    else if (expr.func) {
      if (!Array.isArray( args ))
        args = Object.values( args );
    }
    else if (expr.op?.val === 'list' || args.length === 1) {
      exit = type;
    }
    else if (expr.op?.val === '?:') {
      args = traverseChoiceArgs( args, exprCtx, user, type, callback );
      exit = type;
    }
    else {
      args = traverseSpecialArgs( args, exprCtx, user, type, callback );
    }

    if (expr.path && exit !== traverseExpr.SKIP) {
      for (const step of expr.path) {
        if (step && (step.args || step.where || step.cardinality) &&
            traverseTypedPathItem( step, exprCtx, user, callback ))
          return traverseExpr.STOP;
      }
    }
    if (expr.args) {
      if (!args)
        return traverseExpr.STOP;
      for (const arg of args) {
        if (traverseTypedExpr( arg, exprCtx, user, exit, callback ) === traverseExpr.STOP)
          return traverseExpr.STOP;
      }
    }
    if (expr.suffix) {
      for (const arg of expr.suffix) {
        if (traverseTypedExpr( arg, exprCtx, user, null, callback ) === traverseExpr.STOP)
          return traverseExpr.STOP;
      }
    }
    return exit;
  }

  /**
   * Traverse arguments `args` if they match a specific pattern:
   *
   * - a (sub) expression is a comparison, i.e. uses one of the binary operators
   *   `=`, `<>`, '==', `!=`, `in` or `not in`,
   * - one side of the comparison is a reference or a `cast` function call when
   *   typed with an enum type,
   * - the other side is an enum reference, an enum reference in parentheses, or a
   *   list of enum references.
   *
   * Return an array of the arguments which are to be traversed normally, or
   * `null` if the traversal is stopped immediately
   */
  function traverseSpecialArgs( args, exprCtx, user, type, callback ) {
    if (args.length <= 3) {
      if (args.length === 3 && args[1].literal === 'token' &&
          [ '=', '<>', '==', '!=', 'in' ].includes( args[1].val ))
        return traverseComparison( args[0], args[2], exprCtx, user, callback );
    }
    else if (args[0].val === 'case' && args[0].literal === 'token') {
      return traverseCaseWhen( args, exprCtx, user, type, callback );
    }
    else if (args.length === 4 && args[1].val === 'not' && args[2].val === 'in' &&
             args[1].literal === 'token' && args[2].literal === 'token') {
      return traverseComparison( args[0], args[3], exprCtx, user, callback );
    }
    return args;
  }

  function traverseComparison( left, right, exprCtx, user, callback ) {
    if (!left || !right)          // can happen in old parser
      return [ left || right ];
    if (left.path || left.type) { // ref or cast fn
      const type = traverseTypedExpr( left, exprCtx, user, null, callback );
      if (type === traverseExpr.STOP ||
          traverseTypedExpr( right, exprCtx, user, type, callback ) === traverseExpr.STOP)
        return null;
      return [];
    }
    if (right.path || right.type) { // ref or cast fn
      const type = traverseTypedExpr( right, exprCtx, user, null, callback );
      if (type === traverseExpr.STOP ||
          traverseTypedExpr( left, exprCtx, user, type, callback ) === traverseExpr.STOP)
        return null;
      return [];
    }
    return [ left, right ];
  }

  // for '?:' operator, only via CDL (translates to `case…when` in CSN):
  function traverseChoiceArgs( args, exprCtx, user, type, callback ) {
    if (traverseTypedExpr( args[0], exprCtx, user, null, callback ) === traverseExpr.STOP)
      return null;
    return args.slice( 1 );
    // TODO: adopt if we extend this to ?:?:…
  }

  function traverseCaseWhen( args, exprCtx, user, type, callback ) {
    let idx = 1;
    let when = null;
    let node = args[1];
    // For `CASE <expr> WHEN <…> THEN <…>`
    if (node?.val !== 'when' || node.literal !== 'token') {
      when = traverseTypedExpr( node, exprCtx, user, null, callback );
      if (when === traverseExpr.STOP)
        return null;
      ++idx;
    }
    // Remark: no need to test `literal` in the following - ensured by CDL and CSN
    // parser
    while (args[idx]?.val === 'when' && ++idx < args.length) {
      node = args[idx];
      // be robust against corrupted sources:
      if ((node.literal !== 'token' || ![ 'then', 'when', 'end' ].includes( node.val )) &&
          traverseTypedExpr( args[idx++], exprCtx, user, when, callback ) === traverseExpr.STOP)
        return null;

      if (args[idx]?.val !== 'then')
        continue;
      node = args[++idx];
      if (node &&
          (node.literal !== 'token' || node.val !== 'when' && node.val !== 'end') &&
          traverseTypedExpr( args[idx++], exprCtx, user, type, callback ) === traverseExpr.STOP)
        return null;
    }
    if (args[idx]?.val === 'else') {
      if (++idx < args.length &&
          traverseTypedExpr( args[idx], exprCtx, user, type, callback ) === traverseExpr.STOP)
        return null;
    }
    return [];
  }

  function traverseTypedPathItem( step, exprCtx, user, callback ) {
    const exit = callback( step, exprCtx, user, null );
    if (exit === traverseExpr.STOP)
      return true;
    if (step.where && exit !== traverseExpr.SKIP &&
        traverseTypedExpr( step.where,
                           // TODO: use property in fn dictionary above
                           ( exprCtx === 'calc' || exprCtx === 'calc-filter'
                             ? 'calc-filter'
                             : 'filter' ),
                           step, null, callback ) === traverseExpr.STOP)
      return true;
    if (step.args) {
      const ctx = (exprCtx === 'from') ? 'from-args' : exprCtx;
      const args = Array.isArray( step.args ) ? step.args : Object.values( step.args );
      // TODO: there should be no array `args` on path item
      for (const arg of args) {
        if (traverseTypedExpr( arg, ctx, user, arg.name, callback ) === traverseExpr.STOP)
          return true;
      }
    }
    return false;
  }

  // Return absolute name for unchecked path `ref`.  We first try searching for
  // the path root starting from `env`.  If it exists, return its absolute name
  // appended with the name of the rest of the path.  Otherwise, complain if
  // `unchecked` is false, and set `ref.absolute` to the path name of `ref`.
  // Used for collecting artifact extension.
  //
  // Return '' if the ref is good, but points to an element.
  function resolveUncheckedPath( ref, refCtx, user ) {
    const { path } = ref;
    if (!path || path.broken) // incomplete type AST
      return undefined;
    const semantics = referenceSemantics[refCtx];
    if (!semantics.isMainRef)
      throw new CompilerAssertion( `resolveUncheckedPath() called for reference ctx '${ refCtx }'` );
    if (!definedViaCdl( user ))
      return (path.length === 1) ? path[0].id : '';

    let art = getPathRoot( ref, semantics, user );
    if (ref.scope && ref.scope !== 'global')
      return '';                // TYPE OF, Main:elem

    if (Array.isArray( art ))
      art = art[0];
    if (!art)
      return (semantics.dynamic !== modelDefinitions) ? art : pathName( path );

    const first = (art.kind === 'using' ? art.extern : art.name).id;
    return (path.length === 1) ? first : `${ first }.${ pathName( ref.path.slice(1) ) }`;
  }

  /**
   * Return artifact or element referred by the path in `ref`.  The first
   * environment we search in is `env`.  If no such artifact or element exist,
   * complain with message and return `undefined`.  Record a dependency from
   * `user` to the found artifact if `user` is provided.
   */
  function resolvePath( ref, expected, user ) {
    const origUser = user;
    user = user._user || user;
    if (ref == null)       // no references -> nothing to do
      return undefined;
    if (ref._artifact !== undefined)
      return ref._artifact;

    const { path } = ref;
    if (!path || path.broken || !path.length) {
      // incomplete type AST or empty env (already reported)
      return setArtifactLink( ref, undefined );
    }

    const s = referenceSemantics[expected];
    const semantics = (typeof s === 'string') ? referenceSemantics[s] : s;
    semantics.name = expected;

    const r = getPathRoot( ref, semantics, origUser );
    const root = r && acceptPathRoot( r, ref, semantics, origUser );
    if (!root)
      return setArtifactLink( ref, root );

    // how many path items are for artifacts (rest: elements)
    let art = getPathItem( ref, semantics, user );
    if (!art)
      return setArtifactLink( ref, art );

    // TODO: use isMainRef string value here?
    const acceptFn = semantics.accept || (semantics.isMainRef ? a => a : acceptElemOrVar);
    art = setArtifactLink( ref, acceptFn( art, user, ref, semantics ) );

    // TODO TMP: remove noDep: an association does not depend on the target, only
    // -- on its keys/on, which depend on certain target elements
    if (art && user && !semantics.noDep) {
      const location = artifactRefLocation( ref );
      if (semantics.noDep === '' && art._main) { // assoc in FROM
        environment( art, location, user );
        const target = art._effectiveType?.target?._artifact;
        if (target)
          dependsOn( user._main, target, location, user );
        if (target?.$calcDepElement)
          dependsOn( user._main, target.$calcDepElement, location, user );
      }
      else if (art._main && art.kind !== 'select' || path[0]._navigation?.kind !== '$self') {
        // no real dependency to bare $self (or actually: the underlying query)
        dependsOn( user, art, location );
        if (art.$calcDepElement)
          dependsOn( user, art.$calcDepElement, location );
        // Without on-demand resolve, we can simply signal 'undefined "x"'
        // instead of 'illegal cycle' in the following case:
        //    element elem: type of elem.x;
      }

      // TODO: really write dependency with expand/inline?  write test
      // (removing it is not incompatible => not urgent)
    }
    // TODO: follow FROM here, see csnRef - fromRef
    return art;
  }

  /**
   * Resolve the type arguments of `artifact` according to the type `typeArtifact`.
   * User is used for semantic message location.
   *
   * For builtins, for each property name `<prop>` in `typeArtifact.parameters`, we move a value
   * from `art.$typeArgs` (a vector of numbers with locations) to `artifact.<prop>`.
   *
   * For non-builtins, we take either one or two arguments and interpret them
   * as `length` or `precision`/`scale`.
   *
   * Left-over arguments are errors for non-builtins and warnings for builtins.
   *
   * TODO: move to define.js (and probably rename), rewrite (consider syntax-unexpected-argument)
   *
   * @param {object}  artifact
   * @param {object} typeArtifact
   * @param {CSN.Artifact} user
   */
  function resolveTypeArgumentsUnchecked( artifact, typeArtifact, user ) {
    let args = artifact.$typeArgs || [];
    const parameters = typeArtifact?.parameters || [];

    if (args.length > 0 && parameters.length > 0) {
      // For Builtins
      for (let i = 0; i < parameters.length; ++i) {
        const par = parameters[i].name || parameters[i];
        if (!artifact[par] && i < args.length)
          artifact[par] = args[i];
      }
      args = args.slice( parameters.length );
      // TODO: we could issue syntax-unexpected-argument here
    }
    else if (args.length > 0 && !typeArtifact?.builtin) {
      // One or two arguments are interpreted as either length or precision/scale.
      // For builtins, we know what arguments are expected, and we do not need this mapping.
      // Also, we expect non-structured types.
      if (args.length === 1) {
        artifact.length = args[0];
        args = args.slice(1);
      }
      else if (args.length === 2) {
        artifact.precision = args[0];
        artifact.scale = args[1];
        args = args.slice(2);
      }
    }

    if (!artifact.$typeArgs)
      return;

    // Warn about left-over arguments.
    if (args.length > 0) {
      const loc = [ args[0].location, user ];
      if (typeArtifact?.builtin)
        message( 'type-ignoring-argument', loc, { art: typeArtifact } );
      // when the parser exits rule unsuccessfully/prematurely, $typeArgs might
      // still have a length > 2 → no testMode dump
    }
    artifact.$typeArgs = undefined;
  }

  // Resolve the n-1 path steps before the definition name for LSP.
  function resolveDefinitionName( art ) {
    const path = art?.name?.path;
    if (!art || art._main || !path || path.length <= 1)
      return;

    // Don't resolve paths in an annotation as a definition!
    const definitions = art.kind === 'annotation' ? model.vocabularies : model.definitions;

    let name = art.name.id;
    if (art.kind === 'namespace') // namespace-statements are ref-only.
      setArtifactLink( path[path.length - 1], definitions[name] || false );

    for (let i = path.length - 1; i > 0; --i) {
      name = name.substring(0, name.length - path[i].id.length - 1);
      setArtifactLink( path[i - 1], definitions[name] || false );
    }
  }

  function getPathRoot( { path, scope, location }, semantics, user ) {
    // TODO: use string value of isMainRef?
    const head = path[0];
    if (!head || !head.id)
      return undefined;         // parse error
    if (head._artifact !== undefined)
      return head._artifact;
    let ruser = user._user || user; // TODO: nicer name if we keep this
    if (ruser.kind === '$annotation')
      ruser = ruser._outer;

    // Handle expand/inline, `type of`, :param, global (internally for CDL):
    if (user._columnParent && !semantics.isMainRef) { // in expand/inline
      const { name } = semantics;
      semantics = semantics.nestedColumn();
      semantics.name = name;
    }
    if (typeof scope === 'string') { // typeOf, param, global
      semantics = semantics?.[scope] && semantics[scope]( ruser, path, location, semantics );
      if (!semantics) {
        if (semantics == null)
          throw new CompilerAssertion( `Scope ${ scope } is not expected here` );
        return setArtifactLink( head, null );
      }
    }
    const valid = [];

    // Search in lexical environments, including $self/$projection:
    const { isMainRef } = semantics;
    const lexical = semantics.lexical?.( ruser ); // TODO: _columnParent?
    if (lexical) {
      const [ nextProp, dictProp ] = (isMainRef)
        ? [ '_block', 'artifacts' ]
        : [ '_$next', '$tableAliases' ];
      // let notApplicable = ...;  // for table aliases in JOIN-ON and UNION orderBy
      for (let env = lexical; env; env = env[nextProp]) {
        const dict = env[dictProp] || Object.create( null );
        const r = dict[head.id];
        if (acceptLexical( r, path, semantics, user ))
          return setArtifactLink( head, r );
        valid.push( dict );
      }
    }

    // Search in $special (excluding $self/$projection) and dynamic environment:
    const dynamicDict = semantics.dynamic( ruser, user._user && user._artifact );
    if (!dynamicDict)                // avoid consequential errors
      return setArtifactLink( head, null );
    const isVar = (semantics.dollar && head.id.charAt( 0 ) === '$');
    const dict = (isVar) ? model.$magicVariables.elements : dynamicDict;
    const r = dict[head.id];
    if (r)
      return setArtifactLink( head, r );

    if (!semantics.dollar) {
      valid.push( dynamicDict );
    }
    else {
      valid.push( removeInvalidMagicVariables( model.$magicVariables.elements, semantics ),
                  removeDollarNames( dynamicDict ) );
    }
    // TODO: streamline function arguments (probably: user, path, semantics )
    const undef = semantics.notFound?.( user._user || user, head, valid, dynamicDict,
                                        !isMainRef && user._user && user._artifact,
                                        path, semantics );
    return setArtifactLink( head, undef || null );
  }

  // Return artifact or element referred by path (array of ids) `tail`.  The
  // search environment (for the first path item) is `arg`.  For messages about
  // missing artifacts (as opposed to elements), provide the `head` (first
  // element item in the path)
  // TODO - think about setting _navigation for all $navElement – the
  // "ref: ['tabAlias']: inline: […]" handling might be easier
  // (no _columnParent consultation for key prop and renaming support)
  function getPathItem( ref, semantics, user ) {
    // let art = (headArt && headArt.kind === '$tableAlias') ? headArt._origin : headArt;
    const { path } = ref;
    let artItemsCount = 0;
    const { isMainRef } = semantics;
    if (isMainRef) {
      artItemsCount = (typeof ref.scope === 'number' && ref.scope) ||
                      (ref.scope ? 1 : path.length);
    }
    let art = null;
    const elementsEnv = semantics.navigation || environment;
    let index = -1;
    for (const item of path) {
      ++index;
      --artItemsCount;
      if (!item?.id)    // incomplete AST due to parse error
        return undefined;
      if (item._artifact) { // should be there on first path element
        art = item._artifact;
        continue;
      }

      const prev = art;
      const envFn = (artItemsCount >= 0) ? artifactsEnv : elementsEnv;
      // TOOD: call envFn with location of last item (for dependency error)
      const env = envFn( art, path[index - 1].location, user );
      const found = env && env[item.id];  // not env?.[item.id] ! …we want to keep the 0
      // Reject `$self.$_column_1`: TODO: necessary to do here again?
      art = setArtifactLink( item, (found?.name?.$inferred === '$internal') ? undefined : found );

      if (!art) {
        // TODO (done?): if `env` was 0, we might set a dependency to induce an
        // illegal-cycle error instead of reporting via `errorNotFound`.
        const notFound = (artItemsCount >= 0) ? semantics.notFound : undefinedItemElement;
        // TODO: streamline function arguments (probably: user, path, semantics, prev )
        // false returned by semantics.navigation: no further error:
        if (env !== false)
          notFound( user, item, [ env ], null, prev, path, semantics );
        return null;
      }
      // need to do that here, because we also need to disallow Service.AutoExposed:elem
      // TODO: but Service.AutoExposed.NotAuto should be fine
      if (isMainRef !== 'all' && artItemsCount === 0 &&
          art.$inferred === 'autoexposed' && !user.$inferred) {
        // Depending on the processing sequence, the following could be a
        // simple 'ref-undefined-art'/'ref-undefined-def' - TODO: which we
        // could "change" to this message at the end of compile():
        error( 'ref-unexpected-autoexposed', [ item.location, user ], { art },
               'An auto-exposed entity can\'t be referred to - expose entity $(ART) explicitly' );
        return null;            // continuation semantics: like “not found”
      }
    }
    return art;
  }

  /**
   * Resolve the _path-root_ only.  Used for rewriting annotation paths.
   *
   * @param ref
   * @param {string} expected
   * @param user
   */
  function resolvePathRoot( ref, expected, user ) {
    if (ref == null || !ref.path) // no references -> nothing to do
      return undefined;
    const s = referenceSemantics[expected];
    const semantics = (typeof s === 'string') ? referenceSemantics[s] : s;
    const r = getPathRoot( ref, semantics, user );
    return r && acceptPathRoot( r, ref, semantics, user );
  }

  // Helper functions for resolve[Unchecked]Path, getPath{Root,Item}: -----------

  function acceptLexical( art, path, semantics, user ) {
    if (semantics.isMainRef || !art)
      return !!art;

    // Non-global lexical are table aliases, mixins and $self, $projection, $parameters,
    // Do not accept a lonely table alias and `$projection`
    // TODO: test table alias and mixin named `$projection`
    if (path.length !== 1 || user.expand || user.inline) {
      if (semantics.rewriteProjectionToSelf &&
          art.kind === '$self' && path[0].id === '$projection') {
        // Rewrite $projection to $self
        path[0].id = '$self';
        warning( 'ref-expecting-$self', [ path[0].location, user ],
                 { code: '$projection', newcode: '$self' });
      }
      return art.name?.$inferred !== '$internal'; // not a compiler-generated internal alias
    }

    // allow mixins, $self, and `up_` in anonymous target aspect (is $navElement):
    return art.kind === 'mixin' ||
      art.kind === '$self' && path[0].id === '$self' ||
      art.kind === '$navElement';
  }

  function acceptPathRoot( art, ref, semantics, user ) {
    const { path } = ref;
    const [ head ] = path;
    if (Array.isArray( art ))
      return getAmbiguousRefLink( art, head, user );
    if (semantics.rejectRoot?.( art, user, ref, semantics ))
      return null;

    switch (art.kind) {
      case 'using': {
        const def = model.definitions[art.extern.id];
        if (!def)
          return def;
        if (def.$duplicates)
          return false;
        return setArtifactLink( head, def ); // we do not want to see the using
      }
      case 'mixin': {
        // use a source element having that name if in `extend … with columns`:
        const elem = (user._user || user).$extended &&
          art._parent._combined[head.id];
        if (elem) {
          path.$prefix = elem._parent.name.id; // prepend alias name
          info( 'ref-special-in-extend', [ head.location, user ],
                { '#': 'mixin', id: head.id, art: elem._origin._main } );
          setLink( head, '_navigation', elem );
          return setArtifactLink( head, elem._origin );
        }
        return setLink( head, '_navigation', art );
      }
      case '$navElement': {
        setLink( head, '_navigation', art );
        return setArtifactLink( head, art._origin );
      }
      case '$tableAlias': {
        // use a source element having that name if in `extend … with columns`:
        const { $extended } = user._user || user;
        // if query source has duplicates, table alias has no elements
        const elem = $extended && art.elements?.[head.id];
        if (elem) {
          path.$prefix = art.name.id; // prepend alias name
          info( 'ref-special-in-extend', [ head.location, user ],
                { '#': 'alias', id: head.id, art: elem._origin._main } );
          setLink( head, '_navigation', elem );
          return setArtifactLink( head, elem._origin );
        }
        else if ($extended && art.elements) {
          warning( 'ref-deprecated-in-extend', [ head.location, user ], { id: head.id },
                   // eslint-disable-next-line @stylistic/js/max-len
                   'In an added column, do not use the table alias $(ID) to refer to source elements' );
        }
      }
      /* FALLTHROUGH */
      case '$self': {           // TODO: remove $projection from CC
        setLink( head, '_navigation', art );
        setArtifactLink( head, art._origin ); // query source or leading query in FROM
        if (!art._origin)
          return art._origin;
        // if just table alias (with expand), mark `user` with `$noOrigin` to indicate
        // that the corresponding entity should not be put as $origin into the CSN.
        // TODO: remove again, should be easy enough in to-csn without.
        if (path.length === 1 && art.kind === '$tableAlias')
          (user._user || user).$noOrigin = true;
        if (head.id === '$projection' && user.kind === '$annotation') {
          error( 'ref-unsupported-projection', [ head.location, user ],
                 { code: '$projection', newcode: '$self' },
                 '$(CODE) is not supported in annotations; replace by $(NEWCODE)' );
        }
        return art;
      }
      case '$parameters': {
        // TODO: if ref.scope='param' is handled, test that here, too ?
        const id = path[1]?.id;
        const code = id ? `$parameters.${ id }` : '$parameters';
        const newcode = id ? `:${ id }` : ':‹param›';
        message( 'ref-obsolete-parameters', [ head.location, user ], { code, newcode },
                 'Obsolete $(CODE) - replace by $(NEWCODE)' );
        return art;
      }
      case 'builtin': {
        if (art.name.id === '$at') {
          message( 'ref-deprecated-variable', [ head.location, user ],
                   { code: '$at', newcode: '$valid' },
                   '$(CODE) is deprecated; use $(NEWCODE) instead' );
        }
        return art;
      }
      default:
        return art;
    }
  }

  function getAmbiguousRefLink( arr, head, user ) {
    if (arr[0].kind !== '$navElement' || arr.some( e => e._parent.$duplicates ))
      return false;
    // only complain about ambiguous source elements if we do not have
    // duplicate table aliases, only mention non-ambiguous source elems
    const uniqueNames = arr.filter( e => !e.$duplicates );
    if (uniqueNames.length) {
      const names = uniqueNames.filter( e => e._parent.name?.$inferred !== '$internal' )
        .map( e => `${ e._parent.name.id }.${ e.name.id }` );
      let variant = names.length === uniqueNames.length ? 'std' : 'few';
      if (names.length === 0)
        variant = 'none';
      error( 'ref-ambiguous', [ head.location, user ], { '#': variant, id: head.id, names } );
    }
    return false;
  }

  // Functions for the secondary reference semantics ----------------------------

  function typeOfSemantics( user, [ head ] ) {
    // `type of` is only allowed for (sub) elements of main artifacts
    while (!user.kind && user._outer)
      user = user._outer;
    let struct = user;
    while (struct.kind === 'element')
      struct = struct._parent;
    if (struct === user._main && struct.kind !== 'annotation')
      return { dynamic: typeOfParentDict, navigation: staticTarget };
    error( 'type-unexpected-typeof', [ head.location, user ],
           { keyword: 'type of', '#': struct.kind } );
    return false;
  }

  function paramSemantics( _user, _path, _loction, semantics ) {
    return {
      messageMap: semantics.messageMap,
      dynamic: artifactParams,
      notFound: undefinedParam,
    };
  }

  function paramUnsupported( user, _path, location ) {
    error( 'ref-unexpected-scope', [ location, user ], // TODO: ref-unexpected-param
           // why an extra text for calculated elements? or separate for all?
           { '#': (user.$syntax === 'calc' ? 'calc' : 'std') } );
    return false;
  }

  // Functions for semantics.lexical: -------------------------------------------

  function userBlock( user ) {
    return definedViaCdl( user ) && user._block;
  }
  function justDollarAliases( user ) {
    const query = userQuery( user );
    if (!query)
      return user._main || user; // TODO: also contains `up_` for aspects; remove
    // query.$tableAliases contains both aliases and $self/$projection
    const aliases = query.$tableAliases;
    const r = Object.create( null );
    if (aliases.$self.kind === '$self')
      r.$self = aliases.$self;
    // TODO: disallow $projection for ON conditions all together
    if (aliases.$projection?.kind === '$self')
      r.$projection = aliases.$projection;
    const { $parameters } = user._main.$tableAliases;
    if ($parameters)        // no need to test `kind`, just compiler-set “aliases”
      r.$parameters = $parameters;
    return { $tableAliases: r };
  }
  function tableAliasesAndSelf( user ) {
    return userQuery( user ) || user._main || user;
  }

  // Functions called via semantics.dynamic: ------------------------------------

  function modelDefinitions() {
    return model.definitions;
  }
  function modelBuiltinsOrDefinitions( user ) {
    return definedViaCdl( user ) ? model.$builtins : model.definitions;
  }

  function artifactParams( user ) {
    // TODO: already report error here if no parameters?
    return boundActionOrMain( user ).params || Object.create( null );
  }

  function boundActionOrMain( art ) {
    while (art._main) {
      if (art.kind === 'action' || art.kind === 'function')
        return art;
      art = art._parent;
    }
    return art;
  }

  function typeOfParentDict( user ) {
    // CDL produces the following XSN representation for `type of elem`:
    //  { path: [{ id: 'type of'}, { id: 'elem'}], scope: 'typeOf' }
    return { 'type of': user._parent };
  }

  function targetElements( user, pathItemArtifact ) {
    // has already been computed - no further `navigationEnv` args needed
    const env = navigationEnv( pathItemArtifact || user._parent );
    // do not use env?.elements: a `0` should stay a `0`:
    return env && env.elements;
  }

  function combinedSourcesOrParentElements( user ) {
    const query = userQuery( user );
    if (!query)
      return environment( user._main ? user._parent : user );
    return query._combined;     // TODO: do we need query._parent._combined ?
  }
  function parentElements( user ) {
    // Note: We could have `$self` in bound actions refer to its entity, but reject it now.
    // If users request it, we can either allow it later or point them to binding parameters.
    const useParent = user._main &&
      user.kind !== 'select' &&
      user.kind !== 'action' &&
      user.kind !== 'function';
    return environment( useParent ? user._parent : user );
  }

  function parentElementsOrKeys( user ) {
    // annotations on foreign keys only ever have access to their keys (except of course via $self)
    if (user.kind === 'key')
      return user._parent?.foreignKeys || Object.create( null );
    return parentElements( user );
  }

  function queryElements( user ) {
    return environment( user );
  }

  function nestedElements( user ) {
    const colParent = user._columnParent;
    Functions.effectiveType( colParent ); // set _origin
    const path = colParent?.value?.path;
    if (!path?.length)
      return undefined;
    // also set dependency when navigating along assoc → provide location
    return environment( colParent._origin, path[path.length - 1].location, colParent );
  }

  // Function called via semantics.navigation: ----------------------------------
  // default is function `environment`

  function artifactsEnv( art ) {
    return art._subArtifacts || Object.create( null );
  }

  function staticTarget( prev ) {
    let env = navigationEnv( prev ); // we do not write dependencies for assoc navigation
    if (env === 0)
      return 0;
    // Last try - Composition with targetAspect only (in aspect def):
    const target = env?.targetAspect;
    if (target) {
      if (target.elements)
        return target.elements;
      env = resolvePath( env.targetAspect, 'targetAspect', env );
    }
    return env?.elements || Object.create( null );
  }

  function targetNavigation( art, location, user ) {
    const env = navigationEnv( art, location, user, false );
    // do not use env?.elements: a `0`/false should stay a `0`/false:
    return env && env.elements;
  }

  function assocOnNavigation( art, location, user ) {
    const env = navigationEnv( art, location, user, null );
    // `null` means: do not write a dependency from target of any association
    // otherwise “following” own assoc would lead to cycle.
    // TODO: disallow navigation other than of own assoc, and to foreign keys
    // This way (not here though, but later in resolve.js)
    if (env === 0)
      return 0;
    return env?.elements || Object.create( null );
  }

  function calcElemNavigation( art, location, user ) {
    const env = navigationEnv( art, location, user, 'calc' );
    if (env === 0)
      return 0;
    return env?.elements || Object.create( null );
  }

  // Return effective search environment provided by artifact `art`, i.e. the
  // `artifacts` or `elements` dictionary.  For the latter, follow the `type`
  // chain and resolve the association `target`.  View elements are calculated
  // on demand.
  // TODO: what about location/user when called from getPath ?
  // TODO: think of removing `|| Object.create(null)`.
  //       (if not possible, move to second param position)
  function environment( art, location, user ) {
    const env = navigationEnv( art, location, user, 'nav' );
    if (env === 0)
      return 0;
    return env?.elements || Object.create( null );
  }

  function navigationEnv( art, location, user, assocSpec ) {
    // = effectiveType() on from-path, TODO: should actually already part of
    // resolvePath() on FROM
    if (!art)
      return undefined;
    let type = Functions.effectiveType( art );
    while (type?.items)          // TODO: disallow navigation to many sometimes
      type = Functions.effectiveType( type.items );
    if (!type?.target)
      return type;

    if (assocSpec === false) {  // TODO: move to getPathItem
      error( null, [ location, user ], {},
             'Following an association is not allowed in an association key definition' );
      return false;
    }                   // TODO: else warning for assoc usage with falsy assocSpec
    const target = type?.target._artifact;
    if (!target)
      return target;
    // TODO: really write final dependency with expand/inline?
    if (target && assocSpec && user) {
      if (assocSpec !== 'calc')
        dependsOn( user._main || user, target, location || user.location, user );
      else
        dependsOn( user.$calcDepElement, target, location || user.location, user );
    }
    const effectiveTarget = Functions.effectiveType( target );
    // if (effectiveTarget === 0 && location)
    //   dependsOn( user, user, (user.target || user.type || user.value || user).location );
    // console.log('NT:',assocSpec,!!user,target)
    return effectiveTarget;
  }

  // Functions called via semantics.notFound: -----------------------------------

  function undefinedDefinition( user, item, valid, _dict, prev ) {
    // in a CSN source or for `using`, only one env was tested (valid.length 1) :
    const art = (!prev) ? item.id : searchName( prev, item.id, 'absolute' );
    signalNotFound( (valid.length > 1 ? 'ref-undefined-art' : 'ref-undefined-def'),
                    [ item.location, user ], valid, { art } );
    // TODO: improve text, use text variant for: "or builtin" or "definitions" or none
  }

  function undefinedForAnnotate( user, item, valid, _dict, prev, path ) {
    // in a CSN source, only one env was tested (valid.length 1):
    const art = (!prev) ? item.id : searchName( prev, item.id, 'absolute' );
    if (!user.elements && !user.actions && !user.enum && !user.params &&
        couldBeDraftsEntity( item.id, valid, prev, path ))
      return;
    signalNotFound( (valid.length > 1 ? 'ext-undefined-art' : 'ext-undefined-def'),
                    // TODO: ext-undefined-xyz
                    [ item.location, user ], valid, { art } );
  }

  function couldBeDraftsEntity( id, valid, prev, path ) {
    const entity = prev
      ? prev === path[path.length - 2]._artifact && prev
      : path.length === 1 && id.endsWith( '.drafts' ) && model.definitions[id.slice( 0, -7 )];
    return entity?.kind === 'entity' && !!entity._service;
  }

  function undefinedParam( user, head, valid, _dict, _art, _path, semantics ) {
    // TODO: text variant if there are no parameters, or in artifactParameters()
    // TODO: use prepared message variants
    signalNotFound( 'ref-undefined-param', [ head.location, user ], valid,
                    { art: boundActionOrMain( user ), id: head.id }, semantics );
  }

  function undefinedTargetElement( user, head, valid, _dict, pathItemArtifact ) {
    // `art.target` may not set in case target entities `myEntity[unknown > 2]`
    const art = pathItemArtifact?._effectiveType || user._parent;
    // TODO: better with $refs in filter conditions
    signalNotFound( 'ref-undefined-element', [ head.location, user ], valid,
                    { '#': 'target', art: art.target || art, id: head.id } );
  }

  function undefinedVariable( user, head, valid ) {
    // TODO: avoid message if we have already complained about `(exists …)`?
    const { id } = head;
    const isVar = id.charAt( 0 ) === '$' && id !== '$self';
    // TODO: for wrong $self, also use ref-undefined-var, but with extra msg id
    // otherwise, use s/th like ref-unexpected-element
    signalNotFound( ( isVar ? 'ref-undefined-var' : 'ref-expecting-const'),
                    [ head.location, user ],
                    valid, { '#': 'std', id } );
    // TODO: use s/th better than 'ref-expecting-const' !!
  }

  function undefinedSourceElement( user, head, valid, dynamicDict ) {
    // TODO: we might mention both the "direct" and the "effective" type and
    // always just mentioned one identifier as not found
    const { id } = head;
    if (id.charAt( 0 ) === '$') {
      const tableAlias = dynamicDict[id]?._parent;
      // TODO: probably better to pass param `semantics` and calculate dynamic dict explicitly
      const alias = tableAlias?.kind === '$tableAlias' ? tableAlias.name?.id : null;
      // TODO: mention $self without query
      signalNotFound( 'ref-undefined-var', [ head.location, user ], valid,
                      { '#': (alias ? 'alias' : 'std'), alias, id } );
    }
    else {
      const isVirtual = (user.name?.id === id && user.virtual?.val);
      const code = 'virtual null as ‹name›';
      signalNotFound( 'ref-undefined-element', [ head.location, user ], valid,
                      { art: head.id, '#': isVirtual ? 'virtual' : 'std', code } );
    }
  }

  function undefinedParentElement( user, head, valid, dynamicDict, _art, _path, semantics ) {
    // TODO: we might mention both the "direct" and the "effective" type and
    // always just mentioned one identifier as not found
    const { id } = head;
    if (id.charAt( 0 ) === '$') {
      const queryOrMain = dynamicDict[id]?._parent;
      const withSelf = queryOrMain && (!queryOrMain._main || queryOrMain?.kind === 'select');
      signalNotFound( 'ref-undefined-var', [ head.location, user ], valid,
                      { '#': (withSelf ? 'self' : 'std'), alias: '$self', id } );
    }
    else {
      // TODO: extra msg like ref-rejected-on if elem found in source elements?
      // also whether users wrongly tried to refer to aliases/mixins?
      const msgVar = userQuery( user ) ? 'query' : null;
      // TODO: better with ON in expand if that is supported
      signalNotFound( 'ref-undefined-element', [ head.location, user ], valid,
                      { '#': msgVar, art: head.id }, semantics );
    }
  }

  function undefinedOrderByElement( user, head, valid, dynamicDict, _art, path ) {
    const { id } = head;
    const src = id.charAt( 0 ) !== '$' && user._combined?.[id];
    if (src && !Array.isArray( src )) {
      path.$prefix = src._parent.name.id; // pushing it to path directly could be problematic
      // configurable error:
      signalNotFound( 'ref-deprecated-orderby', [ head.location, user ], valid,
                      { id: head.id, newcode: `${ path.$prefix }.${ head.id }` } );
      return src;
    }
    undefinedParentElement( user, head, valid, dynamicDict );
    return null;
  }

  function undefinedNestedElement( user, head, valid, _dict, _art, path, semantics ) {
    const art = user._columnParent._origin;
    if (!art)
      return null;              // no consequential error
    return undefinedItemElement( user, head, valid, null, art, path, semantics );
  }

  function undefinedItemElement( user, item, valid, _dict, art, path, semantics ) {
    if (semantics.notFound === null)
      return;
    const query = userQuery( art );
    if (query?.name?.id > 1) {
      const root = userQuery( user ) !== query && path[0]._navigation;
      const alias = (root?.kind === '$navElement')
        ? root._parent
        : root?.kind === '$tableAlias' && root;
      // TODO: improve alias retrieval if inside expand/inline
      signalNotFound( 'ref-undefined-element', [ item.location, user ], valid,
                      { '#': (alias ? 'alias' : 'query'), art: item.id, alias: alias?.name?.id },
                      semantics );
    }
    else if (art.kind === '$parameters') {
      signalNotFound( 'ref-undefined-param', [ item.location, user ],
                      valid, { art: art._main, id: item.id }, semantics );
    }
    else if (art.kind === 'builtin') { // magic variable / replacement variable
      // $magic.{ var } is a configurable error,
      // TODO: if it becomes non-configurable, we can omit this warning
      let id = pathName( path );
      let head = path[0]._artifact || { _parent: art };
      // eslint-disable-next-line sonarjs/no-nested-assignment
      while ((head = head?._parent) && head.kind === 'builtin')
        id = `${ head.name.id }.${ id }`;
      const msgId = (art.$uncheckedElements) ? 'ref-unknown-var' : 'ref-undefined-var';
      signalNotFound( msgId, [ item.location, user ],
                      removeInvalidMagicVariables( valid, semantics ), { id }, semantics );
    }
    else if (art.kind === 'aspect' && !art.name) { // anonymous target aspect - TODO: still?
      signalNotFound( 'ref-undefined-element', [ item.location, user ], valid,
                      { '#': 'aspect', id: item.id }, semantics );
    }
    else {
      const target = art._effectiveType?.target;
      if (target?._artifact) {
        signalNotFound( 'ref-undefined-element', [ item.location, user ], valid,
                        { '#': 'target', art: target, id: item.id }, semantics );
      }
      else if (!target) {
        const variant = art.kind === 'aspect' && !art.name && 'aspect';
        const a = (variant) ? '' : searchName( art, item.id, 'element' );
        signalNotFound( 'ref-undefined-element', [ item.location, user ], valid,
                        { '#': variant, art: a, id: item.id }, semantics );
      }
    }
  }

  // Functions called via semantics.accept: -------------------------------------
  // function arguments ( art, user, ref, semantics ),
  // default (for elements only): acceptElemOrVar

  function rejectOwnAliasesAndMixins( art, user, ref, semantics ) { // orderBy-set-ref
    switch (art.kind) {
      case '$tableAlias':
      case 'mixin':
        if (art._parent !== user)
          return false;
        break;
      case '$self':
        if (!semantics)         // orderBy-set-expr
          break;
        // FALLTHROUGH
      default:
        return false;
    }
    error( 'ref-invalid-element', [ ref.path[0].location, user._user ],
           { '#': art.kind, id: art.name.id } );
    return true;
  }

  function rejectAllOwn( art, user, ref ) { // orderBy-set-expr
    return rejectOwnAliasesAndMixins( art, user, ref, null );
  }

  function rejectOwnExceptVisibleAliases( art, user, ref ) { // for join-on
    switch (art.kind) {
      case '$navElement':
        art = art._parent;
        // FALLTHROUGH
      case '$tableAlias':
      case 'mixin':
        if (art._parent !== user._user || user.$tableAliases[art.name.id])
          return false;
        break;
      case '$self':
        // in the SQL backend, the $self.elem references are replaced by the
        // corresponding column expression; this might have references to elements
        // of invisible table aliases; at least one stakeholder uses this,
        // so it can't be an error (yet).
        message( 'ref-deprecated-self-element', [ ref.path[0].location, user._user ], {},
                 // eslint-disable-next-line @stylistic/js/max-len
                 'Referring to the query\'s own elements here might lead to invalid SQL references; use source elements only' );
        return false;
      default:
        return false;
    }
    error( 'ref-invalid-element', [ ref.path[0].location, user._user ],
           { '#': art.kind, id: art.name.id } );
    return true;
  }

  function acceptElemOrVarOrSelf( art, user, ref ) {
    // TODO: make $self._artifact point to the $self alias, not the entity
    return (!(art._main && art.kind !== 'select') && ref.path[0]._navigation?.kind === '$self')
      ? art
      : acceptElemOrVar( art, user, ref );
  }

  function acceptElemOrVar( art, user, ref, semantics ) {
    const { path } = ref;
    if (art.kind === 'builtin') {
      if (art.$onlyInExprCtx && !art.$onlyInExprCtx.includes(semantics.name)) {
        error( 'ref-unexpected-var', [ ref.location, user ], {
          '#': art.$onlyInExprCtx[0], name: pathName( path ),
        });
        return null;
      }

      if (user.expand || user.inline) {
        const location = (user.expand || user.inline)[$location];
        const code = (user.expand) ? '{ ‹expand› }' : '.{ ‹inline› }';
        message( 'def-unexpected-nested-proj', [ location, user ], { '#': 'var', code } );
      }
      else if (art.$requireElementAccess) { // on some CDS variables
        // Path with only one item, but we expect an element, e.g. `$at.from`.
        signalMissingElementAccess( art, [ path[0].location, user ] );
        return null;
      }
      else if (art.$autoElement) {
        const { location } = path[0];
        const step = { id: art.$autoElement, $inferred: '$autoElement', location };
        path.push( step );
        art = art.elements[step.id];
        return setArtifactLink( step, art );
      }
    }
    // TODO: combine $requireElementAccess/$autoElement to $bareRoot ?
    else if (!user.expand && !user.inline &&  // $self._artifact to main artifact
        !(art._main && art.kind !== 'select') && ref.path[0]._navigation?.kind === '$self') {
      // TODO: better ref-invalid-self
      const { location, id } = path[0];
      error( 'ref-unexpected-self', [ location, user ], { id } );
      // TODO: reject bare $projection here (new message id, configurable)
      // TODO: should we also attach valid names?  Probably not...
      // TODO: return false;   ??
      // return false;
    }
    return art;
  }

  /**
   * Returns true, if the artifact is a _real_ artifact that can be used for `extend`/`annotate`.
   */
  function extendableArtifact( art, user, ref ) {
    if (art.kind !== 'namespace')
      return art;
    const { location } = ref.path[ref.path.length - 1];
    if (user.kind === 'extend' && !(user.elements || user.actions || user.includes))
      return art; // allow `extend with definitions` and empty extends

    // for `annotate`, handle "namespaces" just like unknown artifacts: only emit a warning
    signalNotFound( user.kind === 'annotate' ? 'ext-undefined-def' : 'ref-undefined-def',
                    [ location, user ], null, { art } );
    return false;
  }

  function acceptStructOrBare( art, user, ref ) { // for includes[]
    // It had been checked before that `includes` is already forbidden for
    // non-entity/aspect/type/event.
    //
    // We currently disallow as include:
    // - non-structured types or derived type of structured:
    //   would have to follow type in extend/include;
    // - entities with params: clarify inheritance, use of param in ON/DEFAULT;
    // - query entities/events: difficult sequence of resolve steps
    // - aspect with one ore more elements on query entities / events
    // - aspect with `elements` property on non-structured types

    // TODO: adapt `user` if it is an `extend`?  NOTE: we cannot call
    // effectiveType() on user - it might be in the process of being computed!
    // Also, it is not clear whether `art.elements` has been completed → testing
    // its length might be processing-sequence dependent, see #11346.  We must
    // ensure that an include does not add the `elements` property!
    const base = (user.kind === 'extend' ? user.name._artifact : user);
    if (!base)
      return art;
    if (base.query || base.type || !base.elements) {
      // Remark: it is not necessary to test for user.elements[$inferred], because
      // the type could only have inferred elements if it has a type expression.
      // Including aspects with elements is forbidden for aspects without the
      // `elements` property.  Testing for the length of `art.elements` requires
      // that we have applied potential `includes` of `art` before!
      // We might allow includes with elements in the future, they'd probably
      // count as specified elements with lower priority, i.e. annos, types, key
      // etc on columns beat those inherited from the include.
      if (art.kind === 'aspect' &&
          (!art.elements || base.query && !Object.keys( art.elements ).length))
        return art;
      signalNotFound( 'ref-invalid-include', [ ref.location, user ], null,
                      { '#': 'bare' } );
    }
    else {
      if (!art.query && !art.type && !art.params && (art.elements || art.kind === 'aspect'))
        return art;
      const variant = art.params && 'param' || 'std';
      signalNotFound( 'ref-invalid-include', [ ref.location, user ], null, { '#': variant } );
    }
    return false;
  }

  // Remember: a valid aspect should have already been moved to XSN targetAspect, but
  // the error messages should still talk about potential aspects
  function acceptEntity( art, user, ref ) { // for target
    if (art.kind === 'entity')
      return art;
    // Extra msg text with Composition of NeitherEntityNorAspect:
    const bare = !art.elements || art.elements[$inferred];
    const std = targetCantBeAspect( user );
    const msg = std || (bare && art.kind === 'aspect' ? 'bare' : 'composition');
    signalNotFound( 'ref-invalid-target', [ ref.location, user ], null,
                    { '#': msg } );
    return false;
  }

  function acceptAspect( art, user, ref ) { // for targetAspect
    const bare = !art.elements || art.elements[$inferred];
    if (!bare) {
      if (art.kind === 'aspect')
        return art;
      if (art.kind === 'type') {  // v4: Warning → config Error
        signalNotFound( 'ref-sloppy-target', [ ref.location, user ], null );
        return art;
      }
    }
    signalNotFound( 'ref-invalid-target', [ ref.location, user ], null,
                    { '#': (bare ? 'bare' : 'aspect'), prop: 'targetAspect' } );
    return false;
  }

  function acceptQuerySource( art, user, ref ) { // for FROM
    const { path, scope } = ref;
    // see getPathItem(): how many path items are for the main artifact ref?
    const artItemsCount = (typeof scope === 'number' && scope) || (scope ? 1 : path.length);

    // at least the last main definition should be an entity or an
    // event (if the user is an event) or type (if the user is a type)
    // an additional check for target would need effectiveType()
    const source = path[artItemsCount - 1]._artifact;
    if (user._main?.kind === 'type') {
      if (!acceptTypeProjectionSource( source )) {
        signalNotFound( 'ref-invalid-source', [ ref.location, user ], null,
                        { '#': 'type' } );
        return (source === art) ? art : false; // art to show cyclic issues
      }
    }
    else if (source.kind !== 'entity' &&
        !acceptEventProjectionSource( source, user )) {
      signalNotFound( 'ref-invalid-source', [ ref.location, user ], null,
                      { '#': user._main.kind } );
      return (source === art) ? art : false; // art to show cyclic issues
    }
    if (source === art)
      return art;
    const assoc = Functions.effectiveType( art );
    if (assoc.target)
      return art;               // TODO: use target here
    signalNotFound( 'ref-invalid-source', [ ref.location, user ], null, { '#': user._main.kind } );
    return false;
  }

  function acceptEventProjectionSource( source, user ) {
    if (user._main.kind !== 'event' || (source.kind !== 'event' && source.kind !== 'type'))
      return false;
    const effectiveType = Functions.effectiveType( source );
    if (!effectiveType)
      return false;
    const { kind } = effectiveType;
    return (kind === 'entity' || kind === 'event' || (kind === 'type' && effectiveType.elements));
  }

  function acceptTypeProjectionSource( source ) {
    // We require the projection source to be structured.
    // TODO: Also allow all associations?
    return Functions.effectiveType( source )?.elements;
  }

  function acceptTypeOrElement( art, user, ref ) { // for type
    // was ['action', 'function'].includes( user._parent?.kind ))
    while (user._outer)
      user = user._outer;
    const kind = (user.kind !== 'param' || user._parent?.kind !== 'entity')
      ? user.kind
      : 'entity-param';
    switch (art.kind) {
      case 'type':
      case 'element':
        return art;
      case 'entity':
        if (kind === 'param' && art._service)
          return art;
        // FALLTHROUGH
      case 'event':
        if (kind === 'event')
          return art;
        break;
      default:
        break;
    }
    signalNotFound( 'ref-invalid-type', [ ref.location, user ], null, { '#': kind } );
    return false;
  }

  // Functions called via semantics.check by checkExpr(): -----------------------
  //
  // function arguments: ( expr, exprCtx, user )
  // default: tbd (nothing for main artifac ref)

  // Performs checks which would be too early to do via semantics.accept.  It is
  // actually assumed that the foreign-keys / ON-condition rewrite has already
  // been done.

  // Main check area "navigation" (see also semantics.navigation):
  // - navigation along any assoc
  // - navigation only along foreign keys
  // - (no navigation already via semantics.navigation for target refs of foreign keys)
  // - special (ON-condition of unmanaged associations)

  // Main check area: checks on the referred artifact
  // - all artifacts are allowed
  // - all except unmanaged associations
  // - ...

  function checkExpr( expr, exprCtx, user ) {
    if (!expr)
      return;
    const s = referenceSemantics[exprCtx];
    const semantics = (typeof s === 'string') ? referenceSemantics[s] : s;
    const checkFn = semantics.check; // || !semantics.isMainRef && checkElementStd;

    if (checkFn) {
      traverseExpr( expr, exprCtx, user,
                    ( ...args ) => (checkFn( ...args ) ? traverseExpr.STOP : traverseExpr.SKIP) );
    }
  }

  // TODO: Don't allow path args and filter!
  function checkOnCondition( expr, exprCtx, user ) {
    if (!expr || expr.$inferred)
      return;
    const { op } = expr;
    let { args } = expr;
    if (!op || !args) {
      checkExpr( expr, exprCtx, user );
      return;
    }
    if (op?.val === '=')        // TMP
      args = [ args[0], { val: '=', literal: 'token' }, args[1] ];

    for (let index = 0; index < args.length; ++index) {
      const item = args[index];
      const eq = args[index + 1];
      if (eq?.val === '=' && eq.literal === 'token' && item.path && !item.scope) {
        const right = args[index + 2];
        if (right?.path && !right.scope &&
            (isDollarSelfPair( item, right, user ) || isDollarSelfPair( right, item, user ))) {
          checkAssocOnSelf( item, exprCtx, user );
          checkAssocOnSelf( right, exprCtx, user );
          index += 2;
          continue;
        }
      }
      checkOnCondition( item, exprCtx, user );
    }
  }

  // // standard element reference check;
  // function checkElementStd( art, _user, ref, semantics ) {
  //   // No further checks on navigation: nothing to do
  //   // Must not end with any association (TODO: allow managed?):
  //   if (art.target) { // && art.on
  //     // error
  //   }
  // }

  function checkColumnRef( expr, exprCtx, user ) {
    if (!expr.path)
      return;
    if (expr === user.value && // is already a syntax error with non-ref expression
        (user.expand || user.inline))
      checkExpandInlineRef( expr._artifact, user, expr );

    const self = pathStartsWithSelf( expr );
    // console.log('NAV:',expr.path.map(r=>r.id),self)
    if (self || self == null && columnRefStartsWithSelf( user )) {
      checkOnlyForeignKeyNavigation( user, expr.path, 0, 'self-' );
      checkNoUnmanaged( expr, user, true, 'self-unmanaged' );
    }
    // TODO: set navigation dependencies later to avoid both ref-cyclic and
    // ref-invalid-navigation/ref-unexpected-assoc
  }

  function checkOrderByRef( expr, exprCtx, user ) {
    const { path } = expr;
    if (!path)
      return;
    const self = path?.[0]?._navigation?.kind !== '$tableAlias';
    if (self)
      checkOnlyForeignKeyNavigation( user, expr.path );
    checkNoUnmanaged( expr, user, self );
  }

  function checkRefInQuery( expr, exprCtx, user ) {
    const { path } = expr;
    if (!path)
      return;
    const self = pathStartsWithSelf( expr );
    if (self)
      checkOnlyForeignKeyNavigation( user, expr.path, 0, 'self-' );
    checkNoUnmanaged( expr, user, self );
  }

  function checkExpandInlineRef( art, user, ref ) {
    if (!art || !art._main ||   // $self has entity as _artifact
        art.kind === 'builtin') // no repeated error for CDS variables
      return;
    const effective = art._effectiveType;
    if (!effective || effective.target || effective.elements)
      return;
    const { path } = ref;
    const location = (user.expand || user.inline)[$location];
    // mention `table alias` in text only with initial single path item ref,
    // but do not mention that $self { … } is allowed, shouldn't be advertised:
    const txt = (path.length > 1 || user._columnParent) ? 'struct' : 'init';
    const code = (user.expand) ? '{ ‹expand› }' : '.{ ‹inline› }';
    message( 'def-unexpected-nested-proj', [ location, user ], { '#': txt, code } );
  }

  function isDollarSelfPair( left, right, user ) {
    if (!left.path || !right.path || left.scope || right.scope)
      return false; // param ref `:$self` is not $self
    // $self in entity (TODO: mixin? new assoc in col? in aspect?)
    const kind = right._artifact?.kind;
    if (kind !== 'entity' && kind !== 'aspect' && kind !== 'select' && kind !== 'event')
      return false;           // (ok, this would also return `false` for `:$self`)
    const { path } = left;
    // TODO: we might return true and issue an extra error here
    return userTargetElementPathIndex( user, path ) > 0;
  }

  function checkAssocOn( ref, exprCtx, user ) {
    const { path } = ref;
    if (!path)
      return;
    if (path.length === 1 && path[0]._navigation?.kind === '$self') {
      // resolvePath() for `on` allowed bare $self: disallow except in checkAssocOnSelf
      const { location, id } = path[0];
      error( 'ref-unexpected-self', [ location, user ], { '#': 'on', id } );
      return;
    }
    const index = userTargetElementPathIndex( user, path );
    checkOnlyForeignKeyNavigation( user, path, index );
    const last = path[path.length - 1];
    if (!last.where && ref._artifact?.on) { // filter already complained about
      const target = index > 0 && index < path.length && ref._artifact?.target;
      const msg = (target?._artifact === user._main) ? 'self' : 'unmanaged';
      error( 'ref-unexpected-assoc', [ last.location, user ],
             { '#': msg, code: '= $self' } );
    }
  }

  function checkAssocOnSelf( ref, exprCtx, user ) {
    // TODO: fully specify what `‹current_assoc›.‹backlink› = $self` means if the
    // target of ‹backlink› is not the current entity.
    // - what does it mean in an aspect
    // - how about auto-redirections/rewrite
    const { path } = ref;
    if (path.length === 1 && path[0]._navigation?.kind === '$self') {
      const query = userQuery( user );
      const main = query?._main;
      if (query && query !== main._leadingQuery) {
        const { txt, op } = getQueryOperatorName( query );
        const { location, id } = path[0];
        error( 'ref-unexpected-self', [ location, user ], { '#': txt, id, op } );
      }
      return;
    }
    const index = userTargetElementPathIndex( user, path );
    checkOnlyForeignKeyNavigation( user, path, index );
    const target = index > 0 && index < path.length && ref._artifact?.target;
    if (!target) {
      const last = path[path.length - 1];
      error( 'ref-expecting-target-assoc', [ last.location, user ], { id: '$self' },
             'Only an association of the target side can be compared to $(ID)' );
    }
    // in entity: target must match
    // in aspect: must end with assoc, TODO: target must include aspect (+ add/ check)
    else if (target._artifact && target._artifact !== user._main && user._main.kind === 'entity') {
      const last = path[path.length - 1];
      warning( 'ref-invalid-backlink', [ last.location, user ], { art: target, id: '$self' },
               // eslint-disable-next-line @stylistic/js/max-len
               'The target $(ART) of the association is not the current entity represented by $(ID)' );
    }
  }


  // right of union: parent = main → get correct operator
  // FROM subquery: parent = tab alias of outer query
  // other sub query: parent = outer query
  function getQueryOperatorName( query ) {
    if (query._parent !== query._main)
      return { txt: 'subQuery', op: '' };

    for (let set = query._main.query; set.op; set = set.args[0]) {
      const right = set.args[1];
      if (query.name.id >= ((right._leadingQuery || right).name?.id ?? 0))
        return { txt: 'setQuery', op: set.op.val };
    }
    throw new CompilerAssertion( 'Did we pass the leading query as argument?' );
  }

  function userTargetElementPathIndex( user, path ) {
    const head = path[0];
    if (head._artifact === user) // standard case
      return 1;
    if (head._navigation?.kind !== '$self')
      return 0;
    for (let index = 1; index < path.length; ++index) {
      const assoc = path[index]?._artifact;
      if (assoc?.target)
        return (assoc === user) ? index + 1 : 0;
    }
    return 0;
  }

  function checkOnlyForeignKeyNavigation( user, path, startIndex = 0, msgPrefix = '' ) {
    // has to be run after foreign-key rewrite
    const outer = user._columnParent?._origin;
    let assoc = outer?.foreignKeys &&
                pathStartsWithSelf( { path } ) == null && // not $self or CDS var like $now
                outer;
    for (let index = startIndex; index < path.length; ++index) {
      if (assoc?.target) {
        if (!assoc.foreignKeys) {
          error( 'ref-unexpected-assoc', [ path[index - 1].location, user ],
                 { '#': `${ msgPrefix }unmanaged`, alias: '$self' } );
          return;
        }
        if (!assoc.$keysNavigation)
          Functions.addForeignKeyNavigations( assoc, true );
        index = checkCoveredByForeignKey( assoc, path, index, user, msgPrefix );
      }
      assoc = path[index]?._artifact;
      if (assoc?.target) {
        // testing this above is not enough: we would not complain about $self
        // assoc filter at end of ref with expand/inline. We might also move the
        // unmanaged test above to here.
        if (path[index]?.where) {
          error( 'ref-unexpected-assoc', [ path[index].location, user ],
                 { '#': `${ msgPrefix }with-filter`, alias: '$self' } );
          return;
        }
      }
    }
  }

  function checkCoveredByForeignKey( nav, path, index, user, msgPrefix = '' ) {
    const assoc = nav;
    while (index < path.length) {
      const item = path[index];
      nav = nav.$keysNavigation?.[item.id];
      if (!nav)
        break;
      if (nav._artifact)
        return index;
      ++index;
    }
    const last = path[index] || path[index - 1];
    // TODO: or just location of `last`?
    // TODO: extra text variant if the foreign keys are the key elements !
    // eslint-disable-next-line no-nested-ternary
    const txt = index >= path.length
      ? 'complete'
      : (isAssocToPrimaryKeys( assoc ) ? 'keys' : 'std');
    error( 'ref-invalid-navigation', [ last.location, user ], {
      '#': msgPrefix + txt, art: assoc, name: last.id, alias: '$self',
    }, {
      std: 'Can follow association $(ART) only to its foreign key references, not to $(NAME)',
      keys: 'Can follow managed association $(ART) only to the keys of its target, not to $(NAME)',
      complete: 'The reference must cover a full foreign key reference of association $(ART)',
      // eslint-disable-next-line @stylistic/js/max-len
      'self-std': 'In column ref starting with $(ALIAS), we can follow association $(ART) only to its foreign key references, not to $(NAME)',
      // eslint-disable-next-line @stylistic/js/max-len
      'self-keys': 'In column ref starting with $(ALIAS), we can follow managed association $(ART) only to the keys of its target, not to $(NAME)',
      // eslint-disable-next-line @stylistic/js/max-len
      'self-complete': 'The column reference starting with $(ALIAS) must cover a full foreign key reference of association $(ART)',
    } );
    // TODO later: mention allowed ones
    return path.length;
  }

  function checkNoUnmanaged( ref, user, self, messageVariant = 'unmanaged' ) {
    if (ref._artifact?.on && !ref.$expected) {
      const { path } = ref;
      const last = path[path.length - 1];
      if (self && last.where)   // already complained about filter
        return;
      error( 'ref-unexpected-assoc', [ last.location, user ],
             { '#': messageVariant, alias: '$self' } );
    }
  }

  // Low-level functions --------------------------------------------------------

  /**
   * Make a "not found" error and optionally attach valid names.
   *
   * @param {string} msgId
   * @param {any} location
   * @param {object[]} valid
   * @param {object} [textParams]
   * @param {object} [semantics]
   */
  function signalNotFound( msgId, location, valid, textParams, semantics ) {
    if (location.$notFound)     // TODO: still necessary?
      return;
    location.$notFound = true;
    /** @type {object} */
    const err = message( semantics?.messageMap?.[msgId] || msgId, location, textParams );
    if (valid) {
      const user = Array.isArray( location ) && location[1];
      err.validNames = (user && definedViaCdl( user )); // viaCdl -> '.'?
      valid.reverse();
      attachAndEmitValidNames( err, ...valid );
    }
  }

  /**
   * Emit a 'ref-expected-element' error for magic variable references
   * that require element accesses but don't do.
   * For example: `$at`, but `$at.from` or `$at.to` is required.
   *
   * @param {object} art
   * @param {any} location
   */
  function signalMissingElementAccess( art, location ) {
    // TODO: ref-undefined-var ?
    const err = message( 'ref-expected-element', location,
                         { '#': 'magicVar', id: art.name.id } );
    // Mapping for better valid names: from -> $at.from
    const valid = Object.keys( art.elements || {} ).reduce( (prev, curr) => {
      prev[`${ art.name.id }.${ curr }`] = true;
      return prev;
    }, Object.create( null ) );
    attachAndEmitValidNames( err, valid );
  }

  /**
   * Attaches a dictionary of valid names to the given compiler message.
   * In test mode, an info message is emitted with a list of valid names.
   *
   * @param {CompileMessage} msg CDS Compiler message
   * @param  {...object} validDicts One ore more artifact dictionaries such as in `_block`.
   */
  function attachAndEmitValidNames( msg, ...validDicts ) {
    const viaCdl = msg.validNames; // TODO: move to argument list
    if (!options.testMode && !options.attachValidNames)
      return;

    const valid = Object.assign( Object.create( null ), ...validDicts );
    msg.validNames = Object.create( null );
    for (const name of Object.keys( valid )) {
      const art = valid[name];
      // ignore internal types such as cds.Association, ignore names with dot for
      // CDL references to main artifacts:
      if (!art.internal && !art.deprecated && art.name?.$inferred !== '$internal' &&
          (viaCdl ? art._main || !name.includes( '.' ) : art.kind !== 'namespace'))
        msg.validNames[name] = art;
    }

    if (options.testMode && !options.$recompile) {
      // no semantic location => either first of [loc, semantic loc] pair or just location.
      const loc = msg.$location[0] || msg.$location;
      const names = Object.keys( msg.validNames );
      names.sort();
      if (names.length > 22) {
        names.length = 20;
        names[20] = '…';
      }
      info( null, [ loc, null ],
            { '#': !names.length ? 'zero' : 'std' },
            { std: `Valid: ${ names.join( ', ' ) }`, zero: 'No valid names' } );
    }
  }
}

function removeInvalidMagicVariables( variables, semantics ) {
  if (Array.isArray(variables))
    return variables.map(variable => removeInvalidMagicVariables( variable, semantics ));

  const valid = Object.create(null);
  for (const name in variables) {
    const variable = variables[name];
    if (!variable.$onlyInExprCtx || variable.$onlyInExprCtx.includes( semantics.name ))
      valid[name] = variable;
  }
  return valid;
}

function removeDollarNames( dict ) {
  const r = Object.create( null );
  for (const name in dict) {
    if (name.charAt( 0 ) !== '$')
      r[name] = dict[name];
  }
  return r;
}

module.exports = {
  fns,
};
