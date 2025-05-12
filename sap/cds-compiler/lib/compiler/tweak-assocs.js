// Tweak associations: rewrite keys and on conditions

'use strict';

const {
  forEachGeneric,
  forEachInOrder,
} = require('../base/model');
const { dictLocation, weakLocation, weakRefLocation } = require('../base/location');

const {
  setLink,
  setArtifactLink,
  linkToOrigin,
  copyExpr,
  forEachUserArtifact,
  forEachQueryExpr,
  traverseQueryPost,
  traverseQueryExtra,
  setExpandStatus,
  getUnderlyingBuiltinType,
} = require('./utils');
const { Location } = require('../base/location');
const { CompilerAssertion } = require('../base/error');

const $location = Symbol.for( 'cds.$location' );
const $inferred = Symbol.for( 'cds.$inferred' );

// Export function of this file.
function tweakAssocs( model ) {
  // Get shared functionality and the message function:
  const {
    info, warning, error,
  } = model.$messageFunctions;
  const {
    traverseExpr,
    checkExpr,
    checkOnCondition,
    effectiveType,
    getOrigin,
    extendForeignKeys,
    createRemainingAnnotateStatements,
    mergeSpecifiedForeignKeys,
    navigationEnv,
    redirectionChain,
    resolveExprInAnnotations,
  } = model.$functions;

  Object.assign(model.$functions, {
    findRewriteTarget,
    cachedRedirectionChain,
  });

  // Phase 5: rewrite associations
  model._entities.forEach( rewriteArtifact ); // _entities contains all definitions, sorted.
  // Think hard whether an on condition rewrite can lead to a new cyclic
  // dependency.  If so, we need other messages anyway.  TODO: probably dox
  // another cyclic check with testMode.js
  forEachUserArtifact( model, 'definitions', function check( art ) {
    checkOnCondition( art.on, (art.kind !== 'mixin' ? 'on' : 'mixin-on'), art );
    checkExpr( art.value, (art.$syntax === 'calc' ? 'calc' : 'column'), art );

    if (art.kind === 'select')
      forEachQueryExpr( art, checkExpr );
  } );


  // create “super” ANNOTATE statements for annotations on unknown artifacts:
  createRemainingAnnotateStatements();

  return;


  //--------------------------------------------------------------------------
  // Phase 5: rewrite associations
  //--------------------------------------------------------------------------
  // Only top-level queries and sub queries in FROM

  function rewriteArtifact( art ) {
    if (!art.query) {
      rewriteAssociation( art );
    }
    else {
      traverseQueryExtra( art, ( query ) => {
        forEachGeneric( query, 'elements', rewriteAssociation );
      } );
    }
    if (art._service)
      forEachGeneric( art, 'elements', complainAboutTargetOutsideService );

    if (art.query) {
      traverseQueryPost(art.query, false, (query) => {
        forEachGeneric( query, 'elements', rewriteAssociationCheck );
      });
    }
  }

  // function rewriteView( view ) {
  //   // TODO: we could sort according to the $effectiveSeqNo instead
  //   // (and then remove traverseQueryExtra)
  //   if (view.includes)          // entities with structure includes:
  //     forEachGeneric( view, 'elements', rewriteAssociation );
  // }

  // Check explicit ON / keys with REDIRECTED TO
  // TODO: run on all queries, but this is potentially incompatible
  // function rewriteViewCheck( view ) {
  //   traverseQueryPost( view.query, false, ( query ) => {
  //     forEachGeneric( query, 'elements', rewriteAssociationCheck );
  //   } );
  // }

  function complainAboutTargetOutsideService( elem ) {
    const target = elem.target && elem.target._artifact;
    if (!target || target._service) // assoc to other service is OK
      return;
    const loc = [ elem.target.location, elem ];
    const main = elem._main || elem;
    if (!elem.$inferred && !main.$inferred) {
      info( 'assoc-target-not-in-service', loc,
            { target, '#': (elem._main.query ? 'select' : 'define') }, {
              std: 'Target $(TARGET) of association is outside any service', // not used
              define: 'Target $(TARGET) of explicitly defined association is outside any service',
              select: 'Target $(TARGET) of explicitly selected association is outside any service',
            } );
    }
    else {
      const text = main.$inferred === 'autoexposed' ? 'exposed' : 'std';
      // ID published! Used in stakeholder project; if renamed, add to oldMessageIds
      info( 'assoc-outside-service', loc, { '#': text, target, service: main._service }, {
        std: 'Association target $(TARGET) is outside any service',
        // eslint-disable-next-line @stylistic/js/max-len
        exposed: 'If association is published in service $(SERVICE), its target $(TARGET) is outside any service',
      } );
    }
  }

  function rewriteAssociationCheck( element ) {
    const elem = element.items || element; // TODO v6: nested items
    if (elem.elements)
      forEachGeneric( elem, 'elements', rewriteAssociationCheck );
    if (!elem.target)
      return;
    if (elem.on && !elem.on.$inferred) {
      const assoc = getOrigin( elem );
      if (assoc && assoc.foreignKeys) {
        error( 'rewrite-key-for-unmanaged', [ elem.on.location, elem ],
               { keyword: 'on', art: assocWithExplicitSpec( assoc ) },
               // eslint-disable-next-line @stylistic/js/max-len
               'Do not specify an $(KEYWORD) condition when redirecting the managed association $(ART)' );
      }
      checkIgnoredFilter( elem );
    }
    else if (elem.foreignKeys && !inferredForeignKeys( elem.foreignKeys )) {
      const assoc = getOrigin( elem );
      if (assoc?.on) {
        error( 'rewrite-on-for-managed',
               [ elem.foreignKeys[$location] || dictLocation( elem.foreignKeys ), elem ],
               { art: assocWithExplicitSpec( assoc ) },
               'Do not specify foreign keys when redirecting the unmanaged association $(ART)' );
      }
      else if (assoc?.foreignKeys) {
        // same sequence is not checked
        rewriteKeysMatch( elem, assoc );
        rewriteKeysCovered( assoc, elem );
      }

      checkIgnoredFilter( elem );
    }
  }

  /**
   * Publishing an association with filters is allowed, but the filter is ignored
   * if the association is redirected.  That indicates modeling mistakes, so we
   * emit a warning.
   */
  function checkIgnoredFilter( elem ) {
    const lastStep = elem.value?.path?.[elem.value.path.length - 1];
    if (lastStep?.where) {
      const loc = lastStep.where.location;
      const variant = elem.foreignKeys ? 'fKey' : 'onCond';
      warning( 'query-ignoring-filter', [ loc, elem ], { '#': variant } );
    }
  }

  function rewriteKeysMatch( thisAssoc, otherAssoc ) {
    const { foreignKeys } = thisAssoc;
    for (const name in foreignKeys) {
      if (otherAssoc.foreignKeys[name])
        continue;               // we would do a basic type check later
      const key = foreignKeys[name];
      const baseAssoc = assocWithExplicitSpec( otherAssoc );
      if (inferredForeignKeys( baseAssoc.foreignKeys )) { // still inferred = via target keys
        error( 'rewrite-key-not-matched-implicit', [ key.name.location, key ],
               { name, target: baseAssoc.target },
               'No key $(NAME) is defined in original target $(TARGET)' );
      }
      else {
        error( 'rewrite-key-not-matched-explicit', [ key.name.location, key ],
               { name, art: baseAssoc },
               'No foreign key $(NAME) is specified in association $(ART)' );
      }
    }
  }

  function rewriteKeysCovered( thisAssoc, otherAssoc ) {
    const names = [];
    const { foreignKeys } = thisAssoc;
    for (const name in foreignKeys) {
      if (!otherAssoc.foreignKeys[name])
        names.push( name );
    }
    if (names.length) {
      const loc = otherAssoc.foreignKeys[$location] || dictLocation( otherAssoc.foreignKeys );
      const location = loc && (!loc.endCol
        ? loc
        : new Location( loc.file, loc.endLine, loc.endCol - 1, loc.endLine, loc.endCol ));
      const baseAssoc = assocWithExplicitSpec( thisAssoc );
      if (inferredForeignKeys( baseAssoc.foreignKeys )) { // still inferred = via target keys
        error( 'rewrite-key-not-covered-implicit', [ location, otherAssoc ],
               { names, target: baseAssoc.target },
               {
                 std: 'Specify keys $(NAMES) of original target $(TARGET) as foreign keys',
                 one: 'Specify key $(NAMES) of original target $(TARGET) as foreign key',
               } );
      }
      else {
        error( 'rewrite-key-not-covered-explicit', [ location, otherAssoc ],
               { names, art: otherAssoc },
               {
                 std: 'Specify foreign keys $(NAMES) of association $(ART)',
                 one: 'Specify foreign key $(NAMES) of association $(ART)',
               } );
      }
    }
  }

  function assocWithExplicitSpec( assoc ) {
    while (assoc.foreignKeys && inferredForeignKeys( assoc.foreignKeys, 'keys' ) ||
           assoc.on && assoc.on.$inferred)
      assoc = getOrigin( assoc );
    return assoc;
  }

  function rewriteAssociation( element ) {
    doRewriteAssociation( element );
    if (element.target) {
      extendForeignKeys( element );
      if (element.foreignKeys$) {
        // TODO: Also checkSpecifiedElement?
        mergeSpecifiedForeignKeys( element );
      }
      for (const key in element.foreignKeys)
        // TODO: This will re-evaluate all annotations
        resolveExprInAnnotations( element.foreignKeys[key] );
    }
  }

  // only to be used by rewriteAssociation()
  function doRewriteAssociation( element ) {
    let elem = element.items || element; // TODO v6: nested items
    if (elem.elements)
      forEachGeneric( elem, 'elements', rewriteAssociation );
    if (elem.targetAspect?.elements)
      forEachGeneric( elem.targetAspect, 'elements', rewriteAssociation );
    if (!originTarget( elem ))
      return;

    // console.log(message( null, elem.location, elem,
    // {art:assoc,target,ftype:JSON.stringify(ftype)}, 'Info','RA').toString())

    // With cyclic dependencies on select items, testing for the _effectiveType to
    // be 0 (test above) is not enough if we we have an explicit redirection
    // target -> avoid infloop ourselves with _status.
    // TODO: this should be good now
    const chain = [];
    while (!elem.on && elem.foreignKeys == null) {
      chain.push( elem );
      if (elem._status === 'rewrite') { // circular dependency (already reported)
        for (const e of chain)
          setLink( e, '_status', null ); // XSN TODO: nonenum _status -> enum $status
        return;
      }
      setLink( elem, '_status', 'rewrite' );
      elem = getOrigin( elem );
      if (!elem || elem.builtin) // safety
        return;
    }
    chain.reverse();
    for (const art of chain) {
      setLink( elem, '_status', null );
      if (elem.on)
        rewriteCondition( art, elem );
      else if (elem.foreignKeys)
        rewriteKeys( art, elem );

      if (art.on)
        removeManagedPropsFromUnmanaged( art );

      elem = art;
    }
  }

  /**
   * Remove properties from unmanaged association `elem` that are only valid
   * on managed associations.  Only set to `NULL` (special value for propagator),
   * if necessary, i.e. the value is set on the `_origin`-chain.
   */
  function removeManagedPropsFromUnmanaged( elem ) {
    removeProp( 'notNull' );
    removeProp( 'default' );

    function removeProp( prop ) {
      let origin = elem;
      while (origin) {
        if (origin[prop]) { // regardless of the value, reset the property
          const location = weakLocation( elem.name.location );
          elem[prop] = { $inferred: 'NULL', val: undefined, location };
          break;
        }
        origin = getOrigin( origin );
      }
    }
  }

  /** Returns the element's origin's target artifact. */
  function originTarget( elem ) {
    const assoc = !elem.expand && getOrigin( elem );
    const ftype = assoc && effectiveType( assoc );
    return ftype && ftype.target && ftype.target._artifact;
  }

  function inferredForeignKeys( foreignKeys, ignore ) {
    return foreignKeys[$inferred] && foreignKeys[$inferred] !== ignore;
  }

  function rewriteKeys( elem, assoc ) {
    addConditionFromAssocPublishing( elem, assoc, null );
    if (elem.on)
      return; // foreign keys were transformed into ON-condition

    // TODO: split this function: create foreign keys without `targetElement`
    // already in Phase 2: redirectImplicitly()
    elem.foreignKeys = Object.create(null); // set already here (also for zero foreign keys)
    forEachInOrder( assoc, 'foreignKeys', ( orig, name ) => {
      const location = weakRefLocation( elem.target );
      const fk = linkToOrigin( orig, name, elem, 'foreignKeys', location );
      fk.$inferred = 'rewrite'; // Override existing value; TODO: other $inferred value?
      setLink( fk, '_effectiveType', fk );
      fk.targetElement = copyExpr( orig.targetElement, location );
      if (elem._redirected)
        rewriteKey( elem, fk.targetElement );
    } );
    if (elem.foreignKeys) // Possibly no fk was set
      elem.foreignKeys[$inferred] = 'rewrite';
  }

  function rewriteKey( elem, targetElement ) {
    let projectedKey = null;
    // rewrite along redirection chain
    for (const alias of elem._redirected) {
      if (alias.kind !== '$tableAlias')
        continue;

      projectedKey = firstProjectionForPath( targetElement.path, 0, alias, null );
      if (projectedKey.elem) {
        const item = targetElement.path[projectedKey.index];
        item.id = projectedKey.elem.name.id;
        if (projectedKey.index > 0)
          targetElement.path.splice(0, projectedKey.index);
      }
      else {
        setArtifactLink( targetElement.path[0], null );
        setArtifactLink( targetElement, null );

        const culprit = !elem.target.$inferred && elem.target ||
          elem.value?.path?.[elem.value.path.length - 1] ||
          elem;
        // TODO: probably better to collect the non-projected foreign keys
        // and have one message for all
        error('rewrite-undefined-key', [ weakLocation( culprit.location ), elem ], {
          '#': 'std',
          id: targetElement.path.map(p => p.id).join('.'),
          target: alias._main,
          name: elem.name.id,
        });
        return null;
      }
    }

    if (projectedKey?.elem) {
      const item = targetElement.path[0];
      setArtifactLink( item, projectedKey.elem );
      setArtifactLink( targetElement, projectedKey.elem );
      return projectedKey.elem;
    }
    return null;
  }

  // TODO: there is no need to rewrite the on condition of non-leading queries,
  // i.e. we could just have on = {…}
  // TODO: re-check $self rewrite (with managed composition of aspects),
  // and actually also $self inside anonymous aspect definitions
  // (not entirely urgent as we do not analyse it further, at least sole "$self")
  function rewriteCondition( elem, assoc ) {
    // the ON condition might need to be rewritten even if the target stays the
    // same (TODO later: set status whether rewrite changes anything),
    // especially problematic are refs starting with $self:
    setExpandStatus( elem, 'target' );

    // There were previous issues in resolving the target artifact.
    // Avoid further compiler messages.
    if (!elem.target._artifact)
      return;

    if (elem._parent?.kind === 'element') {
      // managed association as sub element not supported yet
      // TODO: Only report once for multi-include chains, see
      //       Associations/SubElements/UnmanagedInSubElement.err.cds
      error( 'type-unsupported-rewrite', [ elem.location, elem ], { '#': 'sub-element' } );
      removeArtifactLinks();
      return;
    }
    const nav = (elem._main?.query && elem.value)
      ? pathNavigation( elem.value ) // redirected source elem or mixin
      : { navigation: assoc };       // redirected user-provided
    elem.on = copyExpr( assoc.on,
      // replace location in ON except if from mixin element
                        nav.tableAlias && elem.name.location );
    elem.on.$inferred = 'copy';

    const { navigation } = nav;
    if (!navigation) { // TODO: what about $projection.assoc as myAssoc ?
      if (elem._columnParent) {
        error( 'rewrite-not-supported', [ elem.target.location, elem ], { '#': 'inline-expand' } );
        removeArtifactLinks();
      }
      return;                 // should not happen: $projection, $magic, or ref to const
    }

    if (!nav.tableAlias || nav.tableAlias.path) {
      const navEnv = followNavigationPath( elem.value?.path, nav ) || nav.tableAlias;
      traverseExpr( elem.on, 'rewrite-on', elem,
                    ( expr ) => {
                      rewriteExpr( expr, elem, nav.tableAlias, navEnv );
                      return traverseExpr.SKIP; // TODO: really necessary?
                    } );
    }
    else if (elem._columnParent) {
      error( 'rewrite-not-supported', [ elem.target.location, elem ], { '#': 'inline-expand' } );
      removeArtifactLinks();
      return;
    }
    else {
      // TODO: support that, now that the ON condition is rewritten in the right order
      error( null, [ elem.value.location, elem ], {},
             'Selecting unmanaged associations from a sub query is not supported' );
      removeArtifactLinks();
      return;
    }

    addConditionFromAssocPublishing( elem, assoc, nav );
    elem.on.$inferred = 'rewrite';

    /**
     * Clear all `_artifact` links in the ON-condition to avoid follow-up
     * issues during ON-condition rewriting of associations that inherit
     * the ON-condition.
     */
    function removeArtifactLinks() {
      traverseExpr( elem.on, 'rewrite-on', elem, (expr) => {
        setArtifactLink( expr, null );
        return traverseExpr.SKIP; // TODO: necessary?
      } );
    }
  }

  /**
   * If an unmanaged association is being published, we add a potential
   * filter to the ON-condition and use its cardinality.
   * If a managed association is published, we transform it into an unmanaged
   * and do the same.
   *
   * The added condition (filter) is already rewritten relative to `elem`.
   */
  function addConditionFromAssocPublishing( elem, assoc, nav ) {
    if (elem.$inferred || elem._main?.$inferred === 'composition-entity') {
      // filter was copied in original element already
      return;
    }
    const publishAssoc = (elem._main?.query || elem.$syntax === 'calc') &&
      elem.value?.path?.length > 0;
    if (!publishAssoc)
      return;

    nav ??= (elem._main?.query && elem.value)
      ? pathNavigation( elem.value ) // redirected source elem or mixin
      : { navigation: assoc };       // redirected user-provided

    const { location } = elem.name;
    const lastStep = elem.value.path[elem.value.path.length - 1];
    if (!lastStep || !lastStep.where)
      return;

    if (lastStep.cardinality) {
      elem.cardinality ??= { ...assoc.cardinality };
      elem.cardinality.location = location;
      for (const card of [ 'sourceMin', 'targetMin', 'targetMax' ]) {
        if (lastStep.cardinality[card])
          elem.cardinality[card] = copyExpr( lastStep.cardinality[card], location );
      }
    }

    // If there are foreign keys, transform them into an ON-condition first.
    if (assoc.foreignKeys) {
      const cond = foreignKeysToOnCondition( elem, assoc, nav );
      if (cond) {
        elem.on = cond;
        elem.foreignKeys = undefined;
      }
    }

    elem.on = {
      op: { val: 'ixpr', location },
      args: [
        { ...elem.on, $parens: [ assoc.location ] },
        { val: 'and', literal: 'token', location },
        filterToCondition( lastStep, elem, nav ),
      ],
      location,
      $inferred: 'copy',
    };

    // Published paths with filters are always associations, never
    // compositions, hence we need to change the type to avoid type propagation.
    const assocType = { id: 'cds.Association', location };
    setArtifactLink( assocType, model.definitions['cds.Association'] );
    elem.type = {
      path: [ assocType ],
      scope: 'global',
      location,
      $inferred: '$generated',
    };
    setArtifactLink( elem.type, assocType._artifact );

    const isComp = (getUnderlyingBuiltinType( assoc )?.name?.id === 'cds.Composition');
    if (isComp) {
      elem.$enclosed = {
        val: true,
        literal: 'boolean',
        location,
        $inferred: '$generated',
      };
    }
  }


  /**
   * Transform a filter on `assocPathStep` into an ON-condition.
   * Paths inside the filter are rewritten relative to `assoc`, so they can be redirected
   * using `rewriteExpr()` later on. `$self` paths remain unchanged.
   */
  function filterToCondition( assocPathStep, elem, nav ) {
    const cond = copyExpr( assocPathStep.where );
    cond.$parens = [ assocPathStep.location ];
    const navEnv = nav && followNavigationPath( elem.value?.path, nav ) || nav?.tableAlias;
    traverseExpr( cond, 'rewrite-filter', elem, (expr) => {
      if (!expr.path || expr.path.length === 0)
        return traverseExpr.SKIP;

      const root = expr.path[0]._navigation || expr.path[0]._artifact;
      if (!root)
        return traverseExpr.SKIP; // only for compile error, e.g. missing definition
      if (root.kind === '$self') {
        // $projection -> $self for recompilability
        expr.path[0].id = '$self';
      }
      else if (!root.builtin && root.kind !== 'builtin') {
        expr.path.unshift({
          id: assocPathStep.id,
          location: elem.name.location,
        });
        setLink( expr.path[0], '_artifact', assocPathStep._artifact );
        if (assocPathStep._navigation?.kind === 'mixin') {
          // _navigation link necessary because condition is rewritten
          // inside the same view (needed for mixins).
          setLink( expr.path[0], '_navigation', assocPathStep._navigation );
        }
        // up to here, filter is relative to original association
        rewriteExpr( expr, elem, nav?.tableAlias, navEnv );
      }
      return traverseExpr.SKIP;
    } );

    checkOnCondition( cond, 'on', elem );
    return cond;
  }

  // Caller must ensure ON-condition correctness via rewriteExpr()!
  function foreignKeysToOnCondition( elem, assoc, nav ) {
    if (model.options.testMode && !nav.tableAlias && !elem._columnParent && elem.$syntax !== 'calc')
      throw new CompilerAssertion('rewriting keys to cond: no tableAlias but not inline/calc');

    if ((!nav.tableAlias && elem.$syntax !== 'calc') || elem._parent?.kind === 'element' ||
       (nav && nav.item && nav.item !== elem.value.path[elem.value.path.length - 1])) {
      // - no nav.tableAlias for mixins or inside inline; mixins can't have managed assocs, though.
      // - _parent is element for expand
      // - nav.item is different for multi-path steps e.g. `sub.assoc`, which is not supported, yet
      // TODO: Support this
      error( 'rewrite-not-supported', [ elem.value.location, elem ] );
      return null;
    }

    let cond = [];
    forEachInOrder( assoc, 'foreignKeys', function keyToCond( fKey ) {
      // Format:      lhs = rhs
      //         assoc.id = assoc_id
      // lhs and rhs look the same but are rewritten differently. We must ensure that
      // the rhs is rewritten to a projected element (or it must remain the assoc's
      // foreign key in case of calc elements).
      const lhs = {
        path: [
          { id: assoc.name.id, location: elem.name.location },
          ...copyExpr( fKey.targetElement.path, weakLocation( elem.name.location ) ),
        ],
        location: elem.name.location,
      };
      setLink( lhs.path[0], '_artifact', assoc );
      setLink( lhs, '_artifact', lhs.path[lhs.path.length - 1]._artifact );

      rewritePath( lhs, lhs.path[0], assoc, elem, elem.value.location ); // different to rhs!

      const rhs = {
        path: [
          // use origin's name; elem could have alias
          { id: assoc.name.id, location: elem.name.location },
          ...copyExpr( fKey.targetElement.path, weakLocation( elem.name.location ) ),
        ],
        location: elem.name.location,
      };
      setLink( rhs.path[0], '_artifact', assoc );
      setLink( rhs, '_artifact', rhs.path[rhs.path.length - 1]._artifact );

      if (elem.$syntax !== 'calc') {
        // Not passing an element, as we don't want to use our own filtered association here!
        // That's done for lhs.
        const projectedFk = firstProjectionForPath( rhs.path, 0, nav.tableAlias, null );
        // different to lhs!
        rewritePath( rhs, projectedFk.item, elem, projectedFk.elem, elem.value.location );
      }

      const fkCond = {
        op: { val: 'ixpr', location: elem.name.location },
        args: [
          lhs,
          { val: '=', literal: 'token', location: elem.name.location },
          rhs,
        ],
        location: elem.name.location,
      };
      cond.push(fkCond);
    } );

    if (cond.length === 0) {
      const lastStep = elem.value.path[elem.value.path.length - 1];
      error( 'expr-missing-foreign-key', [ lastStep.location, elem ], {
        '#': 'publishingFilter',
        id: lastStep.id,
      } );
      return null;
    }

    cond = (cond.length === 1) ? cond[0]
      : {
        op: { val: 'and', location: elem.name.location },
        args: cond,
        location: elem.name.location,
      };

    return cond;
  }

  /**
   * @param expr
   * @param assoc
   * @param tableAlias
   * @param navEnv Navigation element / table alias, used to traverse/rewrite the path.
   */
  function rewriteExpr( expr, assoc, tableAlias, navEnv = tableAlias ) {
    // Rewrite ON condition (resulting in outside perspective) for association
    // 'assoc' in query or including entity from ON cond of mixin element /
    // element in included structure / element in source ref/d by table alias.

    // TODO: complain about $self (unclear semantics)

    if (!expr.path || !expr._artifact)
      return;
    if (!assoc._main)
      return;
    if (navEnv) { // from ON cond of element in source ref/d by table alias
      const root = expr.path[0]._navigation || expr.path[0]._artifact;
      if (!root || root.kind === 'builtin')
        return; // not $self or source element, e.g. builtin

      // parameters are not allowed in ON-conditions; error emitted elsewhere already
      if (expr.scope === 'param' || root.kind === '$parameters')
        return;

      rewritePathForEnv( expr, navEnv, assoc );
    }
    else if (assoc._main.query) { // from ON cond of mixin element in query
      const root = expr.path[0]._navigation || expr.path[0]._artifact;
      if (expr.scope === 'param' || root?.kind === '$parameters') {
        if (assoc.$errorReported !== 'assoc-unexpected-scope') {
          error( 'assoc-unexpected-scope', [ assoc.value.location, assoc ],
                 { id: assoc.value._artifact.name.id },
                 // eslint-disable-next-line @stylistic/js/max-len
                 'Association $(ID) can\'t be projected because its ON-condition refers to a parameter' );
          assoc.$errorReported = 'assoc-unexpected-scope';
        }
        return;
      }
      if (expr.path[0]._navigation) { // rewrite src elem, mixin, $self[.elem]
        const nav = pathNavigation( expr );
        const elem = (assoc._origin === root) ? assoc : navProjection( nav.navigation, assoc );
        // TODO: Use rewritePathForEnv(); make it handle mixins
        rewritePath( expr, nav.item, assoc, elem,
                     nav.item ? nav.item.location : expr.path[0].location );
      }
    }
    else { // from ON cond of element that was included (i.e. from included structure)
      const root = expr.path[0]._navigation || expr.path[0]._artifact;
      if (root.builtin || root.kind !== '$self' && root.kind !== 'element')
        return;
      const item = expr.path[root.kind === '$self' ? 1 : 0];
      if (!item)
        return;     // just $self
      // corresponding elem in including structure or…
      let elem = (assoc._main.items || assoc._main).elements[item.id];
      if (assoc.$syntax === 'calc' && assoc._origin === elem) {
        // … calc element where "elem" points to the referenced (possibly included)
        // sibling element (association).
        elem = assoc;
      }
      if (!elem)
        return; // See #11755
      if (!(elem === item._artifact ||          // redirection for explicit def
            elem._origin === item._artifact)) {
        const art = assoc._origin;
        // eslint-disable-next-line @stylistic/js/max-len
        warning( 'rewrite-shadowed', [ elem.name.location, elem ], { art: art && effectiveType( art ) }, {
          // eslint-disable-next-line @stylistic/js/max-len
          std: 'This element is not originally referred to in the ON-condition of association $(ART)',
          // eslint-disable-next-line @stylistic/js/max-len
          element: 'This element is not originally referred to in the ON-condition of association $(MEMBER) of $(ART)',
        } );
      }
      rewritePath( expr, item, assoc, elem, null );
    }
  }

  /**
   * Rewrite the given reference by using projected elements of the given
   * navigation environment.
   *
   * @param {XSN.Expression} ref
   * @param {object} navEnv
   * @param {XSN.Artifact} user
   */
  function rewritePathForEnv( ref, navEnv, user ) {
    // TODO: combine with rewriteGenericAnnoPath() of xpr-rewrite

    // reset artifact link; we'll set it again if there are no errors
    setArtifactLink( ref, null );

    const rootItem = ref.path[0];
    const root = ref.path[0]._navigation || ref.path[0]._artifact;
    const startIndex = (root.kind === '$self' ? 1 : 0);

    if (root.kind === '$self') {
      let rootEnv = navEnv;
      while (rootEnv?.kind === '$navElement') {
        if (rootEnv._origin?.target?._artifact === root._origin)
          break;
        rootEnv = rootEnv._parent;
      }
      navEnv = rootEnv;
    }

    // Store the original artifact, so that we can use it to
    // calculate a redirection chain later on.
    ref.path.forEach((item) => {
      if (item._artifact)
        setLink( item, '_originalArtifact', item._artifact );
    });

    let env = navEnv;
    let art = rootItem._artifact;
    let isTargetSide = null;

    for (let i = startIndex; i < ref.path.length; ++i) {
      if (i > startIndex && art.target) {
        // if the current artifact is an association, we need to respect the redirection
        // chain from original target to new one.
        // FIXME: Won't work with associations in projected structures.
        const origTarget = ref.path[i - 1]?._originalArtifact?.target?._artifact;
        const chain = cachedRedirectionChain( art, origTarget );
        if (!chain) {
          missingProjection( ref, i, user, false );
          return;
        }
        for (const alias of chain) {
          art = rewritePathItemForEnv( ref, alias, i, user );
          isTargetSide ??= (art === user);
          if (!art) {
            missingProjection( ref, i, user, isTargetSide );
            return;
          }
        }
      }

      art = rewritePathItemForEnv( ref, env, i, user );
      isTargetSide ??= (art === user);
      if (!art) {
        missingProjection( ref, i, user, isTargetSide );
        return;
      }
      env = navigationEnv( art, null, null, 'nav' );
    }
    setArtifactLink( ref, art );

    if (startIndex === 0 && rootItem.id.startsWith('$')) {
      // TODO: What about filters? Also rewritten there?
      // After rewriting, if an element starts with `$` -> add root prefix
      // FIXME: "user" not correct for association inside sub-element,
      //        because `user._parent` is assumed to be the query
      prependSelfToPath( ref.path, user );
    }
  }

  function rewritePathItemForEnv( ref, navEnv, index, user ) {
    const rewriteTarget = findRewriteTarget( ref, index, navEnv, user );
    const found = rewriteTarget[0];
    if (!found) {
      setArtifactLink( ref.path[index], found );
      return found;
    }

    if (rewriteTarget[1] > index) {
      // we keep the last segment, in case it has non-enumerable properties
      ref.path[index] = ref.path[rewriteTarget[1]];
      ref.path.splice(index + 1, rewriteTarget[1] - index);
    }

    const item = ref.path[index];
    if (item.id !== found.name.id || (rewriteTarget[1] - index) !== 0)
      item.id = found.name.id;

    return setArtifactLink( ref.path[index], found );
  }

  /**
   * @param {object} ref
   * @param {number} index
   * @param {XSN.Artifact} user
   * @param {boolean} isTargetSide
   */
  function missingProjection( ref, index, user, isTargetSide ) {
    const item = ref.path[index];
    if (!isTargetSide) {
      const { location } = user.value;
      const rootItem = ref.path[0];
      const elemref = rootItem._navigation?.kind === '$self' ? ref.path.slice(1) : ref.path;
      // TODO: Fix message for sub-elements: `s: { a: Association on x=1, x: Integer};` for x
      error( 'rewrite-not-projected', [ location, user ], {
        name: user.name.id,
        art: item._artifact || item._originalArtifact,
        elemref: { ref: elemref },
      } );
    }
    else {
      const isExplicit = user.target && !user.target.$inferred;
      const loc = isExplicit ? user.target.location : item.location;
      error( 'query-undefined-element', [ loc, user ], {
        '#': isExplicit ? 'redirected' : 'std',
        id: item.id,
        name: user.name.id,
        target: user.target._artifact,
        keyword: 'redirected to',
      } );
    }
  }

  function rewritePath( ref, item, assoc, elem, location ) {
    const { path } = ref;
    const root = path[0];
    if (!elem) {
      if (location) {
        const elemref = root._navigation?.kind === '$self' ? path.slice(1) : path;
        // TODO: Fix message for sub-elements: `s: { a: Association on x=1, x: Integer};` for x
        error( 'rewrite-not-projected', [ location, assoc ], {
          name: assoc.name.id, art: elemref[0]._artifact, elemref: { ref: elemref },
        } );
      }
      delete root._navigation;
      setArtifactLink( root, elem );
      setArtifactLink( ref, elem );
      return;
    }
    if (item !== root) {
      // e.g. mixin ON-condition: Base.foo -> $self.foo or multi-path projection,
      // $projection -> $self
      root.id = '$self';
      setLink( root, '_navigation', assoc._parent.$tableAliases.$self );
      setArtifactLink( root, assoc._parent );
      if (item) {
        const i = path.indexOf(item);
        ref.path = [ root, ...path.slice( i, path.length ) ];
      }
    }
    else if (elem.name.id.charAt(0) === '$') {
      prependSelfToPath( path, assoc );
    }
    else {
      setLink( root, '_navigation', elem );
    }
    if (!elem.name)      // nothing to do for own $projection, $projection.elem
      return;            // (except having it renamed to $self)
    item.id = elem.name.id;
    let state = null;
    for (const i of path) {
      if (!state) {
        if (i === item)
          state = setArtifactLink( i, elem );
      }
      else {
        state = rewriteItem( state, i, assoc );
        if (!state || state === true)
          break;
      }
    }
    if (state !== true)
      setArtifactLink( ref, state );
  }

  function prependSelfToPath( path, elem ) {
    const root = { id: '$self', location: path[0].location };
    setLink( root, '_navigation', elem._parent.$tableAliases.$self );
    setArtifactLink( root, elem._parent );
    path.unshift( root );
  }

  /**
   * @param elem "Navigation environment" (element) for `item`.
   * @param item Path segment to rewrite.
   * @param assoc Published association of query.
   */
  function rewriteItem( elem, item, assoc ) {
    if (!elem._redirected)
      return true;
    let name = item.id;
    for (const alias of elem._redirected) {
      // TODO: a message for the same situation as msg 'rewrite-shadowed'?
      if (alias.kind === '$tableAlias') { // _redirected also contains structures for includes
        // TODO: if there is a "multi-step" redirection, we should probably
        // consider intermediate "preferred" elements - not just `assoc`,
        // but its origins, too.
        const proj = navProjection( alias.elements[name], assoc );
        name = proj?.name?.id;
        if (!name)
          break;
        item.id = name;
        // TODO: Why not break here? Test test3/scenarios/AFC/db/view/consumption/C_ScopedRole.cds
      }
    }
    let env = name && elem._effectiveType; //  should have been computed
    // refs in ON cannot navigate along `items`, no need to consider `items` here
    if (env?.target)
      env = env.target._artifact?._effectiveType;
    const found = setArtifactLink( item, env?.elements?.[name] );
    if (found)
      return found;

    const isExplicit = elem.target && !elem.target.$inferred;
    const loc = isExplicit ? elem.target.location : item.location;
    error( 'query-undefined-element', [ loc, assoc ], {
      '#': isExplicit ? 'redirected' : 'std',
      id: name || item.id,
      name: elem.name.id,
      target: elem.target._artifact,
      keyword: 'redirected to',
    } );
    return null;
  }

  /**
   * Get the redirection chain between the element's target and the original target.
   * Returns `null` if there is no valid chain.
   * Uses `_redirected` if valid.
   *
   * @param {XSN.Artifact} elem
   * @param {XSN.Artifact} origTarget
   * @returns {null|XSN.Artifact[]}
   */
  function cachedRedirectionChain( elem, origTarget ) {
    const target = elem.target?._artifact;
    if (!target || !origTarget)
      return null;
    if (target === origTarget)
      return [];

    if (elem._redirected === null) {
      // means: "don't touch paths after assoc"
      // TODO: figure out if we can assume that here as well
      return [];
    }

    if (elem._redirected) {
      // No need to recalculate if the original target is already in '_redirected'.
      const i = elem._redirected.findIndex(ta => ta._origin === origTarget);
      if (i > -1)
        return elem._redirected.slice(i); // TODO: check if it is always "i===0".
    }

    return redirectionChain( elem, target, origTarget, true );
  }
}

function navProjection( navigation, preferred ) {
  // TODO: Info if more than one possibility?
  if (!navigation)
    return {};

  if (!navigation._projections && !navigation._complexProjections)
    return null;

  // _complexProjections contains projections that are not "simple",
  // i.e. contain a filter or arguments. Only used if it contains our
  // preferred association.
  if (preferred && ( navigation._complexProjections?.includes( preferred ) ||
    navigation._projections?.includes( preferred )))
    return preferred;

  return navigation._projections?.[0] || null;
}

function findRewriteTarget( expr, index, env, user ) {
  if (env.kind === '$navElement' || env.kind === '$tableAlias') {
    const r = firstProjectionForPath( expr.path, index, env, user );
    return [ r.elem, r.index ];
  }

  const item = expr.path[index];
  // If the artifact is already in the same definition, we must not check the query.
  // Or if it is not a query -> no $navElement -> use `elements`
  if (item._artifact?._main === env || !env.query && env.kind !== 'select') {
    if (env.elements?.[item.id])
      return [ env.elements[item.id], index ];
    return [ null, expr.path.length ];
  }
  const items = (env._leadingQuery || env)._combined?.[item.id];
  const allNavs = !items || Array.isArray(items) ? items : [ items ];

  // If the annotation target itself has a table alias, require projections of that
  // table alias. Of course, that only works if we're talking about the same query.
  const tableAlias = (user._main?._origin === item._artifact?._main &&
    user.value?.path[0]?._navigation?.kind === '$tableAlias')
    ? user.value.path[0]._navigation : null;

  // Look at all table aliase that could project `item` and only select
  // those that have actual projections.
  const navs = allNavs?.filter(p => p._origin === item._artifact &&
    (!tableAlias || tableAlias === p._parent));
  if (!navs || navs.length === 0)
    return [ null, expr.path.length ];

  // If there are multiple navigations for the element, just use the first that matches.
  // In case of table aliases, it's just one.
  for (const nav of navs) {
    const r = firstProjectionForPath( expr.path, index, nav._parent, user );
    if (r.elem)
      return [ r.elem, r.index ];
  }

  return [ null, expr.path.length ];
}

/**
 * For a path `a.b.c.d`, return a projection for the first path item that is projected,
 * starting at `startIndex` in this path using the given navigation (table alias or
 * navigation element).
 * For example, if a query has multiple projections such as `a.b, a, a.b.c`, the
 * _first_ possible projection will be used and the caller can rewrite `a.b.c.d` to `b.c.d`.
 * This avoids `extend`s affect the ON-condition.
 *
 * The returned object `ret` has `ret.item`, which is the path item at index `ret.index`
 * that is projected. `ret.elem` is the element projection.
 *
 * If nothing was found, `ret.elem` is null, and `ret.item` is the last segment for which
 * there was a $navElement.
 *
 * @param {any[]} path
 * @param {number} startIndex
 * @param {object} nav
 * @param {object} elem Preferred association/element that should be used if projected.
 * @return {{elem: object, item: object}|null}
 */
function firstProjectionForPath( path, startIndex, nav, elem ) {
  if (startIndex >= path.length) // e.g. just `$self` path item
    return { item: undefined, elem: {} };

  let tableAlias = nav;
  while (tableAlias.kind === '$navElement')
    tableAlias = tableAlias._parent;

  // We want to use the _first_ valid projection that is written by the user (if the preferred
  // `assoc` is not directly projected).  To achieve that, look into the query's elements.
  const selectedElements = Object.values(tableAlias._parent.elements);

  let proj = null;
  let navItem = nav;
  let navIndex = startIndex;
  for (; navIndex < path.length; ++navIndex) {
    const item = path[navIndex];
    navItem = item?.id && navItem.elements?.[item.id];
    if (!navItem) {
      break;
    }
    else if (navItem._projections || navItem._complexProjections) {
      const projElem = navProjection( navItem, elem );
      if (projElem && projElem === elem) {
        // in case the specified association is found, _always_ use it.
        return { index: navIndex, item, elem };
      }
      else if (projElem) {
        const queryIndex = selectedElements.indexOf(projElem);
        if (!proj || queryIndex < proj.queryIndex) {
          proj = {
            index: navIndex, item, elem: projElem, queryIndex,
          };
        }
      }
    }
  }
  if (proj)
    return proj;

  const index = (navIndex - 1) <= startIndex ? startIndex : (navIndex - 1);
  return { index, item: path[index], elem: null };
}

/**
 * Follow the navigation along the given path to its N-1 path step, so
 * that the last step can be resolved against the returned navigation like
 * `returnValue.elements[last.id]`.
 *
 * @param {XSN.Path} path
 * @param {object} nav
 * @returns {object|null}
 */
function followNavigationPath( path, nav ) {
  if (!nav.item || !path || path.length === 1)
    return nav.tableAlias;

  const startIndex = path.indexOf(nav.item);
  if (startIndex === -1)
    return null;

  // navigation is already at last path step
  if (startIndex === path.length - 1) {
    return nav.navigation?.kind === '$navElement'
      ? nav.navigation._parent
      : nav.tableAlias;
  }

  let navItem = nav.navigation || nav.tableAlias;
  for (let i = startIndex + 1; i < path.length - 1; ++i) {
    const item = path[i];
    navItem = item?.id && navItem.elements?.[item.id];
    if (!navItem)
      return null;
  }

  return navItem;
}


/**
 * Return condensed info about reference in select item
 * - tableAlias.elem       -> { navigation: navElem, item: path[1], tableAlias }
 * - sourceElem (in query) -> { navigation: navElem, item: path[0], tableAlias }
 * - mixinElem             -> { navigation: mixinElement, item: path[0] }
 * - $projection.elem      -> also $self.item -> { item: path[1], tableAlias: $self }
 * - $self                 -> { item: undefined, tableAlias: $self }
 * - $parameters.P, :P     -> {}
 * - $now, current_date    -> {}
 * - undef, redef          -> {}
 * With 'navigation': store that navigation._artifact is projected
 * With 'navigation': rewrite its ON condition
 * With navigation: Do KEY propagation
 *
 * TODO: re-think this function, copied in populate.js and tweak-assocs.js
 */
function pathNavigation( ref ) {
  // currently, indirectly projectable elements are not included - we might
  // keep it this way!  If we want them to be included - be aware: cycles
  if (!ref._artifact)
    return {};
  let item = ref.path && ref.path[0];
  const root = item && item._navigation;
  if (!root)
    return {};
  if (root.kind === '$navElement')
    return { navigation: root, item, tableAlias: root._parent };
  if (root.kind === 'mixin')
    return { navigation: root, item };
  item = ref.path[1];
  if (root.kind === '$self')
    return { item, tableAlias: root };
  if (root.kind !== '$tableAlias' || ref.path.length < 2)
    return {};                // should not happen
  return { navigation: root.elements[item.id], item, tableAlias: root };
}

module.exports = tweakAssocs;
