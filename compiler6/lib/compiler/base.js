// Base Definitions for the Core Compiler

'use strict';

const { CompilerAssertion } = require( '../base/error' );

const dictKinds = {
  definitions: 'absolute',
  elements: 'element',
  enum: 'enum',
  foreignKeys: 'key',
  actions: 'action',
  params: 'param',
};

const kindProperties = {
  // TODO: also foreignKeys ?
  namespace: { artifacts: true }, // on-the-fly context
  context: { artifacts: true, normalized: 'namespace' },
  service: { artifacts: true, normalized: 'namespace' },
  entity: {
    elements: true, actions: true, params: () => false, include: true,
  },
  select: { normalized: 'select', elements: true },
  $join: { normalized: 'select' },
  $tableAlias: { normalized: 'alias' }, // table alias in select
  $self: { normalized: 'alias' }, // table alias in select
  $navElement: { normalized: 'element' },
  $inline: { normalized: 'element' }, // column with inline property
  event: { elements: true, include: true },
  type: { elements: propExists, enum: propExists, include: true },
  aspect: {
    elements: propExists,
    actions: ( _p, parent ) => propExists( 'elements', parent ),
    include: true,
  },
  annotation: { elements: propExists, enum: propExists },
  enum: { normalized: 'element', dict: 'enum' },
  element: { elements: propExists, enum: propExists, dict: 'elements' },
  mixin: { normalized: 'alias' },
  action: {
    params: () => false, elements: () => false, enum: () => false, dict: 'actions',
  }, // no extend params, only annotate
  function: {
    params: () => false,
    elements: () => false,
    enum: () => false,
    normalized: 'action',
    dict: 'actions',
  }, // no extend params, only annotate
  key: { normalized: 'element', dict: 'elements' }, // dict for annotate
  param: { elements: () => false, enum: () => false, dict: 'params' },
  source: { artifacts: true },  // TODO -> $source
  using: {},
  extend: {
    noDep: 'special',
    elements: true, /* only for parse-cdl */
    actions: true,  /* only for parse-cdl */
    enum: true,     /* only for parse-cdl */
  },
  annotate: {
    noDep: 'special', elements: true, enum: true, actions: true, params: true,
  },
  builtin: { normalized: 'element' }, // = $now, $user.id, …
  $parameters: {},              // $parameters in query entities - TODO: normalized: 'alias'?
};

function propExists( prop, parent ) {
  const obj = parent.returns || parent;
  return (obj.items || obj.targetAspect || obj)[prop];
}

/**
 * Return the "old style" name structure with `absolute`, `action`, `param`,
 * `element`.  The following code makes use of the fact that only member extensions
 * have a "sparse" name structure.
 *
 * @param {XSN.Artifact & XSN.Using} art
 * @returns {XSN.Name}
 */
function getArtifactName( art ) {
  const { name } = art;
  if (!name)                    // no name
    return name;
  if (!art.kind)                // annotation assignments, $self param type
    return { ...art.name, absolute: art.name.id };
  if (art.kind === 'using')
    return { ...art.name, absolute: art.extern.id };

  const namePath = [];
  let parent = art._outer || art;
  while (parent._main || parent.kind === 'builtin') { // until we hit the main artifact
    if (parent.name.$inferred !== '$internal' || parent.kind === '$inline')
      namePath.push( parent );
    if (parent.kind === 'select')
      break;
    parent = parent._parent;
    parent = parent._outer || parent; // for anonymous aspect and items
  }
  namePath.reverse();
  // start with id/location of art.name, and absolute of art._main
  const dot = (art._main || typeof name.id !== 'string') ? -1 : name.id.lastIndexOf( '.' );
  const rname = (!parent?.name) ? { id: name.id } : {
    id: (dot < 0 ? name.id : name.id.substring( dot + 1)),
    location: name.location,
    absolute: (parent._main || parent).name.id,
  };
  if (name.path !== undefined)
    rname.path = name.path;
  for (const np of namePath) {
    const prop = getMemberNameProp( np, np.kind );
    rname[prop] = (rname[prop]) ? `${ rname[prop] }.${ np.name.id }` : np.name.id;
  }
  if (name._artifact !== undefined) {
    Object.defineProperty( rname, '_artifact',
                           { value: name._artifact, configurable: true, writable: true } );
  }
  return rname;
}

// TODO: probably store this prop in name
function getMemberNameProp( elem, kind ) {
  if (kind !== 'annotate' && kind !== 'extend')
    return kindProperties[kind]?.normalized || kind;
  let obj = elem._parent;
  if (obj.params || obj.returns)
    return 'param';
  if (obj.actions)
    return 'action';
  while (obj.items)
    obj = obj.items;
  if (obj.elements || obj.enum)
    return 'element';
  throw new CompilerAssertion( `Member not found in parent properties ${ Object.keys( obj ).join( '+' ) }` );
}

module.exports = {
  dictKinds,
  kindProperties,
  getArtifactName,
};
