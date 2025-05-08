'use strict';

/**
 * In this module resides all the logic related to exposure of types as part of the OData backend
 * The exposure is run only for definitions which reside in a service.
 * @module typesExposure
 */

const { setProp, isBetaEnabled } = require('../../base/model');
const { defNameWithoutServiceOrContextName, isArtifactInService } = require('./utils');
const { getNamespace, copyAnnotations,
  forEachDefinition, forEachMember, forEachGeneric, isEdmPropertyRendered } = require('../../model/csnUtils');
const { isBuiltinType } = require('../../base/builtins');
const { CompilerAssertion } = require('../../base/error');
const { cloneCsnNonDict } = require('../../model/cloneCsn');

/**
 * A given CDS model is a set of n definitions D = {v_1, ..., v_n } spanning a type dependency
 * graph T(D) with vertices v_r, v_d (representing the referrer (using) and defining node of a type)
 * and edges e(v_r, v_d).
 *
 * S may be a proper subset of D and is defined by v_s. Up to n S_i may exist.
 * v is element of S_i, if name(v) starts with name(v_s). Therefore any v can only be member
 * of exactly one S_i and v_s is always member of its own S_i.
 *
 * A complete service type dependency graph Tc(S) is defined as a set of vertices v_r, v_d
 * and edges e(v_r, v_d) such that all v_r, v_d are elements of S (v_rs, v_ds) and with that
 * all edges are { e(v_rs, v_ds) }.
 *
 * The input CSN may contain edges e(v_rs, v_dns) with v_r element of S_i (v_rs) and v_d not element
 * of S_i (v_dns).
 *
 * The aim of this algorithm is to produce Tc's for all requested S_i by 'filling' up the missing
 * vertices v_ds and rewriting all e(v_rs, v_dns) to e(v_rs, v_ds).
 *
 * This can be done pretty easily by (recursively) iterating over all requested v_rs and
 * follow e(v_r, v_d) until a v_dns is found. v_dns is cloned and added to S via
 * name(v_ds) = name(v_s) + '.' + name(v_dns). If v_dns is an anonymous definition, an
 * artificial name representing the path to that node is being used.
 *
 * The algorithm has a beneficial side effect: it creates new (sub) schemas on the fly
 * which are required for the construction of the EDM intermediate representation later on.
 *
 * An OData service contains at least one schema. Only (OData) schemas may contain definitions.
 * By default, the CDS service v_s represents the default (OData) schema.
 * However, there are situations where { v_dns } must be partitioned into (sub) schemas in order to
 * maintain their original name prefixes and to be compatible with later service definitions.
 *
 * If name(v_dns) is made up of segments separated by a dot '.', the first n-1 segments represent
 * the sub schema: name(schema) = name(v_s) + '.' + concat(1,n-1, segments(name(v_dns)), '.')
 *
 * If name(v_dns) has no prefix segments, the fallback schema name is prepended instead:
 * name(v_ds) = name(v_s) + '.' + fallbackschema + name(v_dns);
 *
 * @param {CSN.Model} csn
 * @param {function}  whatsMyServiceName
 * @param {string[]}     requestedServiceNames
 * @param {String}    fallBackSchemaName
 * @param {Object}    options
 * @param {Object}    csnUtils
 * @param {Object}    message
 * @returns {Object}  schemas dictionary of (sub) schemas for all requested services
 */
function typesExposure(csn, whatsMyServiceName, requestedServiceNames, fallBackSchemaName, options, csnUtils, message) {
  const { error } = message;
  const special$self = !csn?.definitions?.$self && '$self';

  // are we working with OData proxies or cross-service refs
  const isMultiSchema = options.odataVersion === 'v4' && (options.odataProxies || options.odataXServiceRefs);
  // service sub schemas as return value
  const schemas = Object.create(null);
  // exposed types register
  const exposedTypes = Object.create(null);
  forEachDefinition(csn, (def, defName, propertyName, path) => {
    const serviceName = whatsMyServiceName(defName, false);
    // run type exposure only on requested services if not in multi schema mode
    // multi schema mode requires a proper type exposure for all services as a prerequisite
    if (serviceName && requestedServiceNames.includes(serviceName)) {
      if (def.kind === 'type' || def.kind === 'entity') {
        forEachMember(def, (element, elementName, propertyName, path) => {
          if (propertyName === 'elements') {
            const newTypeName = getNewTypeName(element, elementName, defName, serviceName);
            exposeTypeOf(element, element.key, elementName, defName, serviceName, newTypeName, defName, path);
          } else if (propertyName === 'params') {
            const newTypeName = getNewTypeName(element, elementName, `ep_${defName.replace(/\./g, '_')}`, serviceName);
            exposeTypeOf(element, true, elementName, defName, serviceName, newTypeName, defName, path);
          }
        }, path);
      }

      if (def.kind === 'action' || def.kind === 'function') {
        exposeTypesOfAction(def, defName, defName, serviceName, path, false);
      }
      def.actions && Object.entries(def.actions).forEach(([actionName, action]) => {
        exposeTypesOfAction(action, `${defName}_${actionName}`, defName, serviceName, path.concat(['actions', actionName]), true);
      });
    }
  });

  if(isBetaEnabled(options, 'odataTerms')) {
    forEachGeneric(csn, 'vocabularies', (def, defName, _propertyName, path) => {
      const serviceName = whatsMyServiceName(defName, false);
      if (serviceName && requestedServiceNames.includes(serviceName)) {
        if (csn.definitions[defName]) {
          error('odata-duplicate-definition', [ 'vocabularies', defName ], { anno: defName, '#': 'anno' });
        }
        else {
          // link def into definitions for later use
          def.kind = 'annotation';
          csn.definitions[defName] = def;
          const artificialName = `term_${defName.replace(/\./g, '_')}`;//_${paramName}`;
          const newTypeName = getNewTypeName(undefined, undefined, artificialName, serviceName);
          exposeTypeOf(def, false, defName, defName, serviceName, newTypeName, defName, path.concat(['vocabularies', defName]), undefined, true);
        }
      }
    });
  }

  return schemas;

/**
   * If an 'action' uses structured types as parameters or return values that are not exposed in 'service'
   * (because the types are anonymous or have a definition outside of 'service'),
   * create equivalent types in 'service' and make 'action' use them instead,
   * @param {Object} action
   * @param {String} actionName
   * @param {String} serviceName
   */
  function exposeTypesOfAction(action, actionName, defName, serviceName, path, isBound) {
    if (action.returns) {
      const artificialName = `return_${actionName.replace(/\./g, '_')}`;
      const newTypeName = getNewTypeName(action.returns, undefined, artificialName, serviceName);
      exposeTypeOf(action.returns, false, actionName, defName, serviceName, newTypeName, defName, path.concat(['returns']));
    }

    action.params && Object.entries(action.params).forEach(([paramName, param]) => {
      const artificialName = `${isBound ? 'bap' : 'ap'}_${actionName.replace(/\./g, '_')}`;//_${paramName}`;
      const newTypeName = getNewTypeName(param, paramName, artificialName, serviceName);
      exposeTypeOf(param, false, actionName, defName, serviceName, newTypeName, defName, path.concat(['params', paramName]));
    });
  }

  /**
   * If 'node' exists and has a structured type that is not exposed in 'service', (because the type is anonymous or
   * has a definition outside of 'service'), create an equivalent type in 'service' and assign the new type
   * for a value of the 'node.type' property.
   * @param {Object} node
   * @param {String} memberName
   * @param {String} serviceName
   * @param {String} newTypeName
   */
  function exposeTypeOf(node, isKey, memberName, defName, serviceName, newTypeName, lastNonAnonymousFQDefName, path, parentName, isTermDef=false, ignoreInAPI=false) {
    const { isExposable, typeDef, typeName, elements, isAnonymous } = isTypeExposable();
    if (isExposable) {
      // this is the name used to register the new type in csn.definitions
      let fullQualifiedNewTypeName =
        isMultiSchema
          ? (node.type || (node.items?.type)
              ? getTypeNameInMultiSchema(node.type|| (node.items?.type), serviceName)
              : getAnonymousTypeNameInMultiSchema(newTypeName, parentName || defName))
          : `${serviceName}.${newTypeName}`;

      if (!isAnonymous) {
        // as soon as we leave of the anonymous world,
        // we're no longer in a key def => don't set notNull:true on named types
        if(isKey)
          isKey = false;
        // in case this was a named type and if the openness does not match the type definition
        // expose the type as a new one not changing the original definition.
        if(elements && node['@open'] != null && !!node['@open'] !== !!typeDef['@open'])
          fullQualifiedNewTypeName += node['@open'] ? '_open' : '_closed';
        lastNonAnonymousFQDefName = fullQualifiedNewTypeName;
      }
      // check if that type is already defined
      let newType = csn.definitions[fullQualifiedNewTypeName];
      if (newType) {
        // error, if it was not exposed by us
        if (!exposedTypes[fullQualifiedNewTypeName]) {
          setProp(node, '$NameClashReported', true);
          error(null, path, { type: fullQualifiedNewTypeName, name: memberName },
            'Can\'t create artificial type $(TYPE) for $(NAME) because the name is already used');
          return { isExposable, typeDef, typeName, isAnonymous };
        }
      }
      else {
        /* Expose new structured type
         * Treat items.elements as ordinary elements for now.
         */
        if(elements) {
          newType = createNewStructType(elements);
          // if using node enforces open/closed, set it on type
          if (node['@open'] !== undefined)
            newType['@open'] = node['@open']
          if (node.$location)
            setProp(newType, '$location', node.$location);
          ignoreInAPI ||= !isEdmPropertyRendered(node, options);
          setProp(newType, '$ignoreInAPI', ignoreInAPI);

          csn.definitions[fullQualifiedNewTypeName] = newType;
          exposedTypes[fullQualifiedNewTypeName] = 1;

          // Recurse into elements of 'type' (if any) and expose them as well (is needed)
          newType.elements && Object.entries(newType.elements).forEach(([elemName, newElem]) => {
            if (node.elements && node.elements[elemName].$location)
              setProp(newElem, '$location', node.elements[elemName].$location);
            if (newElem.$path)
              newElem.$path[1] = lastNonAnonymousFQDefName;
            defName = typeDef.kind === 'type' ? typeName : defName;
            {
              const { isExposable, typeDef, typeName } = exposeTypeOf(newElem, isKey, elemName, defName, serviceName,
                            getNewTypeName(newElem, elemName, newTypeName, serviceName), lastNonAnonymousFQDefName, path, fullQualifiedNewTypeName, isTermDef, ignoreInAPI);
              // if the type for the newElem was not exposed it may be a scalar type def from an external service that hasn't
              // been caught by expandToFinalBaseType() (forODataNew must not modify external imported services)
              if(!isExposable && isBuiltinType(typeName) && !isBuiltinType((newElem.items?.type || newElem.type))) {
                if(typeDef.items) {
                  newElem.items = typeDef.items;
                  delete newElem.type;
                }
                else if(newElem.items) {
                  newElem.items.type = typeName;
                  if(typeDef.enum)
                    newElem.items.enum = typeDef.enum;
                }
                else {
                  newElem.type = typeName;
                  if(typeDef.enum)
                    newElem.enum = typeDef.enum;
                }
              }
            }
          });

          // Annotations are propagated only from user defined structured
          // types that need to be added to a service
          if (!isAnonymous) {
            copyAnnotations(typeDef, newType);
          }

          // if the origin type had items, add items to exposed type
          if(typeDef.kind === 'type') {
            if(typeDef.items) {
              newType.items = { elements: newType.elements };
              delete newType.elements;
            }
          }
        }
        else if(isTermDef) {
          newType = Object.create(null);
          for(const n in typeDef) {
            newType[n] = typeDef[n];
          }
          newType.kind = 'type';
          csn.definitions[fullQualifiedNewTypeName] = newType;
          exposedTypes[fullQualifiedNewTypeName] = 1;
        }
      }
      // adjust current node to new type
      if(node.items) {
        delete node.items.elements;
        delete node.type;
        node.items.type = fullQualifiedNewTypeName;
      }
      else {
        delete node.elements;
        node.type = fullQualifiedNewTypeName;
      }
    }
    return { isExposable, typeDef, typeName, isAnonymous };

    /**
     * Check if the node's type can be exposed:
     * 1) If it's an anonymous, structured type (items.elements || elements)
     * 2) If it's a named type resolve to the final type definition and
     *    check if this is a structured type
     *
     * Returns an object that indicates
     *  - `isExposable`: whether the type needs exposure
     *  - `elements`: dictionary that needs to be cloned
     *  - `typeDef`: either the resolved type def or the node itself
     *  - `typeName`
     *  - if structured type was anonymously defined
     *
     * @returns {object} { isExposable, typeDef, typeName, elements, isAnonymous }
     */
    function isTypeExposable() {
      let typeName = undefined;
      let typeDef = node;
      const elements = (node.items?.elements || node.elements)
      // anonymous structured type
      if(elements)
        return { isExposable: true, typeDef, typeName, elements, isAnonymous: true };
      // named type, resolve the type to inspect it
      let type = node.items?.type || node.type;
      if(type) {
        typeName = (type.ref && csnUtils.artifactRef(type)) || type;
        const rc = { isExposable: true, typeDef, typeName, isAnonymous: false };
        if((!isBuiltinType(typeName) || typeName === 'cds.Map') && typeName !== special$self) {
          rc.typeDef = typeDef = csnUtils.artifactRef(typeName, typeName);
          if(!isArtifactInService(typeName, serviceName)) {
            while(!isBuiltinType(typeName) || typeDef.$emtpyMapType) {
              typeDef = csnUtils.artifactRef(typeName, typeName);
              if(typeDef !== typeName) {
                // Implementation note: For `type S: T:struct;`, elements from `T:struct` were already propagated to `S`.
                if((isTermDef && typeDef.enum) || (rc.elements = (typeDef.items?.elements || typeDef.elements)) !== undefined)
                  return rc;
                type = typeDef.items?.type || typeDef.type;
                typeName = (type.ref && csnUtils.artifactRef(type)) || type;
              }
              else {
                throw new CompilerAssertion(`Debug me: ${typeName} not found`);
              }
            }
          }
          else {
            rc.isExposable = false;
            return rc;
          }
        }
        // else if(isTermDef && typeDef.enum) {
        //   return rc;
        // }
      }
      return { isExposable: false, typeDef, typeName, isAnonymous: false };
    }


    /**
     * Calculate the new type name that will be exposed in multi schema,
     * in case that the element has a named type.
     *
     * @param {string} typeName type of the element
     * @param {string} serviceName current service name
     */
    function getTypeNameInMultiSchema(typeName, serviceName) {
      const typeService = whatsMyServiceName(typeName);
      if (typeService) {
        // new type name without any prefixes
        const typePlainName = defNameWithoutServiceOrContextName(typeName, typeService);
        const newSchemaName = `${serviceName}.${typeService}`;
        createSchema(newSchemaName);
        // return the new type name
        return `${newSchemaName}.${typePlainName.replace(/\./g, '_')}`;
      } else {
        const typeContext = csnUtils.getContextOfArtifact(typeName);
        const typeNamespace = getNamespace(csn, typeName);
        const newSchemaName = `${serviceName}.${typeContext || typeNamespace || fallBackSchemaName}`;
        // new type name without any prefixes
        const typePlainName = typeContext
          ? defNameWithoutServiceOrContextName(typeName, typeContext)
          : (typeNamespace
              ? typeName.replace(typeNamespace + '.', '')
              : typeName);
        createSchema(newSchemaName);
        // return the new type name
        return `${newSchemaName}.${typePlainName.replace(/\./g, '_')}`;
      }
    }

    /**
     * Calculate the new type name that will be exposed in multi schema,
     * in case that the element has an anonymous type.
     *
     * @param {string} typeName type of the element
     * @param {string} parentName name of the parent def holding the element
     */
    function getAnonymousTypeNameInMultiSchema(typeName, parentName) {
      const currPrefix = parentName.substring(0, parentName.lastIndexOf('.'));
      const newSchemaName = currPrefix || fallBackSchemaName;
      // new type name without any prefixes
      const typePlainName = defNameWithoutServiceOrContextName(typeName, newSchemaName);

      createSchema(newSchemaName);
      return `${newSchemaName}.${typePlainName.replace(/\./g, '_')}`;
    }

    /**
     * Tf does not exists, create a context with the given name in the CSN
     * @param {string} name
     */
    function createSchema(name) {
      schemas[name] = { kind: 'schema', name };
    }

    /**
     * create a new structured type for 'elements'
     * @param {Object} elements
     */
    function createNewStructType(elements) {
      // Create a type with empty elements
      const type = {
        kind: 'type',
        elements: Object.create(null),
      };
      setProp(type, '$exposedBy', 'typeExposure');

      // Duplicate elements
      Object.entries(elements).forEach(([elemName, element]) => {
        const cloned = cloneCsnNonDict(element, options);
        // if this was an anonymous sub element of a key, mark it as not nullable
        if(isAnonymous && isKey && !cloned.key) {
          if(cloned.target) {
            if(cloned.cardinality === undefined)
              cloned.cardinality = {};
            cloned.cardinality.min = 1;
          }
          // if odata-unexpected-nullable-key is checking on min>1, this can
          // be an else if
          if(cloned.notNull === undefined)
            cloned.notNull = true;
        }
        type.elements[elemName] = cloned;
      });
      return type;
    }
  }

  /*
   * Calculate the name of the exposed type based on the information, the element can provide
   * If the element is typed, use the type name
   * else assume it's a de-anonymized type, concatenate the element name to the defName
  */
  function getNewTypeName(element, elementName, typeNamePrefix, serviceName) {
    // for the new type name node.type has precedence over node.items.type
    const typeName = (!element?.elements && element?.type || !element?.items?.elements && element?.items?.type);
    return typeName
        ? `${isMultiSchema
              ? typeName.split('.').pop() // use leaf element
              : typeName.replace(/\./g, '_')}` // concatenate path
        : ( elementName // returns has no elementName, return the precalculated prefix
            ? `${defNameWithoutServiceOrContextName(typeNamePrefix, serviceName).replace(/\./g, '_')}_${elementName}`
            : typeNamePrefix
          );
  }
}

module.exports = typesExposure;
