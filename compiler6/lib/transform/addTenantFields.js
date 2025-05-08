// Add tenant field to entities, check validity

// Prerequisites:

// - the input CSN is a `client` style CSN from the Core Compiler
// - using structure types with unmanaged associations is not supported by the
//   Core Compiler (due to missing ON-rewrite)

// TODO clarify:
//
// - do we have to do something for secondary keys?

// Implementation remark:
//
// - the functions `forEachDefinition` & friends in csnUtils.js have become quite
//   (too) general and are probably slow → not used here

'use strict';

const { createMessageFunctions } = require( '../base/messages' );
const {
  csnRefs,
  traverseQuery,
  implicitAs,
  pathId,
} = require( '../model/csnRefs' );

const annoTenantIndep = '@cds.tenant.independent';

const tenantDef = {
  key: true,
  type: 'cds.String',
  length: 36,
  '@cds.api.ignore': true, // and/or $generated: 'tenant' for the full Universal CSN?
};

function addTenantFields( csn, options, messageFunctions ) {
  const { error, throwWithError }
    = messageFunctions ?? createMessageFunctions( options, 'tenant', csn );
  const { tenantDiscriminator } = options;
  const tenantName = tenantDiscriminator === true ? 'tenant' : tenantDiscriminator;
  if (tenantName !== 'tenant') {
    error( 'api-invalid-option', null, {
      '#': 'value2',
      option: 'tenantDiscriminator',
      value: 'tenant',
      rawvalue: true,
      othervalue: tenantName,
    } );
    throwWithError();
  }

  const { definitions } = csn;
  if (!definitions)
    return csn;
  const {
    initDefinition,
    artifactRef,
    effectiveType,
    queryForElements,
    $getQueries,
    msgLocations,
  } = csnRefs( csn, true );

  const typeCache = new WeakMap();
  const csnPath = [ null ];
  let independent;
  let projection;

  for (const name in definitions) {
    const art = initDefinition( name );
    csnPath[0] = art;
    independent = art[annoTenantIndep];
    projection = art.query || art.projection && art;

    if (art.kind === 'entity') {
      independent = !!independent; // value should not influence message variant
      if (independent && art.includes && !checkIncludes( art ))
        continue;
      handleElements( art );
      if (projection)
        traverseQuery( projection, null, null, handleQuery );
      // Note: handleQuery sets csnPath[0]; store if needed afterwards
    }
    else if (!independent && independent != null) {
      error( 'tenant-invalid-anno-value', msgLocations( csnPath ),
             { anno: annoTenantIndep, value: independent },
             // eslint-disable-next-line @stylistic/js/max-len
             'Can\'t add $(ANNO) with value $(VALUE) to a non-entity, which is always tenant-independent' );
    }
    else if (art.includes) {
      independent = art.kind;   // might be used for message variant
      checkIncludes( art );     // recompile should work
    }
    else if (projection) {      // events, types - TODO: mention in doc
      independent = art.kind;   // might be used for message variant
      // recompile should work: no new `tenant` source element for `select *`
      traverseQuery( projection, null, null, handleQuery );
    }
  }
  // Finally add the `tenant` element (do separately in order not to confuse
  // the cache of csnRefs):
  for (const name in definitions) {
    const art = definitions[name];
    if (addTenantFieldToArt( art, options ) && (art.query || art.projection)) {
      for (const qcache of $getQueries( art ).slice( 1 ))
        addTenantFieldToArt( qcache._select, options, true );
    }
  }

  (csn.extensions || []).forEach( ( ext, idx ) => {
    const tenant = ext.elements?.[tenantName];
    const name = ext.annotate || ext.extend; // extend should not happen
    if (tenant && isTenantDepEntity( definitions[name] )) {
      error( 'tenant-unexpected-ext',
             msgLocations( [ 'extensions', idx, 'elements', 'tenant' ] ),
             { name: tenantName },
             'Can\'t annotate element $(NAME) of a tenant-dependent entity' );
    }
  } );

  throwWithError();
  csn.meta ??= {};
  csn.meta.tenantDiscriminator = tenantName;
  return csn;                   // input CSN changed by side effect

  function checkIncludes( art ) {
    const names = art.includes
      .filter( name => isTenantDepEntity( csn.definitions[name] ) );
    if (names.length) {
      error( 'tenant-invalid-include', msgLocations( csnPath ), { names }, {
        // eslint-disable-next-line @stylistic/js/max-len
        std: 'Can\'t include the tenant-dependent entities $(NAMES) into a tenant-independent definition',
        // eslint-disable-next-line @stylistic/js/max-len
        one: 'Can\'t include the tenant-dependent entity $(NAMES) into a tenant-independent definition',
      } );
    }
    return !names.length;
  }

  function handleElements( art ) {
    const { elements } = art;
    if (elements[tenantName]) {
      error( 'tenant-unexpected-element',
             msgLocations( [ ...csnPath, 'elements', tenantName ] ),
             { name: tenantName, option: 'tenantDiscriminator' },
             'Can\'t have entity with element $(NAME) when using option $(OPTION)' );
    }
    else if (!independent && !Object.values( elements ).some( e => e.key )) {
      error( 'tenant-expecting-key', msgLocations( csnPath ), {},
             'There must be a key in a tenant-dependent entity' );
    }
    else {
      traverse( art, handleAssociations );
    }
  }

  // Queries --------------------------------------------------------------------

  function handleQuery( query, fromSelect, parentQuery ) {
    const select = query.SELECT || query.projection;
    if (select)
      csnPath[0] = query;
    if (!projection || query.ref && handleQuerySource( query, fromSelect ))
      return;

    if (query !== projection && !independent &&
        (fromSelect && !fromSelect.from.ref || !parentQuery?.SET)) {
      // If a sub query would be supported in ORDER BY or LIMIT, the test above
      // would not be enough
      error( 'tenant-unsupported-query', msgLocations( csnPath ),
             { '#': (fromSelect?.from?.join ? 'join' : 'subquery') },
             {
               std: 'Can\'t have tenant-dependent non-simple query entities',
               join: 'Can\'t use a join in a tenant-dependent entity',
               subquery: 'Can\'t use a sub query in a tenant-dependent entity',
             } );
      projection = null;        // no further error
      return;
    }

    if (!select)
      return;                   // query.SET or query.join
    csnPath.push( query.SELECT ? 'SELECT' : 'projection' );

    const qcache = queryForElements( query );
    if (qcache.$queryNumber > 1)
      handleElements( qcache );

    if (select.mixin)
      checkMixins( select.mixin );
    if (!independent) {
      if (select.excluding)
        checkExcluding( select.excluding );
      if (select.columns)
        handleColumns( select.columns );
      handleGroupBy( select );
    }
    csnPath.length = 1;
  }

  function handleQuerySource( query, fromSelect ) {
    if (independent) {
      const art = pathId(query.ref[0]); // yes, the base
      if (csn.definitions[art][annoTenantIndep])
        return true;
      error( 'tenant-invalid-query-source', msgLocations( csnPath ), { art, '#': independent }, {
        std: 'Can\'t use a tenant-dependent query source $(ART) in a tenant-independent entity',
        event: 'Can\'t use a tenant-dependent query source $(ART) in an event',
        type: 'Can\'t use a tenant-dependent query source $(ART) in a type definition',
      } );
      return true;
    }
    if (fromSelect && fromSelect.from !== query) // with JOIN
      return false;                              // issue better error later
    if ((query.as || implicitAs( query.ref )) === tenantName) {
      error( 'tenant-invalid-alias-name', msgLocations( csnPath ),
             { name: tenantName, '#': (query.as ? 'std' : 'implicit') } );
    }
    const art = artifactRef.from( query );
    if (art[annoTenantIndep]) {
      error( 'tenant-expecting-tenant-source', msgLocations( csnPath ), { art: query },
             // TODO: better the final entity name of assoc navigation in FROM
             // eslint-disable-next-line @stylistic/js/max-len
             'Expecting the query source $(ART) to be tenant-dependent for a tenant-dependent query entity' );
    }
    return true;
  }

  function checkMixins( mixin ) {
    csnPath.push( 'mixin', '' );
    for (const name in mixin) {
      csnPath[csnPath.length - 1] = name;
      if (name === tenantName && !independent)
        error( 'tenant-invalid-alias-name', msgLocations( csnPath ), { name, '#': 'mixin' } );
      handleAssociations( mixin[name], null );
    }
    csnPath.length -= 2;
  }

  function checkExcluding( excludeList ) {
    if (excludeList.includes( tenantName )) {
      error( 'tenant-invalid-excluding', msgLocations( csnPath ), { name: tenantName },
             'Can\'t exclude $(NAME) from the query source of a tenant-dependent entity' );
    }
  }

  function handleGroupBy( select ) {
    // TODO: in the future, we allow model-wise keyless views when using
    // aggregation function, and add a GROUP BY for MANDT in this case.  Now, also
    // views with agg functions need to have a key element → it very likely
    // already contains a GROUP BY. And anyway: if we miss to add GROUP BY MANDT,
    // the database will complain → no safetly risk.
    if (select.groupBy)
      select.groupBy.unshift( { ref: [ tenantName ] } );
  }

  function handleColumns( columns ) {
    let specifiedKey = false;
    csnPath.push( 'columns', -1 );
    for (const col of columns) {
      ++csnPath[csnPath.length - 1];
      if (col.expand || col.inline) {
        error( 'tenant-unsupported-expand-inline', msgLocations( csnPath ), {},
               'Can\'t use expand/inline in a tenant-dependent entity' );
      }
      if (col.key != null)      // yes, also with key: false
        specifiedKey = true;
      // REDIRECTED TO: also check new target here? (main query: already checked via elements)
    }
    csnPath.length -= 2;
    columns.unshift( specifiedKey
      ? { key: true, ref: [ tenantName ] }
      : { ref: [ tenantName ] } );
  }

  // Associations ---------------------------------------------------------------

  function handleAssociations( elem, afterRecursion ) {
    if (afterRecursion != null)
      return null;

    if (elem.target) {
      const { target } = elem;
      if (csn.definitions[target][annoTenantIndep]) {
        if (!independent && isComposition( elem ))
          error( 'tenant-invalid-composition', msgLocations( csnPath ), { target } );
      }
      else if (independent) {
        if (target.endsWith( '.DraftAdministrativeData' ) && csnPath.length === 3 &&
            csnPath[1] === 'elements' && csnPath[2] === 'DraftAdministrativeData') {
          error( 'tenant-invalid-draft', msgLocations( csnPath ), {},
                 'A tenant-independent entity can\'t be draft-enabled' );
        }
        else {
          error( 'tenant-invalid-target', msgLocations( csnPath ), { target } );
        }
      }
    }
    else if (elem.type && (independent || !elem.elements && !elem.items)) {
      // check type, but not with expanded elements in dependent entity, because
      // composition could have redirected tenant-dependent target
      const dep = typeDependency( artifactRef( elem.type, null ) );
      if (independent) {
        if (!dep || dep === 'Composition')
          return true;          // check elements (assocs could be redirected)
        error( 'tenant-invalid-target', msgLocations( csnPath ), { type: elem.type, '#': 'type' } );
      }
      else if (dep && dep !== 'dependent') {
        error( 'tenant-invalid-composition', msgLocations( csnPath ),
               { type: elem.type, '#': 'type' } );
      }
    }
    else {
      return true;
    }
    return null;
  }

  /**
   * Returns “type dependency”, a string, for type `assoc`:
   *
   * - '': type does not contain associations other than non-composition associations to
   *   tenant-independent entities
   * - 'Composition': type contains associations (and at least one composition) to
   *   tenant-independent entities, and no associations to tenant-dependent entities
   * - 'dependent': type contains associations, at least one to a tenant-dependent entity,
   *   but no compositions to tenant-independent entities
   * - 'ERR': type contains associations, at least one to a tenant-dependent entity,
   *   and at least one composition to a tenant-independent entity
   *
   * Type references are followed, but only without sibling `elements` or `items`.
   */
  function typeDependency( assoc ) {
    assoc = assoc ? effectiveType( assoc ) : assoc;
    if (!assoc)
      return '';
    const assocDep = typeCache.get( assoc );
    if (assocDep != null)
      return assocDep;
    let parentDep = '';
    traverse( assoc, typeCallback );
    return parentDep;

    function typeCallback( type, savedDep ) {
      let currentDep = typeCache.get( type );
      if (currentDep != null) {
        // nothing
      }
      else if (savedDep != null) {
        currentDep = parentDep;
        parentDep = savedDep;
      }
      else if (type.target) {
        const annoDep = !csn.definitions[type.target][annoTenantIndep];
        currentDep = (annoDep) ? 'dependent' : isComposition( type ) && 'Composition';
      }
      else if (type.elements || type.items) {
        savedDep = parentDep;
        parentDep = '';
        return savedDep || '';      // recurse
      }
      else if (type.type) {
        currentDep = typeDependency( artifactRef( type.type, null ) );
      }
      else {
        currentDep = '';
      }

      typeCache.set( type, currentDep );
      if (!currentDep || !parentDep)
        parentDep ||= currentDep;
      else if (currentDep !== parentDep)
        parentDep = 'ERR';
      return null;              // do not (further) recurse
    }
  }

  // Generic functions ----------------------------------------------------------

  function traverse( elem, callback ) {
    const recurse = callback( elem, null );
    if (recurse == null)
      return;
    const { elements } = elem;
    if (elements) {
      csnPath.push( 'elements', '' );
      for (const name in elements) {
        csnPath[csnPath.length - 1] = name;
        traverse( elements[name], callback );
      }
      csnPath.length -= 2;
    }
    else if (elem.items) {
      csnPath.push( 'items' );
      traverse( elem.items, callback );
      --csnPath.length;
    }
    callback( elem, recurse );
  }

  function isComposition( assoc ) {
    while (assoc && assoc.type !== 'cds.Association') {
      const { type } = assoc;
      if (type === 'cds.Composition')
        return true;
      assoc = artifactRef( type, null );
    }
    return false;
  }
}

function isTenantDepEntity( art ) {
  return art?.kind === 'entity' && !art[annoTenantIndep];
}

function addTenantFieldToArt( art, options, isQuery = false ) {
  if (!isQuery && !isTenantDepEntity( art ))
    return false;
  const tenantName = options.tenantDiscriminator === true ? 'tenant' : options.tenantDiscriminator;
  const elements = Object.getOwnPropertyDescriptor( art, 'elements' );
  // `query.elements` is usually non-enumerable
  elements.value = { [tenantName]: { ...tenantDef }, ...elements.value };
  Object.defineProperty( art, 'elements', elements );
  return true;
}

module.exports = {
  addTenantFields,
  addTenantFieldToArt,
};
