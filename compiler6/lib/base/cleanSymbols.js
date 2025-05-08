'use strict';

/**
 * Remove the given symbols from the object.
 * Does NOT do so recursively, only directly on the object.
 *
 * @param {object} obj
 * @param  {...any} symbols
 */
function cleanSymbols( obj, ...symbols ) {
  for (const symbol of symbols)
    delete obj[symbol];
}

module.exports = {
  cleanSymbols,
};
