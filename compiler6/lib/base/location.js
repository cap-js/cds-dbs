'use strict';

// This file contains functions related to XSN/CSN-location objects,
// and the class definition for semantic locations

const { copyPropIfExist } = require('../utils/objectUtils');

class Location {
  file;
  line;
  col;
  endLine;
  endCol;
  tokenIndex;
  constructor( file, line, col, endLine, endCol ) {
    this.file = file;
    this.line = line;
    this.col = col;
    this.endLine = endLine;
    this.endCol = endCol;
  }
  toString() {
    return locationString( this );
  }
}

class SemanticLocation {
  mainKind;
  absolute;
  action;
  param;
  select;
  mixin;
  element = [];
  suffix;
  innerKind;

  toString() {
    return semanticLocationString( this );
  }
}

function semanticLocationString( name, extended = false ) {
  const parts = [ `${ name.mainKind }:“${ name.absolute }”` ];
  if (name.action != null)
    parts.push( `“action:${ name.action }”` );
  if (name.param != null)
    parts.push( name.param ? `param:“${ name.param }”` : 'returns' );
  if (name.select != null)
    parts.push( name.select ? `select:${ name.select }` : 'select' );
  if (name.mixin != null) {
    const prop = (name.innerKind === 'alias') ? 'alias' : 'mixin';
    parts.push( `${ prop }:${ stringOrRaw( name.mixin ) }` );
  }
  const { element, innerKind } = name;
  if (element.length) {
    const append = innerKind === 'item' || innerKind === 'aspect';
    const prop = !append && innerKind || !innerKind && name.select != null && 'column';
    if (!prop || append) {
      parts.push( `element:${ stringOrRaw( element ) }` );
      if (append)
        parts.push( innerKind );
    }
    else if (prop === 'column') {
      const pos = extended ? -1
        : element.findIndex( ( e, idx ) => idx && typeof e !== 'string' );
      parts.push( `column:${ stringOrRaw( pos > 0 ? element.slice( 0, pos ) : element ) }` );
    }
    else {
      if (element.length > 1)
        parts.push( `element:${ stringOrRaw( element.slice( 0, -1 ) ) }` );
      parts.push( `${ innerKind }:“${ element[element.length - 1] }”` );
    }
  }
  if (name.suffix)
    parts.push( name.suffix );
  return parts.join( '/' );
}

function stringOrRaw( val ) {
  if (!Array.isArray( val ))
    return (typeof val === 'string') ? `“${ val }”` : val;
  return val.every( e => typeof e === 'string' ) // && no '.' ?
    ? `“${ val.join( '.' ) }”`
    : val.map( stringOrRaw ).join( '→' ); // for XSN output, is sliced otherwise
}

/**
 * Create a location with properties `file`, `line` and `col` from argument
 * `start`, and properties `endLine` and `endCol` from argument `end`.
 *
 * @param {XSN.WithLocation} start
 * @param {XSN.WithLocation} end
 * @returns {CSN.Location}
 *
 * TODO: make this function a CDL parser-only function (i.e. there should be
 *       no need to use it outside), it is XSN-only anyway already now
 */
function combinedLocation( start, end ) {
  if (!start || !start.location)
    return end?.location;
  else if (!end || !end.location)
    return start.location;
  const loc = {
    file: start.location.file,
    line: start.location.line,
    col: start.location.col,
  };
  copyPropIfExist(end.location, 'endLine', loc);
  copyPropIfExist(end.location, 'endCol', loc);
  return loc;
}

/**
 * Create an empty location object with the given file name.
 *
 * @param {string} filename
 * @returns {CSN.Location}
 *
 * TODO: make this function redundant (XSN sparse locations project)
 */
function emptyLocation( filename ) {
  return {
    __proto__: Location.prototype,
    file: filename,
    line: 1,
    col: 1,
    endLine: 1,
    endCol: 1,
  };
}

/**
 * Create an empty location object with the given file name.
 * The end line/column is not set and therefore the location is weak.
 *
 * @param {string} filename
 * @returns {CSN.Location}
 *
 * TODO: make this function redundant (XSN sparse locations project)
 */
function emptyWeakLocation( filename ) {
  return {
    __proto__: Location.prototype,
    file: filename,
    line: 1,
    col: 1,
    endLine: undefined,
    endCol: undefined,
  };
}

/**
 * @param {Location} loc
 * @returns {Location}
 */
function weakLocation( loc ) {
  return (!loc?.endLine) ? loc : {
    __proto__: Location.prototype,
    file: loc.file,
    line: loc.line,
    col: loc.col,
    endLine: undefined,
    endCol: undefined,
  };
}

/**
 * Return a location to be used for compiler-generated artifacts whose location is
 * best derived from a reference (`type`, `includes`, `target`, `value`) or a name.
 * Omit the end position to indicate that this is just an approximate location.
 *
 * If represented by a `path` (not always the case for a `name`), use the location
 * of its last item.  Reason: think of an IDE functionality “Go to Definition” – only
 * a double-click on the _last_ identifier token of the reference jumps to the artifact
 * represented by the complete reference.
 *
 * @param {Location} loc
 * @returns {Location}
 */
function weakRefLocation( ref ) {
  if (!ref)
    return ref;
  const { path } = ref;
  const loc = path?.length ? path[path.length - 1].location : ref.location;
  return (!loc?.endLine) ? loc : {
    __proto__: Location.prototype,
    file: loc.file,
    line: loc.line,
    col: loc.col,
    endLine: undefined,
    endCol: undefined,
  };
}

/**
 * @param {Location} loc
 * @returns {Location}
 */
function weakEndLocation( loc ) {
  return loc && {
    __proto__: Location.prototype,
    file: loc.file,
    line: loc.endLine,
    col: loc.endCol && loc.endCol - 1,
    endline: undefined,
    endCol: undefined,
  };
}

/**
 * Returns a dummy location for built-in definitions.
 *
 * @returns {CSN.Location}
 *
 * TODO: make this function redundant (XSN sparse locations project)
 */
function builtinLocation() {
  return emptyLocation('<built-in>');
}

/**
 * Return gnu-style error string for location `loc`:
 *  - 'File:Line:Col' without `loc.end`
 *  - 'File:Line:StartCol-EndCol' if Line = start.line = end.line
 *  - 'File:StartLine.StartCol-EndLine.EndCol' otherwise
 *
 * @param {CSN.Location|CSN.Location} location
 * @param {boolean} [normalizeFilename]
 */
function locationString( location, normalizeFilename ) {
  if (!location)
    return '<???>';
  const loc = location;
  const filename = (loc.file && normalizeFilename)
    ? loc.file.replace( /\\/g, '/' )
    : loc.file;
  if (!(loc instanceof Object))
    return loc;
  if (!loc.line) {
    return filename;
  }
  else if (!loc.endLine) {
    return (loc.col)
      ? `${ filename }:${ loc.line }:${ loc.col }`
      : `${ filename }:${ loc.line }`;
  }

  return (loc.line === loc.endLine)
    ? `${ filename }:${ loc.line }:${ loc.col }-${ loc.endCol }`
    : `${ filename }:${ loc.line }.${ loc.col }-${ loc.endLine }.${ loc.endCol }`;
}

/**
 * Return the source location of the complete dictionary `dict`.  If
 * `extraLocation` is truthy, also consider this location.
 * ASSUMPTION: all entries in the dictionary have a property `location` and
 * `location.file` has always the same value.
 *
 * TODO: remove this function - if we really want to have dictionary locations,
 * set them in the CDL parser, e.g. via a symbol.
 *
 * @param {object} dict
 * @param {CSN.Location} [extraLocation]
 * @returns {CSN.Location}
 */
function dictLocation( dict, extraLocation ) {
  if (!dict)
    return extraLocation;

  if (!Array.isArray(dict))
    dict = Object.getOwnPropertyNames( dict ).map( name => dict[name] );

  /** @type {CSN.Location[]} */
  const locations = [].concat( ...dict.map( _objLocations ) );
  if (extraLocation)
    locations.push( extraLocation );

  const min = locations.reduce( (a, b) => (a.line < b.line || (a.line === b.line && a.col < b.col) ? a : b) );
  const max = locations.reduce( (a, b) => {
    const lineA = (a.endLine || a.line);
    const lineB = (b.endLine || b.line);
    return (lineA > lineB || (lineA === lineB && (a.endCol || a.col) > (b.endCol || b.col)) ? a : b);
  });
  return new Location( min.file, min.line, min.col, max.endLine, max.endCol );
}

function _objLocations( obj ) {
  return Array.isArray(obj) ? obj.map( o => o.location ) : [ obj.location ];
}

module.exports = {
  Location,
  SemanticLocation,
  combinedLocation,
  emptyLocation,
  emptyWeakLocation,
  weakLocation,
  weakRefLocation,
  weakEndLocation,
  builtinLocation,
  dictLocation,
  locationString,
};
