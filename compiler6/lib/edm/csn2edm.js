'use strict';

/* eslint max-lines:off */
/* eslint max-statements-per-line:off */

const NAVPROP_TRENNER = '_';
const VALUELIST_NAVPROP_PREFIX = '';

const edmUtils = require('./edmUtils.js');
const { initializeModel } = require('./edmPreprocessor.js');
const translate = require('./annotations/genericTranslation.js');
const { setProp, isBetaEnabled } = require('../base/model');
const {
  isEdmPropertyRendered, getUtils, findAnnotationExpression,
} = require('../model/csnUtils');
const { isBuiltinType } = require('../base/builtins');
const { checkCSNVersion } = require('../json/csnVersion');
const {
  EdmTypeFacetMap,
  EdmTypeFacetNames,
  EdmPrimitiveTypeMap,
} = require('./EdmPrimitiveTypeDefinitions.js');
const { getEdm } = require('./edm.js');
const { cloneFullCsn } = require('../model/cloneCsn');
const { forEach, forEachValue } = require('../utils/objectUtils.js');
/*
OData V2 spec 06/01/2017 PDF version is available here:
https://msdn.microsoft.com/en-us/library/dd541474.aspx
*/

/**
 * @param {CSN.Model} _csn
 * @param {string} serviceName
 * @param {CSN.Options} _options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @return {any}
 */
function csn2edm( _csn, serviceName, _options, messageFunctions ) {
  return csn2edmAll(_csn, _options, [ serviceName ], messageFunctions)[serviceName];
}

/**
 * @param {CSN.Model} _csn
 * @param {CSN.Options} _options
 * @param {string[]|undefined} serviceNames
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @return {any}
 */
function csn2edmAll( _csn, _options, serviceNames, messageFunctions ) {
  // get us a fresh model copy that we can work with
  const csn = cloneFullCsn(_csn, _options);
  const special$self = !csn?.definitions?.$self && '$self';
  messageFunctions.setModel(csn);

  const {
    info, warning, error, message, throwWithError,
  } = messageFunctions;
  checkCSNVersion(csn, _options);

  let rc = Object.create(null);

  // Currently, the cloneCsn keeps only the creator from the csn.meta.
  // There is the need to assign the odata options because we would like to determine
  // whether to execute toFinalBaseType in the edmPreprocessor or not
  if (_csn.meta && _csn.meta.transformation === 'odata' && _csn.meta.options) {
    if (!csn.meta)
      setProp(csn, 'meta', Object.create(null));
    setProp(csn.meta, 'options', _csn.meta.options);
  }

  const [
    allServices,
    allSchemas,
    reqDefs,
    whatsMyServiceRootName,
    fallBackSchemaName,
    options,
  ] = initializeModel(csn, _options, messageFunctions, serviceNames);

  const mergedVocabularies = translate.mergeOdataVocabularies(options, message);

  const Edm = getEdm(options, messageFunctions);

  const { v } = options;
  if (Object.keys(allServices).length === 0) {
    info(null, null, 'No Services in model');
    return rc;
  }

  // refresh csn cache after preprocessor model augmentation with parameters, types, proxies etc
  const csnUtils = getUtils(csn);

  if (serviceNames === undefined)
    serviceNames = options.serviceNames;
  if (serviceNames) {
    serviceNames.forEach((name) => {
      const serviceCsn = allServices[name];
      if (!serviceCsn)
        warning(null, null, { name }, 'No service definition with name $(NAME) found in the model');

      else
        rc[name] = createEdm(serviceCsn);
    });
  }
  else {
    rc = Object.values(allServices).reduce((services, serviceCsn) => {
      services[serviceCsn.name] = createEdm(serviceCsn);
      return services;
    }, rc);
  }

  throwWithError();
  return rc;

  //--------------------------------------------------------------------------------
  // embedded functions
  //--------------------------------------------------------------------------------
  function createEdm( serviceCsn ) {
    // eslint-disable-next-line no-unused-vars
    function baseName( str, del ) {
      const l = str.lastIndexOf(del);
      return (l >= 0) ? str.slice(l + del.length, str.length) : str;
    }

    // if we have a real alias take it, otherwise use basename of service
    // let alias = serviceCsn.alias || baseName(baseName(serviceCsn.name, '::'), '.');
    // FIXME: UI5 cannot deal with spec conforming simpleid alias names

    function markRendered( def ) {
      setProp(def, '$isRendered', true);
    }

    const service = new Edm.DataServices(v);
    /** @type {object} */
    const edm = new Edm.Edm(v, service);

    /* -------------------------------------------------
      Multi Schema generation in V4:

      If a service contains nested contexts (exactly one level)!
      then these contexts are interpreted as additional schemas:

      service MainSchema {
        entity A { toD: association to SideSchema1.D; };
        context SideSchema1 {
          entity D {};
        }
        context SideSchema2 {
          ...
        }
      };

      Only the main schema has an entity container
      Nested definitions are identified by their name in
      definitions:

      MainSchema.A: {},
      MainSchema.SideSchema1.D: {},
      MainSchema.SideSchema2....

      This requires that the names of all members
      of the side elements must be stripped to reflect the
      schema local name (with single schema prefix).
      Also all schema members need to be grouped into
      their respective schemas.

      All type references inside the EDM sub nodes must
      also be rewritten to address the individual schema
      entries.
      -----------------------------------------------*/
    let LeadSchema;
    const fqSchemaXRef = [ serviceCsn.name ];
    const whatsMySchemaName = n => fqSchemaXRef.reduce((acc, sn) => (!acc && n && n.startsWith(`${ sn }.`) ? sn : acc), undefined);

    // tunnel schema xref and servicename in options to edm.Typebase to rectify
    // type references that are eventually also prefixed with the service schema name.
    options.serviceName = serviceCsn.name;
    // List of all schema names in this service, including the service itself
    options.whatsMySchemaName = whatsMySchemaName;
    options.whatsMyServiceRootName = whatsMyServiceRootName;

    let xServiceRefs = {};
    const UsedTypes = {};
    function collectUsedType( def, typeName = (def.items?.type || def.type) ) {
      if (typeName) {
        if (UsedTypes[typeName])
          UsedTypes[typeName].push(def);
        else
          UsedTypes[typeName] = [ def ];
      }
    }

    // create schema containers
    const subSchemaDictionary = {
      [serviceCsn.name]: {
        name: serviceCsn.name,
        fqName: serviceCsn.name,
        _csn: serviceCsn,
        container: true,
        definitions: Object.create(null),
      },
    };

    if (options.isV4()) {
      // Add additional schema containers as sub contexts to the service
      forEach(allSchemas, (fqName, art) => {
        if (serviceCsn.name === whatsMyServiceRootName(fqName) &&
          fqName.startsWith(`${ serviceCsn.name }.`)) {
          if (art.kind === 'reference')
            fqSchemaXRef.push(fqName);
          if (art.kind === 'schema') {
            fqSchemaXRef.push(fqName);
            // Strip the toplevel service schema name (see comment above)
            const name = fqName.replace(`${ serviceCsn.name }.`, '');
            subSchemaDictionary[name] = {
              name,
              fqName,
              _csn: art,
              container: false,
              definitions: Object.create(null),
            };
          }
        }
      }, subSchemaDictionary);

      // Sort schema names in reverse order to allow longest match
      fqSchemaXRef.sort((a, b) => b.length - a.length);

      // Fill the schemas and references, fqSchemaXRef must be complete
      populateSchemas(subSchemaDictionary);
      xServiceRefs = populateXserviceRefs();

      // Bring the schemas in alphabetical order, service first, root last
      const sortedSchemaNames = Object.keys(subSchemaDictionary).filter(n => n !== fallBackSchemaName && n !== serviceCsn.name).sort();
      if (subSchemaDictionary[fallBackSchemaName])
        sortedSchemaNames.push(fallBackSchemaName);

      // Finally create the schemas and register them in the service.
      LeadSchema = createSchema(subSchemaDictionary[serviceCsn.name]);
      service.registerSchema(serviceCsn.name, LeadSchema);

      sortedSchemaNames.forEach((name) => {
        const schema = subSchemaDictionary[name];
        service.registerSchema(schema.fqName, createSchema(schema));
      });
    }
    else {
      populateSchemas(subSchemaDictionary);
      LeadSchema = createSchema(subSchemaDictionary[serviceCsn.name]);
      service.registerSchema(serviceCsn.name, LeadSchema);
    }

    /*
      EntityContainer duplicate check
    */
    service._children.forEach((c) => {
      if (c._ec) {
        forEach(c._ec._registry, ( setName, arr ) => {
          if (arr.length > 1) {
            error(null, null, {
              name: c._edmAttributes.Namespace,
              id: setName,
              names: arr.map(a => a.getDuplicateMessage()),
            }, 'Namespace $(NAME): Duplicate entries in EntityContainer with Name=$(ID) for $(NAMES)');
          }
        });
      }
    });
    if (!options.odataNoCreator) {
      // remove unqualified @Core.Links and #CAP
      Object.keys(serviceCsn).forEach((key) => {
        if (key === '@Core.Links' || key.startsWith('@Core.Links.') ||
            key === '@Core.Links#CAP' || key.startsWith('@Core.Links#CAP.'))
          delete serviceCsn[key];
      });
    }

    // Create annotations and distribute into Schemas, merge vocabulary cross refs into xServiceRefs
    addAnnotationsAndXServiceRefs();
    if (!options.odataNoCreator)
      LeadSchema.prepend(waterMark());

    // Finally add cross service references into the EDM and extract the targetSchemaNames
    // for the type cross check
    forEachValue(xServiceRefs, (ref) => {
      const r = new Edm.Reference(v, ref.ref);
      r.append(new Edm.Include(v, ref.inc));
      edm._defaultRefs.push(r);
    });

    for (const typeName in UsedTypes) {
      if (!isBuiltinType(typeName)) {
        let iTypeName = typeName;
        /*
          Report type ref, if the type is
            - not a builtin,
            - not included in required definitions
            - not a type clash (reported in type exposure),
            - a @cds.external service member but can't be rendered
        */
        if (!typeName.startsWith(`${ serviceCsn.name }.`))
          iTypeName = `${ serviceCsn.name }.${ typeName }`;
        const def = reqDefs.definitions[iTypeName];

        const usages = UsedTypes[typeName].filter(u => !u.$NameClashReported);
        if (usages.length > 0 && def && !def.$isRendered && def['@cds.external']) {
          message('odata-invalid-external-type', usages[0].$location,
                  {
                    type: typeName,
                    anno: '@cds.external',
                    name: serviceCsn.name,
                    code: def.elements ? 'Edm.ComplexType' : 'Edm.TypeDefinition',
                    version: options.isV4() ? '4.0' : '2.0',
                  });
        }
      }
    }

    return edm;

    function waterMark() {
      const rel = new Edm.PropertyValue(v, 'rel');
      rel._xmlOnlyAttributes.String = 'author';
      rel._jsonOnlyAttributes['Edm.String'] = 'author';
      const href = new Edm.PropertyValue(v, 'href');
      href._xmlOnlyAttributes.String = 'https://cap.cloud.sap';
      href._jsonOnlyAttributes['Edm.String'] = 'https://cap.cloud.sap';
      const watermark = new Edm.Annotation(v, 'Core.Links', new Edm.Collection(v, new Edm.Record(v, rel, href)));
      // watermark._edmAttributes['Qualifier'] = 'CAP';
      if (options.isV2())
        watermark._xmlOnlyAttributes.xmlns = 'http://docs.oasis-open.org/odata/ns/edm';
      return watermark;
    }

    // Sort definitions into their schema container
    function populateSchemas( schemas ) {
      forEach(reqDefs.definitions, ( fqName, art ) => {
        // Identify service members by their definition name only, this allows
        // to let the internal object.name have the sub-schema name.
        // With nested services we must do a longest path match and check whether
        // the current definition belongs to the current toplevel service definition.

        // Definition is to be considered if
        // its name has a schema prefix and it's not a schema defining context
        // and its service root is the current service being generated
        let mySchemaName = whatsMySchemaName(fqName);
        // Add this definition to a (sub) schema, if it is not
        // a container (context, service) and
        // not marked to be ignored as schema member
        if (mySchemaName &&
           serviceCsn.name === whatsMyServiceRootName(fqName, false) &&
           art.kind !== 'context' && art.kind !== 'service') {
          // Strip the toplevel serviceName from object.name
          // except if the schema name is the service name itself.
          // Proxy names are not prefixed, as they need to be reused.
          if (mySchemaName !== serviceCsn.name) {
            art.name = fqName.replace(`${ serviceCsn.name }.`, '');
            fqName = art.name;
            mySchemaName = mySchemaName.replace(`${ serviceCsn.name }.`, '');
          }
          schemas[mySchemaName].definitions[fqName] = art;
        }
      }, schemas);
    }

    // Fill xServiceRefs for Edm.Reference
    function populateXserviceRefs() {
      /*
        References into other Schemas

        References are top level elements in an EDM. However,
        they are valid per service only, so a special link
        object needs to be created that link into the target
        schema.

        Technically these are also contexts but with kind='reference'

        As they are not part of the official CSN spec, they are created
        transiently in the type/proxy exposure.

        ref = { kind: 'reference',
          name: targetSchemaName,
          ref: { Uri },
          inc: { Namespace: targetSchemaName, optionalAlias },
          $mySchemaName: targetSchemaName,
          $proxy: true
        };
      */

      return Object.entries(allSchemas).reduce((references, [ fqName, art ]) => {
        // add references
        if (art.kind === 'reference' &&
           whatsMySchemaName(fqName) &&
           serviceCsn.name === whatsMyServiceRootName(fqName, false))
          references[art.inc.Namespace] = art;

        return references;
      }, {});
    }

    // Main schema creator function
    function createSchema( schema ) {
      /** @type {object} */

      // Same check for alias (if supported by us)
      const reservedNames = [ 'Edm', 'odata', 'System', 'Transient' ];
      const loc = [ 'definitions', schema.name ];
      if (reservedNames.includes(schema.name))
        message('odata-invalid-service-name', loc, { names: reservedNames });
      if (schema.name.length > 511) {
        message('odata-invalid-service-name', loc, { '#': 'length' });
      }
      else {
        schema.name.split('.').forEach((id) => {
          if (!edmUtils.isODataSimpleIdentifier(id))
            message('odata-invalid-name', loc, { id });
        });
      }

      /** @type {any} */
      const Schema = new Edm.Schema(v, schema.name, undefined /* unset alias */, schema._csn, /* annotations */ [], schema.container);
      const EntityContainer = Schema._ec || (LeadSchema && LeadSchema._ec);
      // now namespace and alias are used to create the fullQualified(name)
      const schemaNamePrefix = `${ schema.name }.`;
      const schemaAliasPrefix = schemaNamePrefix;
      const schemaCsn = schema;
      const navigationProperties = [];

      /* create the entitytypes and sets
        Do not create an entity set if:
            V4 containment: $containerNames is set and not equal with the artifact name
            Entity starts with 'localserviceNameized.' or ends with '_localized'
      */
      edmUtils.foreach(schemaCsn.definitions,
                       a => a.kind === 'entity' && !a.abstract && a.name.startsWith(schemaNamePrefix),
                       [ createEntityTypeAndSet, markRendered ]);
      // create unbound actions/functions
      edmUtils.foreach(schemaCsn.definitions,
                       a => (a.kind === 'action' || a.kind === 'function') && a.name.startsWith(schemaNamePrefix),
                       [ (options.isV4()) ? createActionV4 : createActionV2, markRendered ]);

      // create the complex types
      edmUtils.foreach(schemaCsn.definitions,
                       a => edmUtils.isStructuredType(a) && a.name.startsWith(schemaNamePrefix) && !a.$ignoreInAPI,
                       [ createComplexType, markRendered ]);

      if (options.isV4()) {
        edmUtils.foreach(schemaCsn.definitions,
                         artifact => edmUtils.isDerivedType(artifact) &&
        !artifact.target &&
        artifact.name.startsWith(schemaNamePrefix),
                         [ createTypeDefinitionV4, markRendered ]);
      }

      if (isBetaEnabled(options, 'odataTerms')) {
        edmUtils.foreach(schemaCsn.definitions,
                         a => a.kind === 'annotation' && a.name.startsWith(schemaNamePrefix),
                         createTerm);
      }

      // fetch all existing children names in a map
      const NamesInSchemaXRef = Schema._children.reduce((acc, cur) => {
        const name = cur._edmAttributes.Name;
        if (acc[name] === undefined)
          acc[name] = [ cur ];

        else
          acc[name].push(cur);

        return acc;
      }, Object.create(null) );

      navigationProperties.forEach((np) => {
        if (options.isV4()) {
        // V4: No referential constraints for Containment Relationships
          if ((!np.isContainment() || (options.renderForeignKeys)) && !np.isToMany())
            np.addReferentialConstraintNodes();
        }
        else {
          addAssociationV2(np);
        }
      });

      /*
        Remove EntityContainer if empty
        V4 spec says:
        Chapter 5 Element edm:Schema
            It MAY contain elements [...], edm:EntityContainer, [...].
        Chapter 13 Element edm:EntityContainer
            The edm:EntityContainer MUST contain one or more edm:EntitySet, edm:Singleton, edm:ActionImport, or edm:FunctionImport elements.

        The first sentence in chapter 13 is:
          Each metadata document used to describe an OData service MUST define exactly one entity container.

        This sentence expresses that an OData SERVICE must contain an entity container, but an EDMX is not required to have a container.
        Therefore it is absolutely legal and necessary to remove an empty container from the IR!
      */
      if (Schema._ec && Schema._ec._children.length === 0)
        Schema._children.splice(Schema._children.indexOf(Schema._ec), 1);


      forEach(NamesInSchemaXRef, ( name, refs ) => {
        if (refs.length > 1) {
          error(null, [ 'definitions', `${ Schema._edmAttributes.Namespace }.${ name }` ], { name: Schema._edmAttributes.Namespace },
                'Duplicate name in Schema $(NAME)');
        }
      });

      return Schema;

      function createEntityTypeAndSet( entityCsn ) {
        const EntityTypeName = entityCsn.name.replace(schemaNamePrefix, '');
        const EntitySetName = edmUtils.getBaseName(entityCsn.$entitySetName || entityCsn.name);
        const isSingleton = edmUtils.isSingleton(entityCsn) && options.isV4();
        const [ properties, hasStream ] = createProperties(entityCsn);

        const location = reqDefs.definitions[entityCsn.name] ? [ 'definitions', entityCsn.name ] : entityCsn.$path;
        const type = `${ schema.name }.${ EntityTypeName }`;
        if (properties.length === 0)
          warning(null, location, { type }, 'EDM EntityType $(TYPE) has no properties');
        // only if this entity has an entity set, it is required to have a key
        // this especially covers: 'items: composition of one { data : String; }'
        // "keyless" composition targets in structured containment mode
        else if (entityCsn.$hasEntitySet && entityCsn.$edmKeyPaths.length === 0 && !isSingleton)
          message('odata-missing-key', location);

        if (!edmUtils.isODataSimpleIdentifier(EntityTypeName))
          message('odata-invalid-name', location, { id: EntityTypeName });

        properties.forEach((p) => {
          const pLoc = [ ...location, 'elements', p._edmAttributes.Name ];
          edmTypeCompatibilityCheck(p, pLoc);
          if (p._edmAttributes.Name === EntityTypeName)
            message('odata-invalid-property-name', pLoc, { meta: entityCsn.kind });

          if (options.isV2() && p.$isCollection && !p._csn.target)
            message('odata-unexpected-array', pLoc, { version: '2.0' });

          if (!edmUtils.isODataSimpleIdentifier(p._edmAttributes.Name)) {
            message('odata-invalid-name', pLoc, { id: p._edmAttributes.Name });
          }
          else if (options.isV2() && /^(_|\d)/.test(p._edmAttributes.Name)) {
            // FIXME: Rewrite signalIllegalIdentifier function to be more flexible
            message('odata-invalid-name', pLoc, {
              '#': 'v2firstChar',
              prop: p._edmAttributes.Name[0],
              id: p._edmAttributes.Name,
              version: '2.0',
            });
          }
        });

        // construct EntityType attributes
        const attributes = { Name: EntityTypeName };

        // CDXCORE-CDXCORE-173
        if (options.isV2() && hasStream) {
          attributes['m:HasStream'] = true;
          edmUtils.assignAnnotation(entityCsn, '@Core.MediaType', hasStream);
        }

        Schema.append(new Edm.EntityType(v, attributes, properties, entityCsn));

        if (EntityContainer && entityCsn.$hasEntitySet) {
          /** @type {object} */
          let containerEntry;

          if (edmUtils.isSingleton(entityCsn) && options.isV4()) {
            containerEntry = new Edm.Singleton(v, { Name: EntitySetName, Type: fullQualified(EntityTypeName) }, entityCsn);
            if (entityCsn['@odata.singleton.nullable'])
              containerEntry._edmAttributes.Nullable = true;
          }
          else {
            containerEntry = new Edm.EntitySet(v, { Name: EntitySetName, EntityType: fullQualified(EntityTypeName) }, entityCsn);
          }

          // V4: Create NavigationPropertyBinding in EntitySet
          if (options.isV4()) {
            entityCsn.$edmNPBs.forEach((npb) => {
              containerEntry.append(new Edm.NavigationPropertyBinding(v, npb));
            });
          }
          EntityContainer.register(containerEntry);
        }

        // put actions behind entity types in Schema/EntityContainer
        if (entityCsn.actions) {
          forEach(entityCsn.actions, ( n, a ) => {
            if (options.isV4())
              createActionV4(a, n, entityCsn);
            else
              createActionV2(a, n, entityCsn);
          });
        }
      }

      function createComplexType( structuredTypeCsn ) {
        // V4 attributes: Name, BaseType, Abstract, OpenType
        const attributes = { Name: structuredTypeCsn.name.replace(schemaNamePrefix, '') };

        const complexType = new Edm.ComplexType(v, attributes, structuredTypeCsn);
        const elementsCsn = structuredTypeCsn.items || structuredTypeCsn;
        const properties = createProperties(elementsCsn, structuredTypeCsn)[0];
        const location = [ 'definitions', structuredTypeCsn.name ];

        if (!edmUtils.isODataSimpleIdentifier(attributes.Name))
          message('odata-invalid-name', location, { id: attributes.Name });

        properties.forEach((p) => {
          const pLoc = [ ...location, ...(structuredTypeCsn.items ? [ 'items', 'elements' ] : [ 'elements' ]), p._edmAttributes.Name ];
          edmTypeCompatibilityCheck(p, pLoc);
          if (p._edmAttributes.Name === complexType._edmAttributes.Name)
            message('odata-invalid-property-name', pLoc, { meta: structuredTypeCsn.kind });

          if (!edmUtils.isODataSimpleIdentifier(p._edmAttributes.Name))
            message('odata-invalid-name', pLoc, { id: p._edmAttributes.Name });

          if (options.isV2()) {
            if (p.$isCollection && !p._csn.target)
              message('odata-unexpected-array', pLoc, { version: '2.0' });

            if (p._csn.target)
              message('odata-unexpected-assoc', pLoc, { version: '2.0' });
          }
        });


        complexType.append(...(properties));

        Schema.append(complexType);
      }

      /**
       * @param {object} elementsCsn
       * @param {object} edmParentCsn
       * @returns {[object[], any]} Returns a [ [ Edm Properties ], boolean hasStream ]:
       *                              array of Edm Properties
       *                              hasStream : value of @Core.MediaType assignment
       */
      function createProperties( elementsCsn, edmParentCsn = elementsCsn ) {
        const props = [];
        let hasStream = false;
        const streamProps = [];

        if (elementsCsn.elements) {
          forEach(elementsCsn.elements, ( elementName, elementCsn ) => {
            if (!elementCsn._edmParentCsn)
              setProp(elementCsn, '_edmParentCsn', edmParentCsn);

            if (elementCsn.target) {
            // Foreign keys are part of the generic elementCsn.elements property creation

              // This is the V4 edmx:NavigationProperty
              // gets rewritten for V2 in addAssociations()

              // suppress navprop creation only if @odata.navigable:false is not annotated.
              // (undefined !== false) still evaluates to true
              if (!elementCsn._target.abstract && elementCsn['@odata.navigable'] !== false) {
                const navProp = new Edm.NavigationProperty(v, {
                  Name: elementName,
                  Type: elementCsn._target.name,
                }, elementCsn);
                collectUsedType(elementCsn, elementCsn._target.name);
                props.push(navProp);
                // save the navProp in the global array for late constraint building
                navigationProperties.push(navProp);
              }
            }
            // render ordinary property if element is NOT ...
            // 1) ... annotated @cds.api.ignore
            // 2) ... annotated @odata.foreignKey4 and odataFormat: structured

            else if (isEdmPropertyRendered(elementCsn, options)) {
            // CDXCORE-CDXCORE-173
            // V2: filter  @Core.MediaType
              if (options.isV2() && elementCsn['@Core.MediaType']) {
                hasStream = elementCsn['@Core.MediaType'];
                elementCsn['@cds.api.ignore'] = true;
                // CDXCORE-CDXCORE-177:
                // V2: don't render element but add attribute 'm:HasStream="true' to EntityType
                streamProps.push(elementName);
              }
              else {
                // V4: render property type 'Edm.Stream' but don't add '@Core.IsURL'
                if ( elementCsn['@Core.MediaType'])
                  delete elementCsn['@Core.IsURL'];
                collectUsedType(elementCsn);
                props.push(new Edm.Property(v, { Name: elementName }, elementCsn));
              }
            }
          });
        }
        if (options.isV2()) {
          if (streamProps.length > 1) { // TODO: why not mention 2.0 in text?
            error(null, [ 'definitions', elementsCsn.name ], { names: streamProps, version: '2.0', anno: '@Core.MediaType' },
                  'Expected only one element to be annotated with $(ANNO) for OData $(VERSION) but found $(NAMES)');
          }
          else if (streamProps.length === 1) {
            info(null, [ 'definitions', elementsCsn.name ], { id: streamProps[0], version: '2.0', anno: '@Core.MediaType' },
                 'Property $(ID) annotated with $(ANNO) is removed from EDM for OData $(VERSION)');
          }
        }
        return [ props, hasStream ];
      }

      function createTerm( termCsn ) {
        const attributes = { Name: termCsn.name.replace(schemaNamePrefix, '') };
        const term = new Edm.Term(v, attributes, termCsn);
        Schema.append(term);
      }

      // V4 <TypeDefintion>
      function createTypeDefinitionV4( typeCsn ) {
        // derived types are already resolved to base types
        const attributes = { Name: typeCsn.name.replace(schemaNamePrefix, '') };
        if (!edmUtils.isODataSimpleIdentifier(attributes.Name))
          message('odata-invalid-name', typeCsn.$path, { id: attributes.Name });

        const typeDef = new Edm.TypeDefinition(v, attributes, typeCsn );
        edmTypeCompatibilityCheck(typeDef, typeCsn.$path);
        Schema.append(typeDef);
      }

      // add bound/unbound actions/functions for V4
      function createActionV4( actionCsn, _name, entityCsn = undefined ) {
        const iAmAnAction = actionCsn.kind === 'action';
        const actionName = edmUtils.getBaseName(actionCsn.name);
        const attributes = { Name: actionName, IsBound: false };

        const location = entityCsn
          ? [ 'definitions', entityCsn.name, 'actions', actionCsn.name ]
          : [ 'definitions', actionCsn.name ];


        if (!edmUtils.isODataSimpleIdentifier(attributes.Name))
          message('odata-invalid-name', location, { id: attributes.Name });

        if (!iAmAnAction)
          attributes.IsComposable = false;

        /** @type {object} */
        const actionNode = (iAmAnAction) ? new Edm.Action(v, attributes, actionCsn)
          : new Edm.FunctionDefinition(v, attributes, actionCsn);

        const bpType = entityCsn ? fullQualified(entityCsn.name) : undefined;
        /*
        Check for binding $self parameter. If available, use this parameter
        instead of artificially created binding parameter (hasBindingParameter).
        The binding parameter remains in the CSN and is rendered as any other
        parameter (including default value/not null/ etc) and acts as annotation carrier.
        */

        let bpName = 'in';
        if (actionCsn.params) {
          const entries = Object.entries(actionCsn.params);
          const firstParam = entries[0][1];
          const type = firstParam?.items?.type || firstParam?.type;
          if (type === special$self) {
            bpName = entries[0][0];
            setProp(actionCsn, '$bindingParam', firstParam);
            // preserve the original type (as it is the key to reqDefs.defintions)
            // for annotation path resolution (eg. for $draft.IsActiveEntity)
            if (bpType) {
              if (firstParam.items?.type)
                setProp(firstParam.items, '_edmType', bpType);
              if (firstParam.type)
                setProp(firstParam, '_edmType', bpType);
            }
            if (!edmUtils.isODataSimpleIdentifier(bpName))
              message('odata-invalid-name', [ ...location, 'params', bpName ], { id: bpName });
          }
        }

        // bpName is eventually used later for EntitySetPath
        // No explicit binding parameter, check (user defined) annotation value)
        if (!actionCsn.$bindingParam) {
          const bpnAnnoName = '@cds.odata.bindingparameter.name';
          const bpnAnnoLoc = [ ...location, bpnAnnoName ];
          const bpNameAnno = actionCsn[bpnAnnoName];
          if (bpNameAnno != null) {
            if (typeof bpNameAnno === 'string')
              bpName = bpNameAnno;
            if (typeof bpNameAnno === 'object' && bpNameAnno['=']) {
              if (findAnnotationExpression(actionCsn, bpnAnnoName)) {
                if (!bpNameAnno.ref)
                  message('odata-anno-xpr', bpnAnnoLoc, { anno: bpnAnnoName, '#': 'unexpected' });
                else if (bpNameAnno.ref.length !== 1)
                  error('odata-anno-xpr-ref', bpnAnnoLoc, { anno: bpnAnnoName, elemref: bpNameAnno, '#': 'invalid' });
                else
                  bpName = bpNameAnno.ref[0];
              }
              else {
                bpName = bpNameAnno['='];
              }
            }
          }

          if (!edmUtils.isODataSimpleIdentifier(bpName))
            message('odata-invalid-name', bpnAnnoLoc, { id: bpName });
          if (actionCsn.params && actionCsn.params[bpName])
            error('duplicate-definition', bpnAnnoLoc, { '#': 'param', name: bpName });
        }
        if (entityCsn) {
          actionNode.setEdmAttribute('IsBound', true);
          if (!actionCsn.$bindingParam) {
            const bpDef = {
              name: bpName,
              viaAnno: true,
            };
            // Binding Parameter: 'in' at first position in sequence, this is decisive!
            if (actionCsn['@cds.odata.bindingparameter.collection']) {
              actionNode.append(new Edm.Parameter(v, { Name: bpName, Type: bpType, Collection: true/* , Nullable: false */ } ));
              bpDef.items = { type: bpType };
            }
            else {
              actionNode.append(new Edm.Parameter(v, { Name: bpName, Type: bpType } ));
              bpDef.type = bpType;
            }
            setProp(actionCsn, '$bindingParam', bpDef);
          }
        }
        else if (EntityContainer) { // unbound => produce Action/FunctionImport
          /** @type {object} */
          const actionImport = iAmAnAction
            ? new Edm.ActionImport(v, { Name: actionName, Action: fullQualified(actionName) })
            : new Edm.FunctionImport(v, { Name: actionName, Function: fullQualified(actionName) });

          const rt = actionCsn.returns && ((actionCsn.returns.items && actionCsn.returns.items.type) || actionCsn.returns.type);
          if (rt) { // add EntitySet attribute only if return type is a non abstract entity
            const definition = schemaCsn.definitions[rt];
            if (definition && definition.kind === 'entity' && !definition.abstract && !edmUtils.isSingleton(definition))
              actionImport.setEdmAttribute('EntitySet', edmUtils.getBaseName(rt));
          }
          EntityContainer.register(actionImport);
        }

        // Parameter Nodes
        if (actionCsn.params) {
          forEach(actionCsn.params, ( parameterName, parameterCsn ) => {
            const p = new Edm.Parameter(v, { Name: parameterName }, parameterCsn );
            const pLoc = [ ...location, 'params', p._edmAttributes.Name ];
            if (!edmUtils.isODataSimpleIdentifier(parameterName))
              message('odata-invalid-name', pLoc, { id: parameterName });
            collectUsedType(parameterCsn);
            edmTypeCompatibilityCheck(p, pLoc);
            actionNode.append(p);
          });
        }

        // return type if any
        if (actionCsn.returns) {
          actionNode._returnType = new Edm.ReturnType(v, actionCsn.returns);
          collectUsedType(actionCsn.returns);
          edmTypeCompatibilityCheck(actionNode._returnType, [ ...location, 'returns' ]);
          // if binding type matches return type add attribute EntitySetPath
          if (entityCsn && fullQualified(entityCsn.name) === actionNode._returnType._type)
            actionNode.setEdmAttribute('EntitySetPath', bpName);
        }
        Schema.addAction(actionNode);
      }

      // add bound/unbound actions/functions for V2
      function createActionV2( actionCsn, name, entityCsn = undefined ) {
        /** @type {object} */
        const attributes = { Name: name.replace(schemaNamePrefix, '') };
        const functionImport = new Edm.FunctionImport(v, attributes );

        // inserted now to maintain attribute order with old odata generator...
        /*
          V2 says (p33):
          * If the return type of FunctionImport is a collection of entities, the EntitySet
            attribute is defined.
          * If the return type of FunctionImport is of ComplexType or scalar type,
            the EntitySet attribute cannot be defined.
          The spec doesn't mention single ET: Ralf Handls confirmed that there is a gap
          in the spec and advised mention it as in V4
        */

        const location = entityCsn
          ? [ 'definitions', entityCsn.name, 'actions', actionCsn.name ]
          : [ 'definitions', actionCsn.name ];

        if (!edmUtils.isODataSimpleIdentifier(attributes.Name))
          message('odata-invalid-name', location, { id: attributes.Name });

        const rt = actionCsn.returns && ((actionCsn.returns.items && actionCsn.returns.items.type) || actionCsn.returns.type);
        if (rt) { // add EntitySet attribute only if return type is an entity
          const definition = schemaCsn.definitions[rt];
          if (definition && definition.kind === 'entity')
            functionImport.setEdmAttribute('EntitySet', rt.replace(schemaNamePrefix, ''));
        }

        if (actionCsn.returns)
          functionImport.setEdmAttribute('ReturnType', getReturnType(actionCsn));

        if (actionCsn.kind === 'function')
          functionImport.setXml( { 'm:HttpMethod': 'GET' });
        else if (actionCsn.kind === 'action')
          functionImport.setXml( { 'm:HttpMethod': 'POST' });

        if (entityCsn) {
          // Make bound function names always unique as per Ralf's recommendation
          functionImport.setXml( { 'sap:action-for': fullQualified(entityCsn.name) } );
          const entityName = `${ entityCsn.name.replace(schemaNamePrefix, '') }_${ functionImport._edmAttributes.Name }`;
          functionImport.setEdmAttribute('Name', entityName);

          // Binding Parameter: Primary Keys at first position in sequence, this is decisive!
          // V2 XML: Nullable=false is set because we reuse the primary key property for the parameter
          edmUtils.foreach(entityCsn.elements,
                           elementCsn => elementCsn.key && !elementCsn.target,
                           (elementCsn, elementName) => {
                             functionImport.append(new Edm.Parameter(v, { Name: elementName }, elementCsn, 'In' ));
                           });
        }

        // is this still required?
        forEach(actionCsn, ( key, val ) => {
          if (key.match(/^@sap\./))
            functionImport.setXml( { [`sap:${ key.slice(5).replace(/\./g, '-') }`]: val });
        });
        // then append all other parameters
        // V2 XML: Parameters that are not explicitly marked as Nullable or NotNullable in the CSN must become Nullable=true
        // V2 XML spec does only mention default Nullable=true for Properties not for Parameters so omitting Nullable=true let
        // the client assume that Nullable is false.... Correct Nullable Handling is done inside Parameter constructor
        if (actionCsn.params) {
          Object.entries(actionCsn.params).forEach(([ parameterName, parameterCsn ], i) => {
            const type = parameterCsn?.items?.type || parameterCsn?.type;
            if (i === 0 && type === special$self) {
            // skip and remove the first parameter if it is a $self binding parameter to
            // omit annotation rendering later on
              setProp(actionCsn, '$bindingParam', parameterCsn);
              delete actionCsn.params[parameterName];
            }
            else {
              const pLoc = [ ...location, 'params', parameterName ];
              const param = new Edm.Parameter(v, { Name: parameterName }, parameterCsn, 'In' );
              collectUsedType(parameterCsn);
              edmTypeCompatibilityCheck(param, pLoc);
              if (!edmUtils.isODataSimpleIdentifier(parameterName))
                message('odata-invalid-name', pLoc, { id: parameterName });

              // only scalar or structured type in V2 (not entity)
              if (param._type &&
                  !param._type.startsWith('Edm.') &&
                  csn.definitions[param._type] &&
                  !edmUtils.isStructuredType(csn.definitions[param._type]))
                message('odata-invalid-param-type', pLoc, { version: '2.0' });

              if (param.$isCollection)
                message('odata-unexpected-array', pLoc, { version: '2.0' });

              functionImport.append(param);
            }
          });
        }

        if (EntityContainer)
          EntityContainer.register(functionImport);

        function getReturnType( action ) {
          // it is safe to assume that either type or items.type are set
          const returnsLoc = [ ...location, 'returns' ];
          const returns = action.returns.items || action.returns;
          let type = returns['@odata.Type'];
          if (!type) {
            type = returns.type;
            if (type) {
              collectUsedType(action.returns);
              if (!isBuiltinType(type) && csn.definitions[type].kind !== 'entity' && csn.definitions[type].kind !== 'type') {
                message('odata-invalid-return-type', returnsLoc, { kind: action.kind, version: '2.0' });
              }
              else if (isBuiltinType(type)) {
                type = edmUtils.mapCdsToEdmType(returns, messageFunctions, _options);
                if (type) {
                  const td = EdmPrimitiveTypeMap[type];
                  if (td && !td.v2) {
                    message('odata-unexpected-edm-type', returnsLoc,
                            { type, version: '2.0' });
                  }
                }
                else {
                  message('odata-unknown-edm-type', returnsLoc, { type });
                }
              }
              if (action.returns.$isCollection)
                type = `Collection(${ type })`;
            }
            else {
              message('odata-missing-type', returnsLoc);
            }
          }
          return type;
        }
      }

      /*
        addAssociation() constructs a V2 association.
        In V4 all this has been simplified very much, the only thing actually left over is
        <ReferentialConstraint> that is then a sub element to <NavigationProperty>.
        However, referential constraints are substantially different to its V2 counterpart,
        so it is better to reimplement proper V4 construction of<NavigationProperty> in a separate
        function.

        This method does:
        rewrite <NavigationProperty> attributes to be V2 compliant
        add <Association> elements to the schema
        add <End>, <ReferentialConstraint>, <Dependent> and <Principal> sub elements to <Association>
        add <AssociationSet> to the EntityContainer for each <Association>
      */
      function addAssociationV2( navigationProperty ) {
        let constraints = navigationProperty._csn._constraints;
        let parentName = navigationProperty._csn._edmParentCsn.name.replace(schemaNamePrefix, '');
        let plainAssocName = parentName + NAVPROP_TRENNER + navigationProperty._edmAttributes.Name.replace(VALUELIST_NAVPROP_PREFIX, '');
        let assocName = plainAssocName;
        let i = 1;
        while (NamesInSchemaXRef[assocName] !== undefined)
          assocName = `${ plainAssocName }_${ i++ }`;


        let fromRole = parentName;
        let toRole = navigationProperty._edmAttributes.Type.replace(schemaAliasPrefix, ''); // <= navprops type should be prefixed with alias

        let fromEntityType = fromRole;
        let toEntityType = toRole;

        // The entity set name may not be the same as the type name (parameterized entities have
        // differing set names (<T>Parameters => <T>, <T>Type => <T>Set)
        let fromEntitySet = ( navigationProperty._csn._edmParentCsn.$entitySetName || fromEntityType).replace(schemaNamePrefix, '');
        let toEntitySet = (navigationProperty._targetCsn.$entitySetName || toEntityType).replace(schemaNamePrefix, '');

        // from and to roles must be distinguishable (in case of self association entity E { toE: association to E; ... })

        if (fromRole === toRole) {
          if (constraints._partnerCsn)
            fromRole += '1';
          else
            toRole += '1';
        }

        // add V2 attributes to navigationProperty
        navigationProperty.setEdmAttribute('Relationship', fullQualified(assocName));
        navigationProperty.setEdmAttribute('FromRole', fromRole);
        navigationProperty.setEdmAttribute('ToRole', toRole);

        // remove V4 attributes
        navigationProperty.removeEdmAttribute('Type');
        navigationProperty.removeEdmAttribute('Partner');
        navigationProperty.removeEdmAttribute('ContainsTarget');

        /*
          If NavigationProperty is a backlink association (constraints._originAssocCsn is set), then there are two options:
          1) Counterpart NavigationProperty exists and is responsible to create the edm:Association element which needs to
            be reused by this backlink association. This is save because at this point of the processing all NavProps are created.
          2) Counterpart NavigationProperty does not exist (@odata.navigable:false), then the missing edm:Association element
            of the origin association needs to be created as if it would have been already available in case (1).
        */

        let reuseAssoc = false;
        const forwardAssocCsn = constraints._partnerCsn;
        if (forwardAssocCsn) {
          // This is a backlink, swap the roles and types, rewrite assocName
          [ fromRole, toRole ] = [ toRole, fromRole ];
          [ fromEntityType, toEntityType ] = [ toEntityType, fromEntityType ];
          [ fromEntitySet, toEntitySet ] = [ toEntitySet, fromEntitySet ];

          parentName = forwardAssocCsn._edmParentCsn.name.replace(schemaNamePrefix, '');
          plainAssocName = parentName + NAVPROP_TRENNER + forwardAssocCsn.name.replace(VALUELIST_NAVPROP_PREFIX, '');
          assocName = plainAssocName;
          i = 1;
          while (NamesInSchemaXRef[assocName] !== undefined && !(NamesInSchemaXRef[assocName][0] instanceof Edm.Association))
            assocName = `${ plainAssocName }_${ i++ }`;


          navigationProperty.setEdmAttribute('Relationship', fullQualified(assocName));

          reuseAssoc = !!forwardAssocCsn._NavigationProperty;
          constraints = forwardAssocCsn._constraints;
          constraints._multiplicity = edmUtils.determineMultiplicity(forwardAssocCsn);
        }

        if (reuseAssoc)
          return;

        // Create Association and AssociationSet if this is not a backlink association.
        // Store association at navigation property because in case the Ends must be modified
        // later by the partner (backlink) association
        const edmAssociation = new Edm.Association(v, { Name: assocName }, navigationProperty,
                                                   [ fromRole, fullQualified(fromEntityType) ],
                                                   [ toRole, fullQualified(toEntityType) ],
                                                   constraints._multiplicity );
        if (NamesInSchemaXRef[assocName] === undefined)
          NamesInSchemaXRef[assocName] = [ edmAssociation ];

        else
          NamesInSchemaXRef[assocName].push(edmAssociation);

        // Add ReferentialConstraints if any
        if (!navigationProperty.$isCollection && Object.keys(constraints.constraints).length > 0) {
          // A managed composition is treated as association
          if (navigationProperty._csn.type === 'cds.Composition' && navigationProperty._csn.on) {
            edmAssociation.append(Edm.ReferentialConstraint.createV2(v,
                                                                     toRole, fromRole, constraints.constraints));
          }
          else {
            edmAssociation.append(Edm.ReferentialConstraint.createV2(v,
                                                                     fromRole, toRole, constraints.constraints));
          }
        }

        Schema.append(edmAssociation);
        if (EntityContainer && !navigationProperty._targetCsn.$proxy) {
          const assocSet = new Edm.AssociationSet(v, { Name: assocName, Association: fullQualified(assocName) },
                                                  fromRole, toRole, fromEntitySet, toEntitySet);
          if (navigationProperty._csn._SetAttributes)
            assocSet.setSapVocabularyAsAttributes(navigationProperty._csn._SetAttributes);
          EntityContainer.register(assocSet);
        }
      }

      // produce a full qualified name replacing the namespace with the alias (if provided)
      function fullQualified( name ) {
        return schemaAliasPrefix + name.replace(schemaNamePrefix, '');
      }
    }

    // generate the Edm.Annotations tree and append it to the corresponding schema
    function addAnnotationsAndXServiceRefs( ) {
      options.getFinalTypeInfo = csnUtils.getFinalTypeInfo;

      const { annos, usedVocabularies, xrefs } = translate.csn2annotationEdm(reqDefs, csnUtils, csn.vocabularies, serviceCsn.name, Edm, options, messageFunctions, mergedVocabularies);
      // distribute edm:Annotations into the schemas
      // Distribute each anno into Schema
      annos.forEach((anno) => {
        let targetSchema = whatsMySchemaName(anno._edmAttributes.Target);
        // if no target schema has been found, it's a service annotation that applies to the service schema
        if (targetSchema === undefined)
          targetSchema = serviceCsn.name;
        if (targetSchema !== serviceCsn.name) {
          const newTarget = anno._edmAttributes.Target.replace(`${ serviceCsn.name }.`, '');
          anno.setEdmAttribute('Target', newTarget);
        }
        edm._service._schemas[targetSchema]._annotations.push(anno);
      });

      // create service cross reference and merge it into xServiceRefs
      xrefs.forEach((xr) => {
        if (xr !== serviceCsn.name) {
          const art = edmUtils.createSchemaRef(allServices, xr);
          if (xServiceRefs[art.inc.Namespace] === undefined)
            xServiceRefs[art.inc.Namespace] = art;
        }
      });
      // merge vocabulary cross references into xServiceRefs
      usedVocabularies.forEach((art) => {
        xServiceRefs[art.inc.Namespace] = art;
      } );
    }

    function edmTypeCompatibilityCheck( p, pLoc ) {
      const edmType = p._type;
      if (!edmType) {
        message('odata-missing-type', pLoc);
      }
      else if (p._scalarType) {
        const td = EdmPrimitiveTypeMap[edmType];
        if (td) {
          // The renderer/type mapper doesn't/shouldn't produce incompatible types and facets.
          // Only the unknown type warning may be triggered by an unknown @odata.Type override.
          if (td.v2 !== p.v2 && td.v4 !== p.v4) {
            message('odata-unexpected-edm-type', pLoc,
                    { type: edmType, version: (p.v4 ? '4.0' : '2.0') });
          }
          EdmTypeFacetNames.forEach((name) => {
            const facet = EdmTypeFacetMap[name];
            const optional
              = (facet.optional !== undefined)
                ? (Array.isArray(facet.optional)
                  ? facet.optional.includes(edmType)
                  : facet.optional)
                : false;

            // facet is not in attributes
            // facet is member of type definition and mandatory
            // node and facet version match
            if (!p._edmAttributes[name] && td[name] && !optional && (p.v2 === facet.v2 || p.v4 === facet.v4)) {
              message('odata-unexpected-edm-facet', pLoc,
                      { type: edmType, name, version: (p.v4 ? '4.0' : '2.0') });
            }
          });
          if (edmType === 'Edm.Decimal') {
            const precision = Number.parseInt(p._edmAttributes.Precision, 10);
            const scale = Number.parseInt(p._edmAttributes.Scale, 10);
            if (!Number.isNaN(precision) && !Number.isNaN(scale) && scale > precision) {
              message('odata-invalid-scale', pLoc,
                      { number: scale, rawvalue: precision });
            }
          }
        }
        else {
          message('odata-unknown-edm-type', pLoc, { type: edmType });
        }
      }
    }
  }
}
module.exports = { csn2edm, csn2edmAll };
