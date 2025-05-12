'use strict';

/**
 * Copy "property" from the source object to the target object.
 * Only if it exists in the source object (using "in" operator).
 *
 * @param {object} sourceObj
 * @param {string} property
 * @param {object} targetObj
 */
function copyPropIfExist( sourceObj, property, targetObj ) {
  if (sourceObj && property in sourceObj)
    targetObj[property] = sourceObj[property];
}

/**
 * Loops over all elements in an object and calls the specified callback(key,obj)
 *
 * @param {object} obj
 * @param {(key: string, value: object) => void} callback
 */
function forEach( obj, callback ) {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key))
      callback(key, obj[key]);
  }
}

/**
 * Loops over all elements in an object and calls the specified callback(o[key]) for each key
 * --> can be used as substitute for `Object.values(…).forEach(…)`
 *
 * @param  {object} o the object which values should be iterated
 * @param  {Function} callback
 */
function forEachValue( o, callback ) {
  for (const key in o) {
    if (Object.prototype.hasOwnProperty.call(o, key))
      callback(o[key]);
  }
}

/**
 * Loops over all elements in an object and calls the specified callback(key) for each key
 * --> can be used as substitute for `Object.keys(…).forEach(…)`
 *
 * @param  {object} o the object which keys should be iterated
 * @param  {Function} callback
 */
function forEachKey( o, callback ) {
  for (const key in o) {
    if (Object.prototype.hasOwnProperty.call(o, key))
      callback(key);
  }
}

/**
 * Sets a property as "hidden" (a.k.a. non-enumerable).
 *
 * @param {object} obj
 * @param {string} prop
 * @param {any} val
 */
function setHidden( obj, prop, val ) {
  Object.defineProperty( obj, prop, {
    value: val, configurable: true, writable: true, enumerable: false,
  } );
}

/**
 * Check if the given object has the property as non-enumerable
 *
 * @param {Object} object
 * @param {string} propertyName
 * @returns {boolean}
 */
function hasNonEnumerable( object, propertyName ) {
  return Object.prototype.hasOwnProperty.call( object, propertyName ) &&
    !Object.prototype.propertyIsEnumerable.call( object, propertyName );
}

module.exports = {
  copyPropIfExist,
  forEach,
  forEachValue,
  forEachKey,
  setHidden,
  hasNonEnumerable,
};
