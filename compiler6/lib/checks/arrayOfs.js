'use strict';

const { setProp } = require('../base/model');

// Only to be used with validator.js - a correct `this` value needs to be provided!

/**
 * Associations inside of an array-like must have all their foreign keys inside of the items.
 *
 * This effectively restricts it to
 * - managed associations or
 * - unmanaged associations where the on-condition only references elements inside
     of the items, $self usage must be forbidden.
 *
 * @param {CSN.Artifact} member Member
 */
function validateAssociationsInItems( member ) {
  const validate = (obj) => {
    if (obj && obj.elements) {
      for (const elementName of Object.keys(obj.elements)) {
        const element = obj.elements[elementName];
        if (element.elements) {
          validate(element);
        }
        else if (element.target) {
          if (element.on) { // Unmanaged association
            // Unmanaged associations are always forbidden for now
            // TODO: Check if the on-condition only references things inside of the .items
            this.error(null, member.$path, {}, 'Unmanaged associations in "array of" or "many" are not allowed');
          }
        }
      }
    }
  };
  if (this.artifact && this.artifact.kind === 'entity' && member && member.items && member.$path[2] === 'elements') {
    if (member.items.type) {
      const type = member.items.type.ref
        ? this.artifactRef(member.items.type)
        : this.csn.definitions[member.items.type];
      if (type && !type.$visited) {
        setProp(type, '$visited', true);
        validate(type);
        delete type.$visited;
      }
    }
    else {
      validate(member.items);
    }
  }
}

module.exports = { validateAssociationsInItems };
