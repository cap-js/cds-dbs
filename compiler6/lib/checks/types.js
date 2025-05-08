'use strict';

// Only to be used with validator.js - a correct this value needs to be provided!

const { hasPersistenceSkipAnnotation } = require('../model/csnUtils');

/**
 * Scale must not be 'variable' or 'floating'
 *
 * scale property is always propagated
 *
 * @param {CSN.Element} member the element to be checked
 * @param {string} memberName the elements name
 * @param {string} prop which kind of member are we looking at -> only prop "elements"
 * @param {CSN.Path} path the path to the member
 */
function checkDecimalScale( member, memberName, prop, path ) {
  if (this.artifact['@cds.persistence.exists'] ||
      // skip is already filtered in validator, here for completeness
      hasPersistenceSkipAnnotation(this.artifact))
    return;
  if (member.scale && (member.scale === 'variable' || member.scale === 'floating'))
    this.error(null, path, { name: member.scale }, 'Unexpected scale $(NAME)');
}

/**
 * View parameter for hana must be of scalar type
 *
 * @param {CSN.Element} member the element to be checked
 * @param {string} memberName the elements name
 * @param {string} prop which kind of member are we looking at -> only prop "elements"
 * @param {CSN.Path} path the path to the member
 */
function checkTypeIsScalar( member, memberName, prop, path ) {
  if ( prop === 'params' && this.csnUtils.isStructured(member))
    this.error(null, path, {}, 'View parameter type must be scalar');
}

/**
 * Check that the `type of` information in the given element
 * has proper type information or issue an error otherwise. The element's final type is checked.
 *
 * @param {CSN.Element} member the element to be checked
 * @param {string} memberName the elements name
 * @param {string} prop which kind of member are we looking at -> only prop "elements"
 * @param {CSN.Path} path the path to the member
 */
function checkElementTypeDefinitionHasType( member, memberName, prop, path ) {
  if (prop !== 'elements' && prop !== 'params')
    return; // no enum, etc.
  // Computed elements, e.g. "1+1 as foo" in a view don't have a valid type and
  // are skipped here.  References to such columns are checked further below.
  const parent = this.csn.definitions[path[1]];

  // Type elements are not required to have a type.
  // This can also happen via type projections.
  // Elements of views are allowed to be typeless.
  // Calculated elements on-read may not have a .type (requires beta flag)
  if ((!member.value || member.value.stored) &&
      (parent.kind === 'type' || !parent.projection && !parent.query) &&
      !hasArtifactTypeInformation(member)) {
    errorAboutMissingType(this.error, path, member, memberName, true);
    return;
  }

  // Check for `type of`
  if (member.type) {
    if (member.type.ref) {
      const isSelfReference = path[1] === member.type.ref[0];
      checkTypeOfHasProperType.call(
        this, member, memberName, this.csn, this.error, path, isSelfReference ? member.type.ref[1] : null
      );
    }
    else if (member._type) {
      if ( member._type?.kind === 'aspect' || member._type.kind === 'type' && member._type.$syntax === 'aspect')
        this.error('ref-sloppy-type', path, {}, 'A type or an element is expected here');
    }
    return;
  }

  // many
  const { items } = member;
  if (items)
    checkTypeOfHasProperType.call(this, items, memberName, this.csn, this.error, path );
}

/**
 * If the given artifact is a type definition then check whether it is
 * properly defined and has valid type information, e.g. information about
 * its elements or references another valid type.
 *
 * @param {CSN.Artifact} artifact the artifact which is to be checked
 * @param {string} artifactName the artifacts name
 * @param {string} prop which kind of artifact we are looking at
 * @param {CSN.Path} path the path to the artifact
 */
function checkTypeDefinitionHasType( artifact, artifactName, prop, path ) {
  if (artifact.kind !== 'type')
    return;

  // should only happen with csn input, not in cdl
  if (!hasArtifactTypeInformation(artifact)) {
    errorAboutMissingType(this.error, path, artifact, artifactName);
    return;
  }

  // Check for `type of`
  if (artifact.type) {
    checkTypeOfHasProperType.call(this, artifact, artifactName, this.csn, this.error, path);
    return;
  }

  // many
  const { items } = artifact;
  if (items)
    checkTypeOfHasProperType.call(this, items, artifactName, this.csn, this.error, path );
}


/**
 * Check that the `type of` information in the given artifact (i.e. `type` property)
 * has proper type information or issue an error otherwise. The artifact's final type is checked.
 *
 * @param {object} artOrElement can either be an element or a type definition
 * @param {string} name the name of the element or of the artifact
 * @param {CSN.Model} model the csn model in which the element/artifact resides
 * @param {Function} error the error function
 * @param {CSN.Path} path the path to the element or the artifact
 * @param {string} derivedTypeName if the type reference is another type/element e.g. type derivedType : MaliciousType; we want to
 *                                 point at the "MaliciousType" reference, that's why we need to remember the name when drilling down.
 */
function checkTypeOfHasProperType( artOrElement, name, model, error, path, derivedTypeName = null ) {
  if (!artOrElement.type)
    return;

  const typeOfType = this.csnUtils.getFinalTypeInfo(artOrElement.type);

  if (typeOfType === null) {
    if (artOrElement.type.ref && this?.options?.transformation !== 'odata') {
      const typeOfArt = artOrElement.type.ref[0];
      const typeOfElt = artOrElement.type.ref.slice(1).join('.');
      error('check-proper-type-of', path, {
        art: derivedTypeName || typeOfArt, name: typeOfElt, '#': derivedTypeName ? 'derived' : 'std',
      });
    }
  }
  else if (typeOfType && typeOfType.items) {
    derivedTypeName = typeof artOrElement.type === 'string' ? artOrElement.type : artOrElement.type.ref[artOrElement.type.ref.length - 1];
    checkTypeOfHasProperType.call(this, typeOfType.items, name, model, error, path, derivedTypeName);
  }
}


/**
 * Can happen in CSN, e.g. `{ a: { kind: "type" } }` but should not happen in CDL.
 *
 * @param {Function} error the error function
 * @param {CSN.Path} path the path to the element or the artifact
 * @param {CSN.Artifact} artifact Element or other member/definition.
 * @param {string} name of the element or the artifact which is dubious
 * @param {boolean} isElement indicates whether we are dealing with an element or an artifact
 */
function errorAboutMissingType( error, path, artifact, name,
                                isElement = false ) {
  let variant = isElement ? 'elm' : 'std';
  if (artifact.value?.stored)
    variant = 'calc';
  error('def-missing-type', path, { art: name, '#': variant }, {
    std: 'Missing type for $(ART)',
    elm: 'Missing type for element $(ART)',
    calc: 'A stored calculated element must have a type',
  });
}

/**
 * Check whether the given artifact has type information.  An artifact has type
 * information when it is either a builtin, a struct, an enum, an array, an
 * association OR if it references another type, i.e. typeOf.  For the latter
 * case an artifact's final type must be checked.
 *
 * @param {CSN.Artifact} artifact the artifact to check
 * @returns {boolean} indicates whether the artifact has type information
 */
function hasArtifactTypeInformation( artifact ) {
  // When is what property set?
  return artifact.elements ||  // => `type A {}`
    artifact.items ||     // => `type A : array of Integer`
    artifact.enum ||      // => `type A : Integer enum {}`, `type` also set
    artifact.target ||    // => `type A : Association to B;`
    artifact.type;     // => `type A : [type of] Integer`
}

module.exports = {
  checkTypeDefinitionHasType,
  checkElementTypeDefinitionHasType,
  checkTypeIsScalar,
  checkDecimalScale,
};
