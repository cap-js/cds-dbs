'use strict';

// Only to be used with validator.js - a correct this value needs to be provided!
// not relevant for odata - entities need to be checked at the end of the transformation

const { isPersistedOnDatabase } = require('../model/csnUtils.js');

/**
 * Ensure that empty/only virtual entities do not reach the db.
 *
 * @param {CSN.Artifact} artifact Artifact to validate
 * @param {string} artifactName Name of the artifact
 * @param {string} prop Property being looped over
 * @param {CSN.Path} path Path to the artifact
 */
function validateHasPersistedElements( artifact, artifactName, prop, path ) {
  if (artifact.kind === 'entity' && isPersistedOnDatabase(artifact)) {
    if (!artifact.elements || !hasRealElements(artifact.elements))
      // TODO: Maybe check if there are only calc elements and adapt the message?
      this.error('def-missing-element', path, { '#': ( artifact.query || artifact.projection ) ? 'view' : 'std' });
  }
}

/**
 * Check if the provided elements contain elements that will be created on the database.
 * This includes virtual and calculated elements.
 *
 * @param {CSN.Elements} elements Elements to look through
 * @returns {boolean} True if something would be created on the db from these elements.
 */
function hasRealElements( elements ) {
  for (const element of Object.values(elements)) {
    if (!element.virtual && !element.value) {
      if (element.elements) {
        if (hasRealElements(element.elements))
          return true;
      }
      else if (element.target) {
        if (element.keys?.length > 0)
          return true;
        // else: either unmanaged or no keys
      }
      else {
        return true;
      }
    }
  }

  return false;
}


module.exports = validateHasPersistedElements;
