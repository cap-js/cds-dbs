// Propagate properties in XSN

// See also internalDoc/PropagatedCsn.md.
// As opposed to that document, the propagator here works on XSN, not CSN.
// We also do not deep-copy member dictionaries here, but create proxy members
// which get their properties via propagation: we use function `onlyViaParent`
// if that property would not be propagated otherwise.

'use strict';

const {
  forEachDefinition,
  forEachMember,
  forEachGeneric,
} = require( '../base/model');
const {
  setLink,
  linkToOrigin,
  withAssociation,
  viewFromPrimary,
  copyExpr,
} = require('./utils');
const { propagationRules } = require('../base/builtins');
const $inferred = Symbol.for( 'cds.$inferred' );
const { xprRewriteFns } = require('./xpr-rewrite');
// const { ref } = require( '../model/revealInternalProperties' )

// Note that propagation here is also used for deep-copying (function `onlyViaParent`)
function propagate( model ) {
  const props = {
    '@': annotation,            // always except in 'items' (and parameters for entity return types)
    doc: docComment,            // like annotations, but guarded by option `propagateDocComments`
    default: withKind,          // always except in 'items'
    virtual,
    notNull,
    targetElement: onlyViaParent, // in foreign keys
    value: onlyViaParent,      // enum symbol value, calculated element
    // masked: special = done in definer
    // key: special = done in resolver
    // actions: struct includes & primary source = in definer/resolver
    type: notWithExpand,
    length: always,
    precision: always,
    scale: always,
    srid: always,
    localized: withKind,
    target: notWithExpand,
    targetAspect,
    cardinality: notWithExpand,
    on: notWithExpand,
    // "expensive" includes "notWithExpand"
    // required for places where we don't handle associations, such as in parameters;
    // otherwise already expanded and rewritten.
    foreignKeys: expensive,
    items,
    // required for propagation in targetAspect; otherwise already expanded
    elements: expensive,
    // already expanded if necessary
    //   enum: expensive,
    //   params: expensive,          // actually only with parent action
    //   returns,
    $enclosed: annotation,
  };
  const ruleToFunction = {
    __proto__: null,
    never,
    onlyViaArtifact,
    onlyViaParent,
    notWithPersistenceTable,
  };
  for (const rule in propagationRules)
    props[rule] = ruleToFunction[propagationRules[rule]];

  const { rewriteAnnotationsRefs } = xprRewriteFns( model );

  const { message, throwWithError } = model.$messageFunctions;

  forEachDefinition( model, run );
  forEachGeneric( model, 'vocabularies', run );

  // TODO: move 'virtual' handling/checks to resolver
  forEachDefinition( model, checkVirtual );
  throwWithError();
  return model;

  function run( art ) {
    if (!art)
      return;
    if (!checkAndSetStatus( art ) || art.kind === 'select') {
      runMembers( art );
      return;
    }
    // if (!art.builtin)console.log('RUN:', ref(art))

    const chain = [];
    let targets = [ art ];
    while (targets.length) {
      const news = [];
      for (const target of targets) {
        const origin = getOrigin( target );
        if (origin && origin.kind !== '$self') {
          // Calculated elements that are simple references: `calc = field;`.
          // Respect sibling properties in inheritance.
          if (target._calcOrigin?._origin && target.value?._artifact) {
            chain.push({ target, source: target.value._artifact });
            if (checkAndSetStatus( target.value._artifact ))
              news.push( target.value._artifact );
          }
          chain.push( { target, source: origin } );
          if (checkAndSetStatus( origin ))
            news.push( origin );
        }

        for (const ref of target.includes || []) {
          const include = ref._artifact;
          if (!include)
            continue;
          chain.push( { target, source: include } );
          if (checkAndSetStatus( include ))
            news.push( include );
        }
      }
      targets = news;
    }

    chain.reverse();
    chain.forEach( step );
    runMembers( art );
    // if(!art.builtin)console.log('DONE:',ref(art),art.elements?Object.keys(art.elements):0);
  }

  function runMembers( art ) {
    // if(!art.builtin)console.log('MEMBERS:',ref(art))
    forEachMember( art, run ); // after propagation in parent!
    // propagate to sub query elements even if not requested:
    if (art.$queries)
      art.$queries.forEach( run );
    let obj = art;
    if (art.returns) {
      obj = art.returns;
      run( obj );
    }
    if (obj.items)
      run( obj.items );
    obj = obj.targetAspect;
    // if(obj)console.log('TA:',ref(art),!!getOrigin( obj ))
    if (obj && isAnonymousAspect( obj ))
      run( obj );
    setLink( art, '_status', 'propagated' );
  }

  function isAnonymousAspect( aspect ) {
    while (aspect) {
      if (aspect.elements)
        return true;
      aspect = getOrigin( aspect );
    }
    return false;
  }

  function step({ target, source }) {
    const viaType = target.type && // TODO: falsy $inferred value instead of 'cast'?
          (!target.type.$inferred || target.type.$inferred === 'cast');
    const keys = Object.keys( source );
    // console.log('PROPS:',ref(source),'->',ref(target),keys.join('+'))
    for (const prop of keys) {
      // TODO: warning with competing props from multi-includes, but not in propagator.js
      if (target[prop] !== undefined || source[prop] === undefined)
        continue;
      const transformer = props[prop] || props[prop.charAt(0)];
      if (transformer)
        transformer( prop, target, source, viaType );
    }
  }

  function never() { /* no-op: don't propagate */ }

  function always( prop, target, source ) {
    const val = source[prop];
    if (Array.isArray( val )) {
      target[prop] = [ ...val ];
      target[prop].$inferred = 'prop';
    }
    else if (prop.charAt(0) === '@' && val?.kind === '$annotation') {
      target[prop] = Object.assign( copyExpr( val ), { $inferred: 'prop' } );
      rewriteAnnotationsRefs( target, source, prop );
    }
    else {
      target[prop] = Object.assign( {}, val, { $inferred: 'prop' } );
      if (val._artifact !== undefined)
        setLink( target[prop], '_artifact', val._artifact );
      if (val._outer !== undefined)
        setLink( target[prop], '_outer', val._outer );
      if (val._parent !== undefined)
        setLink( target[prop], '_parent', val._parent );
      if (val._main !== undefined)
        setLink( target[prop], '_main', val._main );
    }
  }

  function availableAtType( prop, target, source ) {
    if (target.kind === 'type')
      return false;
    const ref = target.type || source.type;
    const type = ref && ref._artifact;
    if (!type || type._main)
      return false;
    // We do not consider the $expand status, as elements are already expanded
    // by the resolve()
    run( type );
    return type[prop];
  }

  // Expensive properties are not really propagated if they can be directly
  // accessed at their type being a main artifact
  // Expensive properties are also not propagated with `expand`:
  // * `elements`: the compiler calculates its own `elements` for a structure
  //   ref with `expand`.
  // * `params`: no element has parameters
  // * `enum`: an enum cannot be used with `expand`
  // * `keys`: should also not be propagated with `expand`
  function expensive( prop, target, source ) {
    // console.log('EXP:',prop,ref(source),'->',ref(target));
    if (source.kind === 'builtin')
      return;
    if (target.expand)          // do not propagate `keys` with expand
      return;
    if (prop !== 'foreignKeys' && availableAtType( prop, target, source ))
      // foreignKeys must always be copied with target to avoid any confusion
      // whether we have to generated implicit keys
      return;
    if (prop === 'params' && target.$inferred !== 'proxy' && target.$inferred !== 'include')
      return;
    // Remark: occurrences of `foreignKeys` which are not propagated already in
    // tweak-assocs.js: inside `targetAspect` and parameters
    const dict = source[prop];
    if (prop === 'foreignKeys' && (!dict || target.on))
      return; // e.g. published associations with filters, or `Association to many …`
    const location = target.type && !target.type.$inferred && target.type.location ||
                target.location ||
                target._outer && target._outer.location;
    target[prop] = Object.create( null ); // also propagate empty elements
    const propagateKey = target.kind === 'aspect'; // anonymous aspect
    for (const name in dict) {
      const origin = dict[name];
      const member = linkToOrigin( origin, name, target, prop, location );
      if (propagateKey && origin.key)
        member.key = Object.assign( { $inferred: 'expanded' }, origin.key );
      member.$inferred = 'proxy';
      if (prop === 'foreignKeys')
        setLink( member, '_effectiveType', member );
      else
        setEffectiveType( member, dict[name] );
    }
    target[prop][$inferred] = 'prop';
  }

  // Only propagate if parent object (which is not necessarily `_parent`) was propagated.
  function onlyViaParent( prop, target, source ) {
    if (target.$inferred === 'proxy' || target.$inferred === 'expanded')
      // assocs and enums do not have 'include'
      always( prop, target, source );
  }

  function targetAspect( prop, target, source ) {
    if (target.targetAspect)
      return;
    if (target.type?._artifact === model.definitions['cds.Association'])
      return; // don't propagate targetAspect to associations (e.g. via $enclosed)
    const ta = source.targetAspect;
    if (!ta.elements && !ta._origin) { // _origin set for elements in source
      notWithExpand( prop, target, source );
    }
    else {
      const tat = { location: ta.location, $inferred: 'prop', kind: 'aspect' };
      setLink( tat, '_origin', ta );
      setLink( tat, '_outer', target );
      setLink( tat, '_parent', target._parent );
      setLink( tat, '_main', null );
      target.targetAspect = tat;
      // console.log('TAC:',ref(tat),'via',ref(ta))
    }
  }

  function notWithExpand( prop, target, source ) {
    if (!target.expand || prop === 'type' && source.elements)
      always( prop, target, source );
  }

  function notWithPersistenceTable( prop, target, source ) {
    const tableAnno = target['@cds.persistence.table'];
    if (!tableAnno || tableAnno.val === null)
      annotation( prop, target, source );
  }

  function annotation( prop, target, source ) {
    const anno = source[prop];
    if (anno.val !== null)
      withKind( prop, target, source );
  }

  function docComment( prop, target, source ) {
    if (model.options.propagateDocComments)
      annotation( prop, target, source );
    else // TODO: Probably just "never"
      onlyViaParent( prop, target, source );
  }

  function onlyViaArtifact( prop, target, source ) {
    const from = viewFromPrimary( target )?.path;
    // do not propagate from member / if follow assoc in from or into `returns` of actions (v4)
    if (!(from ? from[from.length - 1]._artifact : source)._main &&
       !(target._parent && target._parent.returns === target))
      annotation( prop, target, source );
  }

  function withKind( prop, target, source ) {
    if (target.kind === 'param' && source.kind === 'entity')
      return; // Don't propagate from entity types to parameters (+ return type).
    if (target.kind)
      always( prop, target, source ); // not in 'items'
  }

  function notNull( prop, target, source, _viaType ) {
    // Really "reset" NOT NULL when ref has assoc with cardinality min: 0 (TODO: Universal CSN)
    if (target.value && withAssociation( target.value, targetMinZero ))
      target[prop] = { $inferred: 'NULL', val: undefined }; // set null value in Universal CSN
    // $inferred: 'NULL' is only an issue for sub elements with a 'value' property;
    // it only exists with nested projections, i.e. never with deprecated option enabled
    else
      always( prop, target, source );
  }

  function virtual( prop, target, source, viaType ) {
    if (!viaType)
      always( prop, target, source );
    else // NULL would block strange propagation to sub element
      target[prop] = { $inferred: 'NULL', val: undefined }; // set null value in Universal CSN
  }

  function checkVirtual( view ) {
    if (view.query)
      forEachGeneric( view, 'elements', checkNonVirtualElement );
  }

  function checkNonVirtualElement( elem ) {
    // Not enough at all, but so are the current checks - a complete expression
    // must be checked.  Here we just check what might have worked before.
    // TODO: Propagate 'virtual' in resolver.
    const path = !elem.virtual && elem.value && elem.value.path;
    if (!path || path.broken)
      return;
    for (const item of path) {
      const art = item && item._artifact;
      if (art?.virtual?.val) {
        message( 'def-missing-virtual', [ item.location, elem ], { art, keyword: 'virtual' },
                 // eslint-disable-next-line @stylistic/js/max-len
                 'Prepend $(KEYWORD) to current select item - containing element $(ART) is virtual' );
        return;
      }
    }
  }

  function returns( prop, target, source, ok ) {
    if (ok || target.$inferred === 'proxy' || target.$inferred === 'include' ) {
      target[prop] = { $inferred: 'proxy' };
      setEffectiveType( target[prop], source[prop] );
      setLink( target[prop], '_origin', source[prop] );
      setLink( target[prop], '_outer', target._outer || target ); // for setMemberParent
    }
  }

  function items( prop, target, source ) {
    // usually considered expensive, except:
    // - array of Entity
    const line = availableAtType( prop, target, source );
    if (!line ||
        line.type && line.type._artifact && line.type._artifact.kind === 'entity')
      returns( prop, target, source, true );
  }
}

function targetMinZero( art ) {
  // Semantics of associations without provided cardinality: [*,0..1]
  return !(art.cardinality && art.cardinality.targetMin && art.cardinality.targetMin.val);
}

function getOrigin( art ) {
  let origin = art._origin;
  while (origin?.kind === 'select')
    origin = origin._origin;
  if (origin)
    // Do not consider _origin if due to expand of table alias ref
    return (!art.expand || origin.kind === 'element') && origin;
  // Remark: a column with an 'inline' is never an element -> no need to check
  // art.inline

  return (art.type && (!art.type.$inferred || art.type.$inferred === 'cast'))
    ? art.type._artifact
    : art._origin;
}

function checkAndSetStatus( art ) {
  if (art._status === 'propagated' || art._status === 'propagating')
    return false;
  setLink( art, '_status', 'propagating' );
  return true;
}

function setEffectiveType( target, source ) {
  // TODO: when is this already set?
  if (source._effectiveType !== undefined)
    setLink( target, '_effectiveType', source._effectiveType );
}

module.exports = {
  propagate,
};
