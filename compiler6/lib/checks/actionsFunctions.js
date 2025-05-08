'use strict';

const { isBuiltinType } = require('../base/builtins');

// Only to be used with validator.js - a correct this value needs to be provided!

/**
 * Check bound/unbound actions and functions. These checks are only meaningful for the OData backend.
 *
 * @param {CSN.Artifact} art Definition to be checked: Either the action artifact or an entity with actions.
 * @param {string} artName name of the definition
 * @param {string} prop Ignored property, always "definitions"
 * @param {CSN.Path} path path to the definition
 */
function checkActionOrFunction( art, artName, prop, path ) {
  if (!(art.kind === 'action' || art.kind === 'function') && !art.actions)
    return;

  // const isMultiSchema = this.options.odataFormat === 'structured' &&
  //   (this.options.odataProxies || this.options.odataXServiceRefs);

  const serviceName = this.csnUtils.getServiceName(artName);

  if (art.kind === 'entity') {
    for (const [ actName, act ] of Object.entries(art.actions)) {
      if (act.params) {
        checkExplicitBindingParameter.call(this, act.params, path.concat([ 'actions', actName, 'params' ]));
        for (const [ paramName, param ] of Object.entries(act.params))
          checkActionOrFunctionParameter.call(this, param, path.concat([ 'actions', actName, 'params', paramName ]), act.kind);
      }
      if (act.returns)
        checkReturns.bind(this)(act.returns, path.concat([ 'actions', actName, 'returns' ]), act.kind);
    }
  }
  else {
    if (art.params) {
      for (const [ paramName, param ] of Object.entries(art.params))
        checkActionOrFunctionParameter.call(this, param, path.concat([ 'params', paramName ]), art.kind);
    }
    if (art.returns)
      checkReturns.bind(this)(art.returns, path.concat('returns'), art.kind);
  }

  /**
   *
   * @param {object} params parameter dictionary
   * @param {CSN.Path} currPath to the action parameter
   */
  function checkExplicitBindingParameter( params, currPath ) {
    Object.entries(params).forEach(([ pn, p ], i) => {
      const type = p.items?.type || p.type;
      if (type === '$self' && !this.csn.definitions.$self && i > 0) {
        this.error('def-invalid-param', currPath.concat(pn),
                   'Binding parameter is expected to appear in first position only');
      }
    });
  }

  /**
   * Check the parameters of an action
   *
   * @param {object} param parameter object
   * @param {CSN.Path} currPath path to the parameter
   * @param {string} actKind 'action' or 'function'
   */
  function checkActionOrFunctionParameter( param, currPath, actKind ) {
    const paramType = param.type ? this.csnUtils.getFinalTypeInfo(param.type) : param;
    if (!paramType)
      return; // no type could be resolved

    if (param.type && this.csnUtils.isAssocOrComposition(param)) {
      this.error(null, currPath, { '#': actKind }, {
        std: 'An association is not allowed as this artifact\'s parameter type', // Not used
        action: 'An association is not allowed as action\'s parameter type',
        function: 'An association is not allowed as function\'s parameter type',
      });
    }

    if (paramType.items?.type)
      checkActionOrFunctionParameter.call(this, paramType.items, currPath.concat('items'), actKind);

    // check if the structured & user-defined is from the current service
    checkUserDefinedType.bind(this)(paramType, param.type, currPath);
  }

  /**
   * Check the return statement of an action
   *
   * @param {object} returns returns object
   * @param {CSN.Path} currPath path to the returns object
   * @param {string} actKind 'action' or 'function'
   */
  function checkReturns( returns, currPath, actKind ) {
    const finalReturnType = returns.type ? this.csnUtils.getFinalTypeInfo(returns.type) : returns;
    if (!finalReturnType)
      return; // no type, e.g. `type of V:calculated`; already an error in `checkTypeOfHasProperType()`

    if (this.csnUtils.isAssocOrComposition(returns)) {
      this.error(null, currPath, { '#': actKind },
                 {
                   std: 'An association is not allowed as this artifact\'s return type', // Not used
                   action: 'An association is not allowed as action\'s return type',
                   function: 'An association is not allowed as function\'s return type',
                 });
    }

    if (finalReturnType.items) // check array return type
      checkReturns.call(this, finalReturnType.items, currPath.concat('items'), actKind);
    else // check if return type is user defined from the current service
      checkUserDefinedType.call(this, finalReturnType, returns.type, currPath);
  }

  /**
   * Check non-builtin used types in actions
   *
   * @param {CSN.Artifact} type The final type definition
   * @param {string} typeName Name of the type definition
   * @param {CSN.Path} currPath The current path
   */
  function checkUserDefinedType( type, typeName, currPath ) {
    // TODO: isBuiltinType does not resolve any type-chains.
    if (!isBuiltinType(type.type) && type.kind && type.kind !== 'type') {
      const serviceOfType = this.csnUtils.getServiceName(typeName);
      if (serviceName && serviceName !== serviceOfType) {
        // if (!(isMultiSchema && serviceOfType)) {
        this.error(null, currPath,
                   { type: typeName, kind: type.kind, service: serviceName },
                   'Referenced $(KIND) $(TYPE) can\'t be used in service $(SERVICE) because it is not defined in $(SERVICE)');
        // }
      }
    }
  }
}

module.exports = { checkActionOrFunction };
