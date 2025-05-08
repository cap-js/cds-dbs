// Wrappers around core JavaScript / node functions

'use strict';

class PromiseAllError extends Error {
  constructor(subs, ...args) {
    super(...args);
    this.valuesOrErrors = subs;
  }
}

/**
 * Version of Promise.all() which does not reject immediately, i.e. after one
 * promise rejects, the others are still resolved.
 *
 * If rejected, we reject with a PromiseAllError containing all promise values
 * (is Error in case of rejection).  Compare that with Promise.all() which
 * rejects with the result of the first rejected promise.
 *
 * This function only works as intended if no promise in `promises` fulfill
 * with a value which is an instance of Error.
 */
function promiseAllDoNotRejectImmediately( promises ) {
  return Promise.all( promises.map( p => p.catch(e => e) ) )
    .then( values => (values.some(e => e instanceof Error)
      ? Promise.reject( new PromiseAllError(
        values, 'At least one promise has been rejected'
      ) )
      : values));
}

module.exports = {
  promiseAllDoNotRejectImmediately,
};
