const jestRuntime = require('jest-runtime')

const vm = require('vm')
const transform = require('@jest/transform')
const createScriptFromCode = function (scriptSource, filename) {
  try {
    const scriptFilename = this._resolver.isCoreModule(filename) ? `jest-nodejs-core-${filename}` : filename
    return new vm.Script(this.wrapCodeInModuleWrapper(scriptSource), {
      displayErrors: true,
      filename: scriptFilename,
      columnOffset: this._fileTransforms.get(filename)?.wrapperLength, // Adding this one liner to make debugging as expected again
      // @ts-expect-error: Experimental ESM API
      importModuleDynamically: async specifier => {
        invariant(
          runtimeSupportsVmModules,
          'You need to run with a version of node that supports ES Modules in the VM API. See https://jestjs.io/docs/ecmascript-modules',
        )
        const context = this._environment.getVmContext?.()
        invariant(context, 'Test environment has been torn down')
        const module = await this.resolveModule(specifier, scriptFilename, context)
        return this.linkAndEvaluateModule(module)
      },
    })
  } catch (e) {
    throw (0, transform.handlePotentialSyntaxError)(e)
  }
}
jestRuntime.default.prototype.createScriptFromCode = createScriptFromCode

const runtimeSupportsVmModules = typeof require('vm').SyntheticModule === 'function';
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}