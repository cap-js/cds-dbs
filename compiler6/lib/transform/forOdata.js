'use strict';

const { isBetaEnabled } = require('../base/model');
const transformUtils = require('./transformUtils');
const { forEachDefinition,
        forEachMemberRecursively,
        applyTransformationsOnNonDictionary,
        getArtifactDatabaseNameOf,
        getElementDatabaseNameOf,
        getServiceNames,
        forEachGeneric,
        cardinality2str,
        getUtils
      } = require('../model/csnUtils');
const { checkCSNVersion } = require('../json/csnVersion');
const validate = require('../checks/validator');
const { isArtifactInSomeService, isLocalizedArtifactInService } = require('./odata/utils');
const expandToFinalBaseType = require('./odata/toFinalBaseType');
const { timetrace } = require('../utils/timetrace');
const enrichUniversalCsn = require('./universalCsn/universalCsnEnricher');
const flattening = require('./odata/flattening');
const createForeignKeyElements = require('./odata/createForeignKeys');
const associations = require('./db/associations')
const expansion = require('./db/expansion');
const generateDrafts = require('./draft/odata');

const { addTenantFields } = require('./addTenantFields');
const { addLocalizationViews } = require('./localized');
const { cloneFullCsn } = require('../model/cloneCsn');
const { csnRefs } = require('../model/csnRefs');
const replaceForeignKeyRefsInExpressionAnnotations = require('./odata/foreignKeyRefsInXprAnnos');

// Transformation for ODATA. Expects a CSN 'inputModel', processes it for ODATA.
// The result should be suitable for consumption by EDMX processors (annotations and metadata)
// and also as a final CSN output for the ODATA runtime.
// Performs the following:
//   - Validate the input model. (forODataNew Candidate)
//   - Unravel derived types for elements, actions, action parameters, types and
//     annotations (propagating annotations).
//     (EdmPreproc Candidate, don't know if flatten step depends on it)
//   - If we execute in flat mode, flatten:
//        -- structured elements
//        -- all the references in the model
//        -- foreign keys of managed associations (cover also the case when the foreign key is
//           pointing to keys that are themselves managed associations)
//       (long term EdmPreproc Candidate when RTs are able to map to flat)
//   - Generate foreign keys for all the managed associations in the model as siblings to the association
//     where ever the association is located (toplevel in flat or deep structured). (forODataNew Candidate)
//   - Tackle on-conditions in unmanaged associations. In case of flat mode - flatten the
//     on-condition, in structured mode - normalize it. (forODataNew Candidate)
//   - Generate artificial draft fields if requested. (forODataNew Candidate)
//   - Check associations for:
//     TODO: move to validator (Is this really required here?
//                              EdmPreproc cuts off assocs or adds proxies/xrefs)
//        -- exposed associations do not point to non-exposed targets
//        -- structured types must not contain associations for OData V2
//   - Element must not be an 'array of' for OData V2 TODO: move to the validator
//     (Linter Candidate, move as hard error into EdmPreproc on V2 generation)
//   - Perform checks for exposed non-abstract entities and views - check media type and
//        key-ness (requires that containers have been identified) (Linter candidate, scenario check)
//   Annotations related:
//   - Annotate artifacts, elements, foreign keys, parameters etc with their DB names if requested
//     (must remain in CSN => ForODataNewCandidate)
//   - Mark fields with @odata.on.insert/update as @Core.Computed
//     (EdmPreproc candidate, check with RT if @Core.Computed required by them)
//   - Rename shorthand annotations according to a builtin list (EdmPreproc Candidate)
//       e.g. @label -> @Common.Label
//   - If the association target is annotated with @cds.odata.valuelist, annotate the
//        association with @Common.ValueList.viaAssociation (EdmPreproc Candidate)
//   - Check for @Analytics.Measure and @Aggregation.default (Linter check candidate, remove)
//   - Check annotations. If annotation starts with '@sap...' it must have a string or boolean value
//     (Linter check candidate)
module.exports = { transform4odataWithCsn };

function transform4odataWithCsn(inputModel, options, messageFunctions) {
  timetrace.start('OData transformation');

  // copy the model as we don't want to change the input model
  const csn = cloneFullCsn(inputModel, options);
  messageFunctions.setModel(csn);

  const { message, error, warning, info, throwWithAnyError } = messageFunctions;
  throwWithAnyError();

  // the new transformer works only with new CSN
  checkCSNVersion(csn, options);

  const transformers = transformUtils.getTransformers(csn, options, messageFunctions, '_');
  const {
    addDefaultTypeFacets, checkMultipleAssignments,
    recurseElements, setAnnotation, renameAnnotation,
    expandStructsInExpression,
    csnUtils,
  } = transformers;

  const {
    getCsnDef,
    getServiceName,
    isAssocOrComposition,
    isAssociation,
    inspectRef,
    artifactRef,
    effectiveType,
    getFinalTypeInfo,
    dropDefinitionCache,
    initDefinition,
  } = csnUtils;

  // are we working with structured OData or not
  const structuredOData = options.odataFormat === 'structured' && options.odataVersion === 'v4';

  // collect all declared non-abstract services from the model
  // use the array when there is a need to identify if an artifact is in a service or not
  const services = getServiceNames(csn);
  // @ts-ignore
  const externalServices = services.filter(serviceName => csn.definitions[serviceName]['@cds.external']);
  // @ts-ignore
  const isExternalServiceMember = (art, name) => {
    return !!(externalServices.includes(getServiceName(name)) ||  (art && art['@cds.external']))
  }

  if (options.csnFlavor === 'universal' && isBetaEnabled(options, 'enableUniversalCsn'))
    enrichUniversalCsn(csn, options);

  // - Generate artificial draft fields on a structured CSN if requested, flattening and struct
  //   expansion do their magic including foreign key generation and annotation propagation.
  //   Tenantenizer has to decorate the DraftAdministrativeData, so draft decoration must be done before.
  generateDrafts(csn, options, services, messageFunctions);

  if (options.tenantDiscriminator)
    addTenantFields(csn, options);

  function acceptLocalizedView(_name, parent) {
    csn.definitions[parent].$localized = true;
    return false; // don't keep the views
  }

  addLocalizationViews(csn, options, { acceptLocalizedView, ignoreUnknownExtensions: true });

  // replace all type refs to builtin types with direct type
  transformUtils.rewriteBuiltinTypeRef(csn);

    // Rewrite paths in annotations only if beta modes are set

  options.enrichAnnotations = true;
  const cleanup = validate.forOdata(csn, {
    message, error, warning, info, inspectRef, effectiveType, getFinalTypeInfo, artifactRef,
    options, csnUtils, services, isExternalServiceMember, recurseElements,
    checkMultipleAssignments, csn,
  });


  // Throw exception in case of errors
  throwWithAnyError();

  // TODO: Refactor out the following logic
  forEachDefinition(csn, [
    (def) => {
      // Convert a projection into a query for internal processing will be re-converted
      // at the end of the OData processing
      // TODO: handle artifact.projection instead of artifact.query correctly in future V2
      if (def.kind === 'entity' && def.projection) {
        def.query = { SELECT: def.projection };
        dropDefinitionCache(def);
        initDefinition(def);
      }
    }],
    { skipArtifact: isExternalServiceMember }
  );

  // All type refs must be resolved, including external APIs.
  // OData has no 'type of' so 'real' imported OData APIs marked @cds.external are safe.
  // If in the future 'other' APIs that might support type refs are imported, these refs must be
  // resolved here, as this is the OData transformation and sets the foundation for subsequent EDM
  // rendering which may has to publish external definitions
  expandToFinalBaseType(csn, transformers, csnUtils, services, options, error);


  // Check if structured elements and managed associations are compared in an expression
  // and expand these structured elements. This tuple expansion allows all other
  // subsequent procession steps (especially a2j) to see plain paths in expressions.
  // If errors are detected, throwWithAnyError() will return from further processing
  expandStructsInExpression(csn, { skipArtifact: isExternalServiceMember, drillRef: true });

  // do expansion before Fk creation because of messages reporting
  if (!structuredOData) {
    expansion.expandStructureReferences(csn, options, '_',
      { error, info, throwWithAnyError }, csnUtils,
      { skipArtifact: isExternalServiceMember, keepKeysOrigin: true });
  }

  createForeignKeyElements(csn, options, messageFunctions, csnUtils, { skipArtifact: isExternalServiceMember });

  // needs to be performed after creating foreign keys for the entire model,
  // because of multiple managed associations in refs
  replaceForeignKeyRefsInExpressionAnnotations(csn, options, messageFunctions, csnUtils, { skipArtifact: isExternalServiceMember });

  bindCsnReferenceOnly();

  if (!structuredOData) {
    const resolved = new WeakMap();
    const { inspectRef, effectiveType } = csnRefs(csn);
    const { getFinalTypeInfo } = getUtils(csn);
    const { adaptRefs, transformer: refFlattener } =
      flattening.getStructRefFlatteningTransformer(csn, inspectRef, effectiveType, options, resolved, '_');

    const allMgdAssocDefs = flattening.allInOneFlattening(csn, refFlattener, adaptRefs,
      inspectRef, getFinalTypeInfo, isExternalServiceMember, error, csnUtils, options);
    flattening.flattenAllStructStepsInRefs(csn, refFlattener, adaptRefs,
        inspectRef, effectiveType, csnUtils, error, options,
      { //skip: ['action', 'aspect', 'event', 'function', 'type'],
        skipArtifact: isExternalServiceMember,
      });
    flattening.replaceManagedAssocsAsKeys(allMgdAssocDefs, csnUtils);

    // replace structured with flat dictionaries that contain
    // rewritten path expressions
    forEachDefinition(csn, (def) => {
      ['elements', 'params'].forEach(dictName => {
        if(def[`$flat${dictName}`])
          def[dictName] = def[`$flat${dictName}`];
      })
      if(def.$flatAnnotations) {
        Object.entries(def.$flatAnnotations).forEach(([an, av]) => {
          def[an] = av;
        })
      }
      if(def.actions) {
        Object.values(def.actions).forEach((action) => {
          if(action.$flatAnnotations) {
            Object.entries(action.$flatAnnotations).forEach(([an, av]) => {
              action[an] = av;
            });
          }
        });
      }
    });
  }

  bindCsnReferenceOnly();

  // Allow using managed associations as steps in on-conditions to access their fks
  // To be done after handleManagedAssociationsAndCreateForeignKeys,
  // since then the foreign keys of the managed assocs are part of the elements
  if(!structuredOData) {
    forEachDefinition(csn, associations.getFKAccessFinalizer(csn, csnUtils, '_'));
  }

  // structure flattener reports errors, further processing is not safe -> throw exception in case of errors
  throwWithAnyError();

  // Apply default type facets as set by options
  // Flatten on-conditions in unmanaged associations
  /* FIXME (HJB): Is this comment still correct? processOnCond only strips $self
                  We should not remove $self prefixes in structured OData to not
                  interfere with path resolution
  */
  // This must be done before all the draft logic as all
  // composition targets are annotated with @odata.draft.enabled in this step
  forEachDefinition(csn, [ setDefaultTypeFacets, processOnCond ], { skipArtifact: isExternalServiceMember });

  // Now all artificially generated things are in place
  // TODO: should be done by the compiler - Check associations for valid foreign keys
  // TODO: check if needed at all: Remove '$projection' from paths in the element's ON-condition
  // - Check associations for:
  //        - exposed associations do not point to non-exposed targets
  //        - structured types must not contain associations for OData V2
  // - Element must not be an 'array of' for OData V2 TODO: move to the validator
  // - Perform checks for exposed non-abstract entities and views - check media type and key-ness

  // Deal with all kind of annotations manipulations here
  const skipPersNameKinds = {'service':1, 'context':1, 'namespace':1, 'annotation':1, 'action':1, 'function':1};
  forEachDefinition(csn, (def, defName) => {
    // Resolve annotation shorthands for entities, types, annotations, ...
    renameShorthandAnnotations(def);

    // Annotate artifacts with their DB names if requested.
    // Skip artifacts that have no DB equivalent anyway
    if (options.sqlMapping && !(def.kind in skipPersNameKinds))
       // hana to allow naming mode "hdbcds"
      def['@cds.persistence.name'] = getArtifactDatabaseNameOf(defName, options.sqlMapping, csn, 'hana');

    forEachMemberRecursively(def, (member, memberName, propertyName) => {
      // Annotate elements, foreign keys, parameters, etc. with their DB names if requested
      // Only these are actually required and don't annotate virtual elements in entities or types
      // as they have no DB representation (although in views)
      if (options.sqlMapping && typeof member === 'object' &&
          !(member.kind === 'action' || member.kind === 'function') &&
          !(propertyName === 'enum' || propertyName === 'returns') &&
          (!member.virtual || def.query)) {
        // If we have a 'preserved dotted name' (i.e. we are a result of flattening), use that for the @cds.persistence.name annotation
        member['@cds.persistence.name'] = getElementDatabaseNameOf((!member['@odata.foreignKey4'] && member.$defPath?.slice(1).join('.'))
                                                                    || memberName, options.sqlMapping, 'hana'); // hana to allow "hdbcds"
      }

      // Mark fields with @odata.on.insert/update as @Core.Computed
      annotateCoreComputed(member);

      // Resolve annotation shorthands for elements, actions, action parameters
      renameShorthandAnnotations(member);

      // If an association was modelled as not null, like so:
      // <associationName>: Association to <target> not null;
      // a cardinality property is set to the association member
      // with the value { "min": 1 };
      setCardinalityToNotNullAssociations(member);

      // - If the association target is annotated with @cds.odata.valuelist, annotate the
      //      association with @Common.ValueList.viaAssociation
      // - Check for @Analytics.Measure and @Aggregation.default
      // @ts-ignore
      if (isArtifactInSomeService(defName, services) || isLocalizedArtifactInService(defName, services)) {
        // If the member is an association and the target is annotated with @cds.odata.valuelist,
        // annotate the association with @Common.ValueList.viaAssociation (but only for service member artifacts
        // to avoid CSN bloating). The propagation of the @Common.ValueList.viaAssociation annotation
        // to the foreign keys is done very late in edmPreprocessor.initializeAssociation()
        addCommonValueListviaAssociation(member, memberName);
      }
    }, ['definitions', defName]);

    // Convert a query back into a projection for CSN compliance as
    // the very last conversion step of the OData transformation
    if (def.kind === 'entity' && def.query && def.projection) {
      delete def.query;
    }
  }, { skipArtifact: isExternalServiceMember })

  if(isBetaEnabled(options, 'odataTerms')) {
    forEachGeneric(csn, 'vocabularies', renameShorthandAnnotations);
  }

  cleanup();
  // Throw exception in case of errors
  throwWithAnyError();
  timetrace.stop('OData transformation');
  return csn;

  //--------------------------------------------------------------------
  // HELPER SECTION STARTS HERE

  // Mark elements that are annotated with @odata.on.insert/update with the annotation @Core.Computed.
  function annotateCoreComputed(node) {
    // If @Core.Computed is explicitly set, don't overwrite it!
    if (node['@Core.Computed'] !== undefined) return;

    // For @odata.on.insert/update,  also add @Core.Computed
    // @odata.on is deprecated, use @cds.on {update|insert} instead
    if(['@odata.on.insert', '@odata.on.update', '@cds.on.insert', '@cds.on.update'].some(a => node[a]))
      node['@Core.Computed'] = true;
  }

  // Rename shorthand annotations within artifact or element 'node' according to a builtin list
  function renameShorthandAnnotations(node) {
    const setMappings = {
      '@label': '@Common.Label',
      '@title': '@Common.Label',
      '@description': '@Core.Description',
    };
    const renameMappings = {
      '@ValueList.entity': { val: '@Common.ValueList', op: 'entity' },
      '@ValueList.type':  { val: '@Common.ValueList', op: 'type' },
      '@Capabilities.Deletable': { val: '@Capabilities.DeleteRestrictions', op: 'Deletable' },
      '@Capabilities.Insertable': { val: '@Capabilities.InsertRestrictions', op: 'Insertable' },
      '@Capabilities.Updatable': { val: '@Capabilities.UpdateRestrictions', op: 'Updatable' },
      '@Capabilities.Readable': { val: '@Capabilities.ReadRestrictions', op: 'Readable' }
    };

    const setShortCuts = Object.keys(setMappings);
    const renameShortCuts = Object.keys(renameMappings);

    // Capabilities shortcuts have precedence over @readonly/@insertonly
    Object.keys(node).forEach( name => {
      if (!name.startsWith('@'))
        return;
      // Rename according to map above
      const renamePrefix = (name in renameMappings)
        ? name
        : renameShortCuts.find(p => name.startsWith(p + '.'));
      if(renamePrefix) {
        const mapping = renameMappings[renamePrefix];
        renameAnnotation(node, name, name.replace(renamePrefix, `${mapping.val}.${mapping.op}`));
      }
      else {
        // The two mappings have no overlap, so no need to check for second map if first matched.
        // Rename according to map above
        const setPrefix = (name in setMappings)
          ? name
          : setShortCuts.find(p => name.startsWith(p + '.') || name.startsWith(p + '#'));
        if(setPrefix) {
          setAnnotation(node, name.replace(setPrefix, setMappings[setPrefix]), node[name]);
        }
      }
    });

    // Special case: '@readonly' becomes a triplet of capability restrictions for entities,
    // but '@Core.Computed' for everything else.

    // only if not both readonly/insertonly are true do the mapping
    if(!(node['@readonly'] && node['@insertonly'])) {
      if(node['@readonly']) {
        const setRO = (qualifier) => {
          if (node.kind === 'entity' || node.kind === 'aspect') {
            setAnnotation(node, `@Capabilities.DeleteRestrictions${ qualifier ? '#' + qualifier : ''}.Deletable`, false);
            setAnnotation(node, `@Capabilities.InsertRestrictions${ qualifier ? '#' + qualifier : ''}.Insertable`, false);
            setAnnotation(node, `@Capabilities.UpdateRestrictions${ qualifier ? '#' + qualifier : ''}.Updatable`, false);
          } else {
            setAnnotation(node, '@Core.Computed', true);
          }
        };
        setRO(undefined);
      }
      // @insertonly is effective on entities/queries only
      if (node['@insertonly'] && (node.kind === 'entity' || node.kind === 'aspect')) {
        const setIO = (qualifier) => {
          setAnnotation(node, `@Capabilities.DeleteRestrictions${ qualifier ? '#' + qualifier : ''}.Deletable`, false);
          setAnnotation(node, `@Capabilities.ReadRestrictions${ qualifier ? '#' + qualifier : ''}.Readable`, false);
          setAnnotation(node, `@Capabilities.UpdateRestrictions${ qualifier ? '#' + qualifier : ''}.Updatable`, false);
        }
        setIO(undefined);
      }
    }

    // @Validation.Pattern is applicable to "Term" => node.kind === annotation
    if (node['@assert.format'] != null)
      setAnnotation(node, '@Validation.Pattern', node['@assert.format']);

    // Only on element level
    if(node.kind == null) {
      if (node['@mandatory'] && !Object.entries(node).some(([k,v]) => k === '@Common.FieldControl' || k.startsWith('@Common.FieldControl.') && v != null)) {
        setAnnotation(node, '@Common.FieldControl', { '#': 'Mandatory' });
      }
      if (node['@assert.range'] != null)
        setAssertRangeAnnotation(node);
    }
  }


  function setAssertRangeAnnotation(node) {
    const range = node['@assert.range'];
    if (!Array.isArray(range) || range.length !== 2)
    return; // TODO: Warning for wrong format?

    const min = range[0];
    const max = range[1];
    const minVal = min?.val ?? min;
    const maxVal = max?.val ?? max;

    // CAP Node 8.5 introduced "exclusive" ranges using the annotation expression
    // syntax.  Hence, the compiler uses the same.  It also introduced "infinity"
    // via `@assert.range: [ _, _ ]`.
    // For `_`, minVal is an object and this function returns false, which is ok,
    // since we don't render the annotation for "infinite" values.
    const shouldSet = (val) => (typeof val !== 'object' && val !== undefined && val !== null);

    if (shouldSet(minVal)) {
      setAnnotation(node, '@Validation.Minimum', minVal);
      if (min['='] !== undefined)
        setAnnotation(node, '@Validation.Minimum.@Validation.Exclusive', true);
    }
    if (shouldSet(maxVal)) {
      setAnnotation(node, '@Validation.Maximum', maxVal);
      if (max['='] !== undefined)
        setAnnotation(node, '@Validation.Maximum.@Validation.Exclusive', true);
    }

  }

  // If an association was modelled as not null, like so:
  // <associationName>: Association to <target> not null;
  // a cardinality property is set to the association member
  // with the value { "min": 1 };
  function setCardinalityToNotNullAssociations(member) {
    if (member.target && !member.on) {
      if (member.notNull) {
        if (member.cardinality === undefined)
          member.cardinality = {};
          // min=0 is falsy => check for undefined
        if (member.cardinality.min === undefined) {
          member.cardinality.min = 1;
        }
        else if (member.cardinality.min === 0) {
          warning(null, member.$path, { value: cardinality2str(member, false), code: 'not null' },
                  'Expected target cardinality $(VALUE) and $(CODE) to match');
        }
      }
    }
  }

  // Apply default type facets to each type definition and every member
  // But do not apply default string length (as in DB)
  function setDefaultTypeFacets(def) {
    addDefaultTypeFacets(def.items || def, null)
    forEachMemberRecursively(def,  m=>addDefaultTypeFacets(m.items || m, null));
    if(def.returns)
      addDefaultTypeFacets(def.returns.items || def.returns, null);
  }

  // Handles on-conditions in unmanaged associations
  function processOnCond(def) {
    forEachMemberRecursively(def, (member) => {
      if (member.on && isAssocOrComposition(member)) {
        removeLeadingDollarSelfInOnCondition(member);
      }
    });

    // removes leading $self in on-conditions's references
    function removeLeadingDollarSelfInOnCondition(assoc) {
      if (!assoc.on) return; // nothing to do
      // TODO: Shouldn't this only run on the on-condition and not the whole assoc-node?
      applyTransformationsOnNonDictionary({ assoc }, 'assoc', {
        ref: (node, prop, ref) => {
          // remove leading $self when at the beginning of a ref
          if (ref.length > 1 && ref[0] === '$self')
            node.ref.splice(0, 1);
        }
      });
    }
  }

  // (4.5) If the member is an association whose target has @cds.odata.valuelist annotate it
  // with @Common.ValueList.viaAssociation.
  // Do this only if the association is navigable(@odata.navigable) and the enclosing artifact is
  // a service member (don't pollute the CSN with unnecessary annotations, that is ensured by the caller
  // of this function).
  function addCommonValueListviaAssociation(member, memberName) {
    const vlAnno = '@Common.ValueList.viaAssociation';
    if (isAssociation(member)) {
      const navigable = member['@odata.navigable'] !== false; // navigable disabled only if explicitly set to false
      const targetDef = getCsnDef(member.target);
      if (navigable && targetDef['@cds.odata.valuelist'] && !member[vlAnno]) {
        setAnnotation(member, vlAnno, { '=': memberName });
      }
    }
  }

  function bindCsnReferenceOnly() {
    // invalidate caches for CSN ref API
    const csnRefApi = csnRefs(csn);
    Object.assign(csnUtils, csnRefApi);
  }


} // transform4odataWithCsn
