'use strict';

const { csnRefs, implicitAs, pathId } = require('./csnRefs');
const {
  transformExpression,
  transformAnnotationExpression,
  applyTransformations,
  applyTransformationsOnNonDictionary,
  applyTransformationsOnDictionary,
  mergeTransformers,
} = require('../transform/db/applyTransformations');
const { isBuiltinType, isAnnotationExpression } = require('../base/builtins');
const { ModelError, CompilerAssertion } = require('../base/error');
const { typeParameters } = require('../compiler/builtins');
const { forEach } = require('../utils/objectUtils');
const { cloneAnnotationValue } = require('./cloneCsn');

// Low-level utility functions to work with compact CSN.

/**
 * Generic Callback
 *
 * @callback genericCallback
 * @param {any} art
 * @param {string} name Artifact Name
 * @param {string} prop Dictionary Property
 * @param {CSN.Path} path Location
 * @param {CSN.Artifact} [dictionary]
 */

/**
 * @callback refCallback
 * @param {any} ref
 * @param {object} node
 * @param {CSN.Path} path
 */

/**
 * @callback queryCallback
 * @param {CSN.Query} query
 * @param {CSN.Path} path
 */

/**
 * Get utility functions for a given CSN. Re-exports functions of `csnRefs()`.
 * @param {CSN.Model} model (Compact) CSN model
 */
function getUtils( model, universalReady ) {
  const special$self = !model?.definitions?.$self && '$self';
  const _csnRefs = csnRefs(model, universalReady);
  const { artifactRef } = _csnRefs;
  /** Cache for getFinalTypeInfo(). Specific to the current model. */
  const finalBaseTypeCache = Object.create(null);

  return {
    getCsnDef,
    isStructured,
    isManagedAssociation,
    isAssocOrComposition,
    isAssociation,
    isComposition,
    getArtifactDatabaseNameOf,
    getContextOfArtifact,
    addStringAnnotationTo,
    getServiceName,
    getFinalTypeInfo,
    get$combined,
    getQueryPrimarySource,
    ..._csnRefs,
  };

  /**
   * Compute and return $combined sources for the given query,
   * that is, a map of elements that combine e.g. UNION sources.
   *
   * @param {CSN.Query} query
   * @returns {object}
   */
  function get$combined( query ) {
    return getSources(query);
  }

  /**
   * Get the union of all elements from the "from" clause
   * - descend into unions, following the lead query
   * - merge all queries in case of joins
   * - follow subqueries
   *
   * @param {CSN.Query} query Query to check
   * @param {boolean} [isSubquery]
   * @returns {object} Map of sources
   */
  function getSources( query, isSubquery = false ) {
    // Remark CW: better just a while along query.SET.args[0]
    if (query.SET) {
      if (query.SET.args[0].SELECT?.elements)
        return mergeElementsIntoMap(Object.create(null), query.SET.args[0].SELECT.elements, query.SET.args[0].$location);

      return getSources(query.SET.args[0], isSubquery);
    }
    else if (query.SELECT) {
      if (query.SELECT.from.args) {
        return walkArgs(query.SELECT.from.args);
      }
      else if (query.SELECT.from.ref) {
        let art = artifactRef.from(query.SELECT.from);

        if (art.target)
          art = artifactRef(art.target);

        if (isSubquery && !query.SELECT.elements)
          throw new ModelError('Expected subquery to have .elements');

        const elements = isSubquery ? query.SELECT.elements : art.elements;
        // sub-queries also have an alias that is reachable by outer queries, in contrast to `from.as`.
        const parent = query.as || query.SELECT.from.as || implicitAs(query.SELECT.from.ref);
        // for better error messages, we refer to the actual reference name first
        const errorParent = implicitAs(query.SELECT.from.ref);
        return mergeElementsIntoMap(Object.create(null), elements, art.$location, parent, errorParent);
      }
      else if (query.SELECT.from.SET || query.SELECT.from.SELECT) {
        return getSources(query.SELECT.from, true);
      }
    }

    return {};
  }

  function walkArgs( args ) {
    let elements = Object.create(null);
    for (const arg of args) {
      if (arg.args) {
        elements = mergeElementMaps(elements, walkArgs(arg.args));
      }
      else if (arg.ref) {
        const art = artifactRef.from(arg);
        elements = mergeElementsIntoMap(elements, art.elements, art.$location,
                                        arg.as || implicitAs(arg.ref), implicitAs(arg.ref) || arg.as);
      }
      else if (arg.SELECT || arg.SET) {
        elements = mergeElementMaps(elements, getSources(arg, true));
      }
    }

    return elements;
  }

  /**
   * Merge two maps of elements together
   *
   * @param {object} mapA Map a - will be returned
   * @param {object} mapB Map b - will not be returned
   * @returns {object} mapA
   */
  function mergeElementMaps( mapA, mapB ) {
    for (const elementName in mapB) {
      if (!mapA[elementName])
        mapA[elementName] = [];

      mapB[elementName].forEach(e => mapA[elementName].push(e));
    }

    return mapA;
  }

  /**
   * Merge elements into an existing map
   *
   * @param {any} existingMap map to merge into - will be returned
   * @param {object} elements elements to merge into the map
   * @param {CSN.Location} $location $location of the elements - where they come from
   * @param {any} [parent] Name of the parent of the elements, alias before ref
   * @param {any} [errorParent] Parent name to use for error messages, ref before alias
   * @returns {object} existingMap
   */
  function mergeElementsIntoMap( existingMap, elements, $location, parent, errorParent ) {
    for (const elementName in elements) {
      const element = elements[elementName];
      if (!existingMap[elementName])
        existingMap[elementName] = [];

      existingMap[elementName].push({
        element, name: elementName, source: $location, parent, errorParent,
      });
    }

    return existingMap;
  }

  /**
   * Return the left-most, primary source of the given query.
   * @param {*} query Definition's query object
   */
  function getQueryPrimarySource( query ) {
    if (!query)
      return undefined;
    else if (query.SELECT)
      return getQueryPrimarySource(query.SELECT);
    else if (query.SET)
      return getQueryPrimarySource(query.SET);
    else if (query.from)
      return getQueryPrimarySource(query.from);
    else if (query.ref)
      return query;
    else if (query.args)
      return getQueryPrimarySource(query.args[0]);

    return undefined;
  }

  /**
   * Get the CSN definition for an artifact name.
   * @param {string} defName Absolute name of the artifact
   */
  function getCsnDef( defName ) {
    if (model.definitions[defName])
      return model.definitions[defName];
    throw new ModelError(`Nonexistent definition in the model: '${ defName }'`);
  }

  /**
   * Returns true if an artifact is a structured type
   * or a typedef of a structured type.
   *
   * @param {object} obj
   * @returns {boolean}
   */
  function isStructured( obj ) {
    if (obj.elements)
      return true;
    if (!obj.type)
      return false;
    const typeInfo = getFinalTypeInfo(obj.type);
    return !!(typeInfo?.elements); // TODO? `|| typeInfo?.type === 'cds.Map');`
  }

  // Return true if 'node' is a managed association element
  // TODO: what about elements having a type, which (finally) is an assoc?
  function isManagedAssociation( node ) {
    // Since v6, managed to-many associations don't get any keys, hence don't require it.
    return node.target !== undefined && node.on === undefined;
  }

  /**
   * Returns if a type is an association or a composition (possibly via type chain).
   *
   * @param {object} artifact Element or other artifact.
   */
  function isAssocOrComposition( artifact ) {
    const finalType = artifact && getFinalTypeInfo( artifact.type )?.type;
    return (finalType === 'cds.Association' || finalType === 'cds.Composition');
  }

  /**
   * Returns true if a type is an association (possibly via type chain).
   *
   * @param {object} artifact Element or other artifact.
   */
  function isAssociation( artifact ) {
    const finalType = artifact && getFinalTypeInfo( artifact.type )?.type;
    return (finalType === 'cds.Association');
  }

  /**
   * Returns if a type is a composition (possibly via type chain).
   *
   * @param {object} artifact Element or other artifact.
   */
  function isComposition( artifact ) {
    const finalType = artifact && getFinalTypeInfo( artifact.type )?.type;
    return (finalType === 'cds.Composition');
  }

  /**
   * Return the context part of the artifact name if any.
   * @param {string} name Absolute name of artifact
   */
  function getContextOfArtifact( name ) {
    let lastDotIdx = name.lastIndexOf('.');
    while (model.definitions[name]) {
      if (model.definitions[name].kind === 'context' || model.definitions[name].kind === 'service')
        return name;
      lastDotIdx = name.lastIndexOf('.');
      if (lastDotIdx === -1)
        return undefined;
      name = name.substring(0, lastDotIdx);
    }
    return undefined;
  }

  /**
   * Add an annotation with absolute name 'absoluteName' (including the at-sign) and string value 'theValue' to 'node'
   *
   * @param {string} absoluteName Name of the annotation, including the at-sign
   * @param {any} theValue string value of the annotation
   * @param {any} node Node to add the annotation to
   */
  function addStringAnnotationTo( absoluteName, theValue, node ) {
    // Sanity check
    if (!absoluteName.startsWith('@'))
      throw new CompilerAssertion(`Annotation name should start with "@": ${ absoluteName }`);

    // Assemble the annotation
    node[absoluteName] ??= theValue;
  }

  /**
   * Return the name of the service in which the artifact is contained.
   * Returns null if the artifact doesn't live in a service.
   *
   * @param {string} artifactName Absolute name of artifact
   * @returns {string|null}
   */
  function getServiceName( artifactName ) {
    for (;;) {
      const idx = artifactName.lastIndexOf('.');
      if (idx === -1)
        return null;
      artifactName = artifactName.substring(0, idx);
      const artifact = model.definitions[artifactName];
      if (artifact && artifact.kind === 'service')
        return artifactName;
    }
  }

  /**
   * Resolve to the final type of a type, that means follow type chains, references, etc.
   * Input is a fully qualified type name, i.e. string, or type ref, i.e. `{ ref: [...] }`.
   *
   * Returns `null` if the type can't be resolved or if the referenced element has no type,
   * e.g. `typeof V:calculated`.
   * Otherwise, if scalar, returns an object that has a `type` property and all collected type
   * properties, or an object with `type` and `elements` or `items` property if structured/arrayed.
   *
   * Notes:
   *   - Caches type lookups.  If the CSN changes drastically, you will need to re-call
   *    `getUtils()` and use the newly returned `getFinalTypeInfo()`.
   *   - Does _not_ return the underlying type definition!  It is an object with all relevant
   *     type properties collected while traversing the type chain!
   *
   * @param {string|object} type
   *     Type as string or type ref, i.e. `{ ref: [...] }`
   *
   * @param {(string)=>CSN.Artifact} getArtifactRef
   *     Function used to get an artifact for a reference. Useful in case that the caller
   *     has a custom cache or a CSN that is in in-between state.
   *     TODO: Can we make getUtils() more modular, so that this argument is already
   *           passed to it?
   *
   * @returns {object|null}
   */
  function getFinalTypeInfo( type, getArtifactRef = artifactRef ) {
    type = normalizeTypeRef(type);
    if (!type)
      return null;

    // We differentiate between ref and type to avoid collisions due to dict key.
    // Delimiter chosen arbitrarily; just one that is rarely used.
    // Need to take care of clashes:
    //  - r({ref: ['\\', '\\', '\\\\'] }) != r({ref: ['\\', '\\\\', '\\'] })
    //  - r({ref: ['\\', '\\', '\\\\'] }) != r({ref: ['\\', '\\\\2:\\\\'] })
    const resolvedKey = (typeof type === 'object')
      // eslint-disable-next-line sonarjs/no-nested-template-literals
      ? `ref[${ type.ref.length }]:${ type.ref.map((val, i) => `${ i }:${ val }`).join('\\') }`
      : `type:${ type }`;

    if (finalBaseTypeCache[resolvedKey]) {
      if (finalBaseTypeCache[resolvedKey] === true)
        throw new ModelError(`Detected circular type reference; can't resolve: ${ resolvedKey }`);
      return finalBaseTypeCache[resolvedKey];
    }

    // Nothing to copy from builtin type name.
    if (typeof type === 'string' && (isBuiltinType( type ) || type === special$self))
      return _cacheResolved({ type });

    const typeRef = getArtifactRef(type); // default artifactRef() throws if not found
    const isNonScalar = _cacheNonScalar({ ...typeRef, type });
    if (isNonScalar)
      return finalBaseTypeCache[resolvedKey];

    const props = {};
    _copyTypeProps(props, typeRef);

    // If the resolved type is a builtin, stop and use its type arguments.
    type = normalizeTypeRef(typeRef.type);
    props.type = type;
    if (typeof type === 'string' && isBuiltinType(type))
      return _cacheResolved(props);

    // Set to true (before the recursive call) to avoid cyclic issues.
    finalBaseTypeCache[resolvedKey] = true;

    // Continue the search
    const finalBase = getFinalTypeInfo(type, getArtifactRef);
    if (!finalBase) // Reference has no proper type, e.g. due to `type of View:calculated`.
      return _cacheResolved(null);

    const nonScalar = _cacheNonScalar(finalBase);
    if (nonScalar)
      return finalBaseTypeCache[resolvedKey];

    // If not a non-scalar, must be resolved type.
    props.type = finalBase.type;
    _copyTypeProps(props, finalBase);
    _cacheResolved(props);
    return props;

    /**
     * Cache/Store the type props under the current `resolvedKey` in the `resolved` cache.
     *
     * @param {object} typeProps
     */
    function _cacheResolved( typeProps ) {
      finalBaseTypeCache[resolvedKey] = typeProps;
      return typeProps;
    }

    /**
     * Structured or arrayed types are not followed further, so cache them.
     *
     * @param obj
     * @returns {boolean} True, if structured/arrayed/invalid, false if scalar.
     */
    function _cacheNonScalar( obj ) {
      if (obj.elements || obj.items) {
        _cacheResolved(obj);
        return true;
      }
      return false;
    }

    /**
     * Copy type properties from source to target.  Also copies `type`, `enum`,
     * and `localized` (if keepLocalized is true).  Only copies from source,
     * if target does not have them.
     *
     * @param {object} target
     * @param {object} source
     */
    function _copyTypeProps( target, source ) {
      target.type = source.type;
      const typeProps = [ ...typeParameters.list, 'enum', 'default', 'localized' ];
      for (const param of typeProps) {
        if (target[param] === undefined && source[param] !== undefined)
          target[param] = source[param];
      }
      return target;
    }
  }
}


/**
 * Apply function `callback` to all artifacts in dictionary
 * `model.definitions`.  See function `forEachGeneric` for details.
 * Callback will be called with artifact, artifact name, property
 * name ('definitions') and csn-path to artifact.
 *
 * @param {CSN.Model} csn
 * @param {(genericCallback|genericCallback[])} callback
 * @param {object} iterateOptions can be used to skip certain kinds from being iterated
 */
function forEachDefinition( csn, callback, iterateOptions = {} ) {
  forEachGeneric( csn, 'definitions', callback, [], iterateOptions );
}

/**
 * Apply function `callback` to all members of object `construct` (main artifact or
 * parent member).  Members are considered those in dictionaries `elements`,
 * `enum`, `actions` and `params` of `construct`, `elements` and `enums` are also
 * searched inside property `items` (array of) and `returns` (actions).
 * See function `forEachGeneric` for details.
 *
 * @param {CSN.Artifact} construct
 * @param {genericCallback|genericCallback[]} callback
 * @param {CSN.Path} [path]
 * @param {boolean} [ignoreIgnore]
 * @param {object} iterateOptions can be used to skip certain kinds from being iterated
 * @param constructCallback
 */
function forEachMember( construct, callback, path = [], ignoreIgnore = true, iterateOptions = {},
                        constructCallback = (_construct, _prop, _path) => {} ) {
  // Allow processing $ignored elements if requested
  if (ignoreIgnore && construct.$ignore)
    return;

  // `items` itself is a structure that can contain "elements", and more.
  if (construct.items)
    forEachMember( construct.items, callback, [ ...path, 'items' ], ignoreIgnore, iterateOptions, constructCallback );

  path = [ ...path ]; // Copy
  const propsWithMembers = (iterateOptions.elementsOnly ? [ 'elements' ] : [ 'elements', 'enum', 'actions', 'params' ]);
  propsWithMembers.forEach((prop) => {
    forEachGeneric( construct, prop, callback, path, iterateOptions );
    if (construct[prop]) {
      if (Array.isArray(constructCallback))
        constructCallback.forEach(cb => cb(construct, prop, path));
      else
        constructCallback(construct, prop, path);
    }
  });

  if (construct.returns) {
    if (construct.returns.items || construct.returns.elements) {
      if (!iterateOptions.elementsOnly)
        forEachMember(construct.returns, callback, [ ...path, 'returns' ], ignoreIgnore, iterateOptions, constructCallback);
    }
    else if (Array.isArray(callback)) {
      callback.forEach(cb => cb(construct.returns, '', 'returns', [ ...path, 'returns' ], construct));
    }
    else {
      callback(construct.returns, '', 'returns', [ ...path, 'returns' ], construct);
    }
  }
}

/**
 * Apply function `callback(member, memberName)` to each member in `construct`,
 * recursively (i.e. also for sub-elements of elements).
 *
 * @param {CSN.Artifact} construct
 * @param {genericCallback|genericCallback[]} callback
 * @param {CSN.Path} [path]
 * @param {boolean} [ignoreIgnore]
 * @param {object} iterateOptions can be used to skip certain kinds from being iterated
 * @param {constructCallback|constructCallback[]} callback
 */
function forEachMemberRecursively( construct, callback, path = [], ignoreIgnore = true, iterateOptions = {},
                                   constructCallback = (_construct, _prop, _path) => {} ) {
  forEachMember( construct, ( member, memberName, prop, subpath, parent ) => {
    if (Array.isArray(callback))
      callback.forEach(cb => cb( member, memberName, prop, subpath, parent ));
    else
      callback( member, memberName, prop, subpath, parent );
    // Descend into nested members, too
    forEachMemberRecursively( member, callback, subpath, ignoreIgnore, iterateOptions, constructCallback);
  }, path, ignoreIgnore, iterateOptions, constructCallback);
}

/**
 * Apply function `callback` to all objects in dictionary `dict`, including all
 * duplicates (found under the same name).  Function `callback` is called with
 * the following arguments: the object, the name, and -if it is a duplicate-
 * the array index and the array containing all duplicates.
 *
 * @param {object} construct
 * @param {string} prop
 * @param {genericCallback|genericCallback[]} callback
 * @param {CSN.Path} path
 * @param {object} iterateOptions can be used to skip certain kinds from being iterated
 */
function forEachGeneric( construct, prop, callback, path = [], iterateOptions = {} ) {
  const dict = construct[prop];
  for (const name in dict) {
    if (!Object.prototype.hasOwnProperty.call(dict, name))
      continue;
    const dictObj = dict[name];
    if ((iterateOptions.skip && iterateOptions.skip.includes(dictObj.kind)) ||
       (iterateOptions.skipArtifact && typeof iterateOptions.skipArtifact === 'function' &&
           iterateOptions.skipArtifact(dictObj, name)))
      continue;
    executeCallbacks( dictObj, name );
  }
  function executeCallbacks( o, name ) {
    const p = iterateOptions.pathWithoutProp ? [ name ] : [ prop, name ];

    if (Array.isArray(callback))
      callback.forEach(cb => cb( o, name, prop, path.concat(p), construct ));
    else
      callback( o, name, prop, path.concat(p), construct );
  }
}

const queryTraversalProperties = [ 'args', 'xpr', 'columns', 'where', 'having' ];

/**
 * @param {CSN.Query} query
 * @param {queryCallback} queryCallback
 * @param {CSN.Path} path
 */
function forAllQueries( query, queryCallback, path ) {
  if (query.SELECT) {
    // The projection is turned into a normalized query - there
    // is no real SELECT, it is fake
    if (!(path.length === 3 && path[2] === 'projection'))
      path.push('SELECT');
    queryCallback( query, path );
    query = query.SELECT;
  }
  else if (query.SET) {
    path.push('SET');
    queryCallback( query, path );
    query = query.SET;
  }

  if (query.from)
    traverseFrom( query.from, queryCallback, [ ...path, 'from' ] );

  for (const prop of queryTraversalProperties) {
    // all properties which could have sub queries (directly or indirectly)
    const expr = query[prop];
    if (expr && typeof expr === 'object') {
      if (Array.isArray(expr)) {
        for (let i = 0; i < expr.length; i++)
          forAllQueries(expr[i], queryCallback, [ ...path, prop, i ]);
      }
      else {
        for (const argName of Object.keys( expr ))
          forAllQueries(expr[argName], queryCallback, [ ...path, prop, argName ]);
      }
    }
  }
}

/**
 * @param {CSN.QueryFrom} from
 * @param {queryCallback} queryCallback
 * @param {CSN.Path} path
 */
function traverseFrom( from, queryCallback, path = [] ) {
  if (from.ref) {
    // ignore
  }
  else if (from.args) { // join
    for (let i = 0; i < from.args.length; i++)
      traverseFrom(from.args[i], queryCallback, [ ...path, 'args', i ]);
  }
  else {
    forAllQueries( from, queryCallback, path ); // sub query in FROM
  }
}

/**
 * Returns true if the artifact should be skipped during persistence.
 * Respects special value `if-unused` by Node runtime.
 *
 * @param {CSN.Artifact} art
 * @returns {boolean}
 */
function hasPersistenceSkipAnnotation( art ) {
  return art['@cds.persistence.skip'] && art['@cds.persistence.skip'] !== 'if-unused';
}

/**
 * EDM specific check: Render (navigation) property if element is NOT ...
 * 1) ... annotated @cds.api.ignore
 * 2) ... annotated @odata.navigable: false
 * 2) ... annotated @odata.foreignKey4 and odataFormat: structured
 * function accepts EDM internal and external options
 *
 * @param {CSN.Element} elementCsn
 * @param {ODataOptions} options EDM specific options
 */
function isEdmPropertyRendered( elementCsn, options ) {
  // FKs are rendered in
  // V2/V4 flat: always on
  // V4 struct: on/off
  if (elementCsn == null)
    return false;
  const renderForeignKey = (options.odataVersion === 'v4' && options.odataFormat === 'structured')
    ? !!options.odataForeignKeys : true;
  const isNotIgnored = !elementCsn.target ? !elementCsn['@cds.api.ignore'] : true;
  const isNavigable = elementCsn.target
    ? (elementCsn['@odata.navigable'] === undefined ||
      (elementCsn['@odata.navigable'] === null || !!elementCsn['@odata.navigable'])) : true;
  // Foreign Keys can be ignored
  if (elementCsn['@odata.foreignKey4'])
    return isNotIgnored && renderForeignKey;
  // ordinary elements can be ignored and isNavigable is always true for them
  // assocs cannot be ignored but not navigable
  return isNotIgnored && isNavigable;
}


/**
 * Return the resulting database name for (absolute) 'artifactName', depending on the current naming
 * mode.
 *
 * - For the 'hdbcds' naming mode, this means converting '.' to '::' on
 *   the border between namespace and top-level artifact and correctly replacing some '.' with '_'.
 * - For the 'plain' naming mode, it means converting all '.' to '_' and upper-casing.
 * - For the 'quoted' naming mode, this means correctly replacing some '.' with '_'.
 *
 * The above rules might differ for different SQL dialects.
 * Exceptions will be listed below.
 *
 * @param {string} artifactName The fully qualified name of the artifact
 * @param {'plain'|'quoted'|'hdbcds'|string} sqlMapping The naming mode to use
 * @param {CSN.Model} csn
 * @param {('sqlite'|'hana'|'plain'|string)} [sqlDialect='plain'] The SQL dialect to use
 * @returns {string} The resulting database name for (absolute) 'artifactName', depending on the current naming mode.
 */
function getArtifactDatabaseNameOf( artifactName, sqlMapping, csn, sqlDialect = 'plain' ) {
  if (csn && typeof csn === 'object' && csn.definitions) {
    isValidMappingDialectCombi(sqlDialect, sqlMapping);
    if (sqlMapping === 'quoted' || sqlMapping === 'hdbcds')
      return getResultingName(csn, sqlMapping, artifactName);

    else if (sqlMapping === 'plain')
      return artifactName.replace(/\./g, '_').toUpperCase();

    throw new CompilerAssertion(`Unknown naming mode: ${ sqlMapping }`);
  }
  else {
    throw new CompilerAssertion('A valid CSN model is required to correctly calculate the database name of an artifact.');
  }
}

/**
 * Get the name that the artifact definition has been rendered as - except for plain, there we just return the name as-is.
 * Without quoting/escaping stuff.
 *
 * Example: namespace.context.entity.with.dot
 * - plain: namespace.context.entity.with.dot
 * - quoted: namespace.context.entity_with_dot
 * - hdbcds: namespace::context.entity_with_dot
 *
 * @param {CSN.Model} csn CSN model
 * @param {string} namingMode Naming mode to use
 * @param {string} artifactName Artifact name to use
 * @returns {string} The resulting name
 */
function getResultingName( csn, namingMode, artifactName ) {
  if (namingMode === 'plain' || !artifactName.includes('.'))
    return artifactName;

  const namespace = getNamespace(csn, artifactName);

  // Walk from front to back until we find a non-namespace/context
  // and join everything we've seen until that point with ., the rest
  // with _ (and the namespace with :: for hdbcds naming)
  const stopIndex = namespace ? namespace.split('.').length : 0;

  const parts = artifactName.split('.');

  const realParts = getUnderscoredName(stopIndex, parts, csn);
  const name = realParts ? realParts.join('.') : artifactName;


  return (namespace && namingMode === 'hdbcds') ? `${ namespace }::${ name.slice(namespace.length + 1) }` : name;
}


/**
 * Get the suffix and prefix part - with '.' join for prefix, '_' for suffix.
 * We determine when to start using '_' by walking from front to back until we find
 * the first shadowing definition that is not a namespace, context or service.
 *
 * Anything following is joined by '_'.
 *
 *
 * @param {number} startIndex Index to start looking at the parts - used to skip the namespace
 * @param {string[]} parts Parts of the name, split at .
 * @param {CSN.Model} csn
 * @returns {string[]|null} Array of at most 2 strings: if both: [prefix, suffix], otherwise just one - or null
 */
function getUnderscoredName( startIndex, parts, csn ) {
  for (let i = startIndex; i < parts.length; i++) {
    const namePart = parts.slice(0, i).join('.');
    const art = csn.definitions[namePart];
    if (art && !(art.kind === 'context' || art.kind === 'service')) {
      const prefix = parts.slice(0, i - 1).join('.');
      const suffix = parts.slice(i - 1).join('_');
      const result = [];
      if (prefix)
        result.push(prefix);
      if (suffix)
        result.push(suffix);

      return result;
    }
    else if (art && art.kind === 'service') {
      // inside services, we immediately turn . into _
      const prefix = parts.slice(0, i).join('.');
      const suffix = parts.slice(i).join('_');
      const result = [];
      if (prefix)
        result.push(prefix);
      if (suffix)
        result.push(suffix);

      return result;
    }
  }

  return null;
}

function isValidMappingDialectCombi( sqlDialect, sqlMapping ) {
  if (sqlMapping === 'hdbcds' && sqlDialect !== 'hana')
    throw new CompilerAssertion(`sqlMapping "hdbcds" must only be used with sqlDialect "hana" - found: ${ sqlDialect }`);
  return true;
}


/**
 *  Return the resulting database element name for 'elemName', depending on the current
 *  naming mode.
 *  - For the 'hdbcds' naming mode, this is just 'elemName'.
 *  - For the 'plain' naming mode, it means converting all '.' to '_' and upper-casing.
 *  - For the 'quoted' naming mode, it means converting all '.' to '_'.
 *  No other naming modes are accepted!
 *
 *  The above rules might differ for different SQL dialects.
 *  Exceptions will be listed below.
 *
 * @param {string} elemName The name of the element
 * @param {'plain'|'quoted'|'hdbcds'|string} sqlMapping The naming mode to use
 * @param {('sqlite'|'hana'|'plain'|string)} [sqlDialect='plain'] The SQL dialect to use
 * @returns {string} The resulting database element name for 'elemName', depending on the current naming mode.
 */
function getElementDatabaseNameOf( elemName, sqlMapping, sqlDialect = 'plain' ) {
  isValidMappingDialectCombi(sqlDialect, sqlMapping);
  if (sqlMapping === 'hdbcds')
    return elemName;

  else if (sqlMapping === 'plain')
    return elemName.replace(/\./g, '_').toUpperCase();

  else if (sqlMapping === 'quoted')
    return elemName.replace(/\./g, '_');

  throw new CompilerAssertion(`Unknown naming mode: ${ sqlMapping }`);
}

const _dependencies = Symbol('_dependencies');
const _dependents = Symbol('_dependents');

/**
 * Calculate the hard dependencies between artifacts (as needed to ensure the correct view order).
 * Only works on A2Jed HANA CSN!
 *
 * _dependents: All artifacts that depend on this artifact (because they have a ref that points to it)
 * _dependencies: All artifacts this artifact depends on (because it has a ref to it)
 *
 * @param {CSN.Model} csn A CSN to enrich in-place
 * @param {object} refs csnRefs, only used for artifactRef
 * @returns {object} CSN with _dependents/_dependencies set, "cleanup" function, _dependents/_dependencies Symbol used
 */
function setDependencies( csn, refs = csnRefs(csn) ) {
  const cleanup = [];
  const { artifactRef } = refs;

  forEachDefinition(csn, (artifact, artifactName) => {
    const queries = getNormalizedQuery(artifact).query;
    if (queries) {
      initDependencies(artifact);
      forAllQueries(queries, (query) => {
        if (query.SELECT?.from) {
          if (query.SELECT.from.args)
            handleArgs(artifact, artifactName, query.SELECT.from.args);

          else if (typeof query.SELECT.from === 'string' || query.SELECT.from.ref)
            handleDependency(artifactRef.from(query.SELECT.from), artifact, artifactName);
        }
      }, [ 'definitions', artifactName, (artifact.projection ? 'projection' : 'query') ]);
    }
  });

  return {
    cleanup, csn, _dependents, _dependencies,
  };

  function handleArgs( artifact, artifactName, args ) {
    for (const arg of args) {
      if (arg.args)
        handleArgs(artifact, artifactName, arg.args);
      else if (arg.ref)
        handleDependency(artifactRef.from(arg), artifact, artifactName);
    }
  }

  function handleDependency( dependency, dependant, dependantName ) {
    dependant[_dependencies].add(dependency);
    initDependents(dependency);
    dependency[_dependents][dependantName] = dependant;
  }

  function initDependents( obj ) {
    if (!obj[_dependents]) {
      obj[_dependents] = Object.create(null);
      cleanup.push(() => delete obj[_dependents]);
    }
  }

  function initDependencies( obj ) {
    if (!obj[_dependencies]) {
      obj[_dependencies] = new Set();
      cleanup.push(() => delete obj[_dependencies]);
    }
  }
}

/**
 * If the artifact is either abstract or assigned '@cds.persistence.skip' it
 * never reaches the Database layer.
 *
 * @param {CSN.Artifact} art
 * @returns {boolean}
 */
function isPersistedOnDatabase( art ) {
  return !(art.kind === 'entity' && (art.abstract || hasPersistenceSkipAnnotation(art)));
}
/**
 * Check if the given artifact will be persisted on the database via `CREATE VIEW`
 *
 * @param {CSN.Artifact} artifact
 * @returns {boolean}
 */
function isPersistedAsView( artifact ) {
  return artifact && artifact.kind === 'entity' &&
      !artifact.$ignore &&
      !artifact.abstract &&
      ((artifact.query || artifact.projection) && !artifact['@cds.persistence.table']) &&
      !hasPersistenceSkipAnnotation(artifact) &&
      !artifact['@cds.persistence.exists'];
}
/**
 * Check if the given artifact will be persisted on the database via `CREATE TABLE`
 *
 * @param {CSN.Artifact} artifact
 * @returns {boolean}
 */
function isPersistedAsTable( artifact ) {
  return artifact.kind === 'entity' &&
      !artifact.$ignore &&
      !artifact.abstract &&
      (!artifact.query && !artifact.projection || artifact['@cds.persistence.table']) &&
      !hasPersistenceSkipAnnotation(artifact) &&
      !artifact['@cds.persistence.exists'];
}

/**
 * Return the projection to look like a query.
 *
 * @param {CSN.Artifact} art Artifact with a query or a projection
 * @returns {object} Object with a query property.
 */
function getNormalizedQuery( art ) {
  if (art.projection)
    return { query: { SELECT: art.projection } };

  return art;
}

/**
 * If `art.type` is an object with `ref` of length 1, normalize it to
 * just the type reference string, e.g. `{ ref: [ 'T'] }` becomes `'T'`.
 *
 * @param {string|object} type
 * @return {string|object}
 */
function normalizeTypeRef( type ) {
  if (type && typeof type === 'object' && type.ref?.length === 1)
    type = type.ref[0]; // simplify type: no element -> simple string can be used
  return type;
}

/**
* If the artifact with the name given is part of a context (or multiple), return the top-most context.
* Else, return the artifact itself. Namespaces are not of concern here.
*
* @param {string} artifactName Name of the artifact
* @param {CSN.Model} csn
* @returns {string} Name of the root
*/
function getRootArtifactName( artifactName, csn ) {
  const parts = artifactName.split('.');

  if (parts.length === 1)
    return artifactName;

  let seen = getNamespace(csn, artifactName) || '';
  const startIndex = (seen === '') ? 0 : seen.split('.').length;
  for (let i = startIndex; i < parts.length; i++) {
    if (seen === '')
      seen = parts[i];
    else
      seen = `${ seen }.${ parts[i] }`;

    const art = csn.definitions[seen];
    // Our artifact seems to be contained in this context
    if (art && (art.kind === 'context' || art.kind === 'service'))
      return seen;
  }
  // Our artifact is a root artifact itself
  return seen;
}

// Return the last part of 'name'.
// Examples:
//   'foo.bar.wiz' => 'wiz'
//   'foo' => 'foo';
//   'foo::bar' => 'bar'
function getLastPartOf( name ) {
  // Not using RegEx /[^.:]+$/ to avoid ReDoS.
  for (let i = name.length - 1; i >= 0; --i) {
    if (name[i] === '.' || name[i] === ':')
      return name.substring(i + 1);
  }
  return name;
}

// Return the last part of reference array 'ref'
// Examples:
//   ['foo.bar', 'wiz'] => 'wiz'
//   ['foo.bar.wiz'] => 'wiz'
//   ['foo'] => 'foo';
//   ['foo::bar'] => 'bar'
function getLastPartOfRef( ref ) {
  const lastPathStep = ref[ref.length - 1];
  return getLastPartOf(lastPathStep.id || lastPathStep);
}

/**
 * Copy all annotations from 'fromNode' to 'toNode'.
 *
 * Overwrite existing ones only if 'overwrite' is true.
 *
 * IMPORTANT: Consider using copyAnnotationsAndDoc() instead!
 *            Don't forget about doc comments!
 *
 * @param {object} fromNode
 * @param {object} toNode
 * @param {boolean} [overwrite]
 * @param {object} excludes
 * @param {array} annoNames (copy only these annotations or all if undefined)
 * @returns {array} copiedAnnoNames
 */
function copyAnnotations( fromNode, toNode, overwrite = false, excludes = {}, annoNames = undefined ) {
  const copiedAnnoNames = [];
  if (toNode) {
    if (annoNames == null)
      annoNames = Object.keys(fromNode).filter(key => key.startsWith('@'));

    annoNames.forEach((anno) => {
      if ((toNode[anno] === undefined || overwrite) && !excludes[anno]) {
        toNode[anno] = cloneAnnotationValue(fromNode[anno]);
        copiedAnnoNames.push(anno);
      }
    });
  }
  return copiedAnnoNames;
}


/**
 * Same as `copyAnnotations()` but also copies the
 * annotation-like property `doc`.
 *
 * Overwrite existing ones only if 'overwrite' is true.
 *
 * @param {object} fromNode
 * @param {object} toNode
 * @param {boolean} [overwrite]
 */
function copyAnnotationsAndDoc( fromNode, toNode, overwrite = false ) {
  // Ignore if no toNode (in case of errors)
  if (!toNode)
    return;

  copyAnnotations(fromNode, toNode, overwrite);
  if (toNode.doc === undefined || overwrite)
    toNode.doc = fromNode.doc;
}

/**
 * Same as `copyAnnotationsAndDoc()` but deletes the annotations on source
 * side after copying them.  Useful when applying annotations from `cds.extensions`.
 *
 * Overwrite existing ones only if 'overwrite' is true.
 *
 * @param {object} sourceNode
 * @param {object} targetNode
 * @param {boolean} [overwrite]
 */
function moveAnnotationsAndDoc( sourceNode, targetNode, overwrite = false ) {
  // Ignore if no targetNode (in case of errors)
  if (!targetNode)
    return;

  const annotations = Object.keys(sourceNode)
    .filter(key => key.startsWith('@') || key === 'doc');

  for (const anno of annotations) {
    if (targetNode[anno] === undefined || overwrite) {
      targetNode[anno] = sourceNode[anno];
      delete sourceNode[anno];
    }
  }
}

/**
 * Applies annotations from `csn.extensions` to definitions and their elements.
 *
 * `config.filter` can be used to only copy annotations for those definitions,
 * for which the filter returns true.
 *
 * @todo Does _not_ apply param/action/... annotations.
 *
 * @param {CSN.Model} csn
 * @param {{notFound?: (name: string, index: number) => void, override?: boolean, filter?: (name: string) => boolean, applyToElements?: boolean}} config
 *       notFound: Function that is called if the referenced definition can't be found.
 *                 Second argument is index in `csn.extensions` array.
 *       override: Whether to ignore existing annotations.
 *       filter:   Positive filter. If it returns true, annotations for the referenced artifact
 *                 will be applied.
 *       applyToElements: Whether to apply annotations to elements or only to artifacts
 */
function applyAnnotationsFromExtensions( csn, config ) {
  if (!csn.extensions)
    return;

  const filter = config.filter || (_name => true);
  const applyToElements = config.applyToElements ?? true;
  for (let i = 0; i < csn.extensions.length; ++i) {
    const ext = csn.extensions[i];
    const name = ext.annotate || ext.extend;
    if (name && filter(name)) {
      const def = csn.definitions[name];
      if (def) {
        moveAnnotationsAndDoc(ext, def, config.override);
        if (applyToElements)
          applyAnnotationsToElements(ext, def);
        if (Object.keys(ext).length <= 1)
          csn.extensions[i] = undefined;
      }
      else if (config.notFound) {
        config.notFound(name, i);
      }
    }
  }

  csn.extensions = csn.extensions.filter(ext => ext);

  function applyAnnotationsToElements( ext, def ) {
    // Only the definition is arrayed but the extension is not since
    // `items` is not expected in `extensions` by the CSN frontend and not
    // generated by the CDL parser for `annotate E:arrayed.elem`.
    if (def.items)
      def = def.items;

    if (!ext.elements || !def.elements)
      return;

    forEach(ext.elements, (key, sourceElem) => {
      const targetElem = def.elements[key];
      if (targetElem) {
        moveAnnotationsAndDoc(sourceElem, targetElem, config.override);
        applyAnnotationsToElements(sourceElem, targetElem);
        if (Object.keys(sourceElem).length === 0)
          delete ext.elements[key];
      }
    });

    if (Object.keys(ext.elements).length === 0)
      delete ext.elements;
  }
}

/**
 * Return true if the artifact has a valid, truthy persistence.exists/skip annotation
 *
 * @param {CSN.Artifact} artifact
 * @returns {boolean}
 */
function hasValidSkipOrExists( artifact ) {
  return artifact.kind === 'entity' &&
         (artifact['@cds.persistence.exists'] ||
           hasPersistenceSkipAnnotation(artifact));
}

/**
   * Return the namespace part of the artifact name.
   *
   * Return the longest undefined prefix path.
   * If the first path segment is defined (that is name has
   * no dots and is defined), return undefined.
   *
   * Example:
   * model.definitions {
   *   a.b: 1,
   *   a.b.c.d: 1
   * }
   * getNamespace('foo.bar') = 'foo.bar'
   * getNamespace('a.b.c.d') = 'a'
   *
   * model.definitions {
   *   a: 1,
   *   a.b.c.d: 1
   * }
   * getNamespace('a.b.c.d') = undefined
   *
   * @param {string} name Absolute name of artifact
   * @param {CSN.Model} csn CSN model
   * @param {any} ns default namespace return value
   * @returns {any} The namespace or the value of ns
   */
function getNamespace( csn, name, ns = undefined ) {
  let dotpos = -1;
  while (dotpos < name.length) {
    for (dotpos++; dotpos < name.length && name[dotpos] !== '.'; dotpos++)
      ;
    const tns = name.substring(0, dotpos);
    if (csn.definitions[tns] === undefined)
      ns = tns;
    else
      return ns;
  }
  return ns;
}

/**
 * Return an array of non-abstract service names contained in CSN
 *
 * @param {CSN.Model} csn
 * @returns {string[]}
 */
function getServiceNames( csn ) {
  const result = [];
  forEachDefinition(csn, (artifact, artifactName) => {
    if (artifact.kind === 'service' && !artifact.abstract)
      result.push(artifactName);
  });
  return result;
}

/**
 * Walk path in the CSN and return the result.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Path} path
 * @returns {object} Whatever is at the end of path
 */
function walkCsnPath( csn, path ) {
  /** @type {object} */
  let obj = csn;
  for (const segment of path)
    obj = obj[segment];


  return obj;
}

/**
 * If provided, get the replacement string for the given magic variable ref.
 * No validation is done that the ref is actually magic!
 *
 * @param {array} ref
 * @param {CSN.Options} options
 * @returns {string|null}
 */
function getVariableReplacement( ref, options ) {
  if (options && options.variableReplacements) {
    let replacement = options.variableReplacements;
    for (const segment of ref) {
      replacement = replacement[segment];
      if (replacement === undefined)
        return null;
    }

    if (replacement === undefined)
      return null; // no valid replacement found
    else if (typeof replacement === 'string')
      return replacement; // valid replacement
    return null; // $user.foo, but we only have configured $user.foo.bar -> error
  }
  return null;
}

/**
 *
 * @param {object} obj
 * @param {*} other
 * @param {boolean} noExtendedProps
 * @returns {boolean} returns equality
 *
 * noExtendedProps remove '$', '_' and '@' properties from
 * the comparison. This eliminates false negatives such as
 *  mismatching $locations or @odata.foreignKey4.
 */
function isDeepEqual( obj, other, noExtendedProps ) {
  let objectKeys = Object.keys(obj);
  let otherKeys = Object.keys(other);

  if (noExtendedProps) {
    objectKeys = objectKeys.filter(k => ![ '@', '$', '_' ].includes(k[0]));
    otherKeys = otherKeys.filter(k => ![ '@', '$', '_' ].includes(k[0]));
  }
  if (objectKeys.length !== otherKeys.length)
    return false;

  for (const key of objectKeys) {
    const areValuesObjects = (obj[key] != null && typeof obj[key] === 'object') &&
      (other[key] !== null && typeof other[key] === 'object');

    if (areValuesObjects) {
      if (!isDeepEqual(obj[key], other[key], noExtendedProps))
        return false;
    }
    else if (obj[key] !== other[key]) {
      return false;
    }
  }
  return true;
}

/**
 * convert a cardinality object to string representation
 * @param {object} node
 * @param {boolean} withSrc
 * @returns {string} cardinality as string
 */
function cardinality2str( node, withSrc = true ) {
  const ofto = node.type === 'cds.Composition' ? 'of' : 'to';
  if (node.cardinality == null || (node.cardinality.src == null || !withSrc) && node.cardinality.min == null && node.cardinality.max === 1)
    return `${ ofto } one`;
  if ((node.cardinality.src == null || !withSrc) && node.cardinality.min == null && node.cardinality.max === '*')
    return `${ ofto } many`;
  let s = '[';
  if (node.cardinality.src != null && withSrc)
    s += `${ node.cardinality.src },`;
  if (node.cardinality.min != null)
    s += `${ node.cardinality.min }..`;
  if (node.cardinality.max != null)
    s += `${ node.cardinality.max }]`;
  return s;
}

/**
 * Returns a function that, if called, calls all functions inside
 * the given `functions` array with the same arguments.
 *
 * @param {Function[]} functions
 * @param {object} thisArg Argument that will be passed to all functions as `this`.
 */
function functionList( functions, thisArg ) {
  return function iterateFunctions(...args) {
    return functions.map(f => f.apply(thisArg, args));
  };
}

/**
 * Return true if 'arg' is an expression argument denoting "$self" || "$projection"
 * @param {object} arg
 * @returns {boolean}
 */
function isDollarSelfOrProjectionOperand( arg ) {
  return arg.ref && arg.ref.length === 1 &&
    (arg.ref[0] === '$self' || arg.ref[0] === '$projection');
}

/**
 * Return true if 'arg' is an expression argument of type association or composition
 * @param {object} arg
 * @param {CSN.Path} path
 * @param {function} inspectRef
 * @returns {boolean}
 */
function isAssociationOperand( arg, path, inspectRef ) {
  if (!arg.ref) {
    // Not a path, hence not an association (literal, expression, function, whatever ...)
    return false;
  }
  const { art } = inspectRef(path);
  // If it has a target, it is an association or composition
  return art && art.target !== undefined;
}

function pathName( ref ) {
  return ref ? ref.map( pathId ).join( '.' ) : '';
}

/**
 * Return true if prop is an annotation and the annotation value has an expression
 *
 * @param {object} node
 * @param {string} prop
 * @returns {boolean}
 */
function findAnnotationExpression( node, prop ) {
  let isExpr = false;
  if (prop[0] === '@') {
    transformExpression(node, prop, {
      '=': (p) => {
        isExpr ||= isAnnotationExpression(p);
      },
    });
  }
  return isExpr;
}

module.exports = {
  getUtils,
  applyAnnotationsFromExtensions,
  forEachGeneric,
  forEachDefinition,
  forEachMember,
  forEachMemberRecursively,
  forAllQueries,
  hasPersistenceSkipAnnotation,
  isEdmPropertyRendered,
  getArtifactDatabaseNameOf,
  getResultingName,
  getUnderscoredName,
  getElementDatabaseNameOf,
  transformExpression,
  transformAnnotationExpression,
  applyTransformations,
  applyTransformationsOnNonDictionary,
  applyTransformationsOnDictionary,
  mergeTransformers,
  setDependencies,
  isPersistedOnDatabase,
  isPersistedAsView,
  isPersistedAsTable,
  getNormalizedQuery,
  getRootArtifactName,
  getLastPartOfRef,
  getLastPartOf,
  normalizeTypeRef,
  copyAnnotations,
  copyAnnotationsAndDoc,
  hasValidSkipOrExists,
  getNamespace,
  getServiceNames,
  walkCsnPath,
  getVariableReplacement,
  implicitAs,
  isDeepEqual,
  functionList,
  cardinality2str,
  isAssociationOperand,
  isDollarSelfOrProjectionOperand,
  pathName,
  findAnnotationExpression,
};
