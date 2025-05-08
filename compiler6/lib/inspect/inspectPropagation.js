'use strict';

const { createMessageFunctions } = require('../base/messages');
const { locationString } = require('../base/location');
const { findArtifact, stringRefToPath } = require('./inspectUtils');
const { term } = require('../utils/term');

const inferredNiceOutput = {
  '*': 'wildcard',
  'aspect-composition': 'composition',
  prop: 'propagation',
  $generated: 'generated',
};

/**
 * @param {XSN.Model} xsn
 * @param {CSN.Options} options
 * @param {string} artifactName
 * @returns {string|null}
 */
function inspectPropagation( xsn, options, artifactName ) {
  const { error } = createMessageFunctions(options, 'inspect', xsn);
  const result = [];

  // Default color mode is 'auto'
  const color = term(options.color !== undefined ? options.color : 'auto');

  const path = stringRefToPath(artifactName);
  if (!path) {
    error(null, null, { name: artifactName },
          'Artifact $(NAME) is not a valid path; expected format `<def>[:element]`');
    return null;
  }

  const artifactXsn = findArtifact(xsn, path);

  if (!artifactXsn) {
    error(null, null, { name: artifactName },
          // eslint-disable-next-line @stylistic/js/max-len
          'Artifact $(NAME) not found, only top-level artifacts and their elements are supported for now');
    return null;
  }
  result.push(color.underline('analyzing propagation for artifact:'));
  // TODO: back to artifactXsn.name.id (not ok now, and not before this change!)
  result.push(`  name: ${ artifactXsn.name.id }`);
  result.push(`  kind: ${ artifactXsn.kind }`);

  if (artifactXsn.$inferred)
    result.push(`  inferred: ${ artifactXsn.$inferred }`);

  result.push('');
  result.push(`  ${ color.underline('annotation propagation:') }`);
  result.push(..._indent(_inspectAnnotations(artifactXsn)));

  result.push('');
  result.push(`  ${ color.underline('element propagation:') }`);
  result.push(..._indent(_inspectElements(artifactXsn)));

  return result.join('\n');
}

/**
 @param {string[]} lines
 @param {string} indent
 * @returns {string[]}
 */
function _indent( lines, indent = '    ' ) {
  return lines.map(str => `${ indent }${ str }`);
}

/**
 * @param {XSN.Artifact} artifactXsn
 * @returns {string[]}
 * @private
 */
function _inspectAnnotations( artifactXsn ) {
  const result = [];
  const annos = Object.keys(artifactXsn).filter(str => str.startsWith('@')).sort();

  if (annos.length === 0)
    return [ 'no annotations' ];

  let maxAnnoLength = 30; // chosen arbitrarily, hopefully average
  for (const anno of annos) {
    const annoXsn = artifactXsn[anno];
    const loc = locationString(annoXsn.name.location);

    let origin;
    if (annoXsn.$inferred === '$generated')
      origin = 'generated';
    else if (annoXsn.$inferred)
      origin = inferredNiceOutput[annoXsn.$inferred] || annoXsn.$inferred;
    else if (isContainedInParentLocation(annoXsn.name, artifactXsn))
      origin = 'direct';
    else
      origin = 'annotate';      // ...or `extend`

    maxAnnoLength = Math.max(maxAnnoLength, anno.length);

    // origin: assume max length 11 of 'propagation'
    // anno: use max length of all annotations till now
    result.push([ origin.padStart(11), anno.padEnd(maxAnnoLength), loc ].join(' | '));
  }
  return result;
}

/**
 * @param {XSN.Artifact} artifactXsn
 * @returns {string[]}
 * @private
*/
function _inspectElements( artifactXsn ) {
  if (!artifactXsn.elements)
    return [ 'does not have elements' ];

  const result = [];
  const elements = Object.keys(artifactXsn.elements);

  let maxElemLength = 12;
  let maxOriginLength = 6;

  // type: assume max length 11 of 'composition'
  // element: assume average length of 30, chosen randomly
  result.push([
    'type'.padStart(11),
    'element'.padEnd(maxElemLength),
    'origin'.padEnd(maxOriginLength),
    'location (definition)',
  ].join(' | '));

  for (const element of elements) {
    const elementXsn = artifactXsn.elements[element];
    const loc = locationString(_origin(elementXsn).name.location);
    let origin;
    const originName = (elementXsn._origin?._main || elementXsn._origin)?.name?.id || '';

    if (elementXsn.$inferred) {
      // Use nice(r) output for known $inferred
      if (inferredNiceOutput[elementXsn.$inferred])
        origin = inferredNiceOutput[elementXsn.$inferred];
      else
        origin = elementXsn.$inferred;
    }
    else if (!isContainedInParentLocation(elementXsn, artifactXsn)) {
      // just a heuristic - a good enough one
      origin = 'extend';
    }
    else {
      origin = 'direct';
    }

    maxElemLength = Math.max(maxElemLength, element.length);
    maxOriginLength = Math.max(maxOriginLength, originName.length);

    result.push([
      origin.padStart(11),
      element.padEnd(maxElemLength),
      originName.padEnd(maxOriginLength),
      loc,
    ].join(' | '));
  }

  return result;
}

function _origin( elementXsn ) {
  while (elementXsn._origin)
    elementXsn = elementXsn._origin;
  return elementXsn;
}

/**
 * Returns true if `art` is contained in `parent` according to its location.
 *
 * @param art
 * @param parent
 * @returns {boolean}
 */
function isContainedInParentLocation( art, parent ) {
  const artLoc = art.location;
  const parentLoc = parent.location;
  if (artLoc.file !== parentLoc.file)
    return false;
  const startDiff = artLoc.line - parentLoc.line || artLoc.col - parentLoc.col;
  const endDiff = artLoc.endLine - parentLoc.endLine || artLoc.endCol - parentLoc.endCol;
  return startDiff >= 0 && endDiff <= 0;
}

module.exports = {
  inspectPropagation,
};
