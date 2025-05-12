'use strict';

const { isEdmPropertyRendered, transformAnnotationExpression } = require('../../model/csnUtils');
const { isBuiltinType, isMagicVariable } = require('../../base/builtins');
const edmUtils = require('../edmUtils.js');
const oDataDictionary = require('../../gen/Dictionary.json');
const preprocessAnnotations = require('./preprocessAnnotations.js');
const { forEachDefinition } = require('../../model/csnUtils');
const { isBetaEnabled, setProp } = require('../../base/model.js');
const { xpr2edmJson, getEdmJsonHandler } = require('./edmJson.js');
const { vocabularyDefinitions } = require('./vocabularyDefinitions.js');
const { EdmPathTypeMap } = require('../EdmPrimitiveTypeDefinitions.js');

/** ************************************************************************************************
 * csn2annotationEdm
 *
 * options:
 *   v - array with two boolean entries, first is for v2, second is for v4
 *   dictReplacement: for test purposes, replaces the standard oDataDictionary
 */
function csn2annotationEdm( reqDefs, reqDefsUtils, csnVocabularies, serviceName,
                            Edm, options, messageFunctions, mergedVocDefs = vocabularyDefinitions ) {
  const gAnnosArray = []; // global variable where we store all the generated annotations
  const usedExperimentalTerms = {}; // take note of all experimental annos that have been used
  const usedDeprecatedTerms = {}; // take note of all deprecated annos that have been used

  const { v } = options;
  const { message, error } = messageFunctions;
  const { handleEdmJson } = getEdmJsonHandler(Edm, options, messageFunctions, handleTerm);

  const [ userDefinedTermDict, allKnownVocabularies ] = createUserDefinedTermDictionary();


  allKnownVocabularies.push(...Object.keys(mergedVocDefs));
  allKnownVocabularies.sort((a, b) => b.length - a.length);
  const whatsMyTermNamespace = anno => allKnownVocabularies.reduce((rc, ns) => (!rc && anno && anno.startsWith(`@${ ns }.`) ? ns : rc), undefined);

  // annotation preprocessing
  preprocessAnnotations.preprocessAnnotations(reqDefs, serviceName, options, messageFunctions);

  // we take note of which vocabularies are actually used in a service in order to avoid
  // producing useless references; reset everything to "unused"
  for (const n in mergedVocDefs) {
    mergedVocDefs[n].used = false;
    delete mergedVocDefs[n].$ignore;
  }

  // These vocabularies are always added for the runtimes
  mergedVocDefs.Common.used = true;
  mergedVocDefs.Core.used = true;

  const vocDef = mergedVocDefs[serviceName];
  if (vocDef && vocDef.$optVocRef) {
    setProp(vocDef, '$ignore', true);
    message('odata-anno-vocref', null,
            { name: serviceName, '#': 'service' } );
  }

  forEachDefinition(reqDefs, (def, defName) => {
    if (defName.startsWith(`${ serviceName }.`))
      assignParameterAnnotations(def);
  });

  // Crawl over the csn and trigger the annotation translation for all kinds
  //   of annotated things.
  // Note: only works for single service
  // Note: we assume that all objects lie flat in the service, i.e. objName always
  //       looks like <service name, can contain dots>.<id>
  forEachDefinition(reqDefs, (def, defName) => {
    if (defName === serviceName || defName.startsWith(`${ serviceName }.`)) {
      const location = [ 'definitions', defName ];
      // the <objName> is not the carrier name for <objName>Type
      // and sometimes the object.name doesn't have a service prefix
      if (def.name && def.name.startsWith(`${ serviceName }.`))
        defName = def.name;
      if (def.kind === 'action' || def.kind === 'function')
        handleAction(defName, def, null, location);
      else
        handleDefinition(defName, def, location);
    }
  });

  // filter out empty <Annotations...> elements
  // add references for the used vocabularies
  return {
    annos: gAnnosArray,
    usedVocabularies: Object.values(mergedVocDefs).filter(voc => voc.used),
    xrefs: Object.values(userDefinedTermDict.xrefs).filter(voc => voc.used).map(voc => voc.$myServiceRoot),
  };

  //-------------------------------------------------------------------------------------------------
  //-------------------------------------------------------------------------------------------------
  //-------------------------------------------------------------------------------------------------

  // helper to determine the OData version
  // TODO: improve option handling
  function isV2() {
    return v && v[0];
  }

  function assignParameterAnnotations( def ) {
    // Copy annotations from origin to parameter entity if it's
    // qualified with #$parameters or if its applicable to an EntitySet or Singleton
    const scopeCheck = {
      ref: (elemref, prop, xpr, path) => {
        if (scopeCheck.scope === 'param' &&
          !isMagicVariable(xpr[0]) &&
          (!elemref.param ||
           (xpr[0].id || xpr[0]) === '$self' && !def.elements.$self)) {
          error('odata-anno-xpr-ref', path, { anno: scopeCheck.anno, elemref, '#': 'notaparam' });
          // don't try to resolve those paths later on
          delete elemref[prop];
        }
        if (scopeCheck.scope === 'type' && elemref.param) {
          error('odata-anno-xpr-ref', path, { anno: scopeCheck.anno, elemref, '#': 'notaneelement' });
          delete elemref[prop];
        }
        if (scopeCheck.scope === 'param' && elemref.param) {
          // make sure that path is resolvable as element path later on
          delete elemref.param;
          const head = xpr[0].id || xpr[0];
          if (head[0] === '$')
            xpr.unshift('$self');
        }
      },
    };
    const checkDict = (dict, scope) => {
      if (dict) {
        scopeCheck.scope = scope;
        Object.values(dict).forEach((carrier) => {
          const knownAnnos = filterKnownAnnotations(carrier);
          knownAnnos.forEach((pn) => {
            scopeCheck.anno = pn;
            transformAnnotationExpression(carrier, pn, scopeCheck, carrier.$path);
          });
        });
      }
    };
    const checkObj = (obj, scope) => {
      scopeCheck.scope = scope;
      const knownAnnos = filterKnownAnnotations(obj);
      knownAnnos.forEach((pn) => {
        scopeCheck.anno = pn;
        transformAnnotationExpression(obj, pn, scopeCheck, obj.$path);
      });
    };
    if (def.$isParamEntity && def._origin) {
      // check for correct paths
      if (def._origin.$paramsAnnoProxies) {
        def.$elementsAnnoProxies = def._origin.$paramsAnnoProxies;
        checkDict(def.$elementsAnnoProxies, 'param');
      }
      checkDict(def._origin.$elementsAnnoProxies, 'type');
      checkDict(def.elements, 'param');
      checkDict(def._origin.elements, 'type');

      scopeCheck.scope = 'param';
      Object.keys(def._origin).forEach((attr) => {
        if (attr[0] === '@') {
          scopeCheck.anno = attr;
          const [ prefix, innerAnnotation ] = attr.split('.@');
          const ns = whatsMyTermNamespace(prefix);
          if (ns) {
            const steps = prefix.replace(`@${ ns }.`, '').split('.');
            const paramAnnoParts = steps[0].split('#$parameters');
            const dictTerm = getDictTerm(`${ ns }.${ paramAnnoParts[0] }`, options);
            if (paramAnnoParts.length > 1 ||
                [ 'Singleton', 'EntitySet' ].some(y => dictTerm?.AppliesTo?.includes(y))) {
              steps[0] = `@${ ns }.${ paramAnnoParts.join('') }`;
              let newAnno = steps.join('.');
              if (innerAnnotation)
                newAnno += `.@${ innerAnnotation }`;
              edmUtils.assignAnnotation(def, newAnno, def._origin[attr]);
              transformAnnotationExpression(def._origin, attr, scopeCheck, def._origin.$path);
              if (paramAnnoParts.length > 1)
                delete def._origin[attr];
            }
          }
        }
      });
      checkObj(def._origin, 'type');
    }
  }

  /*
  Mapping annotated thing in cds/csn => annotated thing in edmx:

  carrier: the annotated thing in cds, can be: service, entity, structured type, element of entity or structured type,
                                               action/function, parameter of action/function
  target: the annotated thing in OData

  In the edmx, all annotations for a OData thing are put into an element
    <Annotations Target="..."> where Target is the full name of the target
  There is one exception (Schema), see below

  carrier = service
    the target is the EntityContainer, unless the annotation has an "AppliesTo"
    where only Schema is given, but not EntityContainer then the <Annotation ...>
    is directly put into <Schema ...> without an enclosing <Annotations ...>

  carrier = entity (incl. view/projection)
    the target is the corresponding EntityType, unless the annotation has an
    "AppliesTo" where only EntitySet is given, but not EntityType then the target
    is the corresponding EntitySet

  carrier = structured type
    the target is the corresponding ComplexType

  carrier = element of entity or structured type
    the target is the corresponding Property of the EntityType/ComplexType: Target = <entity/type>/<element>

  carrier = action/function
    v2, unbound:          Target = <service>.EntityContainer/<action/function>
    v2, bound:            Target = <service>.EntityContainer/<entity>_<action/function>
    v4, unbound action:   Target = <service>.<action>()
    v4, bound action:     Target = <service>.<action>(<service>.<entity>)
    v4, unbound function: Target = <service>.<function>(<1st param type>, <2nd param type>, ...)
    v4, bound function:   Target = <service>.<function>(<service>.<entity>, <1st param type>, <2nd param type>, ...)

  carrier = parameter of action/function
    like above, but append "/<parameter" to the Target
*/

  function handleDefinition( defName, def, location ) {
    // definition bound annotations
    handleAnnotations(defName, def, { location });
    // definition bound element annotations
    if (def.$elementsAnnoProxies) {
      Object.entries(def.$elementsAnnoProxies).forEach(([ elemPath, element ]) => {
        const edmTargetName = `${ defName }/${ elemPath }`;
        handleAnnotations(edmTargetName, element,
                          {
                            location: element.$path,
                            csnPath: [ ...location, '$elementsAnnoProxies', elemPath ],
                          });
      });
    }
    // element bound annotations
    if (def.elements) {
      Object.entries(def.elements).forEach(([ elemName, element ]) => {
        const edmTargetName = `${ defName }/${ elemName }`;
        const eLocation = [ ...location, 'elements', elemName ];
        handleAnnotations(edmTargetName, element, { location: eLocation });
      });
    }
    // bound actions
    if (def.actions)
      handleBoundActions(defName, def, location);
  }

  // Annotations for actions and functions (and their parameters)
  // v2, unbound:          Target = <service>.EntityContainer/<action/function>
  // v2, bound:            Target = <service>.EntityContainer/<entity>_<action/function>
  // v4, unbound action:   Target = <service>.<action>()
  // v4, bound action:     Target = <service>.<action>(<service>.<entity>)
  // v4, unbound function: Target = <service>.<function>(<1st param type>, <2nd param type>, ...)
  // v4, bound function:   Target = <service>.<function>(<service>.<entity>, <1st param type>, <2nd param type>, ...)

  // handle the annotations of cObject's (an entity) bound actions/functions and their parameters
  // in: cObjectname : qualified name of the object that holds the actions
  //     cObject     : the object itself
  function handleBoundActions( cObjectname, cObject, location ) {
    // get service name: remove last part of the object name
    // only works if all objects ly flat in the service
    const nameParts = cObjectname.split('.');
    const entityName = nameParts.pop();

    Object.entries(cObject.actions).forEach(([ n, action ]) => {
      setProp(action, '$isBound', true);
      const actionName = `${ serviceName }.${ isV2() ? `${ entityName }_` : '' }${ n }`;
      handleAction(actionName, action, cObjectname, [ ...location, 'actions', n ]);
    });
  }

  // handle the annotations of an action and its parameters
  //   called by handleBoundActions and directly for unbound actions/functions
  // in: cActionName       : qualified name of the action
  //     cAction           : the action object
  //     entityNameIfBound : qualified name of entity if bound action/function
  function handleAction( cActionName, cAction, entityNameIfBound, location ) {
    let actionName = cActionName;

    if (isV2()) { // Replace up to last dot with <serviceName>.EntityContainer
      const lastDotIndex = actionName.lastIndexOf('.');
      if (lastDotIndex > -1)
        actionName = `${ serviceName }.EntityContainer/${ actionName.substring(lastDotIndex + 1) }`;
    }
    else { // add parameter type list
      actionName += relParList();
    }

    handleAnnotations(actionName, cAction, { location, cAction });

    if (cAction.params) {
      if (cAction.$paramsAnnoProxies) {
        Object.entries(cAction.$paramsAnnoProxies).forEach(([ paramPath, param ]) => {
          // skip explicit binding parameter in V2
          if (!(options.isV2() && param.type === '$self' && paramPath === cAction.$bindingParam?.name)) {
            const edmTargetName = `${ actionName }/${ paramPath }`;
            handleAnnotations(edmTargetName, param,
                              {
                                location: param.$path,
                                csnPath: [ ...location, '$paramsAnnoProxies', paramPath ],
                                cAction,
                              });
          }
        });
      }
      // explicit binding parameter is removed from params in V2 during
      // createActionV2(), no need to check ;)
      Object.entries(cAction.params).forEach(([ n, p ]) => {
        const edmTargetName = `${ actionName }/${ n }`;
        handleAnnotations(edmTargetName, p,
                          {
                            action: true,
                            location: [ ...location, 'params', n ],
                            cAction,
                          });
      });
    }
    if (cAction.returns) {
      if (cAction.$returnsAnnoProxies) {
        Object.entries(cAction.$returnsAnnoProxies).forEach(([ returnsPath, returns ]) => {
          const edmTargetName = `${ actionName }/${ returnsPath }`;
          handleAnnotations(edmTargetName, returns,
                            {
                              location: returns.$path,
                              csnPath: [ ...location, '$returnsAnnoProxies', returnsPath ],
                              cAction,
                            });
        });
      }
      const edmTargetName = `${ actionName }/$ReturnType`;
      setProp(cAction.returns, '$appliesToReturnType', true);
      handleAnnotations(edmTargetName, cAction.returns,
                        {
                          location: [ ...location, 'returns' ],
                          cAction,
                        });
      delete cAction.returns.$appliesToReturnType;
    }

    function relParList() {
      // we rely on the order of params in the csn being the correct one
      const params = [];
      if (entityNameIfBound) {
        // If this is an action and has an explicit binding parameter add it here
        if (cAction.$bindingParam && cAction.kind === 'action' ||
            cAction.$bindingParam?.viaAnno) {
          params.push(
            cAction.$bindingParam.items
              ? `Collection(${ entityNameIfBound })`
              : entityNameIfBound
          );
        }
      }
      // In case this is a function the explicit binding parameter is part of
      // the functions params dictionary. Only for functions all parameters must
      // be listed in the annotation target
      if (cAction.kind === 'function' && cAction.params) {
        Object.values(cAction.params).forEach((p) => {
          const isArrayType = !p.type && p.items && p.items.type;
          params.push(isArrayType ? `Collection(${ mapType(p.items) })` : mapType(p));
        });
      }
      return `(${ params.join(',') })`;

      function mapType( p ) {
        if (isBuiltinType(p.type)) {
          return edmUtils.mapCdsToEdmType(p, messageFunctions, options /* is only called for v4 */);
        }
        else if (options.whatsMySchemaName) {
          const schemaName = options.whatsMySchemaName(p._edmType || p.type);
          // strip the service namespace of from a parameter type
          if (schemaName && schemaName !== options.serviceName)
            return (p._edmType || p.type).replace(`${ options.serviceName }.`, '');
        }
        return p._edmType || p.type;
      }
    }
  }


  // handle all the annotations for a given cds thing, here called carrier
  //   edmTargetName : string, name of the target in edm
  //   carrier: object, the annotated cds thing, contains all the annotations
  //                    as properties with names starting with @
  //   ctx: locations and other information that is required to write the
  //        annotations
  function handleAnnotations( edmTargetName, carrier, ctx ) {
    // collect the names of the carrier's annotation properties
    // keep only those annotations that - start with a known vocabulary name
    //                                  - have a value other than null

    // if the carrier is an element that is not rendered or
    // if the carrier is a derived type of a primitive type which is not rendered in V2
    // if the carrier is a media stream element in V2
    // do nothing

    if (!isEdmPropertyRendered(carrier, options) ||
      (isV2() && (edmUtils.isDerivedType(carrier))))
      return;

    if (ctx.location == null)
      throw Error('location required');

    // Filter unknown toplevel annotations
    // Final filtering of all annotations is done in handleTerm

    let knownAnnos = filterKnownAnnotations(carrier);
    if (knownAnnos.length === 0)
      return;

    if (rewriteInnerAnnotations()) {
      knownAnnos = filterKnownAnnotations(carrier);
      if (knownAnnos.length === 0)
        return;
    }

    knownAnnos.forEach((knownAnno) => {
      if (knownAnno.search(/\.\$edmJson\./g) < 0) {
        transformAnnotationExpression(carrier, knownAnno, {
          ref: (elemref, prop, xpr, csnPath) => {
            if (options.isV2() && elemref.$bparam) {
              error('odata-anno-xpr-ref', ctx.location, {
                elemref, anno: knownAnno, version: '2.0', '#': 'bparam_v2_expl',
              });
              return;
            }
            const { links, scope } = reqDefsUtils.inspectRef(csnPath);
            let i = scope === '$self' ? 1 : 0;
            if (scope === '$magic') {
              error('odata-anno-xpr-ref', ctx.location, {
                elemref, anno: knownAnno, '#': 'magic',
              });
              return;
            }
            let stop = false;
            for (; i < links.length && !stop; i++) {
              if (!isEdmPropertyRendered(links[i].art, csnPath)) {
                error('odata-anno-xpr-ref', ctx.location, {
                  count: i + 1, elemref, anno: knownAnno, '#': 'notrendered',
                });
                stop = true;
              }
              if (links[i].art?._target?.$proxy && i < links.length - 1) {
                const proxy = links[i].art?._target;
                const eltName = links[i + 1].art?.name;
                if (!proxy.elements[eltName]) {
                  error('odata-anno-xpr-ref', ctx.location, {
                    count: i + 2, elemref, anno: knownAnno, '#': 'notrendered',
                  });
                  stop = true;
                }
              }
            }
            if (!stop && ctx.cAction?.$isBound && scope === '$self') {
              if (options.isV2()) {
                error('odata-anno-xpr-ref', ctx.location, {
                  elemref, anno: knownAnno, version: '2.0', '#': 'bparam_v2_impl',
                });
              }
              else {
                xpr[0] = ctx.cAction.$bindingParam.name;
                elemref.param = true;
              }
            }
          },
        }, ctx.csnPath || ctx.location);
        xpr2edmJson(carrier, knownAnno, ctx.location, options, messageFunctions);
      }
    });

    const prefixTree = createPrefixTree();

    // usually, for a given carrier there is one target
    // for some carriers (service, entity), there can be an alternative target (usually the EntitySet)
    //    alternativeEdmTargetName: name of alternative target
    // which one to choose depends on the "AppliesTo" message of the single annotations, so we have
    //   to defer this decision; this is why we here construct a function that can make the decision
    //   later when looking at single annotations

    const [
      stdEdmTargetName,           // either the schema path or the EntityContainer itself
      hasAlternativeCarrier,      // is the alternative annotation target available in the EDM?
      alternativeEdmTargetName,   // EntitySet path name
      testToStandardEdmTarget,    // if true, assign to standard Edm Target
      testToAlternativeEdmTarget, // if true, assign to alternative Edm Target
    ] = initCarrierControlVars();

    // collect produced Edm.Annotation nodes for various carriers
    const serviceAnnotations = [];
    const stdAnnotations = [];
    const alternativeAnnotations = [];

    // now create annotation objects for all the annotations of carrier
    handleAnno2(addAnnotation, prefixTree, ctx.location);

    // Produce Edm.Annotations and attach collected Edm.Annotation(s) to the
    // envelope (or directly to the Schema)
    if (serviceAnnotations.length)
      gAnnosArray.push(...serviceAnnotations.filter(a => a));

    if (stdAnnotations.length) {
      const annotations = new Edm.Annotations(v, stdEdmTargetName); // used in closure
      annotations.append(...stdAnnotations);
      gAnnosArray.push(annotations);
    }
    if (alternativeAnnotations.length) {
      const annotations = new Edm.Annotations(v, alternativeEdmTargetName);
      annotations.append(...alternativeAnnotations);
      gAnnosArray.push(annotations);
    }

    // construct a function that is used to add an <Annotation ...> to the
    //   respective collector array
    // this function is specific to the actual carrier, following the mapping rules given above
    function addAnnotation( annotation, appliesTo ) {
      let rc = false;
      if (testToAlternativeEdmTarget && appliesTo && testToAlternativeEdmTarget(appliesTo)) {
        if (carrier.kind === 'service') {
          if (isV2()) {
            // there is no enclosing <Annotations ...>, so for v2 the namespace needs to be mentioned here
            annotation.setXml( { xmlns: 'http://docs.oasis-open.org/odata/ns/edm' } );
          }
          serviceAnnotations.push(annotation); // for target Schema: no <Annotations> element
        }
        else if (hasAlternativeCarrier) {
          alternativeAnnotations.push(annotation);
        }
        rc = true;
      }
      if (testToStandardEdmTarget(appliesTo)) {
        stdAnnotations.push(annotation);
        rc = true;
      }
      // Another crazy hack due to this crazy function:
      // If carrier is a managed association (has keys) and rc is false (annotation was not applicable)
      // return true to NOT trigger 'unapplicable' message message
      if (rc === false && carrier.target && carrier.keys && appliesTo.includes('Property'))
        rc = true;
      return rc;
    }

    function initCarrierControlVars() {
      let testToStandardEdmTargetP = () => true; // if true, assign to standard Edm Target
      let stdEdmTargetNameP = edmTargetName;
      let alternativeEdmTargetNameP = null;
      let hasAlternativeCarrierP = false; // is the alternative annotation target available in the EDM?
      let testToAlternativeEdmTargetP = null; // if true, assign to alternative Edm Target

      if (carrier.kind === 'entity') {
      // If AppliesTo=[EntitySet/Singleton/Collection, EntityType], EntitySet/Singleton/Collection has precedence
        testToAlternativeEdmTargetP = ((x) => {
          if (x) {
            if (options.isV2())
              return [ 'Singleton', 'EntitySet', 'Collection' ].some(y => x.includes(y));
            return edmUtils.isSingleton(carrier)
              ? x.includes('Singleton')
              : [ 'EntitySet', 'Collection' ].some(y => x.includes(y));
          }
          return true;
        });
        testToStandardEdmTargetP = (x => (x ? x.includes('EntityType') : true));
        // if carrier has an alternate 'entitySetName' use this instead of EdmTargetName
        // (see edmPreprocessor.initializeParameterizedEntityOrView(), where parameterized artifacts
        // are split into *Parameter and *Type entities and their respective EntitySets are eventually
        // renamed.
        // (which is the definition key in the CSN and usually the name of the EntityType)
        // Replace up to last dot with <serviceName>.EntityContainer/
        alternativeEdmTargetNameP = carrier.$entitySetName || edmTargetName;
        const lastDotIndex = alternativeEdmTargetNameP.lastIndexOf('.');
        if (lastDotIndex > -1)
          alternativeEdmTargetNameP = `${ serviceName }.EntityContainer/${ alternativeEdmTargetNameP.substring(lastDotIndex + 1) }`;
        hasAlternativeCarrierP = carrier.$hasEntitySet;
      }
      else if (carrier.kind === 'type') {
        testToStandardEdmTargetP = (x => (x ? x.includes(carrier.elements ? 'ComplexType' : 'TypeDefinition') : true));
      }
      else if (carrier.kind === 'action' || carrier.kind === 'function') {
        const type = carrier.kind === 'action' ? 'Action' : 'Function';
        const container = carrier.kind === 'action' ? 'ActionImport' : 'FunctionImport';
        if (options.isV4()) {
          testToStandardEdmTargetP = (x => (x ? x.includes(type) : true));
          // Unbound actions/functions are Action/FunctionImports and are bound to container target
          testToAlternativeEdmTargetP = (x => (x ? x.includes(container) && !carrier.$isBound : true));
          const lastDotIndex = carrier.name.lastIndexOf('.');
          alternativeEdmTargetNameP = lastDotIndex > -1
            ? `${ serviceName }.EntityContainer/${ carrier.name.substring(lastDotIndex + 1) }`
            : `${ serviceName }.EntityContainer/${ carrier.name }`;
          hasAlternativeCarrierP = true;
        }
        if (options.isV2())
          // same as in V4 but everything goes to standard target
          testToStandardEdmTargetP = (x => (x ? x.includes(type) || (x.includes(container) && !carrier.$isBound) : true));
      }
      else if (carrier.kind === 'service') {
      // if annotated object is a service, annotation goes to EntityContainer,
      //   except if AppliesTo contains Schema but not EntityContainer, then annotation goes to Schema
        testToAlternativeEdmTargetP = (x => x.includes('Schema') && !x.includes('EntityContainer'));
        testToStandardEdmTargetP = ( x => (x ? (
        // either only AppliesTo=[EntityContainer]
          (!x.includes('Schema') && x.includes('EntityContainer')) ||
        // or AppliesTo=[Schema, EntityContainer]
        (x.includes('Schema') && x.includes('EntityContainer')))
          : true) );
        stdEdmTargetNameP = `${ edmTargetName }.EntityContainer`;
        alternativeEdmTargetNameP = edmTargetName;
        hasAlternativeCarrierP = true; // EntityContainer is always available
      }
      // element => decide if navprop or normal property
      else if (!carrier.kind) {
        // if appliesTo is undefined, return true
        if (carrier.target) {
          testToStandardEdmTargetP = (x => (x
            ? x.includes('NavigationProperty') ||
              carrier.cardinality && carrier.cardinality.max === '*' && x.includes('Collection')
            : true));
        }
        else if (carrier.$appliesToReturnType) {
          testToStandardEdmTargetP = (x => (x ? x.includes('ReturnType') : true));
        }
        else {
          // this might be more precise if handleAnnotation would know more about the carrier
          testToStandardEdmTargetP = (x => (x
            ? [ 'Parameter', 'Property' ].some(y => x.includes(y) ||
              carrier.$isCollection && x.includes('Collection'))
            : true));
        }
      }
      return [
        stdEdmTargetNameP,
        hasAlternativeCarrierP,
        alternativeEdmTargetNameP,
        testToStandardEdmTargetP,
        testToAlternativeEdmTargetP,
      ];
      /* all AppliesTo entries:
        "Action",
        "ActionImport",
        "Annotation",
        "Collection",
        "ComplexType",
        "EntityContainer",
        "EntitySet",
        "EntityType",
        "Function",
        "FunctionImport",
        "Include",
        "NavigationProperty",
        "Parameter",
        "Property",
        "PropertyValue",
        "Record",
        "Reference",
        "ReturnType",
        "Schema",
        "Singleton",
        "Term",
        "TypeDefinition"
      */
    }

    function rewriteInnerAnnotations() {
      let rc = false;
      for (const a of knownAnnos) {
        const [ prefix, innerAnnotation ] = a.split('.@');
        /*
          New inner annotation (de-)structuring of the core compiler to make
          $value arrays extendable via ellipsis
          @anno: { $value: [ ... ], @innerAnno: ... } is now cracked up by
          the core compiler into:
          @anno: [ ...]
          @anno.@innerAnno: ...

          Conflict handling if $value is present:
          @anno
          @anno.$value
          @anno.@innerAnno

          @anno has precedence (as it was before this change) but now
          @anno.$value is overwritten with @anno and the inner annotations
          are applied.

          Trigger is always the inner annotation, if no inner annotation
          is available, @anno has precedence.

          Insert $value into $edmJson with inner annotation as well.
        */
        if (innerAnnotation) {
          // != null => also != undefined
          if (carrier[prefix] != null) {
            const valPrefix = `${ prefix }.$value`;
            carrier[valPrefix] = carrier[prefix];
            delete carrier[prefix];
            rc = true;
          }
          const edmJsonPrefix = `${ prefix }.$edmJson`;
          if (carrier[edmJsonPrefix] != null) {
            const valPrefix = `${ prefix }.$value.$edmJson`;
            carrier[valPrefix] = carrier[edmJsonPrefix];
            delete carrier[edmJsonPrefix];
            rc = true;
          }
        }
      }
      return rc;
    }

    function createPrefixTree() {
      // in csn, all annotations are flattened
      // => values can be - primitive values (string, number)
      //                  - pseudo-records with "#" or "="
      //                  - arrays
      // in OData, there are "structured" annotations -> we first need to regroup the cds annotations
      //   by building a "prefix tree" for the annotations attached to the carrier
      //   see example at definition of function mergePathStepsIntoPrefixTree
      const prefixTreeP = {};

      for (const a of knownAnnos) {
      // remove leading @ and split at "."
      //   stop splitting at ".@" (used for nested annotations)
      // Inline JSON EDM allows to add annotations to record members
      // by prefixing the annotation with the record member 'foo@Common.Label'
      // The splitter should leave such annotations alone, handleEdmJson
      // takes care of assigning these annotations to the record members
        const [ prefix, innerAnnotation ] = a.split('.@');
        const ns = whatsMyTermNamespace(prefix);
        const steps = prefix.replace(`@${ ns }.`, '').split('.');
        steps.splice(0, 0, ns);
        let i = steps.lastIndexOf('$edmJson');
        if (i > -1) {
          i = steps.findIndex(s => s.includes('@'), i + 1);
          if (i > -1)
            steps.splice(i, steps.length - i, steps.slice(i).join('.'));
        }
        if (innerAnnotation) {
          // A voc annotation has two steps (Namespace+Name),
          // any further steps need to be rendered separately
          if (innerAnnotation.startsWith('sap.')) {
            steps.push(`@${ innerAnnotation }`);
          }
          else {
            const innerAnnoSteps = innerAnnotation.split('.');
            const tailSteps = innerAnnoSteps.splice(2, innerAnnoSteps.length - 2);
            // prepend annotation prefix (path) to tail steps
            tailSteps.splice(0, 0, `@${ innerAnnoSteps.join('.') }`);
            steps.push(...tailSteps);
          }
        }
        mergePathStepsIntoPrefixTree(prefixTreeP, steps, 0);
      }
      return prefixTreeP;

      // tree: object where to put the next level of names
      // path: the parts of the annotation name
      // index: index into that array pointing to the next name to be processed
      //   0  : vocabulary
      //   1  : term
      //   2+ : record properties
      //
      // example:
      //   @v.t1
      //   @v.t2.p1
      //   @v.t2.p2
      //   @v.t3#x.q1
      //   @v.t3#x.q2
      //   @v.t3#y.q1
      //   @v.t3#y.q2
      //
      //   { v : { t1 : ...,
      //           t2 : { p1 : ...,
      //                  p2 : ...   },
      //           t3#x : { q1 : ...,
      //                    q2 : ... }
      //           t3#y : { q1 : ...,
      //                    q2 : ... } } }
      function mergePathStepsIntoPrefixTree( tree, pathSteps, index ) {
      // TODO check nesting level > 3
        const name = pathSteps[index];
        if (index + 1 < pathSteps.length ) {
          if (!tree[name])
            tree[name] = {};

          mergePathStepsIntoPrefixTree(tree[name], pathSteps, index + 1);
        }
        else if (typeof tree === 'object' ) {
          tree[name] = carrier[`@${ pathSteps.join('.') }`];
        }
      }
    }
  }


  // handle all the annotations for a given carrier
  // addAnnotationFunc: a function that adds the <Annotation ...> tags created here into the
  //                    correct parent tag (see handleAnnotations())
  // prefixTree: the annotations
  function handleAnno2( addAnnotationFunc, prefixTree, location ) {
    // first level names of prefix tree are the vocabulary names
    // second level names are the term names
    // create an annotation tag <Annotation ...> for each term
    for (const voc of Object.keys(prefixTree)) {
      for (const term of Object.keys(prefixTree[voc])) {
        const fullTermName = `${ voc }.${ term }`;

        // msg is "semantic" location message used for messages
        const msg = {
          fullTermName,
          stack: [],
          location: [ ...location, `@${ fullTermName }` ],
        };
        msg.anno = () => msg.fullTermName + msg.stack.join('');

        // anno is the full <Annotation Term=...>
        const anno = handleTerm(fullTermName, prefixTree[voc][term], msg);
        if (!anno?.$isInvalid) {
          // addAnnotationFunc needs AppliesTo message from dictionary to decide where to put the anno
          const termName = fullTermName.replace(/#(\w+)$/g, ''); // remove qualifier
          const dictTerm = getDictTerm(termName, msg); // message for unknown term was already issued in handleTerm
          if (!addAnnotationFunc(anno, dictTerm && dictTerm.AppliesTo)) {
            if (dictTerm && dictTerm.AppliesTo) {
              message('odata-anno-def', location,
                      { anno: termName, rawvalues: dictTerm.AppliesTo, '#': 'notapplied' });
            }
          }
        }
      }
    }
  }


  // annoValue : the annotation value from the csn
  //             if the csn contains flattened out elements of a structured annotation,
  //             they are regrouped here
  // msg :   for messages
  // return :    object that represents the annotation in the result edmx
  function handleTerm( termName, annoValue, msg ) {
    /**
     * create the <Annotation ...> tag
     * @type {object}
     * */
    let newAnno;
    const omissions = { 'Aggregation.default': 1 };
    const nullList = { 'Core.OperationAvailable': 1, 'Core.OptionalParameter': 1 };
    if (annoValue != null && !omissions[termName] || nullList[termName]) {
    // termName may contain a qualifier: @UI.FieldGroup#shippingStatus
    // -> remove qualifier from termName and set Qualifier attribute in newAnno
      const i = termName.indexOf('#');
      const termNameWithoutQualifiers = i > 0 ? termName.substring(0, i) : termName;
      const qualifier = i >= 0 ? termName.substring(i + 1) : undefined;

      termNameWithoutQualifiers.split('.').forEach((id) => {
        if (!edmUtils.isODataSimpleIdentifier(id))
          message('odata-invalid-name', msg.location, { id });
      });
      newAnno = new Edm.Annotation(v, termNameWithoutQualifiers);
      if (qualifier?.length) {
        if (!edmUtils.isODataSimpleIdentifier(qualifier))
          message('odata-invalid-qualifier', msg.location, { id: qualifier });

        newAnno.setEdmAttribute('Term', termNameWithoutQualifiers);
        newAnno.setEdmAttribute('Qualifier', qualifier);
      }
      // get the type of the term from the dictionary
      let termTypeName = null;
      const dictTerm = getDictTerm(termNameWithoutQualifiers, msg);
      if (dictTerm) {
        termTypeName = dictTerm.Type;
      }
      else {
        // message if term is completely unknown or if vocabulary is unchecked
        const myVocDef = mergedVocDefs[whatsMyTermNamespace(`@${ termNameWithoutQualifiers }`)];
        if ((myVocDef?.int && myVocDef?.int?.filename) || !myVocDef)
          message('odata-anno-def', msg.location, { anno: termNameWithoutQualifiers });
      }

      // handle the annotation value and put the result into the <Annotation ...> tag just created above
      handleValue(annoValue, newAnno, termNameWithoutQualifiers, termTypeName, msg);
    }
    return newAnno;
  }


  // handle an annotation value
  //   cAnnoValue: the annotation value (c : csn)
  //   oTarget: the result object (o: odata)
  //   oTermName: current term
  //   dTypeNameArg: expected type of cAnnoValue according to dictionary, may be null (d: dictionary)
  function handleValue( cAnnoValue, oTarget, oTermName, dTypeNameArg, msg ) {
    // this function basically only figures out what kind of annotation value we have
    //   (can be: array, expression, enum, pseudo-record, record, simple value),
    //   then calls a more specific function to deal with it and puts
    //   the result into the oTarget object

    const [ dTypeName, dTypeIsACollection ] = stripCollection(dTypeNameArg);

    if (Array.isArray(cAnnoValue)) {
      if (isEnumType(dTypeName)) {
        // if we find an array although we expect an enum, this may be a "flag enum"
        checkMultiEnumValue();
        oTarget.setJSON({ EnumMember: generateMultiEnumValue(false), 'EnumMember@odata.type': `#${ dTypeName }` });
        oTarget.setXml( { EnumMember: generateMultiEnumValue(true) });
      }
      else {
        oTarget.append(generateCollection(cAnnoValue, oTermName, dTypeName, dTypeIsACollection, msg));
      }
    }
    else if (cAnnoValue && typeof cAnnoValue === 'object') {
      // an empty record is rendered as <Record/>
      if ('=' in cAnnoValue) {
        if (dTypeIsACollection) {
          message('odata-anno-value', msg.location,
                  { anno: msg.anno(), str: 'path', '#': 'incompval' });
        }
        // expression
        const res = handleExpression(cAnnoValue['='], dTypeName);
        oTarget.setXml( { [res.name]: res.value });
        oTarget.setJSON( { [res.name]: res.value });
      }
      else if (cAnnoValue['#'] !== undefined) {
        const enumSymbol = cAnnoValue['#'];
        // enum
        if (dTypeName) {
          const typeDef = getDictType(dTypeName);
          if (typeDef && typeDef.$Allowed && !typeDef.Members) {
            const allowedValue = typeDef.$Allowed.Symbols[enumSymbol];
            if (!allowedValue) {
              message('odata-anno-value', msg.location,
                      {
                        anno: msg.anno(),
                        type: dTypeName,
                        value: `"#${ enumSymbol }"`,
                        rawvalues: Object.keys(typeDef.$Allowed.Symbols).map(m => `#${ m }`),
                        '#': 'enum',
                      });
            }
            else {
              oTarget.setXml( { [typeDef.UnderlyingType?.replace('Edm.', '') || 'String']: allowedValue.Value || enumSymbol });
            }
          }
          else if (checkEnumValue(enumSymbol)) {
            oTarget.setXml( { EnumMember: `${ dTypeName }/${ enumSymbol }` });
          }
          else {
            oTarget.setXml( { String: enumSymbol });
          }
        }
        else {
          oTarget.setXml( { EnumMember: `${ oTermName }Type/${ enumSymbol }` });
        }
        oTarget.setJSON({ 'Edm.String': enumSymbol });
      }
      else if (cAnnoValue.$value !== undefined) {
        // "pseudo-structure" used for annotating scalar annotations
        handleValue(cAnnoValue.$value, oTarget, oTermName, dTypeNameArg, msg);

        const k = Object.keys(cAnnoValue).filter( x => x[0] === '@');
        if (!k || k.length === 0) {
          message('odata-anno-value', msg.location,
                  { anno: msg.anno(), str: 'nested', '#': 'nested' });
        }
        for (const nestedAnnoName of k) {
          const nestedAnno = handleTerm(nestedAnnoName.slice(1), cAnnoValue[nestedAnnoName], msg);
          oTarget.append(nestedAnno);
        }
      }
      else if (cAnnoValue.$edmJson) {
        // "pseudo-structure" used for embedding a piece of JSON that represents "OData CSDL, JSON Representation"
        oTarget.append(handleEdmJson(cAnnoValue.$edmJson, msg));
      }
      else if ( Object.keys(cAnnoValue).filter( x => x[0] !== '@' ).length === 0) {
        // object consists only of properties starting with "@", no $value
        setProp(oTarget, '$isInvalid', true);
        message('odata-anno-value', msg.location,
                { anno: msg.anno(), str: 'base', '#': 'nested' } );
      }
      else {
        // regular record
        if (dTypeIsACollection) {
          message('odata-anno-value', msg.location, {
            anno: msg.anno(), str: 'structured', type: dTypeName, '#': 'incompval',
          });
        }
        oTarget.append(generateRecord(cAnnoValue, oTermName, dTypeName, dTypeIsACollection, msg));
      }
    }
    else {
      const res = handleSimpleValue(cAnnoValue, dTypeName, msg);
      if (((oTermName === 'Core.OperationAvailable' && dTypeName === 'Edm.Boolean') ||
        (oTermName === 'Core.OptionalParameter' && dTypeName === 'Edm.String') ||
        (oTermName === 'Validation.AllowedValues' && dTypeName === 'Edm.PrimitiveType')) &&
        cAnnoValue === null) {
        oTarget.append(new Edm.ValueThing(v, 'Null'));
        oTarget._ignoreChildren = true;
      }
      else {
        oTarget.setXml( { [res.name]: res.value });
      }
      oTarget.setJSON( { [res.jsonName]: res.value });
    }
    // found an enum value ("#"), check whether this fits
    //  the expected type "dTypeName"
    function checkEnumValue( value ) {
      let rc = true;
      const expectedType = getDictType(dTypeName);
      if (!expectedType && !isPrimitiveType(dTypeName)) {
        message('odata-anno-dict', msg.location,
                { anno: msg.anno(), type: dTypeName });
      }
      else if (isComplexType(dTypeName) || isPrimitiveType(dTypeName) || expectedType.$kind !== 'EnumType') {
        message('odata-anno-value', msg.location,
                {
                  anno: msg.anno(),
                  type: dTypeName,
                  value: `"#${ value }"`,
                });
        rc = false;
      }
      else if (!expectedType.Members.includes(value)) {
        message('odata-anno-value', msg.location,
                {
                  anno: msg.anno(),
                  type: dTypeName,
                  value: `"#${ value }"`,
                  rawvalues: expectedType.Members.map(m => `#${ m }`),
                  '#': 'enum',
                });
      }
      return rc;
    }

    // cAnnoValue: array
    // dTypeName: expected type, already identified as enum type
    //   array is expected to contain enum values
    function checkMultiEnumValue( ) {
      // we know that dTypeName is not null
      const type = getDictType(dTypeName);
      if (!type || type.IsFlags !== 'true') {
        message('odata-anno-value', msg.location,
                {
                  anno: msg.anno(),
                  str: 'collection',
                  type: dTypeName,
                  '#': 'incompval',
                });
      }

      let index = 0;
      for (const value of cAnnoValue) {
        msg.stack.push(`[${ index }]`);
        index++;
        if (value['#']) {
          checkEnumValue(value['#']);
        }
        else {
          message('odata-anno-value', msg.location,
                  {
                    anno: msg.anno(),
                    type: dTypeName,
                    value: value['='] || value,
                    rawvalues: type.Members.map(m => `#${ m }`),
                    '#': 'enum',
                  });
        }
        msg.stack.pop();
      }
    }

    function generateMultiEnumValue( forXml ) {
      // remove all invalid entries (warnining message has already been issued)
      // replace short enum name by the full name
      // concatenate all the enums to a string, separated by spaces
      return cAnnoValue.filter( x => x['#']).map( x => (forXml ? `${ dTypeName }/` : '') + x['#'] ).join(forXml ? ' ' : ',');
    }
  }

  // found an expression value ("=") "expr"
  //   expected type is dTypeName
  // note: expr can also be provided if an enum/complex type/collection is expected
  function handleExpression( value, dTypeName ) {
    let typeName = 'Path';
    if ( EdmPathTypeMap[dTypeName] ) {
      if (dTypeName === 'Edm.AnyPropertyPath')
        typeName = 'PropertyPath';
      else
        typeName = dTypeName.split('.')[1];
    }

    if (typeof value === 'string') {
      // replace all occurrences of '.' by '/' up to first '@'
      value = value.split('@').map((o, i) => (i === 0 ? o.replace(/\./g, '/') : o)).join('@');
    }

    return {
      name: typeName,
      value,
    };
  }


  // found a simple value "val"
  //  expected type is dTypeName
  //  mapping rule for values:
  //    if expected type is ... the expression to be generated is ...
  //      floating point type except Edm.Decimal -> Float
  //      Edm.Decimal -> Decimal
  //      integer type -> Int
  function handleSimpleValue( value, dTypeName, msg ) {
    // these types must be represented as "String" values in XML:
    const castToXmlString = [ 'Edm.PrimitiveType', 'Edm.Stream', 'Edm.Untyped' ];
    // caller already made sure that val is neither object nor array

    // check if type has allowed values
    const typeDef = getDictType(dTypeName);
    const Allowed = typeDef?.$Allowed;

    let resolvedType = resolveTypeDefinition(dTypeName);

    if (isEnumType(resolvedType)) {
      const type = getDictType(resolvedType);
      const expected = type.Members.map(m => `#${ m }`);
      message('odata-anno-value', msg.location,
              {
                anno: msg.anno(),
                value,
                rawvalues: expected,
                type: resolvedType,
                '#': 'enum',
              });
    }

    let typeName = 'String';
    if (Allowed && !Allowed.Values[value]) {
      message('odata-anno-value', msg.location,
              {
                anno: msg.anno(),
                value,
                rawvalues: Object.keys(Allowed.Values),
                type: resolvedType,
                '#': 'enum',
              });
    }

    if (typeof value === 'string') {
      if (resolvedType === 'Edm.Boolean') {
        typeName = 'Bool';
        if (value !== 'true' && value !== 'false') {
          message('odata-anno-value', msg.location,
                  { anno: msg.anno(), value, type: resolvedType });
        }
      }
      else if (resolvedType === 'Edm.Decimal') {
        typeName = 'Decimal';
        // eslint-disable-next-line no-restricted-globals
        if (isNaN(Number(value)) || isNaN(parseFloat(value))) {
          message('odata-anno-value', msg.location,
                  { anno: msg.anno(), value, type: resolvedType });
        }
      }
      else if (resolvedType === 'Edm.Double' || resolvedType === 'Edm.Single') {
        typeName = 'Float';
        // eslint-disable-next-line no-restricted-globals
        if (isNaN(Number(value)) || isNaN(parseFloat(value))) {
          message('odata-anno-value', msg.location,
                  { anno: msg.anno(), value, type: resolvedType });
        }
      }
      else if (isComplexType(resolvedType)) {
        message('odata-anno-value', msg.location,
                { anno: msg.anno(), value, type: resolvedType });
      }
      else if (isEnumType(resolvedType)) {
        message('odata-anno-value', msg.location,
                { anno: msg.anno(), value, type: resolvedType });
        typeName = 'EnumMember';
      }
      else if (resolvedType && resolvedType.startsWith('Edm.') && !castToXmlString.includes(resolvedType)) {
        // this covers also all paths
        typeName = resolvedType.substring(4);
      }
      else if (!resolvedType || castToXmlString.some(t => t === resolvedType)) {
        resolvedType = 'Edm.String';
        // TODO
        // message(message, msg, "type is not yet handled: found String, expected type: " + dTypeName);
      }
    }
    else if (typeof value === 'boolean') {
      if (!resolvedType || resolvedType === 'Edm.Boolean' || resolvedType === 'Edm.PrimitiveType') {
        typeName = 'Bool';
        resolvedType = 'Edm.Boolean';
      }
      if (resolvedType === 'Edm.Boolean') {
        value = value ? 'true' : 'false';
      }
      else if (resolvedType === 'Edm.String') {
        typeName = 'String';
      }
      else {
        message('odata-anno-value', msg.location,
                { anno: msg.anno(), value, type: resolvedType });
      }
    }
    else if (typeof value === 'number') {
      if (isComplexType(resolvedType) ||
          resolvedType === 'Edm.PropertyPath' ||
          resolvedType === 'Edm.Boolean') {
        message('odata-anno-value', msg.location,
                { anno: msg.anno(), value, type: resolvedType });
      }
      else if (resolvedType === 'Edm.String') {
        typeName = 'String';
      }
      else if (resolvedType === 'Edm.Decimal') {
        typeName = 'Decimal';
      }
      else if (resolvedType === 'Edm.Double') {
        typeName = 'Float';
      }
      else if (Number.isInteger(value)) {
        // typeName = Number.isInteger(val) ? 'Int' : 'Float';
        typeName = 'Int';
        if (resolvedType == null || resolvedType === 'Edm.PrimitiveType' || !resolvedType.startsWith('Edm.'))
          resolvedType = 'Edm.Int64';
      }
      else {
        typeName = 'Float';
        if (resolvedType == null || resolvedType === 'Edm.PrimitiveType' || !resolvedType.startsWith('Edm.'))
          resolvedType = 'Edm.Double';
      }
    }
    else if (value === null) {
      if ((resolvedType == null ||
           resolvedType === 'Edm.PrimitiveType' ||
           resolvedType === 'Edm.String') &&
           typeName === 'String') {
        resolvedType = 'Edm.String';
      }
      else {
        message('odata-anno-value', msg.location,
                { anno: msg.anno(), value, type: resolvedType });
      }
    }

    if ( EdmPathTypeMap[resolvedType] ) {
      if (resolvedType === 'Edm.AnyPropertyPath') {
        resolvedType = 'PropertyPath';
        typeName = resolvedType;
      }
      else {
        resolvedType = resolvedType.split('.')[1];
      }
    }

    return {
      name: typeName,
      jsonName: resolvedType,
      value,
    };
  }


  // obj: object representing the record
  // dTypeName : name of the expected record type according to vocabulary, may be null
  //
  // can be called for a record directly below a term, or at a deeper level
  function generateRecord( obj, termName, dTypeName, dTypeIsACollection, msg ) {
    /** @type {object} */
    const newRecord = new Edm.Record(v);

    // first determine what is the actual type to be used for the record
    if (dTypeName && !isComplexType(dTypeName)) {
      if (!getDictType(dTypeName) && !isPrimitiveType(dTypeName) && !dTypeIsACollection) {
        message('odata-anno-dict', msg.location,
                { anno: msg.anno(), type: dTypeName });
      }
      else {
        message('odata-anno-value', msg.location,
                {
                  anno: msg.anno(), str: 'structured', type: dTypeName, '#': 'incompval',
                });
      }
      return newRecord;
    }

    let actualTypeName = null;
    if (obj.$Type) { // type is explicitly specified
      actualTypeName = obj.$Type;
      if (!getDictType(actualTypeName)) {
        // this type doesn't exist
        if (typeof actualTypeName !== 'string') {
          actualTypeName = JSON.stringify(obj.$Type);
          message('odata-anno-type', msg.location,
                  {
                    anno: msg.anno(), code: '$Type', rawvalue: actualTypeName, '#': 'literal',
                  });
        }
        else {
          message('odata-anno-type', msg.location,
                  { anno: msg.anno(), type: actualTypeName, '#': 'unknown' });
        }
        // explicitly mentioned type, render in XML and JSON
        newRecord.setXml({ Type: actualTypeName });
        // unknown dictionary type: can't fully qualify it
        newRecord.setJSON({ Type: actualTypeName });
      }
      else {
        if (isAbstractType(actualTypeName)) {
          // this type is abstract
          message('odata-anno-type', msg.location,
                  {
                    anno: msg.anno(), type: actualTypeName, code: '$Type', '#': 'abstract',
                  });
          if (dTypeName)
            actualTypeName = dTypeName;
        }
        else if (dTypeName && !isDerivedFrom(actualTypeName, dTypeName)) {
          // this type doesn't fit the expected one
          message('odata-anno-type', msg.location,
                  {
                    anno: msg.anno(),
                    type: actualTypeName,
                    name: dTypeName,
                    code: '$Type',
                    '#': 'derived',
                  });
          actualTypeName = dTypeName;
        }
        // Dictionary Type, render in XML only for backward compatibility
        newRecord.setXml( { Type: actualTypeName });
        const vocName = actualTypeName.slice(0, actualTypeName.indexOf('.'));
        const myVocDef = mergedVocDefs[vocName];
        // Set full qualified type in JSON
        // TODO: Adhoc type x-ref URIs (only if abstract types are allowed in CDS)
        if (myVocDef)
          newRecord.setJSON( { Type: `${ myVocDef.ref.Uri }#${ actualTypeName }` });
        // don't add short actualTypeName into JSON as this would be wrong for a resolved! type.
        // A $Type w/o vocDef can only occur for adhoc type defs and these can't be abstract but
        // are fully resolvable due to their term usage via schema x-ref.
      }
    }
    else if (dTypeName) { // there is an expected type name according to dictionary
      // convenience for common situation:
      //   if DataFieldAbstract is expected and no explicit type is provided, automatically choose DataField
      if (dTypeName === 'UI.DataFieldAbstract')
        actualTypeName = 'UI.DataField';
      //   if SemanticObjectMappingAbstract is expected and no explicit type
      //   is provided, automatically choose SemanticObjectMappingType
      else if (dTypeName === 'Common.SemanticObjectMappingAbstract')
        actualTypeName = 'Common.SemanticObjectMappingType';

      else
        actualTypeName = dTypeName;

      if (isAbstractType(actualTypeName)) {
        message('odata-anno-type', msg.location,
                {
                  anno: msg.anno(), type: dTypeName, code: '$Type', '#': 'abstract',
                });
      }

      // Dictionary Type, render in XML only for backward compatibility
      newRecord.setXml( { Type: actualTypeName });
    }
    else {
      // no expected type set -> do not set newRecord.Type
    }

    // now the type is clear, so look ath the value
    const dictProperties = getAllProperties(actualTypeName);

    // loop over elements
    for (const name of Object.keys(obj)) {
      msg.stack.push(`.${ name }`);

      if (name === '$Type') {
        // ignore, this is an "artificial" property used to indicate the type
      }
      else if (name[0] === '@') {
        // not a regular property, but a nested annotation
        const newAnno = handleTerm(name.substring(1, name.length), obj[name], msg);
        newRecord.append(newAnno);
      }
      else {
        // regular property
        let dictPropertyTypeName = null;
        if (dictProperties) {
          dictPropertyTypeName = dictProperties[name];
          if (!dictPropertyTypeName && !getDictType(actualTypeName).OpenType) {
            message('odata-anno-type', msg.location,
                    { name, anno: termName, type: dTypeName });
          }
        }

        const newPropertyValue = new Edm.PropertyValue(v, name);
        // property value can be anything, so delegate handling to handleValue
        handleValue(obj[name], newPropertyValue, termName, dictPropertyTypeName, msg);
        newRecord.append(newPropertyValue);
      }

      msg.stack.pop();
    }

    return newRecord;
  }


  // annoValue is an array
  // dTypeName : Collection(...) according to dictionary
  function generateCollection( annoValue, termName, dTypeName, dTypeIsACollection, msg ) {
    const newCollection = new Edm.Collection(v);

    if (dTypeName && !dTypeIsACollection) {
      message('odata-anno-value', msg.location,
              {
                anno: msg.anno(), str: 'collection', type: dTypeName, '#': 'incompval',
              });
    }

    let index = 0;
    for (const value of annoValue) {
      msg.stack.push(`[${ index }]`);
      index++;

      // for dealing with the single array entries we unfortunately cannot call handleValue(),
      //   as the values inside an array are represented differently from the values
      //   in a record or term
      if (Array.isArray(value)) {
        message('odata-anno-value', msg.location,
                { anno: msg.anno(), '#': 'nestedCollection' });
      }
      else if (value && typeof value === 'object') {
        if (value['=']) {
          const res = handleExpression(value['='], dTypeName);
          const newPropertyPath = new Edm.ValueThing(v, res.name, res.value );
          newPropertyPath.setJSON( { [res.name]: res.value } );
          newCollection.append(newPropertyPath);
        }
        else if (value['#']) {
          message('odata-anno-value', msg.location,
                  { anno: msg.anno(), '#': 'enuminCollection' });
        }
        else if (value.$edmJson) {
          newCollection.append(handleEdmJson(value.$edmJson, msg));
        }
        else {
          newCollection.append(generateRecord(value, termName, dTypeName, dTypeIsACollection, msg));
        }
      }
      else {
        const res = handleSimpleValue(value, dTypeName, msg);
        const newThing = (value === null) ? new Edm.ValueThing(v, 'Null') : new Edm.ValueThing(v, res.name, value );
        newThing.setJSON( { [res.jsonName]: res.value });
        newCollection.append(newThing);
      }

      msg.stack.pop();
    }

    return newCollection;
  }


  /**
   * translate vocabulary definitions into a userDefinedTermDict
   * with the same structure as the global jsonDictionary that
   * contains all official term and type definitions.
   *
   * Return the dictionary and an array of schemas to which
   * the vocabulary definitions belong
   *
   * @returns [object, Array<object>]
   */
  function createUserDefinedTermDictionary() {
    const allKnownVocabulariesP = [];
    const dict = { terms: {}, types: {}, xrefs: {} };

    if (!isBetaEnabled(options, 'odataTerms'))
      return [ dict, allKnownVocabulariesP ];

    for (const termName in csnVocabularies) {
      let dictDef = oDataDictionary.terms[termName];
      if (dictDef) {
        message('odata-anno-dict', [ 'vocabularies', termName ],
                { anno: termName, string: 'annotation', '#': 'redefinition' } );
      }
      else if (!dictDef) {
        const annoDef = csnVocabularies[termName];
        if (annoDef?.$mySchemaName) {
          if (!allKnownVocabulariesP.includes[annoDef.$mySchemaName])
            allKnownVocabulariesP.push(annoDef.$mySchemaName);
          const myServiceRoot = options.whatsMyServiceRootName(annoDef.$mySchemaName);
          if (!dict.xrefs[myServiceRoot])
            dict.xrefs[myServiceRoot] = { $myServiceRoot: myServiceRoot, used: false };
          const edmType = new Edm.TypeBase(options.v, {}, annoDef);
          dictDef = edmType._edmAttributes;
          if (dictDef.Type?.startsWith('Edm.Int'))
            dictDef.Type = 'Edm.Int';
          dictDef.$myServiceRoot = myServiceRoot;
          let val = annoDef['@odata.term.AppliesTo'];
          if (val != null)
            dictDef.AppliesTo = Array.isArray(val) ? val.map(av => av['='] || av) : [ val['='] || val ];
          val = annoDef['@odata.term.Experimental'];
          if (val != null)
            dictDef.$experimental = !!val;
          val = annoDef['@odata.term.Deprecated'];
          if (val != null) {
            dictDef.$deprecated = !!val;
            if (typeof val === 'string')
              dictDef.$deprecationText = val;
          }
          dict.terms[termName] = dictDef;

          if ((annoDef.items?.enum || annoDef.enum) && isBuiltinType(annoDef.items?.type || annoDef.type)) {
            const enumType = createTypeDefWithAllowedValues(annoDef, annoDef, dictDef.Type, [ 'vocabularies', termName ]);
            const tName = `${ termName }_$$$EnumType$$$$`;
            dict.types[tName] = enumType;
            dictDef.Type = tName;
          }
          else {
            addTypesToDictionary(annoDef);
          }
        }
      }
    }
    return [ dict, allKnownVocabulariesP ];

    function addTypesToDictionary( node ) {
      const typeName = node.items?.type || node.type;
      // for type reuse in x-ref mode, the definition has already been
      // replaced by a reference object in edmPreprocessor.
      // Fall back to original type (the one of the other service).
      const typeDef = reqDefs.definitions[typeName] || reqDefs.definitions[typeName.replace(`${ serviceName }.`, '')];
      if (typeDef) {
        let dictDef = { };
        const elements = typeDef.items?.elements || typeDef.elements;
        if (elements) {
          // complex type
          dictDef.$kind = 'ComplexType';
          // eslint-disable-next-line no-new-object
          dictDef.Properties = new Object(null);

          for (const en in elements) {
            const elt = elements[en];
            if (isEdmPropertyRendered(elt, options)) {
              const edmType = new Edm.TypeBase(options.v, {}, elt);
              dictDef.Properties[en] = edmType._edmAttributes[edmType._typeName];
              addTypesToDictionary(elt);
            }
          }
        }
        else {
          // type definition
          const edmType = new Edm.TypeBase(options.v, {}, typeDef);
          dictDef = createTypeDefWithAllowedValues(node, typeDef, edmType._edmAttributes[edmType._typeName], [ 'definitions', typeName ]);
          if (!typeDef.enum)
            delete dictDef.$Allowed;
        }
        dict.types[typeName] = dictDef;
      }
    }

    function createTypeDefWithAllowedValues( node, typeDef, UnderlyingType, path ) {
      const dictTypeDef = { $kind: 'TypeDefinition', UnderlyingType, $Allowed: { Values: {}, Symbols: {} } };
      // create an artificial type that holds the $Allowed enum symbols and values
      if (node.items && typeDef.enum || typeDef.items?.enum) {
        message('odata-anno-dict-enum', [ 'vocabularies', node.name ],
                {
                  name: node.name,
                  type: typeDef.name,
                  '#': node.name === typeDef.name ? 'std' : 'type',
                });
      }
      const enumDic = (typeDef.items?.enum || typeDef.enum);
      const baseType = (typeDef.items || typeDef).type;
      if (baseType !== 'cds.String' && Object.values(enumDic).some(av => !av.val)) {
        message('odata-anno-dict-enum', path,
                { name: node.name, type: baseType, '#': 'value' });
      }
      else {
        for (const symbol in enumDic) {
          const valDic = { '#SymbolicName': symbol };
          const enumDef = enumDic[symbol];
          // <Null/> values can't be rendered
          if (enumDef.val === undefined)
            valDic.Value = symbol;
          else if (valDic.val !== null)
            valDic.Value = enumDef.val;
          dictTypeDef.$Allowed.Values[symbol] = valDic;
          dictTypeDef.$Allowed.Symbols[symbol] = valDic;
        }
      }
      return dictTypeDef;
    }
  }

  function filterKnownAnnotations( carrier ) {
    const annoNames = Object.keys(carrier).filter( x => x[0] === '@' );
    const nullWhitelist = [ '@Core.OperationAvailable', '@Core.OptionalParameter.DefaultValue' ];
    const knownAnnosP = annoNames.filter((n) => {
      const tns = whatsMyTermNamespace(n);
      return tns &&
        (mergedVocDefs[tns] && !mergedVocDefs[tns].$ignore ||
         !mergedVocDefs[tns]);
    }).filter(x => carrier[x] !== null || nullWhitelist.includes(x));
    if (isBetaEnabled(options, 'odataTerms')) {
      // Extend knownAnnos with the in-service term definitions
      annoNames.forEach((an) => {
        const paths = an.slice(1).split('.');
        const hasNSPrefix = paths[0] === serviceName;
        if (!hasNSPrefix)
          paths.splice(0, 0, serviceName);

        const fqName = `@${ paths.join('.') }`;
        const i = paths[1].indexOf('#');
        const termNameWithoutQualifiers = i > 0 ? paths[1].substring(0, i) : paths[1];
        const def = reqDefs.definitions[`${ paths[0] }.${ termNameWithoutQualifiers }`];
        // if there is a term definition inside the service and the
        // annotation value is != null, then add the annotation to the list
        // of known annotations
        if (def?.kind === 'annotation' && carrier[an] !== null) {
          // Subsequent annotation handler code expects that first path segment
          // is the Vocabulary namespace. The ad-hoc namespace is the service
          // name itself.
          // For service S an annotation assignment  could be addressed
          // relative or absolute to the service @S.foo or @foo
          if (!hasNSPrefix) {
            carrier[fqName] = carrier[an];
            delete carrier[an];
          }
          knownAnnosP.push(fqName);
        }
      });
    }
    return knownAnnosP;
  }


  //-------------------------------------------------------------------------------------------------
  // Dictionary access
  //-------------------------------------------------------------------------------------------------

  // called to look-up a term in the dictionary
  //   in addition: - note usage of the respective vocabulary
  //                - issue a warning if the term is flagged as "experimental"
  function getDictTerm( termName, msg ) {
    const dict = options.dictReplacement || oDataDictionary; // tests can set different dictionary via options
    const dictTerm = (dict.terms[termName] ||
          userDefinedTermDict.terms[`${ serviceName }.${ termName }`] ||
          userDefinedTermDict.terms[termName]);
    // register vocabulary usage if possible
    const vocName = termName.slice(0, termName.indexOf('.'));
    const myVocDef = mergedVocDefs[vocName];
    if (myVocDef && !myVocDef.$ignore)
      myVocDef.used = true;
    else if (dictTerm?.$myServiceRoot &&
          userDefinedTermDict.xrefs[dictTerm?.$myServiceRoot])
      userDefinedTermDict.xrefs[dictTerm.$myServiceRoot].used = true;
    if (dictTerm) {
      // issue message for usage of experimental Terms, but only once per Term
      if (dictTerm.$experimental && !usedExperimentalTerms[termName]) {
        message('odata-anno-dict', msg.location, { anno: msg.anno(), '#': 'experimental' });
        usedExperimentalTerms[termName] = true;
      }
      if (dictTerm.$deprecated && !usedDeprecatedTerms[termName]) {
        message('odata-anno-def', msg.location,
                { anno: msg.anno(), depr: dictTerm.$deprecationText, '#': 'deprecated' });
        usedDeprecatedTerms[termName] = true;
      }
    }
    return dictTerm;
  }
  // called to look-up a type in the dictionary
  //   in addition, note usage of the respective vocabulary
  function getDictType( typeName ) {
    const dict = options.dictReplacement || oDataDictionary; // tests can set different dictionary via options
    const dictType = (dict.types[typeName] ||
          userDefinedTermDict.types[`${ serviceName }.${ typeName }`] ||
          userDefinedTermDict.types[typeName]);
    if (dictType) {
      // register usage of vocabulary
      const vocName = typeName.slice(0, typeName.indexOf('.'));
      const myVocDef = mergedVocDefs[vocName];
      if (myVocDef && !myVocDef.$ignore)
        myVocDef.used = true;
    }
    return dictType;
  }

  //-------------------------------------------------------------------------------------------------
  //-------------------------------------------------------------------------------------------------
  //-------------------------------------------------------------------------------------------------

  // resolve "derived types"
  // -> if dTypeName is a TypeDefinition, replace by
  //    underlying type
  function resolveTypeDefinition( dTypeName ) {
    const type = getDictType(dTypeName);
    if (type && type.UnderlyingType && type.$kind === 'TypeDefinition')
      return type.UnderlyingType;

    return dTypeName;
  }

  function stripCollection( typeName ) {
    if (typeName) {
      const match = typeName.match(/^Collection\((.+)\)/);
      if (match)
        return [ match[1], true ];
    }

    return [ typeName, false ];
  }

  function isPrimitiveType( typeName ) {
    return typeName.split('.')[0] === 'Edm';
  }

  function isEnumType( dTypeName ) {
    const type = getDictType(dTypeName);
    return type && type.$kind === 'EnumType';
  }

  function isComplexType( dTypeName ) {
    const type = getDictType(dTypeName);
    return dTypeName === 'Edm.ComplexType' || type && type.$kind === 'ComplexType';
  }

  function isAbstractType( dTypeName ) {
    const type = getDictType(dTypeName);
    return type && type.Abstract === 'true';
  }

  // return true if derived has baseCandidate as direct or indirect base type
  function isDerivedFrom( derived, baseCandidate ) {
    while (derived) {
      if (derived === baseCandidate)
        return true;
      derived = getDictType(derived).BaseType;
    }
    return false;
  }

  // return dictionary of all properties of typeName, including those of base types
  function getAllProperties( typeName ) {
    if (!typeName || !getDictType(typeName))
      return null;
    return getDictType(typeName).Properties;
  }
}

function mergeOdataVocabularies( options, message ) {
  /*  Merge options.odataVocabularies into vocabularyDefinitions and
      create a csn2edm stack local dictionary.
      odataVocabularies is an object, each property is the
      annotation prefix (as in mergedVocDefs), the value
      is an object { Alias, Namespace, Uri }, this way
      the definitions are unique and duplicate entries to address
      the annotation via alias and namespace is possible (see
      inverted index of mergedVocDefs above)
  */
  const mergedVocDefs = Object.assign({}, vocabularyDefinitions);
  const reqProps = [ 'Alias', 'Namespace', 'Uri' ];
  if (options.odataVocabularies) {
    const vocRefs = options.odataVocabularies;
    if (typeof vocRefs === 'object' && !Array.isArray(vocRefs)) {
      Object.entries(vocRefs).forEach(([ id, def ]) => {
        let defOk = true;
        reqProps.forEach((name) => {
          if (!def[name] || typeof def[name] !== 'string') {
            message('odata-anno-vocref', null,
                    { id, name, '#': 'malformed' } );
            defOk = false;
          }
          else if (name === 'Alias' && !edmUtils.isODataSimpleIdentifier(def[name])) {
            message('odata-invalid-vocabulary-alias', null, { id: name, value: def[name] });
            defOk = false;
          }
        });
        if (defOk) {
          const vocDef = mergedVocDefs[id];
          if (vocDef && !vocDef.$optVocRef) {
            message('odata-anno-vocref', null,
                    { id, type: mergedVocDefs[id].inc.Namespace, '#': 'redef' } );
          }
          else if (id !== def.Alias) {
            message('odata-anno-vocref', null,
                    { id, name: def.Alias } );
          }
          else {
            // no int.filename => no validation
            mergedVocDefs[id] = {
              ref: { Uri: def.Uri },
              inc: { Alias: def.Alias, Namespace: def.Namespace },
            };
            setProp(mergedVocDefs[id], '$optVocRef', true);
          }
        }
      });
    }
  }
  return mergedVocDefs;
}

//-------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------------

module.exports = { vocabularyDefinitions, csn2annotationEdm, mergeOdataVocabularies };
