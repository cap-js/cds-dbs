'use strict';

/* eslint max-statements-per-line:off */
const { setProp, isBetaEnabled } = require('../base/model');
const {
  forEachDefinition, forEachGeneric, forEachMemberRecursively,
  isEdmPropertyRendered, getUtils,
  applyTransformations, transformAnnotationExpression, findAnnotationExpression,
  cardinality2str,
} = require('../model/csnUtils');
const { isBuiltinType, isMagicVariable } = require('../base/builtins');
const edmUtils = require('./edmUtils.js');
const edmAnnoPreproc = require('./edmAnnoPreprocessor.js');
const { inboundQualificationChecks } = require('./edmInboundChecks.js');
const typesExposure = require('../transform/odata/typesExposure');
const expandCSNToFinalBaseType = require('../transform/odata/toFinalBaseType');
const { cloneCsnNonDict, cloneAnnotationValue } = require('../model/cloneCsn');
const { forEach, forEachKey } = require('../utils/objectUtils.js');

const NavResAnno = '@Capabilities.NavigationRestrictions.RestrictedProperties';

// Capabilities that can be pulled up to NavigationRestrictions
const capabilities = Object.keys(require('../gen/Dictionary.json')
  .types['Capabilities.NavigationPropertyRestriction'].Properties)
  .filter(c => ![ 'NavigationProperty', 'Navigability' ].includes(c))
  .map(c => `@Capabilities.${ c }`);

/**
 *  edmPreprocessor warms up the model so that it can be converted into an EDM document and
 *  contains all late & application specific model transformations
 *  that should NOT become persistent in the published CSN model but only
 *  be presented in the resulting EDM files. These late tweaks or mods can
 *  be dependent to EDM version.
 *
 * @param {CSN.Model} csn
 * @param {object}    _options
 */
function initializeModel( csn, _options, messageFunctions, requestedServiceNames = undefined ) {
  const {
    info, warning, error, message,
  } = messageFunctions;
  const special$self = !csn?.definitions?.$self && '$self';
  const csnUtils = getUtils(csn);

  // proxies are merged into the final model after all proxy elements are collected
  const proxyCache = [];
  // iterate only over those definitions that need to be preprocessed
  // instead of mangling through the whole model each time
  // preprocess steps removing adding to the model must co-modify this map
  const reqDefs = { definitions: Object.create(null) };


  // make sure options are complete
  const options = edmUtils.validateOptions(_options);

  const [ serviceRoots,
    serviceRootNames,
    fallBackSchemaName,
    whatsMyServiceRootName ] = getAnOverviewOnTheServices();

  if (serviceRootNames.length === 0)
    return [ serviceRoots, Object.create(null), reqDefs, whatsMyServiceRootName, fallBackSchemaName, options ];


  if (requestedServiceNames === undefined)
    requestedServiceNames = options.serviceNames;
  if (requestedServiceNames === undefined)
    requestedServiceNames = serviceRootNames;


  function isMyServiceRequested( n ) {
    return requestedServiceNames.includes(whatsMyServiceRootName(n));
  }

  // Structural CSN inbound QA checks
  inboundQualificationChecks(csn, options, messageFunctions,
                             serviceRootNames, requestedServiceNames, isMyServiceRequested, whatsMyServiceRootName, csnUtils);
  // not needed at the moment
  // resolveForeignKeyRefs();

  if (isBetaEnabled(options, undefined))
    splitDottedDefinitionsIntoSeparateServices();

  else
    /*
      Replace dots with underscores for all definitions below a context
      or a service and rewrite refs and targets. MUST be done before type exposure.
    */
    renameDottedDefinitionsInsideServiceOrContext();

  /*
    Final base type expansion is required here when:
    1) The input CSN was already transformed for V4 but shall be rendered in V2 and the
       edmx generator is called directly (bypassing OData transformation)
    2) The input CSN was already transformed for V4 and persisted (all non-enumerables are
       stripped of)
    3) call via cdsc

    At the end of the day, this module must be called only here, in the renderer and removed
    as a step in the OData transformer with the goal to have a protocol agnostic OData CSN.
  */
  if (csn.meta && csn.meta.options && csn.meta.options.odataVersion === 'v4' && options.isV2()) {
    const { toFinalBaseType } = require('../transform/transformUtils').getTransformers(csn, options, messageFunctions);
    expandCSNToFinalBaseType(csn, { toFinalBaseType }, csnUtils, serviceRootNames, options);
  }

  /*
    Enrich the CSN by de-anonymizing and exposing types that are required to make the service self contained.
  */
  // add cds.Map structured type into definitions to allow types exposure to pull in this type
  if (options.isV4() && csn.definitions['cds.Map'] == null) {
    const cdsMap = { '@open': true, elements: Object.create(null) };
    setProp(cdsMap, '$emtpyMapType', true);
    csn.definitions['cds.Map'] = cdsMap;
  }

  const schemas = typesExposure(csn, whatsMyServiceRootName, requestedServiceNames,
                                fallBackSchemaName, options, csnUtils, { error });

  if (options.isV4() && csn.definitions['cds.Map']?.$emptyMapType)
    csn.definitions['cds.Map'] = undefined;

  // Get an overview about all schemas (including the services)
  const schemaNames = [ ...serviceRootNames ];
  schemaNames.push(...Object.keys(schemas));
  // sort schemas in reverse order to allow longest match in whatsMySchemaName function
  schemaNames.sort((a, b) => b.length - a.length);
  function whatsMySchemaName( n ) {
    return schemaNames.reduce((rc, sn) => (!rc && n && n.startsWith(`${ sn }.`) ? sn : rc), undefined);
  }

  if (schemaNames.length) {
    forEachDefinition(csn, [
      attachNameProperty,
      (def, defName) => {
        const mySchemaName = whatsMySchemaName(defName);
        if (mySchemaName)
          setProp(def, '$mySchemaName', mySchemaName);
        if (isMyServiceRequested(defName) && def.kind !== 'aspect' && def.kind !== 'event')
          reqDefs.definitions[defName] = def;
      },
      linkAssociationTarget,
    ]);
    forEachGeneric(csn, 'vocabularies', (term, termName) => {
      const mySchemaName = whatsMySchemaName(termName);
      if (mySchemaName)
        setProp(term, '$mySchemaName', mySchemaName);
    });
    // initialize requested services
    const skip = { skipArtifact: (_def, defName) => !isMyServiceRequested(defName) };
    forEachDefinition({ definitions: serviceRoots }, initService, skip);
    // Create data structures for containments
    forEachDefinition(reqDefs, initContainments);
    // Initialize entities with parameters (add Parameter entity)
    forEachDefinition(reqDefs, initParameterizedEntityOrView);
    // Initialize structures
    forEachDefinition(csn, initStructure);
    // Initialize associations after _parent linking
    forEachDefinition(reqDefs, initConstraints);
    // Mute V4 elements depending on constraint preparation
    if (options.isV4())
      forEachDefinition(reqDefs, ignoreProperties);
    // calculate constraints based on ignoreProperties and initConstraints
    forEachDefinition(reqDefs, finalizeConstraints);
    // convert exposed types into cross schema references if required
    // must be run before proxy exposure to avoid potential reference collisions
    convertExposedTypesOfOtherServicesIntoCrossReferences();
    // create association target proxies (v4)
    // Decide if an entity set needs to be constructed or not
    forEachDefinition(reqDefs, [
      exposeTargetsAsProxiesOrSchemaRefs,
      determineEntitySet,
      annotateOptionalActFuncParams,
    ]);
    // finalize proxy creation
    mergeProxiesIntoModel();

    // Calculate NavPropBinding Target paths
    // Rewrite @Capabilities for containment mode
    if (options.isV4()) {
      forEachDefinition(reqDefs, [
        initEdmNavPropBindingTargets,
        pullupCapabilitiesAnnotations,
      ]);
    }

    // Things that can be done in one pass
    // Create edmKeyRefPaths
    // Create V4 NavigationPropertyBindings, requires determineEntitySet & initEdmNavPropBindingTargets
    // Map /** doc comments */ to @CoreDescription
    forEachDefinition(reqDefs, [
      initEdmKeyRefPaths,
      initEdmNavPropBindingPaths,
      finalize,
    ]);
  }
  return [
    serviceRoots,
    schemas,
    reqDefs,
    whatsMyServiceRootName,
    fallBackSchemaName,
    options,
  ];

  // ////////////////////////////////////////////////////////////////////
  //
  // Service initialization starts here
  //

  function getAnOverviewOnTheServices( ) {
    const defs = csn.definitions || {};
    const sroots = Object.create(null);
    for (const defName in defs) {
      const def = defs[defName];
      if (def && def.kind === 'service')
        sroots[defName] = Object.assign(def, { name: defName });
    }

    // first of all we need to know about all 'real' user defined services
    const srootNames = Object.keys(sroots).sort((a, b) => b.length - a.length);


    // find a globally unambiguous schema name to collect all top level 'root' types
    // TODO: work on service basis (this requires post exposure renaming)
    let fbSchemaName = 'root';
    let i = 1;
    const defNames = Object.keys(defs);
    // eslint-disable-next-line no-loop-func
    while (defNames.some((artName) => {
      const p = artName.split('.');
      return p.length === 2 && p[0] === fbSchemaName;
    }))
      fbSchemaName = `root${ i++ }`;


    return [
      sroots,
      srootNames,
      fbSchemaName,
      // whatsMyServiceRootName
      ( n, self = true ) => srootNames.reduce((rc, sn) => (!rc && n && n.startsWith(`${ sn }.`) || (n === sn && self) ? sn : rc), undefined),
    ];
  }

  /*
    Replace dots in sub-service and sub-context definitions with underscores to be
    Odata ID compliant.
    Replace the definitions in csn.definitions (such that linkAssociationTarget works)
    All type refs and assoc targets must also be adjusted to refer to the new names.
  */
  function renameDottedDefinitionsInsideServiceOrContext() {
    // Find the first definition above the current definition or undefined otherwise.
    // Definition can either be a context or a service
    function getRootDef( name ) {
      const scopeKinds = { service: 1, context: 1 };
      let pos = name.lastIndexOf('.');
      name = pos < 0 ? undefined : name.substring(0, pos);
      while (name && !((csn.definitions[name] && csn.definitions[name].kind) in scopeKinds)) {
        pos = name.lastIndexOf('.');
        name = pos < 0 ? undefined : name.substring(0, pos);
      }
      return name;
    }

    const dotEntityNameMap = Object.create(null);
    const dotTypeNameMap = Object.create(null);
    const kinds = {
      entity: 1, type: 1, action: 1, function: 1,
    };
    forEachDefinition(csn, (def, defName) => {
      if (def.kind in kinds) {
        const rootDef = getRootDef(defName);
        // if this definition has a root def and the root def is not the service/schema name
        // => service C { type D.E }, replace the prefix dots with underscores
        if (rootDef && defName !== rootDef && rootDef !== edmUtils.getSchemaPrefix(defName)) {
          const newDefName = `${ rootDef }.${ defName.replace(`${ rootDef }.`, '').replace(/\./g, '_') }`;
          // store renamed types in correlation maps for later renaming
          if (def.kind === 'entity')
            dotEntityNameMap[defName] = newDefName;
          if (def.kind === 'type')
            dotTypeNameMap[defName] = newDefName;
          // rename in csn.definitions
          const art = csn.definitions[newDefName];
          if (art !== undefined) {
            error(null, [ 'definitions', defName ], { name: newDefName },
                  'Artifact name containing dots can\'t be mapped to an OData compliant name because it conflicts with existing definition $(NAME)');
          }
          else {
            csn.definitions[newDefName] = def;
            delete csn.definitions[defName];
          }
          // dots are illegal in bound actions/functions, no actions required for them
        }
      }
    });
    // rename type refs to new type names
    const rewrite = (def) => {
      const rewriteReferencesInActions = (act) => {
        if (act.params) {
          Object.values(act.params).forEach((param) => {
            param = param.items || param;
            if (param.type && (dotEntityNameMap[param.type] || dotTypeNameMap[param.type]))
              param.type = dotEntityNameMap[param.type] || dotTypeNameMap[param.type];
          });
        }
        if (act.returns) {
          const returnsObj = act.returns.items || act.returns;
          if (returnsObj.type && dotEntityNameMap[returnsObj.type] || dotTypeNameMap[returnsObj.type])
            returnsObj.type = dotEntityNameMap[returnsObj.type] || dotTypeNameMap[returnsObj.type];
        }
      };

      const applyOnNode = (node) => {
        node = node.items || node;
        if (node.type && dotTypeNameMap[node.type])
          node.type = dotTypeNameMap[node.type];

        if (node.target && dotEntityNameMap[node.target])
          node.target = dotEntityNameMap[node.target];

        if (node.$path && dotEntityNameMap[node.$path[1]])
          node.$path[1] = dotEntityNameMap[node.$path[1]];

        rewriteReferencesInActions(node);
      };

      forEachMemberRecursively(def, applyOnNode);
      applyOnNode(def);
      // handle unbound action/function and params in views
      rewriteReferencesInActions(def);
    };

    forEachDefinition(csn, rewrite);
    forEachGeneric(csn, 'vocabularies', rewrite);
  }

  /*
    Experimental: Move definitions with dots into separate (sub-)service that has the
    namespace of the definition prefix. As not all such services end up with entity sets,
    schemas should be packed after the preprocessing run in order to minimize the number
    of services.
  */
  function splitDottedDefinitionsIntoSeparateServices() {
    forEachDefinition(csn, (def, defName) => {
      if (def.kind !== 'service') {
        const myServiceRoot = whatsMyServiceRootName(defName);
        const mySchemaPrefix = edmUtils.getSchemaPrefix(defName);
        if (myServiceRoot && options.isV4() &&
        /* (options.odataProxies || options.odataXServiceRefs) && options.isStructFormat && */
        defName !== myServiceRoot && myServiceRoot !== mySchemaPrefix) {
          const service = { kind: 'service', name: mySchemaPrefix };
          serviceRoots[mySchemaPrefix] = service;
          serviceRootNames.push(mySchemaPrefix);
        }
      }
    });
    serviceRootNames.sort((a, b) => b.length - a.length);
  }

  function attachNameProperty( def, defName ) {
    edmUtils.assignProp(def, 'name', defName);
    // Attach name to bound actions, functions and parameters
    forEachGeneric(def, 'actions', (a, an) => {
      edmUtils.assignProp(a, 'name', an);
      forEachGeneric(a, 'params', (p, pn) => {
        edmUtils.assignProp(p, 'name', pn);
      });
    });
    // Attach name unbound action parameters
    forEachGeneric(def, 'params', (p, pn) => {
      edmUtils.assignProp(p, 'name', pn);
    });
  }

  // initialize the service itself
  function initService( serviceRoot ) {
    edmAnnoPreproc.setSAPSpecificV2AnnotationsToEntityContainer(options, serviceRoot);
  }

  // link association target to association and add @odata.contained to compositions in V4
  function linkAssociationTarget( struct ) {
    forEachMemberRecursively(struct, (element, name, prop, subpath) => {
      if (element.target && !element._target) {
        const target = csn.definitions[element.target];
        if (target) {
          setProp(element, '_target', target);
          // If target has parameters, xref assoc at target for redirection
          if (edmUtils.isParameterizedEntity(target)) {
            if (!target.$sources)
              setProp(target, '$sources', Object.create(null));

            target.$sources[`${ struct.name }.${ name }`] = element;
          }
        }
        else {
          error(null, subpath, { target: element.target }, 'Target $(TARGET) can\'t be found in the model');
        }
      }
      // in V4 tag all compositions to be containments
      if (options.odataContainment &&
         options.isV4() &&
         csnUtils.isComposition(element) &&
         element['@odata.contained'] === undefined)
        element['@odata.contained'] = true;
    });
  }

  // Perform checks and add attributes for "contained" sub-entities:
  // - A container is recognized by having an association/composition annotated with '@odata.contained'.
  // - All targets of such associations ("containees") are marked with a property
  //   '$containerNames: []', having as value an array of container names (i.e. of entities
  //   that have a '@odata.contained' association pointing to the containee). Note that this
  //   may be multiple entities, possibly including the container itself.
  // - All associations in the containee pointing back to the container are marked with
  //   a boolean property '_isToContainer : true', except if the association itself
  //   has the annotation '@odata.contained' (indicating the top-down link in a hierarchy).
  // - Rewrite annotations that would be assigned to the containees entity set for the
  //   non-containment rendering. If containment rendering is active, the containee has no
  //   entity set. Instead try to rewrite the annotation in such a way that it is effective
  //   on the containment navigation property.
  // $containeeAssociations stores the containees (children/outbound edges)
  // $containerNames stores the containers (parents/inbound edges)

  function initContainments( container ) {
    if (container.kind === 'entity') {
      if (!container.$containeeAssociations)
        setProp(container, '$containeeAssociations', []);
      forEachMemberRecursively(container, eachAssoc,
                               [], true, { pathWithoutProp: true, elementsOnly: true });
    }

    function eachAssoc( elt, _memberName, _prop, path ) {
      if (elt.target && elt['@odata.contained']) {
        // store all containment associations, required to create the containment paths later on
        container.$containeeAssociations.push( { assoc: elt, path });
        // Let the containee know its container
        // (array because the contanee may contained more then once)
        const containee = elt._target;
        if (!containee.$containerNames)
          setProp(containee, '$containerNames', []);
        // add container only once per containee
        if (!containee.$containerNames.includes(container.name))
          containee.$containerNames.push(container.name);
        // Mark associations in the containee pointing to the container (i.e. to this entity)
        forEachMemberRecursively(containee, markToContainer,
                                 [ 'definitions', containee.name ], true, { elementsOnly: true });
      }
      else if (elt.type && !elt.elements) {
        // try to find elements to drill down further
        while (elt && !isBuiltinType(elt.type) && !elt.elements)
          elt = csn.definitions[elt.type];

        if (elt && elt.elements && !elt.$visited) {
          setProp(elt, '$visited', true);
          forEachMemberRecursively(elt, eachAssoc,
                                   path, true, { pathWithoutProp: true, elementsOnly: true });
          delete elt.$visited;
        }
      }
    }

    function markToContainer( elt ) {
      if (elt._target && elt._target.name) {
        // If this is an association that points to the container (but is not by itself contained,
        // which would indicate the top role in a hierarchy) mark it with '_isToContainer'
        if (elt._target.name === container.name && !elt['odata.contained'])
          setProp(elt, '_isToContainer', true);
      }
      else {
        // try to find elements to drill down further
        while (elt && !(isBuiltinType(elt.type) || elt.elements))
          elt = csn.definitions[elt.type];

        if (elt && elt.elements && !elt.$visited) {
          setProp(elt, '$visited', true);
          forEachMemberRecursively(elt, markToContainer,
                                   [], true, { elementsOnly: true });
          delete elt.$visited;
        }
      }
    }
  }

  // Split an entity with parameters into two entity types with their entity sets,
  // one named <name>Parameter and one named <name>Type. Parameter contains Type.
  // Containment processing must take place before because it might be that this
  // artifact with parameters is already contained. In such a case the existing
  // containment chain must be propagated and reused. This requires that the
  // containment data structures must be manually added here.
  // As a param entity is a potential proxy candidate, this split must be performed on
  // all definitions
  function initParameterizedEntityOrView( entityCsn, entityName ) {
    if (!edmUtils.isParameterizedEntity(entityCsn))
      return;

    // Naming rules for aggregated views with parameters
    // Parameters: EntityType <ViewName>Parameters, EntitySet <ViewName>
    //             with NavigationProperty "Results" pointing to the entity set of type <ViewName>Result
    // Result:     EntityType <ViewName>Result, EntitySet <ViewName>Results

    // Naming rules for non aggregated views with parameters
    // Parameters: EntityType <ViewName>Parameters, EntitySet <ViewName>
    //             with NavigationProperty "Set" pointing to the entity set of type <ViewName>Type
    // Result:     EntityType <ViewName>Type, EntitySet <ViewName>Set
    //             Backlink Navigation Property "Parameters" to <ViewName>Parameters

    // this code can be extended for aggregated views
    const typeEntityName = `${ entityName }Type`;
    const typeEntitySetName = `${ entityName }Set`;
    const typeToParameterAssocName = 'Parameters';
    const hasBacklink = true;


    // create the Parameter Definition
    const parameterCsn = createParameterEntity(entityCsn, entityName, false);
    setProp(parameterCsn, '_origin', entityCsn);
    // create the Type Definition
    // modify the original parameter entity with backlink and new name
    if (csn.definitions[typeEntityName])
      error('odata-duplicate-definition', [ 'definitions', entityName ], { '#': 'std', name: typeEntityName });
    else
      entityCsn.name = typeEntityName;
    setProp(entityCsn, '$entitySetName', typeEntitySetName);
    // add backlink association
    if (hasBacklink) {
      entityCsn.elements[typeToParameterAssocName] = {
        name: typeToParameterAssocName,
        target: parameterCsn.name,
        type: 'cds.Association',
        on: [ { ref: [ 'Parameters', 'Set' ] }, '=', { ref: [ '$self' ] } ],
      };
      setProp(entityCsn.elements[typeToParameterAssocName], '_selfReferences', []);
      setProp(entityCsn.elements[typeToParameterAssocName], '_target', parameterCsn);
      setProp(entityCsn.elements[typeToParameterAssocName], '$path',
              [ 'definitions', entityName, 'elements', typeToParameterAssocName ] );
    }

    /*
  <EntitySet Name="ZRHA_TEST_CDSSet" EntityType="ZRHA_TEST_CDS_CDS.ZRHA_TEST_CDSType" sap:creatable="false" sap:updatable="false"
             sap:deletable="false" sap:addressable="false" sap:content-version="1"/>
*/
    edmUtils.assignProp(entityCsn, '_SetAttributes',
                        {
                          '@sap.creatable': false, '@sap.updatable': false, '@sap.deletable': false, '@sap.addressable': false,
                        });

    // redirect inbound associations/compositions to the parameter entity
    Object.keys(entityCsn.$sources || {}).forEach((n) => {
      // preserve the original target for constraint calculation
      setProp(entityCsn.$sources[n], '_originalTarget', entityCsn.$sources[n]._target);
      entityCsn.$sources[n]._target = parameterCsn;
    });
  }

  function createParameterEntity( entityCsn, entityName, isProxy ) {
    const parameterEntityName = `${ entityName }Parameters`;
    const parameterToTypeAssocName = 'Set';

    // Construct the parameter entity
    const parameterCsn = {
      name: parameterEntityName,
      kind: 'entity',
      elements: Object.create(null),
      '@sap.semantics': 'parameters',
    };
    if (!isProxy)
      setProp(parameterCsn, '$entitySetName', entityName);
    if (entityCsn.$location)
      edmUtils.assignProp(parameterCsn, '$location', entityCsn.$location);


    /*
      <EntitySet Name="ZRHA_TEST_CDS" EntityType="ZRHA_TEST_CDS_CDS.ZRHA_TEST_CDSParameters" sap:creatable="false" sap:updatable="false"
                 sap:deletable="false" sap:pageable="false" sap:content-version="1"/>
    */

    edmUtils.assignProp(parameterCsn, '_SetAttributes',
                        {
                          '@sap.creatable': false, '@sap.updatable': false, '@sap.deletable': false, '@sap.pageable': false,
                        });

    setProp(parameterCsn, '$isParamEntity', true);
    setProp(parameterCsn, '$mySchemaName', entityCsn.$mySchemaName);

    forEachGeneric(entityCsn, 'params', (p, n) => {
      const elt = cloneCsnNonDict(p, options);
      elt.name = n;
      delete elt.kind;
      setProp(elt, '$path', [ 'definitions', parameterEntityName, 'elements', n ]);
      elt.key = true; // params become primary key in parameter entity
      /*
        Spec meeting decision 28.02.22:
        Annotation @sap.parameter allows two values "mandatory"/"optional".
        Question was how to deal with incompatible "optional".
        Only "mandatory" is allowed because in RAP all parameters are NOT NULL
        and so they are in CAP (all view parameters become primary keys which are not null).
      */
      if (options.isV2())
        edmUtils.assignAnnotation(elt, '@sap.parameter', 'mandatory');
      else
        edmUtils.assignAnnotation(elt, '@Common.FieldControl', { '#': 'Mandatory' });
      parameterCsn.elements[n] = elt;
    });
    linkAssociationTarget(parameterCsn);
    initContainments(parameterCsn);
    // add assoc to result set, FIXME: is the cardinality correct?
    if (!isProxy) {
      parameterCsn.elements[parameterToTypeAssocName] = {
        '@odata.contained': true,
        name: parameterToTypeAssocName,
        target: entityCsn.name,
        type: 'cds.Association',
        cardinality: { src: 1, min: 0, max: '*' },
      };
      setProp(parameterCsn.elements[parameterToTypeAssocName], '_target', entityCsn);
      setProp(parameterCsn.elements[parameterToTypeAssocName], '$path',
              [ 'definitions', parameterEntityName, 'elements', parameterToTypeAssocName ] );
    }

    [ '@odata.singleton', '@odata.singleton.nullable' ].forEach((a) => {
      if (entityCsn[a] != null)
        parameterCsn[a] = entityCsn[a];
      delete entityCsn[a];
    });

    // initialize containment
    // propagate containment information, if containment is recursive, use parameterCsn.name as $containerNames
    if (entityCsn.$containerNames) {
      if (!parameterCsn.$containerNames)
        setProp(parameterCsn, '$containerNames', []);
      for (const c of entityCsn.$containerNames)
        parameterCsn.$containerNames.push((c === entityCsn.name) ? parameterCsn.name : c);
    }
    entityCsn.$containerNames = [ parameterCsn ];

    if (!parameterCsn.$containeeAssociations)
      setProp(parameterCsn, '$containeeAssociations', [ ]);
    parameterCsn.$containeeAssociations.push(
      {
        assoc: parameterCsn.elements[parameterToTypeAssocName],
        path: [ parameterToTypeAssocName ],
      }
    );

    // rewrite $path
    setProp(parameterCsn, '$path', [ 'definitions', parameterEntityName ]);

    // proxies are registered in model separately
    if (!isProxy) {
      if (csn.definitions[parameterCsn.name]) {
        error('odata-duplicate-definition', [ 'definitions', entityName ], { '#': 'std', name: parameterCsn.name });
      }
      else {
        csn.definitions[parameterCsn.name] = parameterCsn;
        reqDefs.definitions[parameterCsn.name] = parameterCsn;
      }
    }
    return parameterCsn;
  }

  function initElement( element, name, struct ) {
    setProp(element, 'name', name);
    setProp(element, '_parent', struct);
  }

  // convert $path to path starting at main artifact
  function $path2path( p ) {
    const path = [];
    /** @type {any} */
    let env = csn;
    for (let i = 0; p && env && i < p.length; i++) {
      const ps = p[i];
      env = env[ps];
      if (env && env.constructor === Object) {
        path.push(ps);
        // jump over many items but not if this is an element
        if (env.items) {
          env = env.items;
          if (p[i + 1] === 'items')
            i++;
        }
        if (env.type && !isBuiltinType(env.type) && !env.elements)
          env = csn.definitions[env.type];
      }
    }
    return path;
  }

  // Initialize a structured artifact
  function initStructure( def ) {
    // Don't operate on any structured types other than type and entity
    // such as events and aspects
    if (!edmUtils.isStructuredArtifact(def))
      return;

    const keys = Object.create(null);
    // eslint-disable-next-line
    const validFrom = [];
    const validKey = [];

    // Iterate all struct elements
    forEachMemberRecursively(def.items || def, (element, elementName, prop, _path, construct) => {
      if (prop !== 'elements')
        return;

      initElement(element, elementName, construct);

      // collect temporal information
      if (element['@cds.valid.key'])
        validKey.push(element);

      if (element['@cds.valid.from'])
        validFrom.push(element);

      // forward annotations from managed association element to its foreign keys
      const elements = construct.items?.elements || construct.elements;
      const assoc = elements[element['@odata.foreignKey4']];
      if (assoc) {
        Object.keys(assoc).filter(pn => pn[0] === '@' && !findAnnotationExpression(assoc, pn)).forEach((pn) => {
          edmUtils.assignAnnotation(element, pn, assoc[pn]);
        });
      }
      // and eventually remove some afterwards
      if (options.isV2())
        edmAnnoPreproc.setSAPSpecificV2AnnotationsToAssociation(element);

      const absPath = $path2path(element.$path);

      // initialize an association
      if (element.target) {
        // in case this is a forward assoc, store the backlink partners here, _selfReferences.length > 1 => error
        edmUtils.assignProp(element, '_selfReferences', []);
        edmUtils.assignProp(element._target, '$proxies', []);
        // $abspath is used as partner path
        edmUtils.assignProp(element, '$abspath', absPath);
      }
      // Collect keys
      if (element.key)
        keys[elementName] = element;

      edmAnnoPreproc.applyAppSpecificLateCsnTransformationOnElement(options, element, def, error);
    }, [], true, { elementsOnly: true });

    // if artifact has a cds.valid.key mention it as @Core.AlternateKey
    if (validKey.length) {
      const altKeys = [ { Key: [] } ];
      validKey.forEach(vk => altKeys[0].Key.push( { Name: vk.name, Alias: vk.name } ) );
      edmUtils.assignAnnotation(def, '@Core.AlternateKeys', altKeys);
    }

    // prepare the structure itself
    if (def.kind === 'entity') {
      edmUtils.assignProp(def, '_SetAttributes', Object.create(null));
      edmUtils.assignProp(def, '$keys', keys);
      edmAnnoPreproc.applyAppSpecificLateCsnTransformationOnStructure(options, def, error);
      edmAnnoPreproc.setSAPSpecificV2AnnotationsToEntitySet(options, def);
    }
  }

  // Prepare the associations for the subsequent steps
  function initConstraints( def ) {
    if (!edmUtils.isStructuredArtifact(def))
      return;

    forEachMemberRecursively(def.items || def, initConstraintsOnAssoc, [], true, { elementsOnly: true });
  }
  function initConstraintsOnAssoc( element ) {
    if (element.target && !element._constraints) {
      // setup the constraints object
      setProp(element, '_constraints', {
        constraints: Object.create(null), selfs: [], _origins: [], termCount: 0,
      });
      // and crack the ON condition
      edmUtils.resolveOnConditionAndPrepareConstraints(csn, element, messageFunctions);
    }
  }

  /*
    Do not render (ignore) elements as properties
    In V4:
    1) If this is a foreign key of an association to a container which *is* used
       to establish the relation via composition and $self comparison.
       The $self comparison can only be evaluated after the ON conditions have been
       parsed in prepareConstraints().
    2) For all other foreign keys let isEdmPropertyRendered() decide.
    3) If an element/association is annotated with @odata.containment.ignore and containment is
       active, assign @cds.api.ignore or @odata.navigable: false
    4) All of this can be revoked with options.renderForeignKeys.
  */
  function ignoreProperties( struct ) {
    if (!edmUtils.isStructuredArtifact(struct))
      return;

    forEachMemberRecursively(struct.items || struct, (element) => {
      if (!element.target) {
        if (element['@odata.foreignKey4']) {
          let isContainerAssoc = false;
          let { elements } = struct.items || struct;
          let assoc;
          const paths = element['@odata.foreignKey4'].split('.');
          for (const p of paths) {
            assoc = elements[p];
            if (assoc) // could be that the @odata.foreignKey4 was propagated...
              elements = assoc.elements;
          }

          if (assoc)
            isContainerAssoc = !!(assoc._isToContainer && assoc._selfReferences.length || assoc['@odata.contained']);
            /*
              If this foreign key is NOT a container fk, let isEdmPropertyRendered() decide
              Else, if fk is container fk, omit it if it wasn't requested in structured mode
            */
          if ((!isContainerAssoc && !isEdmPropertyRendered(element, options)) ||
               (isContainerAssoc && !options.renderForeignKeys))
            edmUtils.assignAnnotation(element, '@cds.api.ignore', true);
          // Only in containment:
          // If this element is a foreign key and if it is rendered, remove it from the key ref vector (if available)
          else if (options.odataContainment &&
                  isContainerAssoc &&
                  options.renderForeignKeys &&
                  struct.$keys)
            delete struct.$keys[element.name];
        }
        // Only in containment:
        // Ignore this (foreign key) element if renderForeignKeys is false
        if (options.odataContainment && element['@odata.containment.ignore']) {
          if (!options.renderForeignKeys)
            edmUtils.assignAnnotation(element, '@cds.api.ignore', true);
          else if (struct.$keys)
            // If foreign keys shall be rendered, remove it from key ref vector (if available)
            delete struct.$keys[element.name];
        }
      }
      // it's an association
      else if (element['@odata.containment.ignore'] && options.odataContainment && !options.renderForeignKeys) {
        // if this is an explicitly containment ignore tagged association,
        // ignore it if option odataContainment is true and no foreign keys should be rendered
        edmUtils.assignAnnotation(element, '@odata.navigable', false);
      }
    }, [], true, { elementsOnly: true });
  }

  /*
    Calculate the final referential constraints based on the assignments done in mutePropertiesForV4()
    It may be that now a number of properties are not rendered and cannot act as constraints (see isConstraintCandidate())
    in edmUtils
  */
  function finalizeConstraints( def ) {
    if (!edmUtils.isStructuredArtifact(def))
      return;

    forEachMemberRecursively(def.items || def, finalizeConstraintsOnAssoc, [], true, { elementsOnly: true });
  }
  function finalizeConstraintsOnAssoc( element ) {
    if (element.target && element._constraints) {
      edmUtils.finalizeReferentialConstraints(csn, element, options, info);

      if (element._constraints?._partnerCsn) {
        // if this is a partnership and this assoc has a set target cardinality, assign it as source cardinality to the partner
        if (element._constraints._partnerCsn.cardinality) {
          // if the forward association has set a src cardinality and it deviates from the backlink target cardinality raise a warning
          // in V2 only, in V4 the source cardinality is rendered implicitly at the Type property
          if (element._constraints._partnerCsn.cardinality.src) {
            const partnerCsn = element._constraints._partnerCsn;
            // eslint-disable-next-line eqeqeq
            const srcMult = (partnerCsn.cardinality.src == 1) ? '0..1' : '*';
            const newMult
              = (element.cardinality?.min == 1 && element.cardinality?.max == 1) // eslint-disable-line eqeqeq
                ? 1
                : (element.cardinality?.max === '*' || element.cardinality?.max > 1)
                  ? '*'
                  : '0..1';
            if (srcMult !== newMult) {
              // TODO: Message should probably list actual cardinalities and not "normalized" ones.
              warning('odata-unexpected-cardinality', element.$path, {
                value: srcMult,
                othervalue: newMult,
                name: `${ partnerCsn._parent.name }/${ partnerCsn.name }`,
              }, 'Explicit source cardinality $(VALUE) of $(NAME) conflicts with target cardinality $(OTHERVALUE)' );
            }
          }
          else {
            // .. but only if the original assoc hasn't set src yet
            element._constraints._partnerCsn.cardinality.src = element.cardinality?.max ? element.cardinality.max : 1;
            if (element.cardinality?.min !== undefined && element._constraints._partnerCsn.cardinality?.srcmin === undefined)
              element._constraints._partnerCsn.cardinality.srcmin = element.cardinality.min;
          }
        }
        else {
          element._constraints._partnerCsn.cardinality = { src: element.cardinality?.max ? element.cardinality.max : 1 };
          if (element.cardinality?.min !== undefined)
            element._constraints._partnerCsn.cardinality.srcmin = element.cardinality.min;
        }
      }
      setProp(element._constraints, '$finalized', true);
    }
  }

  /*
    convert sub schemas that represent another service into a service reference object and remove all
    sub artifacts exposed by the initial type exposure
  */
  function convertExposedTypesOfOtherServicesIntoCrossReferences() {
    if (options.odataXServiceRefs && options.isV4()) {
      serviceRootNames.forEach((srn) => {
        schemaNames.forEach((fqSchemaName) => {
          if (fqSchemaName.startsWith(`${ srn }.`)) {
            const targetSchemaName = fqSchemaName.replace(`${ srn }.`, '');
            if (serviceRootNames.includes(targetSchemaName)) {
              // remove all definitions starting with < fqSchemaName >. and add a schema reference
              forEachKey(csn.definitions, (dn) => {
                if (dn.startsWith(fqSchemaName)) {
                  delete csn.definitions[dn];
                  delete reqDefs.definitions[dn];
                }
              });
              if (!schemas[fqSchemaName])
                schemaNames.push(fqSchemaName);
              schemas[fqSchemaName] = edmUtils.createSchemaRef(serviceRoots, targetSchemaName);
            }
          }
        });
      });
    }
    schemaNames.sort((a, b) => b.length - a.length);
  }

  /*
      If an association targets an artifact outside the service, expose the target entity type
      as proxy.

      A proxy represents the identity (or primary key tuple) of the target entity.

      All proxies are registered in a sub context representing the schema, in which the proxy
      is to be rendered (see csn2edm for details).

      If the target resides outside any service, the schema is either it's CDS namespace if provided
      or as 'root'.

      If the target resides in another service, either a schema named by the target service is
      created (option: odataProxies), or a reference object is created representing the target
      service (option: odataExtReferences).

      If option odataExtReferences is used, 'root' proxies are still created.

      If the association leading to the proxy candidate refers to associations either directly
      or indirectly (via structured elements), these dependent entity types are (recursively) exposed
      (or referenced) as well to keep the navigation graph in tact.
  */
  function exposeTargetsAsProxiesOrSchemaRefs( struct ) {
    if (struct.kind === 'context' || struct.kind === 'service' || struct.$proxy)
      return;

    // globalSchemaPrefix is the prefix for all proxy registrations and must not change
    // the service prefix is checked without '.' because we also want to inspect those
    // definitions which are directly below the root service ($mySchemaName is the root)
    const globalSchemaPrefix = whatsMyServiceRootName(struct.$mySchemaName);
    // if this artifact is a service member check its associations
    if (globalSchemaPrefix) {
      forEachGeneric(struct.items || struct, 'elements', (element) => {
        if (!edmUtils.isNavigable(element))
          return;
        /*
         * Consider everything @cds.autoexpose: falsy to be a proxy candidate for now
         */
        /*
        if(element._target['@cds.autoexpose'] === false) {
          // :TODO: Also ignore foreign keys to association?
          edmUtils.foreach(struct.elements,
            e =>
              e['@odata.foreignKey4'] === element.name,
            e => e.$ignore = true);
          element.$ignore = true;
          info(null, ['definitions', struct.name, 'elements', element.name]
            `${element.type.replace('cds.', '')} "${element.name}" excluded,
              target "${element._target.name}" is annotated '@cds.autoexpose: ${element._target['@cds.autoexpose']}'`
            );
          return;
        }
        */
        // Create a proxy if the source schema and the target schema are different
        // That includes that the target doesn't have a schema.
        // If the target is in another schema, check if both the source and the target share the same service name.
        // If they share the same service name, then it is just a cross schema navigation within the same EDM, no
        // proxy required.
        // association must be managed and not unmanaged

        // odataProxies (P) and odataXServiceRefs (X) are evaluated as follows:
        // P | X | Action
        // 0 | 0 | No out bound navigation
        // 0 | 1 | Cross service references are generated
        // 1 | 0 | Proxies for all out bound navigation targets are created
        // 1 | 1 | Cross service references and proxies are generated

        const targetSchemaName = element._target.$mySchemaName;
        if (isProxyRequired(element)) {
          if (options.isV4() && (options.odataProxies || options.odataXServiceRefs)) {
            // must be a managed association with keys OR an unambiguous backlink to become a proxy
            const assocOK = element.keys ||
             (element.on && element._constraints.selfs.length === 1 && element._constraints.termCount === 1);
            // reuse proxy if available
            let proxy = getProxyForTargetOf(element);
            if (!proxy) {
              if (targetSchemaName && options.odataXServiceRefs)
                proxy = createSchemaRefFor(targetSchemaName);

              // create a proxy for a 'good' association only
              else if (options.odataProxies && assocOK)
                proxy = createProxyFor(element, targetSchemaName);

              proxy = registerProxy(proxy, element);
            }
            else if (!assocOK) {
              // if there is already a proxy (generated by a 'good' association)
              // and this association is not a good one, don't expose this association.
              muteNavProp(element, 'onCond');
              return;
            }
            if (proxy) {
            // if a proxy was either already created or could be created and
            // if it's a 'real' proxy, link the _target to it and remove constraints
            // otherwise proxy is a schema reference, then do nothing
              setProp(element, '$noPartner', true);
              element._constraints.constraints = Object.create(null);
              if (proxy.kind === 'entity') {
                if (!proxy.$isParamEntity)
                  populateProxyElements(element, proxy, getForeignKeyDefinitions(element));
                element._target = proxy;
              }
              else {
                // No navigation property bindings on external references
                setProp(element, '$externalRef', true);
              }
            }
            else {
              muteNavProp(element, assocOK ? 'std' : 'onCond');
              return;
            }
          }
          else {
            muteNavProp(element);
            return;
          }
        }
      });
    }

    function muteNavProp( elt, msg = 'std' ) {
      edmUtils.assignAnnotation(elt, '@odata.navigable', false);
      if (elt._target['@cds.autoexpose'] !== false) {
        warning('odata-navigation', elt.$path,
                { target: elt._target.name, service: globalSchemaPrefix, '#': msg });
      }
    }

    function createSchemaRefFor( targetSchemaName ) {
      let ref = csn.definitions[`${ globalSchemaPrefix }.${ targetSchemaName }`];
      if (!ref)
        ref = edmUtils.createSchemaRef(serviceRoots, targetSchemaName);


      return ref;
    }

    function createProxyFor( assoc, targetSchemaName ) {
      // If target is outside any service expose it in service of source entity
      // The proxySchemaName is not prepended with the service schema name to allow to share the proxy
      // if it is required in multiple services. The service schema name is prepended upon registration
      const proxySchemaName = targetSchemaName || edmUtils.getSchemaPrefix(assoc._target.name);

      // if the target is a parameter entity, it's easy just create the parameter stub
      const isParamProxy = edmUtils.isParameterizedEntity(assoc._target);

      // 1) construct the proxy definition
      // proxyDefinitionName: strip the serviceName and replace '.' with '_'
      const defName
        = `${ assoc._target.name.replace(`${ proxySchemaName }.`, '').replace(/\./g, '_') }`;

      // fullName: Prepend serviceName and if in same service add '_proxy'
      const proxy = isParamProxy
        ? createParameterEntity(assoc._target, `${ proxySchemaName }.${ defName }`, true)
        : { name: `${ proxySchemaName }.${ defName }`, kind: 'entity', elements: Object.create(null) };

      // Final proxyShortName for all further processing
      const proxyShortName = defName + (isParamProxy ? 'Parameters' : '');

      setProp(proxy, '$proxy', true);
      setProp(proxy, '$mySchemaName', proxySchemaName);
      setProp(proxy, '$proxyShortName', proxyShortName);
      setProp(proxy, '$keys', Object.create(null));
      setProp(proxy, '$hasEntitySet', false);
      setProp(proxy, '$exposedTypes', Object.create(null));
      // copy all annotations of the target to the proxy
      forEach(assoc._target, ( k, v ) => {
        if (k[0] === '@' && k !== '@open')
          proxy[k] = v;
      });

      // 2) create the elements and $keys
      if (isParamProxy) {
        // Reset param proxy elements to expose element tree
        const { elements } = proxy;
        proxy.elements = Object.create(null);
        populateProxyElements(assoc, proxy, elements);
      }
      else {
        populateProxyElements(assoc, proxy, assoc._target.$keys);
      }
      return proxy;
    }

    // Return top level foreign key element definitions. The full top level
    // element is exposed instead of merging partial trees into the exposed type
    // def structure.
    function getForeignKeyDefinitions( e ) {
      return e.keys ? e.keys.map(fk => e._target.elements[fk.ref[0]]) : [];
    }

    // copy over the primary keys of the target and trigger the type exposure
    // if the element already exists we assume it was fully exposed
    function populateProxyElements( assoc, proxy, elements ) {
      Object.values(elements).forEach((e) => {
        if (isEdmPropertyRendered(e, options)) {
          let newElt = proxy.elements[e.name];
          if (!newElt) {
            if (csnUtils.isAssocOrComposition(e)) {
              if (!e.on && e.keys) {
                newElt = createProxyOrSchemaRefForManagedAssoc(e);
              }
              else {
                info(null, [ 'definitions', struct.name, 'elements', assoc.name ],
                     { name: proxy.nname, target: assoc._target.name },
                     'Unmanaged associations are not supported as primary keys for proxy entity type $(NAME) of unexposed association target $(TARGET)');
              }
            }
            else {
              newElt = Object.create(null);
              forEachKey(e, (prop) => {
                newElt[prop] = e[prop];
              });
            }
            if (newElt) {
              initElement(newElt, e.name, proxy);
              proxy.elements[newElt.name] = newElt;

              if (csnUtils.isStructured(newElt)) {
                // argument proxySchemaName forces an anonymous type definition for newElt into the
                // proxy schema. If omitted, this exposure defaults to 'root', in case API flavor
                // of the day changes...
                exposeStructTypeForProxyOf(newElt, `${ proxy.$proxyShortName }_${ newElt.name }`,
                                           proxy.$mySchemaName, newElt.key, !!(newElt.key && newElt.elements));
              }
              if (newElt.key)
                proxy.$keys[newElt.name] = newElt;
            }
          }
        }
      });
      // 3) sort the exposed types so that they appear lexicographically ordered in the EDM
      proxy.$exposedTypes = Object.keys(proxy.$exposedTypes).sort().reduce((dict, tn) => {
        dict[tn] = proxy.$exposedTypes[tn];
        return dict;
      }, Object.create(null));

      // If 'node' exists and has a structured type that is not exposed in 'service', (because the type is
      // anonymous or has a definition outside of 'service'), create an equivalent type in 'service', either
      // using the type's name or (if anonymous) 'artificialName', and make 'node' use that type instead.
      // Complain if there is an error.
      // isKey: Indicates top level element is key or not
      // forceToNotNull: if top level element is key, recursively set all anonymously exposed elements
      // to notNull until the first named type is exposed.
      function exposeStructTypeForProxyOf( node, artificialName,
                                           typeSchemaName = fallBackSchemaName,
                                           isKey = false, forceToNotNull = false ) {
        if (node.type && isBuiltinType(node.type))
          return;

        // Always expose types referred to by a proxy, never reuse an eventually existing type
        // as the nested elements must all be not nullable
        // elements have precedence over type
        const typeDef = !node.elements && node.type ? csn.definitions[node.type] : node;

        if (typeDef) {
          let typeClone;
          // the type clone must be produced for each service as this type may
          // produce references and/or proxies into multiple services
          // (but only once per service, therefore cache it).
          if (typeDef.$proxyTypes && typeDef.$proxyTypes[globalSchemaPrefix]) {
            // if type has been exposed in a schema use this type
            typeClone = typeDef.$proxyTypes[globalSchemaPrefix];
          }
          else {
            // Set the correct name
            let typeId = artificialName; // the artificialName has no namespace, it's the element
            if (node.type) {
              // same as for proxies, use schema or namespace, 'root' is last resort
              typeSchemaName = typeDef.$mySchemaName || edmUtils.getSchemaPrefix(node.type);
              typeId = node.type.replace(`${ typeSchemaName }.`, '').replace(/\./g, '_');
              // strip the service root of that type (if any)
              const myServiceRootName = whatsMyServiceRootName(typeSchemaName);
              if (myServiceRootName)
                typeSchemaName = typeSchemaName.replace(`${ myServiceRootName }.`, '');
            }

            if (edmUtils.isStructuredArtifact(typeDef)) {
              // pull forceNotNull to false for named types and non-key nodes
              // only toplevel nodes (elements) can be key
              forceToNotNull = !!(forceToNotNull && isKey && node.elements && !node.type);

              typeClone = cloneStructTypeForProxy(`${ typeSchemaName }.${ typeId }`);
              if (typeClone) {
                // Recurse into elements of 'type' (if any)
                if (typeClone.elements) {
                  forEach(typeClone.elements, ( elemName, elem ) => {
                  // if this is a foreign key element, we must check whether or not the association
                  // has been exposed as proxy. If it has not been exposed, no further structured
                  // types must be exposed as 'Proxy_' types.

                    // TODO: expose types of assoc.keys and don't rely on exposed foreign keys
                    if (!elem['@odata.foreignKey4'] ||
                      (elem['@odata.foreignKey4'] && !typeClone.elements[elem['@odata.foreignKey4']].$exposed)) {
                      exposeStructTypeForProxyOf(elem, `${ typeId }_${ elemName }`,
                                                 typeSchemaName, isKey, forceToNotNull);
                    }
                  });
                }
                if (!typeDef.$proxyTypes)
                  typeDef.$proxyTypes = Object.create(null);
                typeDef.$proxyTypes[globalSchemaPrefix] = typeClone;
              }
            }
            else {
              // FUTURE: expose scalar type definition as well
            }
          }
          if (typeClone) {
            // register the type clone at the proxy
            // Reminder: Each proxy receives a full set of type clones, even if the types are shared
            // (no scattered type clone caching). registerProxy() checks if a clone needs to be added to
            // csn.definitions.
            proxy.$exposedTypes[typeClone.name] = typeClone;

            // set the node's new type name
            node.type = typeClone.name;
            // the key path generator must use the type clone directly, because it can't resolve
            // the type clone in the CSN (its name is the final name and not the definition name).
            setProp(node, '_type', typeClone);
            // Hack alert:
            // beta feature 'subElemRedirections' (now the default in v2) adds elements to the node by
            // default, without we must do it to get the primary key tuple calculation correct.
            // Remember: node.type is the service local type name (not prepended by the service name),
            // so it can't be resolved in definitions later on
            if (typeClone.elements)
              node.elements = typeClone.elements;
          }
        }

        function cloneStructTypeForProxy( name ) {
          // Create type with empty elements
          const type = {
            kind: 'type',
            name,
            elements: Object.create(null),
          };
          setProp(type, '$mySchemaName', typeSchemaName);
          setProp(type, '$exposedBy', 'proxyExposure');
          if (typeDef['@open'] !== undefined)
            type['@open'] = typeDef['@open'];

          if (typeDef.elements) {
            forEach(typeDef.elements, ( elemName, elem ) => {
              if (!elem.target) {
                type.elements[elemName] = Object.create(null);
                forEachKey(elem, (prop) => {
                  type.elements[elemName][prop] = elem[prop];
                });
              }
              else if (elem.keys && !elem.on) {
                // a primary key can never be an unmanaged association
                type.elements[elemName] = createProxyOrSchemaRefForManagedAssoc(elem);
              }
              if (forceToNotNull) {
                const newElt = type.elements[elemName];
                if (newElt.target) {
                  if (newElt.cardinality === undefined)
                    newElt.cardinality = {};
                  newElt.cardinality.min = 1;
                }
                // if odata-unexpected-nullable-key is checking on min>1, this can be an else
                newElt.notNull = true;
              }
              setProp(type.elements[elemName], 'name', elem.name);
            });
          }
          return type;
        }
      }

      // create a new element and wire the proxy as new target.
      // Create a new proxy if:
      // 1) source and target schema names are different (otherwise)
      //    the proxy that is just being created targets back into
      //    its own serice
      // 2) or if no proxy for this source schema has been created yet
      function createProxyOrSchemaRefForManagedAssoc( e ) {
        let newProxy = e._target;
        const newElt = cloneCsnNonDict(e, options);

        if (isProxyRequired(e)) {
          newProxy = getProxyForTargetOf(e);
          if (!newProxy) {
            // option odataXServiceRefs has precedence over odataProxies
            if (e._target.$mySchemaName && options.odataXServiceRefs) {
              newProxy = createSchemaRefFor(e._target.$mySchemaName);
            }
            else if (options.odataProxies) {
              newProxy = createProxyFor(e, e._target.$mySchemaName);
              if (!e._target.$isParamEntity)
                populateProxyElements(e, newProxy, getForeignKeyDefinitions(e));
            }
            newProxy = registerProxy(newProxy, e);
          }
        }
        if (!newProxy) {
          newProxy = e._target;
          // no proxy: no navigation
          edmUtils.assignAnnotation(newElt, '@odata.navigable', false);
        }
        // either the proxy has exposed the type or
        // the assoc doesn't need to be exposed, so don't
        // try to drill further down in this type clone
        setProp(newElt, '$exposed', true);
        // _target must be set with (original) in case
        // a schema ref has been created
        setProp(newElt, '$noPartner', true);
        setProp(newElt, '_target', e._target);
        initConstraintsOnAssoc(e);
        finalizeConstraintsOnAssoc(e);
        setProp(newElt, '_constraints', e._constraints);
        setProp(newElt, '_selfReferences', []);
        if (newProxy.kind === 'entity') {
          newElt.target = newProxy.name;
          setProp(newElt, '_target', newProxy);
        }
        return newElt;
      }
    }

    /*
      A proxy is required if the source and the target schemas differ.
      However, if two schemas are below the same root/top level service,
      these schemas are always exposed in the same Edm/DataServices. In
      this case no proxy is required. (This is especially true, if we
      decide to allow user defined schemas aka services with contexts)

      Example:

      service S {
        context T {
          entity A { ...; toB: association to S.B; };
        }
        entity B { ...; toA: association to S.T.A; };
      }

      In CSN the entity definitions are named 'S.T.A' and 'S.B', sharing
      the same service name 'S', which implies that they are always exposed
      in the same Edm => no proxy required.
    */
    function isProxyRequired( element ) {
      const targetSchemaName = element._target.$mySchemaName;
      // longest match for service name
      return (!element._target.$proxy && globalSchemaPrefix !== targetSchemaName)
        ? (!((targetSchemaName &&
          globalSchemaPrefix === whatsMyServiceRootName(targetSchemaName)))) : false;
    }

    // read a proxy from the elements target
    function getProxyForTargetOf( element ) {
      return element._target.$cachedProxy && element._target.$cachedProxy[globalSchemaPrefix];
    }

    // register the proxy at the elements target
    function registerProxy( proxy, element ) {
      if (proxy === undefined)
        return undefined;

      setProp(proxy, '$globalSchemaPrefix', globalSchemaPrefix);
      setProp(proxy, '$origin', element);

      const fqProxyName = `${ proxy.$globalSchemaPrefix }.${ proxy.name }`;

      if (!element._target.$cachedProxy)
        edmUtils.assignProp(element._target, '$cachedProxy', Object.create(null));
      if (getProxyForTargetOf(element)) {
        info(null, [ 'definitions', struct.name, 'elements', element.name ],
             { name: fqProxyName }, 'Proxy EDM entity type $(NAME) has already been registered');
      }
      else {
        determineEntitySet(proxy);
        proxyCache.push(proxy);
        element._target.$cachedProxy[globalSchemaPrefix] = proxy;
      }
      return proxy;
    }
  }

  function mergeProxiesIntoModel() {
    proxyCache.forEach((proxy) => {
      const fqProxyName = `${ proxy.$globalSchemaPrefix }.${ proxy.name }`;
      const fqSchemaName = `${ proxy.$globalSchemaPrefix }.${ proxy.$mySchemaName }`;

      if (proxy.kind === 'entity') {
        finalizeProxyContainments(proxy);
        // collect all schemas even for newly exposed types
        // (that may reside in another subcontext schema), but only once
        const schemaSet = new Set();
        // start with the schema name for the proxy
        schemaSet.add(fqSchemaName);
        // followed by all namespaces that are potentially exposed by the exposed types
        // don't forget to prepend the global namespace prefix
        // schemas are ordered in csn2edm.js for each service
        forEachKey(proxy.$exposedTypes, t => schemaSet.add(`${ proxy.$globalSchemaPrefix }.${ edmUtils.getSchemaPrefix(t) }`));
        schemaSet.forEach((schemaName) => {
          if (!schemas[schemaName]) {
            schemas[schemaName] = { kind: 'schema', name: schemaName };
            schemaNames.push(schemaName);
          }
        });
        const alreadyRegistered = csn.definitions[fqProxyName];
        if (!alreadyRegistered) {
          csn.definitions[fqProxyName] = proxy;
          reqDefs.definitions[fqProxyName] = proxy;
          setProp(proxy, '$path', [ 'definitions', fqProxyName ]);
          forEach(proxy.$exposedTypes, ( tn, v ) => {
            const fqtn = `${ proxy.$globalSchemaPrefix }.${ tn }`;
            if (csn.definitions[fqtn] === undefined) {
              csn.definitions[fqtn] = v;
              reqDefs.definitions[fqtn] = v;
              setProp(v, '$path', [ 'definitions', fqtn ]);
            }
          });

          // default location is not always correct in case proxy has been created by a nested assoc
          // as foreign key targeting another proxy association
          let loc = [ 'definitions', proxy.$origin._parent.name, 'elements', proxy.$origin.name ];
          if (proxy.$origin._parent.$path)
            loc = [ ...proxy.$origin._parent.$path, 'elements', proxy.$origin.name ];
          info(null, loc,
               { name: proxy.name }, 'Created proxy EDM entity type $(NAME)');
        }
        else if (alreadyRegistered && !alreadyRegistered.$proxy &&
          alreadyRegistered.kind !== 'entity') {
          warning('odata-duplicate-proxy', [ 'definitions', proxy.$origin._parent.name, 'elements', proxy.$origin.name ],
                  { name: fqProxyName, kind: alreadyRegistered.kind });
        }
      }
      else if (!schemas[fqSchemaName]) {
        // it's a service reference, just add that reference proxy
        schemas[fqSchemaName] = proxy;
        schemaNames.push(fqSchemaName);
        info(null, [ 'definitions', proxy.$origin._parent.name, 'elements', proxy.$origin.name ],
             { name: proxy.name }, 'Created EDM namespace reference $(NAME)');
      }
      // don't error on duplicate schemas, if it's already present then all is good....
    });
    schemaNames.sort((a, b) => b.length - a.length);

    function finalizeProxyContainments( proxy ) {
      // initialise containments after all exposed types are collected
      // AND remove unfulfillable NavRestrictions
      initContainments(proxy);
      const assocPaths = proxy.$containeeAssociations.map(entry => entry.path.join('.'));
      const newNpr = [];
      const npr = proxy[NavResAnno];
      if (npr) {
        npr.forEach((np) => {
          const npath = np.NavigationProperty && np.NavigationProperty['='];
          if (npath && assocPaths.includes(npath))
            newNpr.push(np);
        });
      }
      if (newNpr.length)
        proxy[NavResAnno] = newNpr;

      else
        delete proxy[NavResAnno];
    }
  }

  /*
    Initialize the key ref paths into the property list
    Iterate over all keys and ignore the non-rendered elements
      * For Flat V2/V4 take all elements except associations/compositions,
        all elements are flat, no need to treat them any further
      * For Structured V4 flatten out all key elements, if the element
        is an association/composition, flatten out the foreign keys as well.
      * In Structured V4 do not render primary key 'parent' associations that
        establish the containment (_isToContainer=tue).
      * If in Structured V4, 'odataForeignKeys' is true, render all @foreignKey4,
        and do not render associations (this will include the foreign keys of
        the _isToContainer association).
  */
  function initEdmKeyRefPaths( def, defName ) {
    if (def.$keys) {
      setProp(def, '$edmKeyPaths', []);
      // for all key elements that shouldn't be ignored produce the paths
      edmUtils.foreach(def.$keys, k => !(k._isToContainer && k._selfReferences.length), (k, kn) => {
        if (isEdmPropertyRendered(k, options) &&
         !(options.isV2() && k['@Core.MediaType'])) {
          if (options.isV4() && options.isStructFormat) {
            // This is structured OData ONLY
            // if the foreign keys are explicitly requested, ignore associations and use the flat foreign keys instead
            if (!options.renderForeignKeys || (options.renderForeignKeys && !k.target))
              def.$edmKeyPaths.push(...produceKeyRefPaths(k, kn, [ 'definitions', defName, 'elements', kn ]));
          }
          // In v2/v4 flat, associations are never rendered
          else if (!k.target) {
            def.$edmKeyPaths.push([ kn ]);
          }
          // check toplevel key for spec violations
          checkKeySpecViolations(k, [ 'definitions', defName, 'elements', k.name ]);
        }
      });
    }
    /*
      Produce the list of paths for this element
      - If element is not rendered in EDM, return empty array.
      - If element is structured type, do structure flattening and then check for each
        leaf element if it is a managed association and flatten further recursively.
      - If element is a managed association, use the FK path as prefix and flatten out
        all foreign keys (eventually recursively). This filters the association itself
        to become an entry in the path array which is correct as OData doesn't allow
        navprops to be key ref.
      If element is of scalar type, return it as an array.
    */
    function produceKeyRefPaths( eltCsn, prefix, path ) {
      const keyPaths = [];
      // we want to point to the element in the entity which is the first path step
      const location = def.$path.concat([ 'elements' ]).concat(prefix.split('/')[0]);
      if (!isEdmPropertyRendered(eltCsn, options)) {
        // let annos = Object.keys(eltCsn).filter(a=>a[0]==='@').join(', ');
        // warning(null, ['definitions', struct.name, 'elements', eltCsn.name ],
        //    `${struct.name}: OData V4 primary key path: "${prefix}" is unexposed by one of these annotations "${annos}"` );
        return keyPaths;
      }
      // OData requires all elements along the path to be nullable: false (that is either key or notNull)

      let elements = eltCsn.elements || eltCsn.items?.elements;
      if (!elements) {
        const finalType = csnUtils.getFinalTypeInfo(eltCsn.items?.type || eltCsn.type);
        elements = finalType?.elements || finalType?.items?.elements;
      }
      if (elements) {
        forEach(elements, ( eltName, elt ) => {
          if (!elt.$visited) {
            setProp(elt, '$visited', true);
            let newRefs = [];
            // if the foreign keys are explicitly requested, ignore associations and use the flat foreign key instead
            // ignore nested unmanaged associations
            if ((!options.renderForeignKeys || (options.renderForeignKeys && !elt.target)) && !(elt.target && elt.on))
              newRefs = produceKeyRefPaths(elt, prefix + options.pathDelimiter + eltName, path);
            if (newRefs.length) {
              keyPaths.push(...newRefs);
              // check path step key for spec violations
              const pathSegment = `${ prefix }/${ eltName }`;
              checkKeySpecViolations(elt, location, pathSegment);
            }
            delete elt.$visited;
          }
          else {
            error('odata-key-recursive', path, { name: prefix });
          }
        });
      }
      /* If element is a managed association (can't be anything else),
         flatten foreign keys and use foreign key path as new starting prefix
         This also implies that the association itself is never added into the
         list of primary key refs
      */
      else if (eltCsn.target && !eltCsn.on) {
        // if this association has no keys or if it is a redirected parameterized entity,
        // use the primary keys of the target
        const keys = (!eltCsn._target.$isParamEntity && !eltCsn.on && (eltCsn.keys ?? [])) ||
          Object.keys(eltCsn._target.$keys).map(k => ({ ref: [ k ] }));
        let pathSegment = prefix;
        keys.forEach((k) => {
          let art = eltCsn._target || csnUtils.getCsnDef(eltCsn.target);
          for (const ps of k.ref) {
            art = art.elements[ps];
            pathSegment += `/${ art.name }`;
            checkKeySpecViolations(art, location, pathSegment);
            if (art.type && !isBuiltinType(art.type))
              art = art._type || csnUtils.getCsnDef(art.type);
          }
          if (art === eltCsn)
            error('odata-key-recursive', path, { name: prefix });
          else
            keyPaths.push(...produceKeyRefPaths(art, prefix + options.pathDelimiter + k.ref.join(options.pathDelimiter), path));
        });
      }
      else {
        keyPaths.push([ prefix ]);
      }
      return keyPaths;
    }

    function checkKeySpecViolations( elt, location, pathSegment ) {
      // Nullability
      const eltDef = elt.items || elt;
      if ((!elt.key && (eltDef.notNull === undefined || eltDef.notNull === false)) ||
           elt.key && (eltDef.notNull !== undefined && eltDef.notNull === false)) {
        message('odata-unexpected-nullable-key', location,
                { name: pathSegment || elt.name, '#': !pathSegment ? 'std' : 'scalar' });
      }
      // many is either directly on elements or on the type
      // due to added proxy types it might be that the type can't be found in definitions
      let type = elt.items ||
        (elt.type &&
        !isBuiltinType(elt.type) &&
        csn.definitions[elt.type] &&
        csnUtils.getFinalTypeInfo(elt.type).items);
      if (type ||
        (options.odataFormat !== 'flat' && !options.odataForeignKeys) &&
         elt.cardinality?.max && elt.cardinality.max !== 1) {
        // many primary key can be induced by a many parameter of a view
        message('odata-unexpected-arrayed-key', location,
                {
                  name: pathSegment || elt.name,
                  value: cardinality2str(elt),
                  '#': elt.target ? 'assoc' : 'std',
                });
      }
      // type
      if (!elt.elements) {
        if (!type)
          type = isBuiltinType(elt.type) ? elt : csn.definitions[elt.type];

        // check for legal scalar types, proxy exposed structured types are not resolvable in CSN
        // V2 allows any Edm.PrimitiveType (even Double and Binary), V4 is more specific:
        if (options.isV4() && type && !type.target && isBuiltinType(type.type)) {
          const edmType = edmUtils.mapCdsToEdmType(type, messageFunctions, _options);
          const legalEdmTypes = {
            'Edm.Boolean': 1,
            'Edm.Byte': 1,
            'Edm.Date': 1,
            'Edm.DateTimeOffset': 1,
            'Edm.Decimal': 1,
            'Edm.Duration': 1,
            'Edm.Guid': 1,
            'Edm.Int16': 1,
            'Edm.Int32': 1,
            'Edm.Int64': 1,
            'Edm.SByte': 1,
            'Edm.String': 1,
            'Edm.TimeOfDay': 1,
          };
          if (!(edmType in legalEdmTypes)) {
            message('odata-invalid-key-type', location,
                    {
                      name: pathSegment, type: type.type, id: edmType, '#': pathSegment ? 'std' : 'scalar',
                    });
          }
        }
      }
    }
  }

  /*
    Calculate all reachable entity set paths for a given navigation start point

    Rule: First non-containment association terminates Path, if association is
    containment enabling assoc, Target is own Struct/ plus the path down to the
    n-2nd path segment (which is the path to the n-1st implicit entity set).

    Example:
    entity Header {
      items: composition of many {
        toF: association to F;
        subitems: composition of many {
          toG: association to G;
          subitems: composition of many {
            toG: association to G;
          };
        }
      }
    }
    Must produce:
    Path="items/up_" Target="Header"/>
    Path="items/toF" Target="F"/>
    Path="items/subitems/up_" Target="Header/items"/>
    Path="items/subitems/toG" Target="G"/>
    Path="items/subitems/subitems/up_" Target="Header/items/subitems"/>
    Path="items/subitems/subitems/toG" Target="G"/>
  */
  function initEdmNavPropBindingTargets( def ) {
    if (def.$hasEntitySet) {
      forEachGeneric(def.items || def, 'elements', (element) => {
        produceTargetPath([ edmUtils.getBaseName(def.name) ], element, def);
      });
    }

    function produceTargetPath( prefix, elt, curDef ) {
      const newPrefix = [ ...prefix, elt.name ];
      if (isEdmPropertyRendered(elt, options)) {
        // Assoc can never be a derived TypeDefinition, no need to
        // unroll derived type chains for assocs
        if (elt.target && !elt.$visited) {
          if (!elt._target.$edmTgtPaths)
            setProp(elt._target, '$edmTgtPaths', []);
          // drill into target only if
          // 1) target has no entity set and this assoc is not going to the container
          // 2) current definition and target are the same (cycle)
          // 3) it's no external reference
          if (!elt.$externalRef &&
             !elt._target.$hasEntitySet &&
             !elt._isToContainer &&
             curDef !== elt._target) {
            // follow elements in the target but avoid cycles
            setProp(elt, '$visited', true);
            elt._target.$edmTgtPaths.push(newPrefix);
            Object.values(elt._target.elements).forEach(e => produceTargetPath(newPrefix, e, elt._target));
            delete elt.$visited;
          }
        }
        else {
          // try to find elements to drill down further
          while (elt && !(isBuiltinType(elt.type) || elt.elements))
            elt = csn.definitions[elt.type];

          if (elt && elt.elements && !elt.$visited) {
            setProp(elt, '$visited', true);
            Object.values(elt.elements).forEach(e => produceTargetPath(newPrefix, e, curDef));
            delete elt.$visited;
          }
        }
      }
    }
  }

  function initEdmNavPropBindingPaths( def ) {
    if (options.isV4() && def.$hasEntitySet) {
      let npbs = [];
      forEachGeneric(def.items || def, 'elements', (element) => {
        npbs = npbs.concat(produceNavigationPath(element, def));
      });
      setProp(def, '$edmNPBs', npbs);
    }

    // collect all paths originating from this element that end up in an entity set
    function produceNavigationPath( elt, curDef ) {
      let npbs = [];
      const prefix = elt.name;
      if (isEdmPropertyRendered(elt, options)) {
        // Assoc can never be a derived TypeDefinition, no need to
        // unroll derived type chains for assocs
        if (elt.target && !elt.$visited) {
          // drill into target only if
          // 1) target has no entity set and this assoc is not going to the container
          // 2) current definition and target are the same (cycle)
          // 3) it's no external reference
          if (!elt.$externalRef &&
             !elt._target.$hasEntitySet &&
             !elt._isToContainer &&
             curDef !== elt._target) {
            // follow elements in the target but avoid cycles
            setProp(elt, '$visited', true);
            Object.values(elt._target.elements).forEach((e) => {
              npbs = npbs.concat(produceNavigationPath(e, elt._target));
            });
            delete elt.$visited;
          }
          else if (!(options.odataContainment && options.isV4() && elt['@odata.contained'])) {
            // end point reached but must not be an external reference nor a proxy nor a composition itself
            // last assoc step must not be to-n and target a singleton
            let path;
            if (!elt.$externalRef &&
                !(edmUtils.isToMany(elt) &&
                edmUtils.isSingleton(elt._target) &&
                options.isV4())) {
              if (elt._target.$edmTgtPaths && elt._target.$edmTgtPaths.length) {
                path = elt._target.$edmTgtPaths.find(p => p[0] === edmUtils.getBaseName(def.name)) || elt._target.$edmTgtPaths[0];
              }
              else if (elt._target.$hasEntitySet) {
                const baseName = edmUtils.getBaseName(elt._target.$entitySetName || elt._target.name);
                // if own struct and target have a set they either are in the same $mySchemaName or not
                // if target is in another schema, target the full qualified entity set
                path = (elt._target.$mySchemaName === def.$mySchemaName)
                  ? [ baseName ] : [ `${ elt._target.$mySchemaName }.EntityContainer`, baseName ];
              }
              if (path) {
                // if own struct and target have a set they either are in the same $mySchemaName or not
                // if target is in another schema, target the full qualified entity set
                const npb = {
                  Path: elt.name,
                  Target: path.join('/'),
                };
                npbs.push( npb );
              }
            }
            // Do not prepend prefix here!
            return npbs;
          }
        }
        else {
          // try to find elements to drill down further
          while (elt && !(isBuiltinType(elt.type) || elt.elements))
            elt = csn.definitions[elt.type];

          if (elt && elt.elements && !elt.$visited) {
            setProp(elt, '$visited', true);
            Object.values(elt.elements).forEach((e) => {
              npbs = npbs.concat(produceNavigationPath(e, curDef));
            });
            delete elt.$visited;
          }
        }
      }
      npbs.forEach((p) => {
        p.Path = `${ prefix }/${ p.Path }`;
      });
      return npbs;
    }
  }

  function determineEntitySet( def ) {
    // if this is an entity or a view, determine if an entity set is required or not
    // 1) must not be a proxy and not a containee in V4
    // No annos are rendered for non-existing EntitySet targets.
    if (def.$hasEntitySet === undefined) {
      const hasEntitySet = def.kind === 'entity' && !(options.isV4() && edmUtils.isContainee(def)) && !def.$proxy;
      setProp(def, '$hasEntitySet', hasEntitySet);
    }
  }

  function finalize( def, defName ) {
    // 1. let all doc props become @Core.Descriptions
    // 2. mark a member that will become a collection
    // 3. assign the edm primitive type to elements, to be used in the rendering later
    // 4. assign @Validation.AllowedValues to enums
    const defLocation = [ 'definitions', defName ];
    edmUtils.assignAnnotation(def, '@Core.Description', def.doc);
    markCollection(def);
    mapCdsToEdmProp(def);
    annotateAllowedValues(def, defLocation);
    if (def.returns) {
      markCollection(def.returns, true);
      mapCdsToEdmProp(def.returns);
      annotateAllowedValues(def.returns, [ ...defLocation, 'returns' ]);
    }
    forEachMemberRecursively(def, (member, _memberName, prop, location) => {
      edmUtils.assignAnnotation(member, '@Core.Description', member.doc);
      markCollection(member);
      mapCdsToEdmProp(member);
      annotateAllowedValues(member, location);
      ComputedDefaultValue(member, prop, location);
      rewriteAnnotationExpressions(member);
      if (member.returns) {
        edmUtils.assignAnnotation(member.returns, '@Core.Description', member.returns.doc);
        markCollection(member.returns, true);
        mapCdsToEdmProp(member.returns);
        annotateAllowedValues(member.returns, [ ...location, 'returns' ]);
        rewriteAnnotationExpressions(member.returns);
      }
    }, defLocation);
    // mark members that need to be rendered as collections
    function markCollection( obj, isReturns ) {
      const items = obj.items || csn.definitions[obj.type] && csn.definitions[obj.type].items;
      if (items) {
        edmUtils.assignProp(obj, '$NoNullableProperty',
                            isReturns && items.type &&
                            !isBuiltinType(items.type) &&
                            csn.definitions[items.type]?.kind === 'entity');
        edmUtils.assignProp(obj, '_NotNullCollection', items.notNull !== undefined ? items.notNull : false);
        edmUtils.assignProp(obj, '$isCollection', true);
      }
    }

    /*
    Add @Validation.AllowedValues annotation for all enum types
    A 'Value' is added if the enum symbol:
    - has a valid value other than 'null'
    - has no value but the base type is cds.String, use the
      symbol as value
    */
    function annotateAllowedValues( node, location ) {
      let typeDef = node;
      if (!node.enum && node.type && !isBuiltinType(node.type))
        typeDef = csn.definitions[node.type];
      if (typeDef?.enum) {
        const enumValue = [];
        for (const enumSymbol in typeDef.enum) {
          const result = { '@Core.SymbolicName': enumSymbol };
          let enumSymbolDef = typeDef.enum[enumSymbol];
          while (enumSymbolDef && !enumSymbolDef.$visited && enumSymbolDef['#']) {
            setProp(enumSymbolDef, '$visited', true);
            enumSymbolDef = typeDef.enum[enumSymbolDef['#']];
          }
          // reset visited
          for (const es in typeDef.enum)
            delete typeDef.enum[es].$visited;

          if (enumSymbolDef) {
            if (enumSymbolDef.val !== undefined) {
              // 'null' value is represented spec conform as empty record in AllowedValues collection
              result.Value = enumSymbolDef.val;
              enumValue.push(result);
            }
            else if (typeDef.type === 'cds.String') {
              // the symbol is used as value for type 'cds.String'
              result.Value = enumSymbol;
              enumValue.push(result);
            }
            else if (node.kind !== 'annotation') {
              // omit the entry and warn
              warning('odata-enum-missing-value', location,
                      { name: enumSymbol, anno: '@Validation.AllowedValues', type: typeDef.type },
                      'Expected enum element $(NAME) of type $(TYPE) to have a value, not added to $(ANNO)');
            }
          }
          else { // enumSymbolDef not found
            // omit the entry and warn
            warning('odata-enum-missing-value', location,
                    { name: enumSymbol, anno: '@Validation.AllowedValues', type: typeDef.type },
                    'Expected enum element $(NAME) of type $(TYPE) to have a value, not added to $(ANNO)');
          }

          // Can't rely that @description has already been renamed to @Core.Description
          // Eval description according to precedence (doc comment must be considered already in Odata transformer
          // as in contrast to the other doc comments as it is used to annotate the @Validation.AllowedValues)
          const desc = enumSymbolDef ? enumSymbolDef['@Core.Description'] || enumSymbolDef['@description'] || enumSymbolDef.doc : undefined;
          if (desc)
            result['@Core.Description'] = desc;
        }
        if (enumValue.length > 0)
          edmUtils.assignAnnotation(node, '@Validation.AllowedValues', enumValue);
      }
    }
  }

  // If containment in V4 is active, annotations that would be assigned to the containees
  // entity set are not renderable anymore. In such a case try to reassign the annotations to
  // the containment navigation property.
  // Today only Capabilities.*Restrictions are known to be remapped as there exists a CDS
  // short cut annotation @readonly that gets expanded and can be safely remapped.
  function pullupCapabilitiesAnnotations( rootContainer ) {
    if (!options.odataCapabilitiesPullup)
      return;
    // @Capabilities is applicable to EntitySet/Collection only
    if (!rootContainer.$hasEntitySet)
      return;

    const isRecursiveContainment
      = !!(rootContainer.$containerNames && rootContainer.$containeeAssociations &&
      rootContainer.$containerNames.length === 1 &&
      rootContainer.$containeeAssociations.some(entry => rootContainer.$containerNames.includes(entry.assoc.target)));

    // Root nodes are not contained
    const isRootNode
      = !!(!rootContainer.$containerNames ||
          rootContainer.$containerNames && rootContainer.$containerNames.length === 0);

    if (!isRecursiveContainment && !isRootNode)
      return;

    const rootRestrictions = [];
    addContainmentAnnotationsRecursively([], rootContainer);
    if (rootRestrictions.length)
      rootContainer[NavResAnno] = rootRestrictions;

    function addContainmentAnnotationsRecursively( prefix, container ) {
      if (container.$containeeAssociations) {
        // copy or create container restrictions, don't modify original
        const localRestrictions = container[NavResAnno]
          ? cloneAnnotationValue(container[NavResAnno]) : [];

        // prefix the existing navigation property restrictions on the container
        if (prefix.length) {
          localRestrictions.forEach((npe) => {
            if (npe.NavigationProperty &&
               npe.NavigationProperty['='] &&
               typeof npe.NavigationProperty['='] === 'string') {
              // TODO: replace with transformExpression
              applyTransformations({ definitions: { npe } }, {
                '=': (parent, prop, value) => {
                  parent[prop] = prefix.concat(value).join('.');
                },
              });
            }
          });
        }

        setProp(container, '$visited', true);
        // collect capabilities from containees
        container.$containeeAssociations.forEach((entry) => {
          const { assoc, path } = entry;
          const containee = assoc._target;

          if (edmUtils.isNavigable(assoc) && isMyServiceRequested(containee.name) || containee.$proxy) {
            const localAssocPath = path.join('.');
            const laprefix = prefix.concat(localAssocPath).join('.');
            let navPropEntry = localRestrictions.find(p => p.NavigationProperty && p.NavigationProperty['='] === laprefix);
            const hasEntry = !!navPropEntry;

            if (!hasEntry)
              navPropEntry = { NavigationProperty: { '=': laprefix } };


            const props = Object.entries(containee);
            let newEntry = false;
            capabilities.forEach((c) => {
              if (edmUtils.mergeIntoNavPropEntry(c, navPropEntry, prefix.concat(path), props))
                newEntry = true;
            });

            if (newEntry && !hasEntry)
              localRestrictions.push(navPropEntry);


            if (!containee.$visited)
              addContainmentAnnotationsRecursively(prefix.concat(path), containee);
          }
        });

        rootRestrictions.unshift(...localRestrictions);
        delete container.$visited;
      }
    }
  }

  /*
    V4 Only:
    An action/function parameter is optional if
    1) it is explicitly annotated to be optional
    2) it has a default value (including null), regardless of it's nullability
    3) it has NO default value but is nullable (the implicit default value is null)

    If a mandatory parameter (not null no default value) appears after an optional
    parameter, a warning is raised, Core.OptionalParameter requires that all optional
    parameters appear rightmost.
  */
  function annotateOptionalActFuncParams( def, defName ) {
    // return if there is nothing to do
    const loc = [ 'definitions', defName ];
    if (def.kind === 'function' || def.kind === 'action')
      iterateParams(def, loc.concat('params'));
    if (def.actions) {
      for (const an in def.actions) {
        const a = def.actions[an];
        iterateParams(a, loc.concat([ 'actions', an, 'params' ]));
      }
    }

    function iterateParams( action, location ) {
      let optPns = [];
      const isBP = p => (p.items?.type || p.type) === special$self;

      if (action.params) {
        Object.entries(action.params).forEach(([ pn, p ]) => {
          // user assigned annotation, don't touch it
          const defT = reqDefs.definitions[p.items?.type || p.type];
          const isStructType = !!(defT?.items?.elements || defT?.elements);
          const isItems = !!(p.items || defT?.items);

          if (Object.keys(p).some(a => a.startsWith('@Core.OptionalParameter') && p[a] != null)) {
            // expand short cut annotation for unspecified default value
            if (typeof p['@Core.OptionalParameter'] === 'boolean') {
              if (p['@Core.OptionalParameter'] && !isBP(p) && !options.isV2()) {
                if (p.default?.val !== undefined) {
                  if (p.default.val !== null && (isStructType || isItems))
                    warning('odata-ignoring-param-default', location.concat(pn), { '#': 'colitem' });
                  else
                    p['@Core.OptionalParameter'] = { DefaultValue: p.default.val };
                }
                else {
                  p['@Core.OptionalParameter'] = { $Type: '' };
                }
                optPns.push(p);
              }
              else { // reset falsy annotation, param is NOT optional
                p['@Core.OptionalParameter'] = null;
              }
            }
            else {
              optPns.push(p);
            }
          }
          else if (!isBP(p) && !options.isV2()) {
            // default value automatically makes param optional
            if (p.default?.val !== undefined) {
              if (p.default.val !== null && (isStructType || isItems))
                warning('odata-ignoring-param-default', location.concat(pn), { '#': 'colitem' });
              else
                edmUtils.assignAnnotation(p, '@Core.OptionalParameter.DefaultValue', p.default.val);
              optPns.push(p);
            }
            // nullable action params are optional (implicit default null)
            else if (!p.notNull && action.kind === 'action') {
              optPns.push(p);
            }
            else if (action.kind === 'function') {
              // this is a mandatory parameter, warn about all previously collected optional parameters
              if (optPns.filter(op => (op.items?.type || op.type) !== special$self).length)
                error('odata-parameter-order', location.concat(pn));
              optPns = [];
            }
          }
        });
      }
    }
  }

  // ////////////////////////////////////////////////////////////////////
  //
  // Helper section starts here
  //


  function mapCdsToEdmProp( obj ) {
    if (edmUtils.convertMapToOpenStruct(obj, _options.odataVersion === 'v4')) {
      return;
    }
    else if (obj.type && isBuiltinType(obj.type) && !obj.target && !obj.targetAspect) {
      const edmType = edmUtils.mapCdsToEdmType(obj, messageFunctions, _options, obj['@Core.MediaType']);
      edmUtils.assignProp(obj, '_edmType', edmType);
    }
    else if (obj.$isCollection && (obj.items && isBuiltinType(csnUtils.getFinalTypeInfo(obj.items.type)?.type))) {
      const edmType = edmUtils.mapCdsToEdmType(obj.items, messageFunctions, _options, obj['@Core.MediaType'], obj.$path);
      edmUtils.assignProp(obj, '_edmType', edmType);
    }
    // This is the special case when we have array of array, but will not be supported in the future
    else if (obj.$isCollection && obj.items && obj.items.type && obj.items.items && isBuiltinType(csnUtils.getFinalTypeInfo(obj.items.items.type)?.type)) {
      const edmType = edmUtils.mapCdsToEdmType(obj.items.items, messageFunctions, _options, obj['@Core.MediaType']);
      edmUtils.assignProp(obj, '_edmType', edmType);
    }
  }

  function ComputedDefaultValue( member, prop, location ) {
    if (member.default && !csn['@Core.ComputedDefaultValue']) {
      let def = member.default;
      let noTailExpr = false;
      if (def.xpr) {
        let i = 0;
        // consume all unary signs
        while (def.xpr[i] === '-' || def.xpr[i] === '+')
          i++;
        // noTailExpr is true if there is nothing behind the next token in the stream
        noTailExpr = i < def.xpr.length - 1;
        def = def.xpr[i];
      }
      // it is a computed value if it is not a simple value or an annotation
      if (!((def.val !== undefined && !noTailExpr) || def['#'])) {
        if (prop === 'params')
          warning('odata-ignoring-param-default', location, { '#': 'xpr' });
        else
          edmUtils.assignAnnotation(member, '@Core.ComputedDefaultValue', true);
      }
    }
  }

  function rewriteAnnotationExpressions( carrier ) {
    // rewrite annotation expression paths such that they are defined against the definition
    const absPath = $path2path(carrier.$path);
    let isSubTreeSpan = true;

    let rootPrefix = absPath.slice(1, absPath.length - 1);

    const subTreeSpan = {
      ref: (parent, _prop, xpr) => {
        const head = xpr[0].id || xpr[0];
        if (head === '$self' || parent.param) {
          let j = parent.param ? 0 : 1;
          const k = parent.param ? 1 : 0;
          isSubTreeSpan = isSubTreeSpan && (absPath.length - k <= xpr.length);
          for (let i = 1; i < absPath.length - 1 && isSubTreeSpan; i++, j++)
            isSubTreeSpan = isSubTreeSpan && (xpr[j].id || xpr[j]) === absPath[i];
        }
      },
    };
      // this element was not a top level element before type exposure
      // rectify all absolute annotation paths inside
    const relativize = {
      ref: (parent, _prop, xpr) => {
        const head = xpr[0].id || xpr[0];
        let absPathPrefixEqual = true;
        if (head === '$self' || parent.param) {
          let j = parent.param ? 0 : 1;
          for (let i = 1; i < absPath.length - 1 && absPathPrefixEqual; i++, j++)
            absPathPrefixEqual = (xpr[j].id || xpr[j]) === absPath[i];

          if (absPathPrefixEqual) {
            // remove prefix between $self and leaf element name
            // or starting with the parameter name
            xpr.splice(parent.param ? 0 : 1, absPath.length - 2);
            if (parent.param)
              parent.param = null;
          }
        }
      },
    };

    const absolutize = {
      ref: (parent, prop, xpr) => {
        const head = xpr[0].id || xpr[0];
        if (head !== '$self' && !parent.param && !isMagicVariable(head)) {
          parent[prop] = [ ...rootPrefix, ...xpr ];
          if (absolutize.scope === 'params')
            parent.param = true;
          else
            parent[prop].unshift('$self');
        }
      },
    };

    if (absPath.length > 2) {
      const [ xprANames, nxprANames ] = Object.keys(carrier).reduce((acc, pn) => {
        if (pn[0] === '@')
          acc[findAnnotationExpression(carrier, pn) ? 0 : 1].push(pn);
        return acc;
      }, [ [], [] ]);

      let scope = carrier.$path[2];
      let def = csn.definitions[carrier.$path[1]];
      // unbound
      if (scope === 'returns') {
        absPath[1] = '$ReturnType';
        rootPrefix = absPath.slice(3, absPath.length - 1);
      }
      let eltPath = absPath.slice(1).join('/');
      // bound action
      if (scope === 'actions' && def[scope][carrier.$path[3]]) {
        def = def[scope][carrier.$path[3]];
        scope = carrier.$path[4];
        if (scope === 'params') {
          rootPrefix = absPath.slice(2, absPath.length - 1);
          eltPath = absPath.slice(2).join('/');
        }
        if (scope === 'returns') {
          absPath[2] = '$ReturnType';
          rootPrefix = absPath.slice(3, absPath.length - 1);
          eltPath = absPath.slice(2).join('/');
        }
      }
      const proxyDict = `$${ scope }AnnoProxies`;

      xprANames.forEach((xprAName) => {
        isSubTreeSpan = true;
        transformAnnotationExpression(carrier, xprAName, subTreeSpan);
        if (isSubTreeSpan) {
          transformAnnotationExpression(carrier, xprAName, relativize);
        }
        else {
          absolutize.scope = scope;
          transformAnnotationExpression(carrier, xprAName, absolutize);
          if (!def[proxyDict])
            setProp(def, proxyDict, Object.create(null));
          let proxyCarrier = def[proxyDict][eltPath];
          if (!proxyCarrier) {
            proxyCarrier = Object.create(null);
            // these attributes are needed to test for
            // Property, Parameter, NavigationProperty, Collection
            // Applicability
            [ 'target',
              'cardinality',
              'keys',
              '$isCollection',
              '$appliesToReturnType',
              '$path',
              '@cds.api.ignore',
              '@odata.navigable' ].forEach((prop) => {
              if (carrier[prop] != null)
                setProp(proxyCarrier, prop, carrier[prop]);
            });

            Object.keys(carrier).filter(pn => pn[0] !== '@').forEach((pn) => {
              proxyCarrier[pn] = carrier[pn];
            });
            def[proxyDict][eltPath] = proxyCarrier;
          }
          proxyCarrier[xprAName] = carrier[xprAName];
          carrier[xprAName] = null;
          nxprANames.filter(an => an.startsWith(`${ xprAName }.`)).forEach((nxprAName) => {
            proxyCarrier[nxprAName] = carrier[nxprAName];
            carrier[nxprAName] = null;
          });
        }
      });
    }
  }
}

module.exports = {
  initializeModel,
};
