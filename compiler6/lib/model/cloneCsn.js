'use strict';

const { csnPropertyOrder } = require('../json/to-csn');
const { ModelError } = require('../base/error');
const { setHidden, hasNonEnumerable } = require('../utils/objectUtils');
const { isAnnotationExpression } = require('../base/builtins');

const csnDictionaries = {
  __proto__: null,
  args: 1,
  params: 1,
  enum: 1,
  mixin: 1,
  elements: 1,
  actions: 1,
  definitions: 1,
  vocabularies: 1,
};

const sortedCsnDictionaries = {
  __proto__: null,
  definitions: 1,
  actions: 1,
};

function shallowCopy( val, _options, _sort ) {
  return val;
}

const internalCsnProps = {
  __proto__: null,
  $sources: shallowCopy,
  $location: shallowCopy,
  $path: shallowCopy,
  $paths: shallowCopy,
  elements: cloneCsnDict,
  $tableConstraints: shallowCopy,
  $default: shallowCopy, // used for HANA CSN migrations
  $notNull: shallowCopy, // used for HANA CSN migrations
  $sqlService: shallowCopy,
  $dummyService: shallowCopy,
};
const internalEnumerableCsnProps = {
  __proto__: null,
  $tableConstraints: shallowCopy, // enumerable for HANA CSN for migrations
};
const internalCsnPropertyNames = Object.keys(internalCsnProps);

/**
 * Deeply clone the given CSN model and return it.
 * In testMode (or with testSortCsn), definitions are sorted.
 *
 * This function is CSN aware! Don't put annotation values into it, or
 * keys such as "elements" will be interpreted according to CSN rules!
 *
 * @see cloneAnnotationValue()
 * @see cloneCsnDict()
 *
 * @param {object} csn
 *   Top-level CSN.  You can pass non-dictionary values.
 * @param {CSN.Options} options
 *   CSN Options, only used for `dictionaryPrototype`, `testMode`, and `testSortCsn`.
 * @param {boolean} sort
 *   Whether to sort CSN properties.
 */
function cloneCsn( csn, options, sort ) {
  if (!csn || typeof csn !== 'object')
    return csn;
  if (Array.isArray(csn))
    return csn.map( v => cloneCsn(v, options, sort) );

  const keys = Object.keys(csn);
  if (sort)
    keys.sort( compareProperties );

  const r = {};
  for (const n of keys) {
    const val = csn[n];
    if (n.charAt(0) === '@') {
      r[n] = cloneAnnotationValue(val, options, false); // TODO: pass 'sort'
    }
    else if (!val || typeof val !== 'object') {
      r[n] = val;
    }
    else if (csnDictionaries[n] && !Array.isArray(val)) {
      const sortDict = (!options || options.testMode || options.testSortCsn) &&
        sortedCsnDictionaries[n];
      // Array check for property `args` which may either be a dictionary or an array.
      r[n] = cloneCsnDict(val, options, sort, sortDict);
    }
    else if (n in internalEnumerableCsnProps) {
      r[n] = internalEnumerableCsnProps[n](val, options, sort);
    }
    else {
      r[n] = cloneCsn(val, options, sort);
    }
  }

  // Note: internal properties with value `undefined` are _not_ cloned!
  // The `hasNonEnumerable()` is required to work with cds.linked() CSN!
  // It _must_ appear before csn[prop] or it may invoke getters!
  internalCsnPropertyNames.forEach((prop) => {
    if (r[prop] === undefined && hasNonEnumerable( csn, prop ) && csn[prop] !== undefined)
      setHidden( r, prop, internalCsnProps[prop](csn[prop], options, sort) );
  });
  options?.hiddenPropertiesToClone?.forEach((prop) => {
    if (r[prop] === undefined && hasNonEnumerable( csn, prop ) && csn[prop] !== undefined)
      setHidden( r, prop, csn[prop] );
  });

  return r;
}


/**
 * Deeply clone the given CSN dictionary and return it.
 * This function does _not_ sort the given dictionary.
 * See cloneCsnNonDict() if you want sorted definitions.
 *
 * This function is CSN aware! Don't put annotation values into it, or
 * keys such as "elements" will be interpreted according to CSN rules!
 *
 * @see cloneAnnotationValue
 * @see cloneCsnNonDict
 *
 * @param {object} csn
 * @param {CSN.Options} options Only cloneOptions.dictionaryPrototype is
 *                              used and cloneOptions are passed to sortCsn().
 * @param {boolean} sortProps   Whether to sort CSN properties.
 * @param {boolean} sortDict    Whether to sort CSN dictionary entries.
 */
function cloneCsnDict( csn, options, sortProps, sortDict ) {
  const proto = options?.dictionaryPrototype;
  const dictProto = (typeof proto === 'object') // including null
    ? proto
    : null;
  const r = Object.create( dictProto );
  const keys = Object.keys(csn);
  if (sortDict)
    keys.sort();
  for (const n of keys) {
    // CSN does not allow any dictionary that are not objects.
    // The compiler handles it, but a pre-transformed OData CSN won't trigger recompilation.
    if (csn[n] && typeof csn[n] === 'object')
      r[n] = cloneCsn(csn[n], options, sortProps);
    else
      throw new ModelError(`Found non-object dictionary entry: "${ n }" of type "${ typeof csn[n] }"`);
  }
  return r;
}

/**
 * Clones the given annotation _value_.  `value` must not be an object with annotations,
 * but the annotation value itself, e.g. `[ { a: 1 } ]`, not `@anno: [...]`.
 *
 * @param {any} value
 * @param {object} options
 * @param {boolean} sort Whether to sort properties inside expressions.
 * @returns {any}
 */
function cloneAnnotationValue( value, options, sort ) {
  if (!value || typeof value !== 'object') // scalar
    return value;
  if (!Array.isArray(value) && isAnnotationExpression( value ))
    return cloneCsn( value, options, sort );
  return JSON.parse( JSON.stringify( value ) );
}

/**
 * Sorts the definition dictionary in tests mode.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @returns The input csn model.
 */
function sortCsnDefinitionsForTests( csn, options ) {
  if (!options.testMode && !options.testSortCsn)
    return csn;
  const sorted = Object.create(null);
  Object.keys(csn.definitions || {}).sort().forEach((name) => {
    sorted[name] = csn.definitions[name];
  });
  csn.definitions = sorted;
  return csn;
}

function sortCsnForTests( csn, options ) {
  if (options.testMode)
    return cloneCsn(csn, options, true);
  if (options.testSortCsn)
    return sortCsnDefinitionsForTests( csn, options );
  return csn;
}

// Difference to to-csn.js: Annotations are always sorted
function compareProperties( a, b ) {
  if (a === b)
    return 0;
  const oa = csnPropertyOrder[a] || csnPropertyOrder[a.charAt(0)] || 9999;
  const ob = csnPropertyOrder[b] || csnPropertyOrder[b.charAt(0)] || 9999;
  return oa - ob || (a < b ? -1 : 1);
}

module.exports = {
  cloneCsnDict(csn, options) {
    return cloneCsnDict(csn, options, false, false);
  },
  cloneCsnNonDict(csn, options) {
    return cloneCsn(csn, options, false);
  },
  cloneFullCsn(csn, options) {
    return cloneCsn(csn, options, false);
  },
  cloneAnnotationValue(csn) {
    return cloneAnnotationValue(csn, {}, false);
  },
  sortCsn(csn, options) {
    return cloneCsn(csn, options, true);
  },
  sortCsnDefinitionsForTests,
  sortCsnForTests,
};
