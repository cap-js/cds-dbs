'use strict';

/**
 * Use this class to indicate that an internal error was noticed.
 * In testMode, these errors do _not_ trigger a recompilation.
 */
class CompilerAssertion extends Error {
  constructor(message) {
    super(`cds-compiler assertion failed: ${ message }`);
    this.code = 'ERR_CDS_COMPILER_ASSERTION';
  }
}

/**
 * Use this class to indicate that something with the input CSN is wrong,
 * which will be caught by the core compiler through recompiling the sources.
 */
class ModelError extends Error {
  constructor(message) {
    super(`cds-compiler model error: ${ message }`);
    this.code = 'ERR_CDS_COMPILER_MODEL';
  }
}

module.exports = {
  CompilerAssertion,
  ModelError,
};
