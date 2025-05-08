// Miscellaneous CSN functions we put into our compiler API

// Do not change at will - they are in the compiler API!

'use strict';

/**
 * Dictionary of default traversal functions for function `traverseCsn`.
 * It maps CSN property names to functions which are used by default
 * to traverse the CSN node which is the value of the corresponding property.
 * Users specify their own traversal function via argument `userFunctions`.
 *
 * Each function in `userFunctions` and `defaultFunctions` is called with:
 * - `userFunctions`
 * - the current CSN node, i.e. ‹parent node›.‹property name›
 * - the ‹parent node›
 * - the ‹property name› (might be useful if the same function is used for several props)
 */
const defaultFunctions = {
  '@': () => { /* do not traverse annotation assignments */ },
  args: dictionary,
  elements: dictionary,
  enum: dictionary,
  params: dictionary,
  actions: dictionary,
  mixin: dictionary,
  definitions: dictionary,
  $: () => { /*  do not traverse properties starting with '$' */ },
};

/**
 * Traverse the CSN node `csn`.
 *
 * If `csn` is an array, call it recursively on each array item.
 * If `csn` is an(other) object, call a function on each property:
 * - The property name is a used as key in argument `userFunctions` and the
 *   constant `defaultFunctions` above to get the function which is called on
 *   the property value, see `defaultFunctions` for details.
 * - If no function is found with the property name, try to find one with the
 *   first char, which is useful for annotations.
 * - If still not found, call `traverseCsn` recursively.
 *
 * The functions in `userFunctions` are usually transformer functions, which
 * change the input CSN destructively.
 */
function traverseCsn( userFunctions, csn ) {
  if (!csn || typeof csn !== 'object')
    return;
  if (Array.isArray( csn )) {
    csn.forEach( node => traverseCsn( userFunctions, node ) );
  }
  else {
    for (const prop of Object.keys( csn )) {
      const func = userFunctions[prop] || defaultFunctions[prop] ||
            userFunctions[prop.charAt(0)] || defaultFunctions[prop.charAt(0)] ||
            traverseCsn;
      func( userFunctions, csn[prop], csn, prop );
    }
  }
}
// people might want to have their own traversal function for `elements`, etc:
traverseCsn.dictionary = dictionary;

/**
 * Traverse the CSN dictionary node `csn`.
 * Call `traverseCsn` on each property value in `csn`, passing down `userFunctions`.
 */
function dictionary( userFunctions, csn ) {
  if (!csn || typeof csn !== 'object')
    return;
  if (Array.isArray( csn )) {   // args can be both array and dictionary
    csn.forEach( node => traverseCsn( userFunctions, node ) );
  }
  else {
    for (const name of Object.keys( csn ))
      traverseCsn( userFunctions, csn[name] );
  }
}

module.exports = {
  traverseCsn,
};
