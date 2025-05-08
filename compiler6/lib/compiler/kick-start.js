// Kick-start: prepare to resolve all references

'use strict';

const { isBetaEnabled, forEachGeneric } = require('../base/model');
const {
  setLink,
  annotationVal,
  annotationIsFalse,
  isDirectComposition,
} = require('./utils');

function kickStart( model ) {
  const { options } = model;
  const { message } = model.$messageFunctions;

  const { resolveUncheckedPath, resolvePath } = model.$functions;

  // Set _service link (sorted to set it on parent first).  Could be set
  // directly, but beware a namespace becoming a service later.
  Object.keys( model.definitions ).sort().forEach( setAncestorsAndService );
  forEachGeneric( model, 'definitions', postProcessArtifact );

  forEachGeneric( model, 'sources', resolveUsings );
  return;


  /**
   * Set projection ancestors, and _service link for artifact with absolute name 'name':
   *  - not set: internal artifact
   *  - null: not within service
   *  - service: the artifact of the embedding service
   * This function must be called ordered: parent first
   *
   * @param {string} name Artifact name
   */
  function setAncestorsAndService( name ) {
    const art = model.definitions[name];
    if (art._parent === undefined)
      return;                   // nothing to do for builtins and redefinitions
    if (art.query && art._ancestors === undefined && art.kind === 'entity')
      setProjectionAncestors( art );

    let parent = art._parent;
    if (parent === model.definitions.localized)
      parent = model.definitions[name.substring( 'localized.'.length )];
    const service = parent && (parent._service || parent.kind === 'service' && parent);
    setLink( art, '_service', service );
    if (!parent || !service)
      return;
    // To be removed when nested services are allowed
    if (!isBetaEnabled( options, 'nestedServices' ) && art.kind === 'service') {
      while (parent.kind !== 'service')
        parent = parent._parent;
      message( 'service-nested-service', [ art.name.location, art ], { art: parent },
               'A service can\'t be nested within a service $(ART)' );
    }
    else if (art.kind === 'context') {
      while (parent.kind !== 'service')
        parent = parent._parent;
      // TODO: remove this error
      message( 'service-nested-context', [ art.name.location, art ], { art: parent },
               'A context can\'t be nested within a service $(ART)' );
    }
  }

  function setProjectionAncestors( art ) {
    // Must be run after processLocalizedData() as we could have a projection
    // on a generated entity.

    // TODO: do not do implicit redirection across services, i.e. Service2.E is
    // no redirection target for E if Service2.E = projection on Service1.E and
    // Service1.E = projection on E

    // Remark: _ancestors are also set with includes, and there also for aspects,
    // types and events.
    const chain = [];
    const autoexposed = annotationVal( art['@cds.autoexposed'] );
    // no need to set preferredRedirectionTarget in the while loop as we would
    // use the projection having @cds.redirection.target anyhow instead of
    // `art` anyway (if we do the no-x-service-implicit-redirection TODO above)
    while (art?.query?.from?.path && // direct select with one source
           art._ancestors !== 0) {   // prevent inf-loop
      chain.push( art );
      setLink( art, '_ancestors', 0 ); // avoid infloop with cyclic from
      const name = resolveUncheckedPath( art.query.from, 'from', art );
      art = name && model.definitions[name];
      if (autoexposed)
        break;                  // only direct projection for auto-exposed
    }
    let ancestors = art && (!autoexposed && art._ancestors || []);
    chain.reverse();
    for (const a of chain) {
      ancestors = (ancestors ? [ ...ancestors, art ] : []);
      setLink( a, '_ancestors', ancestors );
      art = a;
    }
  }

  function postProcessArtifact( art ) {
    tagCompositionTargets( art );
    if (art.$queries) {
      for (const query of art.$queries) {
        if (query.mixin)
          forEachGeneric( query, 'mixin', tagCompositionTargets );
      }
    }
    if (!art._ancestors || art.kind !== 'entity')
      return;                   // redirections only to entities
    const service = art._service;
    if (!service)
      return;
    const sname = service.name.id;
    art._ancestors.forEach( expose );
    return;

    function expose( ancestor ) {
      if (ancestor._service === service || annotationIsFalse( art['@cds.redirection.target'] ))
        return;
      const desc = ancestor._descendants ||
            setLink( ancestor, '_descendants', Object.create( null ) );
      if (!desc[sname])
        desc[sname] = [ art ];
      else
        desc[sname].push( art );
    }
  }

  function tagCompositionTargets( elem ) {
    if (elem.target && isDirectComposition( elem )) {
      // A target aspect would have already moved to property `targetAspect` in
      // define.js (hm... more something for kick-start.js...)
      // TODO: for safety, just use resolveUncheckedPath()
      const target = resolvePath( elem.target, 'target', elem );
      if (target)
        model.$compositionTargets[target.name.id] = true;
    }
    if (elem.targetAspect?.elements)
      elem = elem.targetAspect;
    forEachGeneric( elem, 'elements', tagCompositionTargets );
  }

  // Resolve the using declarations in `using`.  Issue
  // error message if the referenced artifact does not exist.
  // TODO: think of moving this to resolve.js
  function resolveUsings( src, topLevel ) {
    if (!src.usings)
      return;
    for (const def of src.usings) {
      if (def.usings)           // using {...}
        resolveUsings( def );
      if (!def.name || !def.name.id)
        continue;               // using {...}, parse error
      const art = model.definitions[def.name.absolute];
      if (art && art.$duplicates)
        continue;
      const ref = def.extern;
      const user = (topLevel ? def : src);
      const from = user.fileDep;
      if (art || !from || from.realname)   // no error for non-existing ref with non-existing module
        resolvePath( ref, 'using', def ); // TODO: consider FROM for validNames
    }
  }
}

module.exports = kickStart;
