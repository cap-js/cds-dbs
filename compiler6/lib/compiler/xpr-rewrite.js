// Rewrite paths in annotation expressions.
//
// This module rewrites paths in expressions of propagated annotations.
// To properly rewrite paths, we need to consider where the annotation originates
// and where it is propagated to.
//
// Paths may need:
// 1. to have their prefix changed.
//    This affects e.g. propagation due to type-of, where a prefix `$self.a` needs to
//    be replaced by `$self.sub.elem` or even simple type references at parameters
//    where `$self` needs to be replaced by `:P`.
// 2. to be rewritten due to projections
//    This affects all paths that contain association steps, as their target may
//    have been redirected, but also all annotations on projections.
//
// References referring to parameters are never rewritten.
//
// Via Includes
// ============
// Path prefixes don't change. However, we may need to reject the annotation if
// an included element was overridden and the type has changed.
//
// The path then needs to be rewritten due to associations.
// See section "Associations".
//
// Via Type
// ========
// If an annotation was written at a type or at an element of a type, we may need to
// adapt path prefixes at the type usage position.
//
// If an annotation is propagated from a type definition and the type is used at:
//
// - another (type) definition, no prefixes need to change.
// - another (type) definition as an include, see "Includes".
// - an element definition, `$self` needs to be replaced by the element name.
//   Paths without `$self` on the type itself (not sub-elements), need to have
//   the element name prepended.
// - a parameter, `$self` needs to be replaced by the parameter name.
//   Paths without `$self` on the type itself (not sub-elements), need to have
//   the parameter name prepended.
// - a return parameter, `$self` needs to be rejected, because there is no way
//   to refer to `returns`. Paths without `$self` on the type itself (not sub-elements),
//   need to be rejected as well.
//
// If elements in a structured type use `$self`, they, too, will need to be rewritten.
// The same rules as above apply.  Because this would always end up in element
// expansion, this case is rejected and only possible with a beta flag.
// If no `$self` is used, no prefixes need to change, as the paths are already relative.
// Parameter references in types do not exist.
//
// The path then needs to be rewritten due to associations.
// See section "Associations".
//
// Via Type-Of
// ===========
// For type-ofs such as `E:sub.elem`, similar rules as for "type" are required, but
// before rewriting the paths, we need to check whether the path is valid.
//
// For `E:sub.elem`, all paths at element `elem` need to refer to sub-elements of
// `elem` or `elem` itself only.  If siblings of `elem` or siblings of `sub` are
// referred to, the path can't be rewritten at the type-of usage location.
//
// Because non-relative references such as `$self` inside structures would always
// end up in element expansion, they are rejected and are only possible with a beta
// flag.
//
// If an annotation is propagated from an element `sub.elem` and the type-of is used at:
//
// - another type definition, the path may also not refer to element `sub.elem`
//   itself, as it can't be rewritten to `$self` at a type definition.
//   Paths starting with `$self.sub.elem` must be replaced by `$self`, i.e.
//   the path up to the last path step in the type-of.
// - an element definition, `$self.sub.elem` needs to be replaced by the element name.
//   Paths without `$self` on the "type-of element" itself need to have
//   the first path step be replaced by the target element name.
// - a parameter, `$self.sub.elem` needs to be replaced by the parameter name.
//   Paths without `$self` on the "type-of element" itself need to have
//   the first path step be replaced by the target parameter name.
// - a return parameter, `$self` needs to be rejected, because there is no way
//   to refer to `returns`. Paths without `$self` on the "type-of element" itself
//   (not sub-elements), need to be rejected as well.
//
// The path then needs to be rewritten due to associations.
// See section "Associations".
//
// Associations
// ============
// All paths containing associations may need to be rewritten.  Due to auto-exposure
// and auto-redirection, associations may be redirected to projections of their
// original targets.  And those projections may rename elements or leave them out
// altogether.  Therefore, all paths with associations need to be rewritten
// according to the rules in section "In Queries".
//
// In Queries
// ==========
// Both, propagation from source entity to query, but also from element to select item,
// need to respect renamed select items.
//
// Select Item via Origin
// ----------------------
// A bare select item of path length one, that gets an annotation via propagation from
// its origin, behaves similar to an element that gets it via an include.
// However, elements may have been renamed or may not be available at all.
// On top of that, they may be inside nested projections (expand).
// Or even simpler: sub-elements may have been selected.
//
// Instead of changing the path prefix, we need to check if the referenced path
// was projected or if a prefix was projected (e.g. for structures or associations).
// The same rules as for ON-condition rewriting apply.
//
// Furthermore, as the target is a select item, and this select item belongs to a table
// alias, we should rewrite all annotation paths only to projected elements of that
// table alias.  Cross-rewriting between table aliases should not be done.
// This is the same we do for association rewriting.
//
// TODO:
//   For now, we do not rewrite sub-structure elements.  The whole structure needs
//   to be projected or the select item isn't considered.  That is, `expand {*}`
//   is not considered, yet.
//
// Query Source
// ------------
// For propagation from query sources to the query, the same rules as for select
// items apply.
//
// Via Calculated Element Origin
// =============================
// Calculated elements behave just like `type-of`.
//
// Notes on $self
// ==============
// Because `$self` handling is complicated and will always result in type-expansion
// if used on/in a type definition, we reject it at such places.
// This module still resolves and rewrites them properly, though, if beta flag
// `rewriteAnnotationExpressionsViaType` is used.
//
// Notes on Propagator
// ===================
// If the compiler expands all elements (including those in `targetAspect`), then we
// can move the call to rewriteAnnotationRefs from the propagator into tweak-assocs.
// There, we need to go through _all_ definitions, not just `model._entities`.
// But until then, we rely on the propagator to properly propagate annotations.


'use strict';

const { weakLocation } = require('../base/location');
const {
  setArtifactLink,
  setLink,
  setExpandStatusAnnotate,
} = require('./utils');
const { CompilerAssertion } = require('../base/error');
const { isBetaEnabled } = require('../base/model');
const { isSimpleCdlIdentifier } = require('../parsers/identifiers');

// Config object passed around all "rewrite" functions.
class AnnoRewriteConfig {
  anno;
  target;
  targetRoot;
  origin;
  fromTargetType;
  fromCalcElement;
  expandedRoot;
  expandedRootType;
  isInFilter;
  tokenExpr;
}

function xprRewriteFns( model ) {
  const { error } = model.$messageFunctions;
  const {
    traverseExpr,
    resolvePath,
    navigationEnv,
    resolvePathRoot,
    cachedRedirectionChain,
    findRewriteTarget,
  } = model.$functions;

  return {
    rewriteAnnotationsRefs,
  };

  /**
   * @param expr
   * @param {AnnoRewriteConfig} config
   * @param {string} [variant]
   */
  function reportAnnoRewriteError( expr, config, variant = 'std' ) {
    return error('anno-missing-rewrite', [
      weakLocation( config.target.location ), config.target,
    ], {
      '#': variant,
      anno: config.anno,
      art: config.origin,
      elemref: expr,
    });
  }

  /**
   * Rewrite the propagated annotation relative to the target.
   *
   * @param {XSN.Artifact} target
   * @param {XSN.Artifact} origin
   * @param {string} annoName
   */
  function rewriteAnnotationsRefs( target, origin, annoName ) {
    // Make sure not to waste time if no inherited annotation has references:
    if (!origin?.$contains?.$annotation?.$path)
      return;

    const anno = target[annoName];
    // only annotations with expressions have a kind
    // also, don't report errors twice
    if (!anno.kind || anno.$invalidPaths)
      return;

    // Annotation comes from the target's type.  That's important to know, because
    // path prefixes need to be adapted.
    const fromTargetType = target.type?._artifact === origin;
    // Annotation comes from the target's calculated element.  A special case propagation rule, e.g
    // for `calcString: String = str;`.  We also need to adapt path prefixes.
    const fromCalcElement = !fromTargetType && target.$calcDepElement &&
      target.value?._artifact === origin;

    const { expandedRoot, expandedRootType } = !fromTargetType && getExpandRoot( target ) || {};

    const config = {
      __proto__: AnnoRewriteConfig.prototype,
      anno: annoName,
      target,
      targetRoot: annoRootArt( target ),
      origin,
      fromTargetType,
      fromCalcElement,
      expandedRoot,
      expandedRootType,
    };

    const hasError = rewriteAnnotationExpr( target[annoName], config );
    target.$contains ??= {};
    target.$contains.$annotation ??= {};
    target.$contains.$annotation.$path ||= origin.$contains.$annotation.$path;
    target.$contains.$annotation.$self ||= origin.$contains.$annotation.$self;
    if (hasError)
      anno.$invalidPaths = true; // avoid subsequent errors
  }

  /**
   * @param {XSN.Expression} expr
   * @param {AnnoRewriteConfig} config
   * @returns {boolean}
   */
  function rewriteAnnotationExpr( expr, config ) {
    if (expr.literal === 'array') {
      return !!expr.val.find(val => rewriteAnnotationExpr( val, config ));
    }
    else if (expr.literal === 'struct') {
      const struct = Object.values(expr.struct);
      return !!struct.find(val => rewriteAnnotationExpr( val, config ));
    }
    else if (expr.$tokenTexts) {
      // used to set `$tokenText` to true in case of rewritten annotation
      config.tokenExpr = expr;
      return traverseExpr.STOP === traverseExpr(
        expr, 'annoRewrite', config.target,
        // eslint-disable-next-line @stylistic/js/max-len, @stylistic/js/function-paren-newline
        (e, refCtx) => (rewriteAnnoExpr( e, config, refCtx ) ? traverseExpr.STOP : traverseExpr.SKIP) );
    }
    return false;
  }

  /**
   * @param {XSN.Expression} expr
   * @param {AnnoRewriteConfig} config
   * @param {string} refCtx
   * @returns {null|true} Returns true if the expression couldn't be rewritten.
   */
  function rewriteAnnoExpr( expr, config, refCtx ) {
    const root = expr.path && (expr.path[0]?._navigation || expr.path[0]?._artifact);
    if (!root || !expr._artifact)
      return null; // invalid path

    const { target } = config;

    // Report obsolete $parameters; parameters on non-actions not supported, yet.
    if (root.kind === '$parameters' || (root.kind === 'param' && root._parent.kind !== 'action' &&
      root._parent.kind !== 'function'))
      return reportAnnoRewriteError( expr, config, 'unsupported' );

    if (root.kind === 'key') {
      // Foreign keys can't be renamed and since we don't have absolute references to foreign keys,
      // i.e. `$self.assoc.target_id` always refers to the target side, we don't have to rewrite
      // them.
      return null;
    }

    // magic variables / replacement variables are never rewritten; they can't
    // have filters nor can they point to elements.
    if (expr._artifact?.kind === 'builtin')
      return null;

    let hasError = false;
    if (config.fromTargetType || config.fromCalcElement)
      hasError = adaptPathPrefixViaType( expr, config );
    else if (config.expandedRoot)
      hasError = adaptPathPrefixViaTypeExpansion( expr, config );

    hasError ||= rewriteGenericAnnoPath( expr, config, refCtx );

    if (hasError)
      return true;

    // TODO: Remove extra loop once filter traversal is added to traverseExpr (#12068)
    for (const step of expr.path) {
      if (step?._artifact && step.where && !Array.isArray( step._artifact ) ) {
        // We must not prefix `$`-renamed variables with `$self`, as it would
        // change meaning, see (#11775).  Also, the path's target changes.
        const assocTarget = step._artifact.target._artifact;
        if (target) {
          const filterConfig = { ...config, target: assocTarget, isInFilter: true };
          if (traverseExpr.STOP === traverseExpr(
            step.where, 'filter', step,
            // eslint-disable-next-line @stylistic/js/max-len
            (e, ctx) => expr.path && (rewriteGenericAnnoPath( e, filterConfig, ctx ) ? traverseExpr.STOP : traverseExpr.SKIP)
          ))
            return true;
        }
        else {
          // can't happen: rejected earlier by compiler
          return reportAnnoRewriteError( expr, config, 'unsupported' );
        }
      }
    }

    if (expr.$tokenTexts === true) {
      // TODO: do not do with Universal-CSN (and gensrc, but that does not matter)
      // We rewrite the string value for backward compatibility with "old-school" tools that
      // only understand the string representation.  But we only do so for simple strings, which
      // is the case if this path expression has $tokenTexts. It then is of the form `@a: (path)`.
      const isSimpleStep = step => !step.where && !step.args && isSimpleCdlIdentifier( step.id );
      if (expr.path.every(isSimpleStep))
        expr.$tokenTexts = expr.path.map( step => step.id ).join('.');
    }

    if (model.options.testMode) {
      // re-resolve the modified path; all paths steps must match what we rewrote
      const ref = { ...expr, path: [ ...expr.path.map(item => ({ ...item })) ] };
      if (!resolvePath( ref, refCtx, target ))
        throw new CompilerAssertion(`rewritten anno path must be resolvable: ${ JSON.stringify(ref.path) }`);

      for (let i = 0; i < ref.path.length; ++i) {
        const actual = ref.path[i];
        const expected = ref.path[i];
        if (actual._artifact !== expected._artifact) {
          throw new CompilerAssertion(`rewritten anno path contains incorrect artifact links: ${
            JSON.stringify(ref.path) }; step ${ i }`);
        }
        else if (actual._navigation !== undefined && actual._navigation !== expected._navigation) {
          throw new CompilerAssertion(`rewritten anno path contains incorrect navigation links: ${
            JSON.stringify(ref.path) }; step ${ i }`);
        }
      }
    }

    return false;
  }

  /**
   * @param {XSN.Expression} expr
   * @param {AnnoRewriteConfig} config
   * @returns {*}
   */
  function getRootEnv( expr, config ) {
    const { target } = config;

    if (expr.scope === 'param') // path is absolute
      return navigationEnv( config.targetRoot, null, null, 'nav' );

    // On select items, use navigation elements or table alias
    // TODO: Expand/inline paths don't have a `_navigation` property on their last
    //       path step, yet.  We need to implement expand/inline.
    const isSimpleSelectItem = target.value?.path && target._main?.query && !target._columnParent;
    if (isSimpleSelectItem) {
      const isSelfPath = (expr.path[0]?._navigation?.kind === '$self');
      if (isSelfPath) {
        // Path is absolute, use table alias to resolve it.
        let tableAlias = target.value.path[0]._navigation;
        while (tableAlias && tableAlias.kind === '$navElement')
          tableAlias = tableAlias._parent;
        if (tableAlias)
          return tableAlias;
      }
      else {
        // Path is relative
        const nav = target.value.path[target.value.path.length - 1]._navigation?._parent;
        if (nav)
          return nav;
      }
    }

    if (isSimpleSelectItem && model.options.testMode)
      throw new CompilerAssertion(`select item has no table alias: ${ JSON.stringify(target.value.path) }`);

    if (isAnnoPathAbsolute( expr ))
      return navigationEnv( config.targetRoot, null, null, 'nav' );

    // anno path is relative / element reference (others were already rejected)
    // if the target is a root artifact, use it. Otherwise, use its parent.
    return navigationEnv( isAnnoRootArt( target ) ? target : target._parent, null, null, 'nav' );
  }

  /**
   * @param {XSN.Expression} expr
   * @param {AnnoRewriteConfig} config
   * @param {string} refCtx
   * @returns {boolean}
   */
  function rewriteGenericAnnoPath( expr, config, refCtx ) {
    const isAbsolute = isAnnoPathAbsolute( expr );
    const startIndex = isAbsolute ? 1 : 0;

    // We get the root environment now, even though below we resolve the root item
    // again if it was absolute (e.g. $self).  We do so, because for queries, we
    // want to respect the select item's corresponding table alias.
    const rootEnv = getRootEnv( expr, config );

    // reset artifact link; we'll set it again if there are no errors
    setArtifactLink( expr, null );

    if (isAbsolute) {
      // Adapt absolute root path, as it isn't rewritten in rewriteItem
      // The path-prefix was already adapted in rewriteAnnoExpr().
      delete expr.path[0]._artifact;
      delete expr.path[0]._navigation;
      // TODO: What about `up_`? Shouldn't we set `_navigation` as well?
      // TODO: Can we handle `$self` of anonymous-composition-of-aspect?
      const root = resolvePathRoot( expr, refCtx, config.target );
      if (!root)
        return reportAnnoRewriteError( expr, config );
    }

    // Store the original artifact, so that we can use it to
    // calculate a redirection chain later on.
    expr.path.forEach((item) => {
      if (item._artifact)
        setLink( item, '_originalArtifact', item._artifact );
    });

    let env = rootEnv;
    let art = expr.path[0]._artifact;

    for (let i = startIndex; i < expr.path.length; ++i) {
      if (i > startIndex && art.target) {
        // if the current artifact is an association, we need to respect the redirection
        // chain from original target to new one.
        // FIXME: Won't work with associations in projected structures.
        const origTarget = expr.path[i - 1]?._originalArtifact?.target?._artifact;
        const chain = cachedRedirectionChain( art, origTarget );
        if (!chain)
          return reportAnnoRewriteError( expr, config );
        for (const alias of chain) {
          art = rewriteItem( expr, config, alias, i );
          if (!art)
            return reportAnnoRewriteError( expr, config );
        }
      }
      art = rewriteItem( expr, config, env, i );
      if (!art)
        return reportAnnoRewriteError( expr, config );
      // target, items, …
      env = navigationEnv( art, null, null, 'nav' );
    }
    setArtifactLink( expr, art );

    if (startIndex === 0 && expr.path[0].id.startsWith('$')) {
      if (config.isInFilter) {
        // In filters, we must not prepend `$self`, as that would change its meaning.
        // We must reject it. See #11775
        return reportAnnoRewriteError( expr, config );
      }
      // After rewriting, if an element starts with `$` -> add root prefix
      prependRootPath( config.origin, config.targetRoot, expr );
    }

    return false;
  }

  /**
   * Rewrite an expression that came via type propagation.
   *
   * @returns {boolean} Returns the expression if it couldn't be rewritten.
   */
  function adaptPathPrefixViaType( expr, config ) {
    const { target, origin } = config;
    if (!target._main && !origin._main)
      return false; // no need to rewrite; both are top-level

    if (rejectOuterReference( expr, origin, config ))
      return true;

    // $self-paths via types from/to non-main artifacts always need to be rewritten.
    config.tokenExpr.$tokenTexts = true;

    const wasAbsolute = isAnnoPathAbsolute( expr );
    stripAbsolutePathPrefix( expr, origin );

    if (wasAbsolute) {
      prependRootPath( origin, target, expr );
    }
    else if (!isAnnoRootArt( target )) { // target is element
      const item = { id: target.name.id };
      setArtifactLink( item, target );
      prependToStrippedPath( origin, expr, [ item ] );
    }
    else if (target.kind === 'param') {
      // annotations on parameters need a `:prefix`
      prependRootPath( origin, target, expr );
    }
    else {
      prependToStrippedPath( origin, expr, [ ] );
    }

    return false;
  }

  function adaptPathPrefixViaTypeExpansion( expr, config ) {
    const root = expr.path[0]?._navigation;
    if (root?.kind !== '$self') {
      // non-self paths are always valid in expanded artifacts
      // TODO: What about parameter references? Are they already always rejected?
      return false;
    }

    // We reject $self-paths because they need to be rewritten.
    // However, with a special flag, we allow rewriting it for testing purposes.
    if (!isBetaEnabled( model.options, 'rewriteAnnotationExpressionsViaType' ))
      return reportAnnoRewriteError( expr, config, 'unsupported' );

    if (rejectOuterReference( expr, config.expandedRootType, config ))
      return true;

    stripAbsolutePathPrefix( expr, config.expandedRootType );
    prependRootPath( config.expandedRootType, config.expandedRoot, expr );
    setExpandStatusAnnotate( config.target, 'annotate' );

    config.target[config.anno].$inferred = 'anno-rewrite';
    // $self-paths via type expansion always need to be rewritten.
    config.tokenExpr.$tokenTexts = true;

    return false;
  }

  /**
   * Prepend a path to `expr.path` or replace the root item.
   * The path needs to have been run through stripPrefixToNewRoot(…)`.
   * It is prepended if the root item is not the origin.
   * Replaced otherwise.
   *
   * @param origin
   * @param {XSN.Expression} expr
   * @param path
   */
  function prependToStrippedPath( origin, expr, path ) {
    // If origin is a definition, we need to _prepend_ the path.
    // Otherwise, we need to replace the root's name.
    const rootArt = expr.path[0]._artifact;
    if (rootArt === origin)
      expr.path.shift();
    expr.path.unshift(...path);
  }

  /**
   * Strips a prefix path from `expr.path`.  The prefix is defined
   * by where `art` appears in the path.
   *
   * @param {XSN.Expression} expr
   * @param {XSN.Artifact} art
   */
  function stripAbsolutePathPrefix( expr, art ) {
    const relativeRoot = findRelativeRoot( expr, art );
    if (relativeRoot === -1 && isAnnoRootArt( art ))
      return; // no $self; root item is element
    if (relativeRoot >= 1)
      expr.path = expr.path.slice(relativeRoot);
    else if (relativeRoot === -1)
      throw new CompilerAssertion('Error while rewriting annotation');
  }

  /**
   * Returns false if the path can be propagated to the target without referring
   * to any "outer" elements.  It differentiates between the target being a main
   * artifact and elements, because an element annotation referring to itself can't
   * be propagated to a type:
   *
   *     type T1 : { @a: (elem) elem: String; };
   *     type T2 : T1:elem; // invalid
   *
   * Also considers other targets such as `returns`, etc.
   *
   * @param {XSN.Expression} expr
   * @param {XSN.Artifact} origin
   * @param {AnnoRewriteConfig} config
   * @returns {boolean}
   */
  function rejectOuterReference( expr, origin, config ) {
    if (!isAnnoPathAbsolute( expr ) && !origin._main)
      return false;

    const root = expr.path[0]?._navigation;
    const found = findRelativeRoot( expr, origin );
    const isInvalid = (found === -1) ||
      // Can't use paths with `$self` in `returns`.
      (root?.kind === '$self' && isReturnParam( config.targetRoot )) ||
      // siblings are allowed for non-main artifacts, except for 'returns'
      (!config.target._main || isReturnParam( config.target )) && (expr.path.length - found) <= 1;

    if (isInvalid)
      return reportAnnoRewriteError( expr, config );
    return false;
  }

  /**
   * Finds the path segment in expr which starts at `origin`.
   * For example, for a path `$self.elem.b.c` on an element `b`, it will return 2.
   * Returns -1 if `origin` isn't found in the path.
   *
   * @param {XSN.Expression} expr
   * @param {XSN.Artifact} origin
   * @returns {number}
   */
  function findRelativeRoot( expr, origin ) {
    if (!origin._main) // main artifacts can't have outer references
      return expr.path[0]?._artifact === origin ? 0 : -1;

    const { path } = expr;
    for (let i = 0; i < path.length; ++i) {
      const item = path[i];
      if (item._artifact === origin)
        return i;
    }
    return -1;
  }

  function prependRootPath( origin, art, expr ) {
    const path = [];
    while (!isAnnoRootArt( art )) {
      const item = { id: art.name.id };
      setArtifactLink( item, art );
      do
        art = art._parent;
      while (art.kind === 'select');
      path.push(item);
    }

    if (art.kind === 'param') {
      const param = { id: art.name.id };
      setArtifactLink( param, art );
      path.push(param);
      expr.scope = 'param';
    }
    else {
      const self = makeDollarSelfItem( art );
      path.push(self);
    }
    path.reverse();

    prependToStrippedPath( origin, expr, path );
  }

  function makeDollarSelfItem( art ) {
    const self = { id: '$self' };
    setLink( self, '_artifact', art );
    setLink( self, '_navigation', art.$tableAliases.$self );
    return self;
  }

  /**
   * Rewrite the item in `expr.path` at the given index.
   * This function may splice the array if more than one path segment
   * is replaced by a single item (e.g. in queries).
   *
   * @param {XSN.Expression} expr
   * @param {AnnoRewriteConfig} config
   * @param {object} env
   * @param {number} index
   * @returns {*|null}
   */
  function rewriteItem( expr, config, env, index ) {
    const rewriteTarget = findRewriteTarget( expr, index, env, config.target );
    const found = setArtifactLink( expr.path[index], rewriteTarget[0] );
    if (!found)
      return null;

    if (rewriteTarget[1] > index) {
      // we keep the last segment, in case it has non-enumerable properties
      expr.path[index] = expr.path[rewriteTarget[1]];
      expr.path.splice(index + 1, rewriteTarget[1] - index);
    }

    const item = expr.path[index];
    if (item.id !== found.name.id || (rewriteTarget[1] - index) !== 0) {
      // Path was rewritten; original token text string is no longer accurate
      config.tokenExpr.$tokenTexts = true;
      item.id = found.name.id;
    }

    return setArtifactLink( expr.path[index], found );
  }
}

/**
 * @param {XSN.Expression} expr
 * @returns {boolean}
 */
function isAnnoPathAbsolute( expr ) {
  return expr.path[0]?._navigation?.kind === '$self' || expr.scope === 'param';
}

/**
 * Returns true if the given artifact is a root artifact in terms of annotation paths.
 * E.g. an element is never a root, but an entity is, as it can be referred to as `$self`,
 * but also a param, as it can be referred to as `:P`.
 *
 * @param {XSN.Artifact} art
 * @returns {boolean}
 */
function isAnnoRootArt( art ) {
  return !art._parent || !art._main || art.kind === 'param';
}

/**
 * Get the root artifact according to the rules of isAnnoRootArt(art).
 *
 * @param {XSN.Artifact} art
 * @returns {XSN.Artifact}
 */
function annoRootArt( art ) {
  while (art && !isAnnoRootArt( art ))
    art = art._parent;
  return art;
}

/**
 * @param {XSN.Artifact} art
 * @returns {boolean}
 */
function isReturnParam( art ) {
  return art?.kind === 'param' && art.name.id === '';
}

/**
 * Gets the artifact (e.g. element) that was expanded. `target` is a sub-artifact of that root and
 * is an expanded element.
 *
 * - expandedRoot:     Top-most structure that was expanded.
 * - expandedRootType: The type of expandedRoot.
 *
 * @param {XSN.Artifact} target
 * @returns { {expandedRoot: XSN.Artifact, expandedRootType: XSN.Artifact}}
 */
function getExpandRoot( target ) {
  if (target.$inferred !== 'expanded' && target.$inferred !== 'rewrite')
    return { expandedRoot: null, expandedRootType: null };

  let expandedRoot = target;

  // 'expanded' for structures, 'rewrite' for foreign keys
  while (expandedRoot.$inferred === 'expanded' || expandedRoot.$inferred === 'rewrite')
    expandedRoot = expandedRoot._parent;

  // `items` may be inferred via a type, hence why we check `items.type` after `type`
  let expandedRootType = expandedRoot?.type || expandedRoot?.items?.type;
  expandedRootType = (!expandedRootType?.$inferred && expandedRootType?._artifact) || null;

  const viaInclude = expandedRoot?.$inferred === 'include';
  expandedRoot = !viaInclude && expandedRootType ? expandedRoot : false;

  return { expandedRoot, expandedRootType };
}

module.exports = {
  xprRewriteFns,
};
