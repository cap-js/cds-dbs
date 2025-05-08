'use strict';

/**
 * Reference (string) to path (array) that can be used to identify an artifact
 * @param str
 * @returns {*[]|*}
 */
function stringRefToPath( str ) {
  // e.g. `ns.service.E:sub.elem.structured`
  const path = str.split(':');
  if (path.length === 1)
    return path;
  if (path.length > 2)
    return null;
  return [ path[0], ...path[1].split('.') ];
}

/**
 * @param {XSN.Model} xsn
 * @param {string} path
 * @private
 */
function findArtifact( xsn, path ) {
  const segments = [ ...path ];
  const topLevelName = segments[0];
  let art = (xsn.definitions && xsn.definitions[topLevelName]) ||
    (xsn.vocabularies && xsn.vocabularies[topLevelName]);
  if (!art)
    return null;
  segments.shift();
  if (segments.length === 0)
    return art;
  while (segments.length && art) {
    const segment = segments.shift();
    art = (art.items?.elements || art.elements)?.[segment];
  }
  return art || null;
}


module.exports = {
  stringRefToPath,
  findArtifact,
};
