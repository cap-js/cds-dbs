'use strict';

const { setProp } = require('../base/model');

// Only to be used with validator.js - a correct this value needs to be provided!

/**
 * Check that used types do not contain managed compositions of anonymous aspects
 *
 * - no usage of array-like fields as foreign keys (also not transitively)
 * - no usage of unmanaged association as foreign keys (also not transitively)
 *
 * @param {object} member Member
 */
function checkUsedTypesForAnonymousAspectComposition( member ) {
  // Declared as arrow-function to keep scope the same (this value)
  const handleAssociation = (mem, fn) => {
    for (const key of mem.keys) {
      if (key.ref) {
        if (!key._art)
          continue;
        fn(key._art);
      }
    }
  };
  // Declared as arrow-function to keep scope the same (this value)
  const handleStructured = (mem, fn) => {
    for (const elementName of Object.keys(mem.elements)) {
      const element = mem.elements[elementName];
      fn(element);
    }
  };

  const assertNoAnonymousAspectComposition = (mem) => {
    if (!mem) {
      return;
    }
    else if (mem.type && (mem.type === 'cds.Composition') && !mem.on) {
      if (!mem.target && mem.targetAspect && typeof mem.targetAspect !== 'string')
        this.error(null, member.$path, {}, 'Types with anonymous aspect compositions can\'t be used');
    }
    else if (mem.elements) {
      handleStructured(mem, assertNoAnonymousAspectComposition);
    }
    else if (mem.type) {
      const type = mem.type.ref
        ? this.artifactRef(mem.type)
        : this.csn.definitions[mem.type];
      if (type && !type.$visited) {
        setProp(type, '$visited', true);
        assertNoAnonymousAspectComposition(type);
        delete type.$visited;
      }
    }
  };

  // Recursively perform the checks on an element
  // Declared as arrow-function to keep scope the same (this value)
  const checkTypeUsages = (mem) => {
    if (!mem) {
      return;
    }
    else if (mem.keys) {
      handleAssociation(mem, checkTypeUsages);
    }
    else if (mem.elements) {
      handleStructured(mem, checkTypeUsages);
    }
    else if (mem.type) { // type of
      const type = mem.type.ref
        ? this.artifactRef(mem.type)
        : this.csn.definitions[mem.type];
      if (type && !type.$visited) {
        setProp(type, '$visited', true);
        assertNoAnonymousAspectComposition(type);
        delete type.$visited;
      }
    }
  };

  checkTypeUsages(member);
}

module.exports = checkUsedTypesForAnonymousAspectComposition;
