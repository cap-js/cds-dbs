'use strict';

// A "tools" collection of various transformation functions that might be helpful for
// different backends.
// The sibling of model/transform/TransformUtil.js which works with compacted new CSN.

const { setProp, isBetaEnabled } = require('../base/model');

const { copyAnnotations, applyTransformations, isDollarSelfOrProjectionOperand, isDeepEqual } = require('../model/csnUtils');
const { getUtils } = require('../model/csnUtils');
const { typeParameters } = require('../compiler/builtins');
const { isBuiltinType } = require('../base/builtins');
const { ModelError, CompilerAssertion} = require('../base/error');
const { forEach } = require('../utils/objectUtils');
const { cloneCsnNonDict, cloneCsnDict } = require('../model/cloneCsn');
const { addTenantFieldToArt } = require('./addTenantFields');

const RestrictedOperators = ['<', '>', '>=', '<='];
const RelationalOperators = ['=', '<>', '==', '!=', 'is' /*, 'like'*/,...RestrictedOperators];
// Return the public functions of this module, with 'model' captured in a closure (for definitions, options etc).
// Use 'pathDelimiter' for flattened names (e.g. of struct elements or foreign key elements).
// 'model' is compacted new style CSN
// TODO: Error and warnings handling with compacted CSN? - currently just throw new ModelError for everything
// TODO: check the situation with assocs with values. In compacted CSN such elements have only "@Core.Computed": true
function getTransformers(model, options, msgFunctions, pathDelimiter = '_') {
  const { message, error, warning, info } = msgFunctions;
  const csnUtils = getUtils(model);
  const {
    getCsnDef,
    getFinalTypeInfo,
    inspectRef,
    isStructured,
    effectiveType,
  } = csnUtils;

  return {
    csnUtils,
    resolvePath,
    flattenPath,
    addDefaultTypeFacets,
    flattenStructuredElement,
    flattenStructStepsInRef,
    toFinalBaseType,
    createExposingProjection,
    createAndAddDraftAdminDataProjection,
    isValidDraftAdminDataMessagesType,
    createScalarElement,
    createAssociationElement,
    createAssociationPathComparison,
    createForeignKey,
    addForeignKey,
    addElement,
    copyAndAddElement,
    createAction,
    assignAction,
    extractValidFromToKeyElement,
    checkMultipleAssignments,
    checkAssignment,
    recurseElements,
    renameAnnotation,
    setAnnotation,
    resetAnnotation,
    expandStructsInExpression,
  };

  /**
   * Try to apply length, precision, scale from options if no type facet is set on the primitive types 'cds.String' or 'cds.Decimal'.
   * If 'obj' has primitive type 'cds.String' and no length try to apply length from options if available or set to default internalDefaultLengths[type].
   * if 'obj' has primitive type 'cds.Decimal' try to apply precision, scale from options if available.
   *
   * @param {CSN.Element} element
   * @param {null|object} [internalDefaultLengths] Either null (no implicit default) or an object `{ 'cds.String': N, 'cds.Binary': N }`.
   **/
  function addDefaultTypeFacets(element, internalDefaultLengths = null) {
    if (!element || !element.type)
      return;

    if (element.type === 'cds.String' && element.length === undefined) {
      if (options.defaultStringLength) {
        element.length = options.defaultStringLength;
        setProp(element, '$default', true);
      }
      else if (internalDefaultLengths !== null) {
        element.length = internalDefaultLengths[element.type];
      }
    }
    if (element.type === 'cds.Binary' && element.length === undefined) {
      if (options.defaultBinaryLength) {
        element.length = options.defaultBinaryLength;
        setProp(element, '$default', true);
      }
      else if(internalDefaultLengths !== null) {
        element.length = internalDefaultLengths[element.type];
      }
    }
  /*
    if (element.type === 'cds.Decimal' && element.precision === undefined && options.precision) {
      element.precision = options.precision;
    }
    if (element.type === 'cds.Decimal' && element.scale === undefined && options.scale) {
      element.scale = options.scale;
    }
  */
  }

  // For a structured element 'elem', return a dictionary of flattened elements to
  // replace it, flattening names with pathDelimiter's value and propagating all annotations and the
  // type properties 'key', 'notNull', 'virtual', 'masked' to the flattened elements.
  // example input:
  //  { elem: {
  //          key: true,
  //          @foo: true,
  //          elements:
  //            { a: { type: 'cds.Integer' } },
  //            { b: {
  //                 elements:
  //                   { b1: type: 'cds.String', length: 42 } } },
  //  } }
  //
  // result:
  //  { elem_a: {
  //          key: true,
  //          @foo: true,
  //          type: 'cds.Integer' },
  //    elem_b_b1: {
  //          key: true,
  //          @foo: true,
  //          type: 'cds.String',
  //          length: 42 },
  // }
  function flattenStructuredElement(elem, elemName, parentElementPath=[], pathInCsn=[]) {
    const elementPath=parentElementPath.concat(elemName); // elementPath contains only element names without the csn structure node names
    // in case the element is of user defined type => take the definition of the type
    // for type of 'x' -> elem.type is an object, not a string -> use directly
    let elemType;
    if (!elem.elements) // structures do not have final base type
      elemType = getFinalTypeInfo(elem.type);

    const struct = elemType ? elemType.elements : elem.elements;

    // Collect all child elements (recursively) into 'result'
    // TODO: Do not report collisions in the generated elements here, but instead
    //       leave that work to the receiver of this result
    const result = Object.create(null);
    const addGeneratedFlattenedElement = (e, eName) => {
      if (result[eName])
        error('name-duplicate-element', pathInCsn, { '#': 'flatten-element-gen', name: eName })
      else
        result[eName] = e;
    }
    forEach(struct, (childName, childElem) => {
      if (isStructured(childElem)) {
        // Descend recursively into structured children
        const grandChildElems = flattenStructuredElement(childElem, childName, elementPath, pathInCsn.concat('elements',childName));
        for (const grandChildName in grandChildElems) {
          const flatElemName = elemName + pathDelimiter + grandChildName;
          const flatElem = grandChildElems[grandChildName];
          addGeneratedFlattenedElement(flatElem, flatElemName);
          // TODO: check with values. In CSN such elements have only "@Core.Computed": true
          // If the original element had a value, construct one for the flattened element
          // if (elem.value) {
          //   createFlattenedValue(flatElem, flatElemName, grandChildName);
          // }
          // Preserve the generated element name as it would have been with 'hdbcds' names
        }
      } else {
        // Primitive child - clone it and restore its cross references
        const flatElemName = elemName + pathDelimiter + childName;
        const flatElem = cloneCsnNonDict(childElem, options);
        // Don't take over notNull from leaf elements
        delete flatElem.notNull;
        setProp(flatElem, '_flatElementNameWithDots', elementPath.concat(childName).join('.'));
        addGeneratedFlattenedElement(flatElem, flatElemName);
      }
    });

    // Fix all collected flat elements (names, annotations, properties, origin ..)
    forEach(result, (name, flatElem) => {
      // Copy annotations from struct (not overwriting, because deep annotations should have precedence).
      // Attention:
      // This has historic reasons. We don't copy doc-comments because copying annotations
      // is questionable to begin with.  Only selected annotations should have been copied,
      // if at all.
      // When flattening structured elements for OData don't propagate the odata.Type annotations
      // as these would falsify the flattened elements. Type facets must be aligned with
      // EdmTypeFacetMap defined in edm.js
      const excludes = options.toOdata ?
      {
        '@odata.Type': 1,
        '@odata.Scale': 1,
        '@odata.Precision': 1,
        '@odata.MaxLength': 1,
        '@odata.SRID': 1,
        '@odata.FixedLength': 1,
        '@odata.Collation': 1,
        '@odata.Unicode': 1,
      } : {};

      copyAnnotations(elem, flatElem, false, excludes);

      // Copy selected type properties
      const props = ['key', 'virtual', 'masked', 'viaAll'];
      // 'localized' is needed for OData
      if(options.toOdata)
        props.push('localized');
      for (const p of props) {
        if (elem[p]) {
          flatElem[p] = elem[p];
        }
      }
    });
    return result;
  }

  /**
   * Return a copy of 'ref' where all path steps resulting from struct traversal are
   * fused together into one step, using '_' (so that the path fits again for flattened
   * structs), e.g.
   *  [ (Entity), (struct1), (struct2), (assoc), (elem) ] should result in
   *  [ (Entity), (struct1_struct2_assoc), (elem) ]
   *
   * @param {CSN.Ref} ref
   * @param {CSN.Path} path CSN path to the ref
   * @param {object[]} [links] Pre-resolved links for the given ref - if not provided, will be calculated JIT
   * @param {string} [scope] Pre-resolved scope for the given ref - if not provided, will be calculated JIT
   * @param {WeakMap} [resolvedLinkTypes=new WeakMap()] A WeakMap with already resolved types for each link-step - safes an `artifactRef` call
   * @param {boolean} [suspend] suspend flattening by caller until association path step
   * @param {number} [suspendPos] suspend if starting pos is lower or equal to suspendPos and suspend is true
   * @param {boolean} [revokeAtSuspendPos] revoke suspension after suspendPos (binding parameter path use case)
   * @param {boolean} [flattenParameters] Whether to flatten references into structured parameters. OData flattens parameters, SQL/for.effective does not.
   *
   * @todo: Refactor to take config object instead of N boolean arguments.
   * @returns [string[], bool]
   */
  function flattenStructStepsInRef(ref, path, links, scope, resolvedLinkTypes=new WeakMap(), suspend=false, suspendPos=0, revokeAtSuspendPos=false, flattenParameters = false) {
    // A path is absolute if it starts with $self or a parameter. Then we must not flatten the first path step.
    const pathIsAbsolute = scope === '$self' || (!flattenParameters && scope === 'param');
    // Refs of length 1 cannot contain steps - no need to check
    if (ref.length < 2 || (pathIsAbsolute && ref.length === 2)) {
      return [ ref, false ];
    }

    const result = pathIsAbsolute ? [ref[0]] : [];
    //let stack = []; // IDs of path steps not yet processed or part of a struct traversal
    if(!links && !scope) { // calculate JIT if not supplied
      const res = inspectRef(path);
      links = res.links;
      scope = res.scope;
    }
    if (scope === '$magic')
      return [ ref, false ];

    // Don't process a leading $self - it will a .art with .elements!
    let i = pathIsAbsolute ? 1 : 0;

    // read property from resolved path link
    const art = (propName) =>
    (links[i].art?.[propName] ||
     effectiveType(links[i].art)[propName] ||
     (resolvedLinkTypes.get(links[i])||{})[propName]);

     let refChanged = false
     let flattenStep = false;
    suspend = !!art('items') || (suspend && i <= suspendPos);
    for(; i < links.length; i++) {

      if (flattenStep && !suspend) {
        result[result.length - 1] += pathDelimiter + (ref[i].id ? ref[i].id : ref[i]);
        // if we had a filter or args, we had an assoc so this step is done
        // we then keep along the filter/args by updating the id of the current ref
        if(ref[i].id) {
          ref[i].id = result[result.length-1];
          result[result.length-1] = ref[i];
        }
        refChanged = true;
        // suspend flattening if the next path step has some 'items'
        suspend = !!art('items');
      }
      else {
        result.push(ref[i]);
        suspend ||= !!art('items');
      }
      // revoke items suspension for next assoc step
      if(suspend && art('target') || (revokeAtSuspendPos && i === suspendPos))
        suspend = false;

      flattenStep = !links[i].art?.kind &&
        !links[i].art?.SELECT &&
        !links[i].art?.from &&
        art('elements');
    }
    return [ result, refChanged ];
  }

  /**
   * Replace the type of 'nodeWithType' with its final base type, i.e. copy relevant type properties and
   * set the `type` property to the builtin if scalar or delete it if structured/arrayed.
   *
   * @param {object} nodeWithType
   * @param {WeakMap} [resolved] WeakMap containing already resolved refs
   * @param {boolean} [keepLocalized=false] Whether to clone .localized from a type def
   */
  function toFinalBaseType(nodeWithType, resolved = new WeakMap(), keepLocalized = false) {
    const type = nodeWithType?.type;
    if (!type || nodeWithType.elements || nodeWithType.items || resolved.has(nodeWithType)) {
      return;
    }
    // The caller may use `{ art }` syntax for `{ ref }` objects, but we only use
    // it to indicate that an artifact has been processed.
    resolved.set(nodeWithType, nodeWithType);

    // Nothing to copy from builtin.
    if (typeof type === 'string' && isBuiltinType(type))
      return;

    const typeRef = getFinalTypeInfo(type, (t) => resolved.get(t)?.art || csnUtils.artifactRef(t));
    if(!typeRef)
      return;

    if (typeRef.elements || typeRef.items) {
      // Copy elements/items and we're finished. No need to look up actual base type,
      // since it must also be structured and must contain at least as many elements,
      // if not more (in client style CSN).
      if (typeRef.elements && !(options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds'))
        nodeWithType.elements = cloneCsnDict(typeRef.elements, options);
      else if (typeRef.items)
        nodeWithType.items = cloneCsnNonDict(typeRef.items, options);

      return;
    }

    if (typeRef.enum && nodeWithType.enum === undefined)
      nodeWithType.enum = cloneCsnDict(typeRef.enum, options);

    // Copy type and type arguments (+ localized)

    for (const param of typeParameters.list) {
      if (nodeWithType[param] === undefined && typeRef[param] !== undefined &&!typeRef.$default) {
        nodeWithType[param] = typeRef[param];
      }
    }
    if (keepLocalized && nodeWithType.localized === undefined && typeRef.localized !== undefined)
      nodeWithType.localized = typeRef.localized;
    if (typeRef.type)
      nodeWithType.type = typeRef.type;
  }

  // Return a full projection 'projectionId' of artifact 'art' for exposure in 'service'.
  // Add the created projection to the model and complain if artifact already exists.
  // Used by Draft generation
  function createExposingProjection(art, artName, projectionId, service) {
    const projectionAbsoluteName = `${service}.${projectionId}`;
    // Create elements matching the artifact's elements
    const elements = Object.create(null);
    art.elements && Object.entries(art.elements).forEach(([elemName, artElem]) => {
      const elem = Object.assign({}, artElem);
      // Transfer xrefs, that are redirected to the projection
      // TODO: shall we remove the transferred elements from the original?
      // if (artElem._xref) {
      //   setProp(elem, '_xref', artElem._xref.filter(xref => xref.user && xref.user._main && xref.user._main._service == service));
      // }
      // FIXME: Remove once the compactor no longer renders 'origin'
      elements[elemName] = elem;
    });

    const query = {
      'SELECT': {
        'from': {
          'ref': [
            artName
          ]
        }
      }
    };
    // Assemble the projection itself and add it into the model
    const projection = {
      'kind': 'entity',
      projection: query.SELECT, // it is important that projection and query refer to the same object!
      elements
    };
    // copy annotations from art to projection
    for (const a of Object.keys(art).filter(x => x.startsWith('@'))) {
      projection[a] = art[a];
    }
    model.definitions[projectionAbsoluteName] = projection;
    return projection;
  }

  /**
   * Create a 'DraftAdministrativeData' projection on entity 'DRAFT.DraftAdministrativeData'
   * in service 'service' and add it to the model.
   *
   * For forRelationalDB, use String(36) instead of UUID and UTCTimestamp instead of Timestamp
   *
   * @param {string} service
   * @param {boolean} [hanaMode=false] Turn UUID into String(36)
   * @returns {CSN.Artifact}
   */
  function createAndAddDraftAdminDataProjection(service, hanaMode=false) {
    // Make sure we have a DRAFT.DraftAdministrativeData entity
    let draftAdminDataEntity = model.definitions['DRAFT.DraftAdministrativeData'];
    if (!draftAdminDataEntity) {
      draftAdminDataEntity = createAndAddDraftAdminDataEntity();
      model.definitions['DRAFT.DraftAdministrativeData'] = draftAdminDataEntity;
      if (isBetaEnabled(options, 'draftMessages')
          && options.transformation === 'odata'
          && !model.definitions['DRAFT.DraftAdministrativeData_DraftMessage']) {
        model.definitions['DRAFT.DraftAdministrativeData_DraftMessage'] = createDraftAdminDataMessagesType();
      }
      if(options.tenantDiscriminator && options.transformation !== 'odata')
        addTenantFieldToArt(model.definitions['DRAFT.DraftAdministrativeData'], options);
    }

    // Create a projection within this service
    return createExposingProjection(draftAdminDataEntity, 'DRAFT.DraftAdministrativeData', 'DraftAdministrativeData', service);

    /**
     * Create the 'DRAFT.DraftAdministrativeData' entity (unless it already exist)
     * Return the 'DRAFT.DraftAdministrativeData' entity.
     */
    function createAndAddDraftAdminDataEntity(artifactName = 'DRAFT.DraftAdministrativeData') {
      // Create the 'DRAFT.DraftAdministrativeData' entity
      const artifact = {
        kind: 'entity',
        elements: Object.create(null),
        '@Common.Label': '{i18n>Draft_DraftAdministrativeData}',
      }

      // key DraftUUID : UUID
      const draftUuid = createScalarElement('DraftUUID', hanaMode ? 'cds.String' : 'cds.UUID', true);
      if(hanaMode)
        draftUuid.DraftUUID.length = 36;

      draftUuid.DraftUUID['@UI.Hidden'] = true;
      draftUuid.DraftUUID['@Common.Label'] = '{i18n>Draft_DraftUUID}';
      addElement(draftUuid, artifact, artifactName);

      // CreationDateTime : Timestamp;
      const creationDateTime = createScalarElement('CreationDateTime', 'cds.Timestamp');
      creationDateTime.CreationDateTime['@Common.Label'] = '{i18n>Draft_CreationDateTime}';
      addElement(creationDateTime, artifact, artifactName);

      // CreatedByUser : String(256);
      const createdByUser = createScalarElement('CreatedByUser', 'cds.String');
      createdByUser['CreatedByUser'].length = 256;
      createdByUser.CreatedByUser['@Common.Label'] = '{i18n>Draft_CreatedByUser}';
      addElement(createdByUser, artifact, artifactName);

      // DraftIsCreatedByMe : Boolean;
      const draftIsCreatedByMe = createScalarElement('DraftIsCreatedByMe', 'cds.Boolean');
      draftIsCreatedByMe.DraftIsCreatedByMe['@UI.Hidden'] = true;
      draftIsCreatedByMe.DraftIsCreatedByMe['@Common.Label'] = '{i18n>Draft_DraftIsCreatedByMe}';
      addElement(draftIsCreatedByMe, artifact, artifactName);

      // LastChangeDateTime : Timestamp;
      const lastChangeDateTime = createScalarElement('LastChangeDateTime', 'cds.Timestamp');
      lastChangeDateTime.LastChangeDateTime['@Common.Label'] = '{i18n>Draft_LastChangeDateTime}';
      addElement(lastChangeDateTime, artifact, artifactName);

      // LastChangedByUser : String(256);
      const lastChangedByUser = createScalarElement('LastChangedByUser', 'cds.String');
      lastChangedByUser['LastChangedByUser'].length = 256;
      lastChangedByUser.LastChangedByUser['@Common.Label'] = '{i18n>Draft_LastChangedByUser}';
      addElement(lastChangedByUser, artifact, artifactName);

      // InProcessByUser : String(256);
      const inProcessByUser = createScalarElement('InProcessByUser', 'cds.String');
      inProcessByUser['InProcessByUser'].length = 256;
      inProcessByUser.InProcessByUser['@Common.Label'] = '{i18n>Draft_InProcessByUser}';
      addElement(inProcessByUser, artifact, artifactName);

      // DraftIsProcessedByMe : Boolean;
      const draftIsProcessedByMe = createScalarElement('DraftIsProcessedByMe', 'cds.Boolean');
      draftIsProcessedByMe.DraftIsProcessedByMe['@UI.Hidden'] = true;
      draftIsProcessedByMe.DraftIsProcessedByMe['@Common.Label'] = '{i18n>Draft_DraftIsProcessedByMe}';
      addElement(draftIsProcessedByMe, artifact, artifactName);

      if (isBetaEnabled(options, 'draftMessages')) {
        const messages = { DraftMessages: { } };
        if (options.transformation === 'odata') {
          messages.DraftMessages = { items: { type: 'DRAFT.DraftAdministrativeData_DraftMessage' } };
        } else {
          messages.DraftMessages = { type: 'cds.LargeString' };
        }
        messages.DraftMessages['@cds.api.ignore'] = true;
        addElement(messages , artifact, artifactName);
      }

      return artifact;
    }
  }

  // Create the artificial 'DRAFT.Draf tAdministrativeData_DraftMessage' type
  // for the beta feature 'draftMessages'
  function createDraftAdminDataMessagesType() {
    const messagesType = {
      kind: 'type',
      elements: Object.create(null)
    }

    addElement(createScalarElement('code', 'cds.String'), messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    addElement(createScalarElement('message', 'cds.String'), messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    addElement(createScalarElement('target', 'cds.String'), messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    addElement({ 'additionalTargets': createScalarElement('items', 'cds.String') }, messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    addElement(createScalarElement('transition', 'cds.Boolean'), messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    addElement(createScalarElement('numericSeverity', 'cds.UInt8'), messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    addElement(createScalarElement('longtextUrl', 'cds.String'), messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    // the tag element not needed for now, but might be added later on
    // addElement(createScalarElement('tag', 'cds.String'), messagesType, 'DRAFT.DraftAdministrativeData_DraftMessage');
    // setAnnotation(messagesType.tag, '@cds.api.ignore', true);
    return messagesType;
  }

  // Checks if the given definition is a valid 'DRAFT.DraftAdministrativeData_DraftMessage' type
  function isValidDraftAdminDataMessagesType(def) {
    const expectedType = createDraftAdminDataMessagesType();
    return isDeepEqual(def, expectedType, false);
  }

  // Create an artificial scalar element 'elemName' with final type 'typeName'.
  // Make the element a key element if 'isKey' is true.
  // Add a default value 'defaultVal' if supplied
  // example result: { foo: { type: 'cds.Integer', key: true, default: { val: 6 }, notNull: true } }
  //                   ^^^            ^^^^^^^^^       ^^^^                   ^^             ^^
  //                 elemName         typeName        isKey               defaultVal       notNull
  function createScalarElement(elemName, typeName, isKey = false, defaultVal = undefined, notNull=false) {
    if (!isBuiltinType(typeName) && !model.definitions[typeName]) {
      throw new ModelError('Expecting valid type name: ' + typeName);
    }
    const result = {
      [elemName]: {
        type: typeName
      }
    };
    if (isKey) {
      result[elemName].key = true;
    }
    if (defaultVal !== undefined) {
      result[elemName].default = {
        val: defaultVal,
      }
    }
    if(notNull) {
      result[elemName].notNull = true;
    }
    return result;
  }

  // Create an artificial element 'elemName' of type 'cds.Association',
  // having association target 'target'. If 'isManaged' is true, take all keys
  // of 'target' as foreign keys.
  // e.g. result:
  // { toFoo: {
  //     type: 'cds.Association', target: 'Foo',
  //     keys: [{ ref: ['id'] }]
  // } }
  function createAssociationElement(elemName, target, isManaged = false) {
    const elem = createScalarElement(elemName, 'cds.Association', false, undefined);
    const assoc = elem[elemName];
    assoc.target = target;

    if (isManaged) {
      assoc.keys = [];
      const targetArt = getCsnDef(target);
      targetArt.elements && Object.entries(targetArt.elements).forEach(([keyElemName, keyElem]) => {
        if (keyElem.key) {
          const foreignKey = createForeignKey(keyElemName, keyElem);
          addForeignKey(foreignKey, assoc);
        }
      });
    }
    return elem;
  }

  // Create a comparison operation <assoc>.<foreignElem> <op> <elem>.
  // return an array to be spread in an on-condition
  // e.g. [ { ref: ['SiblingEntity','ID'] }, '=', { ref: ['ID'] } ]
  //                 ^^^^^          ^^^      ^^           ^^^
  //                 assoc      foreignElem  op           elem
  function createAssociationPathComparison(assoc, foreignElem, op, elem) {
    return [
      { ref: [assoc, foreignElem] }, op, { ref: [elem] }
    ]
  }

  // Create an artificial foreign key 'keyElemName' for key element 'keyElem'. Note that this
  // only creates a foreign key, not the generated foreign key element.
  // TODO: check the usage of this function's param 'keyElem' ?
  function createForeignKey(keyElemName, keyElem = undefined) { /* eslint-disable-line no-unused-vars */

    return {
      ref: [keyElemName]
      // TODO: do we need these two?
      // calculated: true,
      // $inferred: 'keys',
    }
  }

  // Add foreign key 'foreignKey' to association element 'elem'.
  function addForeignKey(foreignKey, elem) {
    // Sanity checks
    if (!elem.target || !elem.keys) {
      throw new ModelError('Expecting managed association element with foreign keys');
    }

    // Add the foreign key
    elem.keys.push(foreignKey);
  }


  /**
   * Add element 'elem' to 'artifact'
   *
   * @param {any} elem is in form: { b: { type: 'cds.String' } }
   * @param {CSN.Artifact} artifact is: { kind: 'entity', elements: { a: { type: 'cds.Integer' } ... } }
   * @param {string} [artifactName] Name of the artifact in `csn.definitions[]`.
   * @returns {void}
   */
  function addElement(elem, artifact, artifactName) {
    // Sanity check
    if (!artifact.elements) {
      throw new ModelError('Expecting artifact with elements: ' + JSON.stringify(artifact));
    }
    const elemName = Object.keys(elem)[0];
    // Element must not exist
    if (artifact.elements[elemName]) {
      let path = null;
      if (artifactName) {
        path = ['definitions', artifactName, 'elements', elemName];
      }
      error(null, path, { name: elemName }, 'Generated element $(NAME) conflicts with existing element');
      return;
    }

    // Add the element
    Object.assign(artifact.elements, elem);
  }

  /**
   * Make a copy of element 'elem' (e.g. { elem: { type: 'cds.Integer' } })
   * and add it to 'artifact' under the new name 'elemName'.
   * ( e.g. { artifact: { elements: { elemName: { type: 'cds.Integer' } } })
   * Return the newly created element
   * (e.g. { elemName: { type: 'cds.Integer' } })
   *
   * @param {object} elem
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   * @param {string} elementName
   */
  function copyAndAddElement(elem, artifact, artifactName, elementName) {
    if (!artifact.elements) {
      throw new ModelError('Expected structured artifact');
    }
    // Must not already have such an element
    if (artifact.elements[elementName]) {
      const path = ['definitions', artifactName, 'elements', elementName];
      error(null, path, { name: elementName }, 'Generated element $(NAME) conflicts with existing element');
    }

    const result = Object.create(null);
    result[elementName] = {};
    elem && Object.entries(elem).forEach(([prop, value]) => {
      result[elementName][prop] = value;
    });
    Object.assign(artifact.elements, result);
    return result;
  }

  // Create an artificial action 'actionName' with return type artifact 'returnType' optionally with one parameter 'paramName'
  // of type name 'paramTypeName'
  function createAction(actionName, returnTypeName = undefined, paramName = undefined, paramTypeName = undefined) {
    // Assemble the action
    const result = {
      [actionName]: {
        kind: 'action'
      }
    };

    const action = result[actionName];

    if (returnTypeName) {
      if (!isBuiltinType(returnTypeName) && !model.definitions[returnTypeName])
        throw new ModelError('Expecting valid return type name: ' + returnTypeName);
      action.returns = { type: returnTypeName };
      // TODO: What about annotation propagation from return type to `returns`?
    }

    // Add parameter if provided
    if (paramName && paramTypeName) {
      if (!isBuiltinType(paramTypeName) && !model.definitions[paramTypeName])
        throw new ModelError('Expecting valid parameter type name: ' + paramTypeName);

      action.params = Object.create(null);
      action.params[paramName] = {
        type: paramTypeName
      }
    }

    return result;
  }

  /**
   * Add action 'action' to 'artifact' but don't overwrite existing action
   *
   * @param {object} action Action that shall be added to the given artifact.
   *                        In form of `{ myAction: { kind: 'action', returns ... } }`
   * @param {CSN.Artifact} artifact Artifact in the form of `{ kind: 'entity', elements: ... }`
   **/
  function assignAction(action, artifact) {
    if (!artifact.actions) {
      artifact.actions = Object.create(null);
    }

    const actionName = Object.keys(action)[0];
    // Element must not exist
    if (!artifact.actions[actionName]) {
      // Add the action
      Object.assign(artifact.actions, action);
    }
  }

  /**
   * If the element has annotation @cds.valid.from or @cds.valid.to, return it.
   *
   * @param {any} element Element to check
   * @param {Array} path path in CSN for error messages
   * @returns {Array[]} Array of arrays, first filed has an array with the element if it has @cds.valid.from,
   *                    second field if it has @cds.valid.to. Default value is [] for each field.
   */
  function extractValidFromToKeyElement(element, path) {
    const validFroms = [], validTos = [], validKeys = [];
    if (element['@cds.valid.from'])
      validFroms.push({ element, path: [...path] });
    if (element['@cds.valid.to'])
      validTos.push({ element, path: [...path] });
    if (element['@cds.valid.key'])
      validKeys.push({ element, path: [...path] });
    return [ validFroms, validTos, validKeys ];
  }

  /**
   * Check if the element can be annotated with the given annotation.
   * Only runs the check if:
   * - The artifact is not a type
   * - The artifact is not a view
   *
   * Signals an error, if:
   * - The element is structured
   * - Has a target
   * - Has an element as _parent.kind
   *
   * @param {string} annoName Annotation name
   * @param {object} element Element to be checked
   * @param {CSN.Path} path
   * @param {CSN.Artifact} artifact
   * @returns {boolean} True if no errors
   */
  function checkAssignment(annoName, element, path, artifact) {
    if (artifact.kind !== 'type' && !artifact.query) {
      // path.length > 4 to check for structured elements
      if (element.elements || element.target || path.length > 4) {
        error(null, path, { anno: annoName }, 'Element can\'t be annotated with $(ANNO)');
        return false;
      }
    }
    return true;
  }

  /**
   * Signals an error/warning if an annotation has been assigned more than once
   *
   * @param {any} array Array of elements that have the annotation
   * @param {any} annoName Name of the annotation
   * @param {CSN.Artifact} artifact Root artifact containing the elements
   * @param {string} artifactName Name of the root artifact
   * @param {boolean} [err=true] Down-grade to a warning if set to false
   */
  function checkMultipleAssignments(array, annoName, artifact, artifactName, err = true) {
    if (array.length > 1) {
      const loc = ['definitions', artifactName];
      if (err === true) {
        error(null, loc, { anno: annoName }, 'Annotation $(ANNO) must be assigned only once');
      } else {
        warning(null, loc, { anno: annoName },'Annotation $(ANNO) must be assigned only once');
      }
    }
  }

  /**
   * Calls `callback` for each element in `elements` property of `artifact` recursively.
   *
   * @param {CSN.Artifact} artifact the artifact
   * @param {CSN.Path} path path to get to `artifact` (mainly used for error messages)
   * @param {(art: CSN.Artifact, path: CSN.Path) => any} callback Function called for each element recursively.
   */
  function recurseElements(artifact, path, callback) {
    callback(artifact, path);
    const elements = artifact.elements;
    if (elements) {
      path.push('elements', null);
      forEach(elements, (name, obj) => {
        path[path.length - 1] = name;
        recurseElements(obj, path, callback);
      });
      // reset path for subsequent usages
      path.length -= 2; // equivalent to 2x pop()
    }
  }

  // Rename annotation 'fromName' in 'node' to 'toName' (both names including '@')
  function renameAnnotation(node, fromName, toName) {
    const annotation = node && node[fromName];
    // Sanity checks
    if (!fromName.startsWith('@')) {
      throw new CompilerAssertion('Annotation name should start with "@": ' + fromName);
    }
    if (!toName.startsWith('@')) {
      throw new CompilerAssertion('Annotation name should start with "@": ' + toName);
    }
    if (annotation === undefined) {
      throw new CompilerAssertion('Annotation ' + fromName + ' not found in ' + JSON.stringify(node));
    }
    if(node[toName] == null) {
      delete node[fromName];
      node[toName] = annotation;
    }
  }

  /**
   * Assign annotation to a node but do not overwrite already existing annotation assignment
   * that is (assignment is either undefined or has null value)
   *
   * @param {object} node Assignee
   * @param {string} name Annotation name
   * @param {any} value Annotation value
   * @returns {void}
   */
  function setAnnotation(node, name, value) {
    if (!name.startsWith('@')) {
      throw new CompilerAssertion('Annotation name should start with "@": ' + name);
    }
    if (value === undefined) {
      throw new CompilerAssertion('Annotation value must not be undefined');
    }
    node[name] ??= value;
  }

  /**
   * Assigns unconditionally annotation to a node, which means it overwrites already existing annotation assignment.
   * Overwriting is when the assignment differs from undefined and null, also when differs from the already set value.
   * Setting new assignment results false as return value and overwriting - true.
   *
   * @param {object} node Assignee
   * @param {string} name Annotation name
   * @param {any} value Annotation value
   * @param {function} info function that reports info messages
   * @param {CSN.Path} path location of the warning
   * @returns {boolean} wasOverwritten true when the annotation was overwritten
   */
  function resetAnnotation(node, name, value, info, path) {
    if (!name.startsWith('@')) {
      throw new CompilerAssertion('Annotation name should start with "@": ' + name);
    }
    if (value === undefined) {
      throw new CompilerAssertion('Annotation value must not be undefined');
    }

    const wasOverwritten = node[name] !== undefined && node[name] !== null && node[name] !== value;
    const oldValue = node[name];
    node[name] = value;
    if(wasOverwritten)
      info(null, path, { anno: name, prop: value, otherprop: oldValue },
      'Value $(OTHERPROP) of annotation $(ANNO) is overwritten with new value $(PROP)');
    return wasOverwritten;
  }

  /*
    Resolve the type of an artifact
    If art is undefined, stop
    If art has elements or items.elements, stop
    If art has a type and the type is scalar, stop
    If art has a named type or a type ref, resolve it
  */
  function resolveType(art) {
    while(art &&
          !((art.items && art.items.elements) || art.elements) &&
            (art.type &&
              ((!art.type.ref && !isBuiltinType(art.type)) || art.type.ref))) {
      if(art.type.ref)
        art = resolvePath(art.type);
      else
        art = model.definitions[art.type];
    }
    return art;
  }

  /**
   * Path resolution, attach artifact to each path step, if found,
   * Dereference types and follow associations.
   *
   * @param {any} path ref object
   * @param {any} art start environment
   * @returns {any} path with resolved artifacts or artifact
   * (if called with simple ref paths)
   */
  function resolvePath(path, art=undefined) {
    let notFound = false;
    for(let i = 0; i < path.ref.length && !notFound; i++) {
      const ps = path.ref[i];
      const id = ps.id || ps;
      if(art) {
        if(art.target)
          art = model.definitions[art.target].elements[id];
        else if(art.items && art.items.elements || art.elements) {
          art = (art.items && art.items.elements || art.elements)[id];
        }
        else
          art = undefined;
      }
      else {
        art = model.definitions[id];
      }
      art = resolveType(art);

      // if path step has id, store art
      if(ps.id && art)
        ps._art = art;
      notFound = !art;
    }
    // if resolve was called on constraint path, path has id.
    // Store art and return path, if called recursively for model ref paths,
    // return artifact only
    if(path.ref[0].id) {
      if(art)
        path._art = art;
      return path;
    }
    else return art;
  }

  /*
    Flatten structured leaf types and return an array of paths.

    Argument 'path' must be an object of the form
    { _art: <leaf_artifact>, ref: [...] }
    with _art identifying ref[ref.length-1]

    A produced path has the form { _art: <ref>, ref: [ <id> (, <id>)* ] }

    Flattening stops on all non structured elements, if followMgdAssoc=false.

    If fullRef is true, a path step is produced as { id: <id>, _art: <link> }
  */
  function flattenPath(path, fullRef=false, followMgdAssoc=false) {
    let art = path._art;
    if(art) {
      if(art && !((art.items && art.items.elements) || art.elements)) {
        if(followMgdAssoc && art.target && art.keys) {
          const rc = [];
          for(const k of art.keys) {
            const nps = { ref: k.ref.map(p => fullRef ? { id: p } : p ) };
            setProp(nps, '_art', k._art);
            const paths = flattenPath( nps, fullRef, followMgdAssoc );
            // prepend prefix path
            paths.forEach(p=>p.ref.splice(0, 0, ...path.ref));
            rc.push(...paths);
          }
          return rc;
        }
        if(art.type && art.type.ref)
          art = resolvePath(art.type);
        else if(art.type && !isBuiltinType(art.type))
          art = model.definitions[art.type];
      }
      const elements = art.items && art.items.elements || art.elements;
      if(elements) {
        const rc = []
        Object.entries(elements).forEach(([en, elt]) => {
          const nps = { ref: [ (fullRef ? { id: en, _art: elt } : en )] };
          setProp(nps, '_art', elt);
          const paths = flattenPath( nps, fullRef, followMgdAssoc );
          // prepend prefix path
          paths.forEach(p=>p.ref.splice(0, 0, ...path.ref));
          rc.push(...paths);
        });
        return rc;
      }
      else
        setProp(path, '_art', art);
    }
    return [path];
  }

  /**
   * Expand structured expression arguments to flat reference paths.
   * Structured elements are real sub element lists and managed associations.
   * All unmanaged association definitions are rewritten if applicable (elements/mixins).
   * Also, HAVING and WHERE clauses are rewritten. We also check for infix filters and
   * .xpr in columns.
   *
   * @todo Check if can be skipped for abstract entity  and or cds.persistence.skip ?
   * @param {CSN.Model} csn
   * @param {object} [options={}] "skipArtifact": (artifact, name) => Boolean to skip certain artifacts
   */
  function expandStructsInExpression(csn, options = {}) {
    applyTransformations(csn, {
      'on': (parent, name, on, path) => {
        parent.on = expand(parent.on, path.concat(name));
      },
      'having': (parent, name, having, path) => {
        parent.having = expand(parent.having, path.concat(name));
      },
      'where': (parent, name, where, path) => {
        parent.where = expand(parent.where, path.concat(name));
      },
      'xpr': (parent, name, xpr, path) => {
        parent.xpr = expand(parent.xpr, path.concat(name));
      }
    }, [], options);

    /*
      flatten structured leaf types and return array of paths
      Flattening stops on all non-structured types.
    */
    function expand(expr, location) {
      if (!Array.isArray(expr))
        return expr; // don't traverse strings, etc.
      const rc = [];
      for(let i = 0; i < expr.length; i++)
      {
        if(Array.isArray(expr[i]))
          rc.push(expr[i].map(e => expand(e, location)));

        if(i < expr.length-2)
        {
          let [lhs, op, not, rhs] = expr.slice(i);
          if(not !== 'not') {
            rhs = not;
            not = false;
          }
          if(lhs === undefined || op === undefined || rhs === undefined)
            return expr;

          // we might have to ad-hoc resolve a ref, since handleExists is run before hand and generates new refs.
          const lhsArt = lhs._art || lhs.ref && !lhs.$scope && inspectRef(location.concat(i)).art;
          const rhsArt = rhs._art || rhs.ref && !rhs.$scope && inspectRef(location.concat(i+2)).art;
          const lhsIsVal = (lhs.val !== undefined);
          // if ever rhs should be allowed to be a value uncomment this
          const rhsIsVal = (rhs === 'null' /*|| rhs.val !== undefined*/);

          // lhs & rhs must be expandable types (structures or managed associations)
          // if ever lhs should be allowed to be a value uncomment this
          if(!(lhsIsVal /*&& rhsIsVal*/) &&
             !(isDollarSelfOrProjectionOperand(lhs) || isDollarSelfOrProjectionOperand(rhs)) &&
             RelationalOperators.includes(op) &&
             (lhsIsVal || (lhsArt && lhs.ref && isExpandable(lhsArt))) &&
             (rhsIsVal || (rhsArt && rhs.ref && isExpandable(rhsArt)))
            ) {

            if(RestrictedOperators.includes(op)) {
              message('expr-unexpected-operator', location, { op }, 'Unexpected operator $(OP) in structural comparison');
            }
            // if path is scalar and no assoc or has no type (@Core.Computed) use original expression
            // only do the expansion on (managed) assocs and (items.)elements, array of check in ON cond is done elsewhere
            const lhspaths = lhsIsVal ? [] : flattenPath({ _art: lhsArt, ref: lhs.ref }, false, true );
            const rhspaths = rhsIsVal ? [] : flattenPath({ _art: rhsArt, ref: rhs.ref }, false, true );

            // mapping dict for lhs/rhs for mismatch check
            // strip lhs/rhs prefix from flattened paths to check remaining common trailing path
            // if path is idempotent, it doesn't produce new flattened paths (ends on scalar type)
            // key is then empty string on both sides '' (=> equality)
            // Path matches if lhs/rhs are available
            const xref = createXRef(lhspaths, rhspaths, lhs, rhs, lhsIsVal, rhsIsVal);
            const xrefkeys = Object.keys(xref);
            const xrefvalues = Object.values(xref);
            let cont = true;

            const prefix = (lhs, op, rhs) => {
              return `${lhsIsVal ? lhs.val : lhs.ref.join('.')} ${op} ${rhsIsVal ? rhs : rhs.ref.join('.')}`
            }
            if(op === 'like' && xrefvalues.reduce((a, v) => {
              return (v.lhs && v.rhs) ? a + 1: a;
            }, 0) === 0) {
              // error if intersection of paths is zero
              error(null, location,
                {
                  prefix: prefix(lhs, op, rhs)
                },
                'Expected compatible types for $(PREFIX)');
              cont = false;
            }

            cont && xrefkeys.forEach(xn => {
              const x = xref[xn];
              // do the paths match?
              if(op !== 'like' && !(x.lhs && x.rhs)) {
                if(xn.length) {
                  error('expr-invalid-expansion', location, {
                    value: prefix(lhs, op, rhs),
                    name: xn,
                    alias: (x.lhs ? rhs : lhs).ref.join('.')
                  },
                    'Missing sub path $(NAME) in $(ALIAS) for tuple expansion of $(VALUE); both sides must expand to the same sub paths');
                }
                else {
                  error(null, location,
                    {
                      prefix: prefix(lhs, op, rhs),
                      name: (x.lhs ? lhs : rhs).ref.join('.'),
                      alias: (x.lhs ? rhs : lhs).ref.join('.')
                    },
                    '$(PREFIX): Path $(NAME) does not match $(ALIAS)');
                }
                cont = false;
              }
              // lhs && rhs are present, consistency checks that affect both ends
              else {
                // is lhs scalar?
                // eslint-disable-next-line sonarjs/no-gratuitous-expressions
                if(!lhsIsVal && x.lhs && !isScalarOrNoType(x.lhs._art)) {
                  error(null, location,
                    {
                      prefix: prefix(lhs, op, rhs),
                      name: `${x.lhs.ref.join('.')}${(xn.length ? '.' + xn : '')}`
                    },
                    '$(PREFIX): Path $(NAME) must end on a scalar type')
                  cont = false;
                }
                // is rhs scalar?
                if(!rhsIsVal && x.rhs && !isScalarOrNoType(x.rhs._art)) {
                  error(null, location,
                    {
                      prefix: prefix(lhs, op, rhs),
                      name: `${x.rhs.ref.join('.')}${(xn.length ? '.' + xn : '')}`
                    },
                    '$(PREFIX): Path $(NAME) must end on a scalar type');
                  cont = false;
                }
                // info about type incompatibility if no other errors occurred
                // eslint-disable-next-line sonarjs/no-gratuitous-expressions
                if(!(lhsIsVal || rhsIsVal) && x.lhs && x.rhs && xn && cont) {
                  const lhst = getType(x.lhs._art);
                  const rhst = getType(x.rhs._art);
                  if(lhst !== rhst) {
                    info(null, location,
                      {
                        prefix: prefix(lhs, op, rhs),
                        name: xn
                      },
                      '$(PREFIX): Types for sub path $(NAME) don\'t match');
                  }
                }
              }
            });
            // don't continue if there are path errors
            if(!cont)
              return expr;

            // if lhs and rhs are refs set operator from 'like' to '='
            // eslint-disable-next-line sonarjs/no-gratuitous-expressions
            if(op === 'like' && !(lhsIsVal || rhsIsVal)) {
              op = '=';
            }
            // t_0 OR ... OR t_n with t = (a <not equal> b)
            const bop = (op === 'is' && not) || op === '!=' || op === '<>' ? 'or' : 'and';
            const xpr = { xpr: [] };
            xrefvalues.filter(x => x.lhs && x.rhs).forEach((x,i) => {
              xpr.i = i;
              if(i>0) {
                xpr.xpr.push(bop);
              }
              xpr.xpr.push(x.lhs);
              xpr.xpr.push(op);
              if(not)
                xpr.xpr.push('not')
              xpr.xpr.push(x.rhs);
            });
            if(xpr.i > 0) {
              delete xpr.i;
              rc.push(xpr);
            }
            else
              rc.push(...xpr.xpr);
            i += not ? 3 : 2;
          }
          else
            rc.push(expr[i]);
        }
        else
          rc.push(expr[i]);
      }
      return rc;

      function createXRef(lhspaths, rhspaths, lhs, rhs, lhsIsVal, rhsIsVal) {
        // mapping dict for lhs/rhs for mismatch check
        // strip lhs/rhs prefix from flattened paths to check remaining common trailing path
        // if path is idempotent, it doesn't produce new flattened paths (ends on scalar type)
        // key is then empty string on both sides '' (=> equality)
        // Path matches if lhs/rhs are available
        let xref;
        if(!lhsIsVal) {
          xref = lhspaths.reduce((a, v) => {
            a[v.ref.slice(lhs.ref.length).join('.')] = rhsIsVal ? { lhs: v, rhs } : { lhs: v };
            return a;
          }, Object.create(null));

          rhspaths.forEach(v => {
            const k = v.ref.slice(rhs.ref.length).join('.');
            if(xref[k])
              xref[k].rhs = v;
            else
                xref[k] = { rhs: v };
          });
        }
        else if(!rhsIsVal) {
          xref = rhspaths.reduce((a, v) => {
            a[v.ref.slice(rhs.ref.length).join('.')] = lhsIsVal ? { lhs, rhs: v } : { rhs: v };
            return a;
          }, Object.create(null));

          lhspaths.forEach(v => {
            const k = v.ref.slice(lhs.ref.length).join('.');
            if(xref[k])
              xref[k].lhs = v;
            else
                xref[k] = { lhs: v };
          });
        }
        return xref;
      }

      function getType(art) {
        const effArt = effectiveType(art);
        return Object.keys(effArt).length ? effArt : art.type;
      }

      function isExpandable(art) {
        art = effectiveType(art);
        if(art) {
          // items in ON conds are illegal but this should be checked elsewhere
          const elements = art.elements || (art.items && art.items.elements);
          return !!(elements || art.target && art.keys)
        }
        return false;
      }

      function isScalarOrNoType(art) {
        art = effectiveType(art);
        if (art) {
          const type = art.type || art.items?.type;
          // items in ON-conditions are illegal but this should be checked elsewhere
          const elements = art.elements || (art.items && art.items.elements);
          // @Core.Computed has no type
          return (!elements && !type ||
            (type && isBuiltinType(type) &&
              type !== 'cds.Association' && type !== 'cds.Composition' && type !== 'cds.Map'))
        }
        return false;
      }
    }
  }

}

/**
 * Mandatory input transformation for all backends:
 * Replace
 *     type: { ref: [ 'cds.<type>' ] }
 * with the direct type
 *     type: 'cds.<type>'
 *
 * @param {CSN.Model} csn
 */
function rewriteBuiltinTypeRef(csn) {
  const special$self = !csn?.definitions?.$self && '$self';
  applyTransformations(csn, {
    type: (parent, _prop, type) => {
      if(type?.ref && (
        isBuiltinType(type.ref[0]) ||
        type.ref[0] === special$self)
      ) {
        parent.type = type.ref[0];
      }
    }
  });
}

module.exports = {
  // This function retrieves the actual exports
  getTransformers,
  RelationalOperators,
  rewriteBuiltinTypeRef,
};
