'use strict';

function createLazyload( callingModule ) {
  /**
   * Load the module on-demand and not immediately.
   *
   * @param {string} moduleName Name of the module to load - like with require
   * @returns {object} A Proxy that handles the on-demand loading
   */
  return function lazyload( moduleName ) {
    let module;
    return new Proxy(((...args) => {
      if (!module)
        module = callingModule.require(moduleName);
      if (module.apply && typeof module.apply === 'function')
        return module.apply(this, args);
      return module; // for destructured calls
    }), {
      get(target, name) {
        if (!module)
          module = callingModule.require(moduleName);
        return module[name];
      },
    });
  };
}

module.exports = createLazyload;
