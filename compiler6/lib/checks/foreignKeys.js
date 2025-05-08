'use strict';

const { setProp } = require('../base/model');

// Only to be used with validator.js - a correct this value needs to be provided!

/**
 * Validate the foreign keys of a managed association
 *
 * - no usage of array-like fields as foreign keys (also not transitively)
 * - no usage of unmanaged association as foreign keys (also not transitively)
 *
 * @param {object} member Member
 * @param {string} memberName Member name
 */
function validateForeignKeys( member, memberName ) {
  // We have a managed association
  const isManagedAssoc = mem => mem && mem.target && !mem.on;

  // Declared as arrow-function to keep scope the same (this value)
  const handleAssociation = (mem) => {
    for (const key of mem.keys) {
      if (key.ref) {
        if (!key._art)
          continue;
        // eslint-disable-next-line no-use-before-define
        checkForItemsOrMissingType(key._art, key.ref.join('.'));
      }
    }
  };

  // Declared as arrow-function to keep scope the same (this value)
  const handleStructured = (mem) => {
    for (const elementName of Object.keys(mem.elements)) {
      const element = mem.elements[elementName];
      // eslint-disable-next-line no-use-before-define
      checkForItemsOrMissingType(element, elementName);
    }
  };

  // Recursively perform the checks on an element
  // Declared as arrow-function to keep scope the same (this value)
  const checkForItemsOrMissingType = (mem, memName) => {
    if (mem.items) {
      this.error(null, member.$path, {}, 'Array-like properties must not be foreign keys');
    }
    else if (mem.keys) {
      handleAssociation(mem);
    }
    else if (mem.elements) {
      handleStructured(mem);
    }
    else if (mem.type) {
      if (mem.type === 'cds.Map') {
        this.error(null, member.$path, { type: mem.type }, 'Unexpected type $(TYPE) in foreign key');
      }
      else {
        const type = mem.type.ref
          ? this.artifactRef(mem.type)
          : this.csn.definitions[mem.type];
        if (type && !type.$visited) {
          setProp(type, '$visited', true);
          checkForItemsOrMissingType(type, memName);
          delete type.$visited;
        }
      }
    }
    else if (mem && !mem.type && this.options.transformation !== 'odata') {
      const variant = member.type === 'cds.Composition' ? 'managedCompForeignKey' : 'managedAssocForeignKey';
      this.error('check-proper-type-of', member.$path, {
        '#': variant, name: memName, art: memberName,
      });
    }
  };

  if (isManagedAssoc(member))
    checkForItemsOrMissingType(member, memberName);
}

module.exports = validateForeignKeys;
