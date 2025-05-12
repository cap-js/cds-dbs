// Functions for dictionaries (Objects without prototype)
//
// Warning: this is Core-compiler only stuff

'use strict';

// New-style duplicate representation - use the style below for artifacts and
// _combined only
function dictAdd( dict, name, entry, duplicateCallback ) {
  const found = dict[name];
  if (!found) {
    dict[name] = entry;
    return entry;
  }
  if (!found.$duplicates) {     // not already with duplicates
    found.$duplicates = [];
    // Redefinitions from second source -> also complain in first source
    if (duplicateCallback && name) // do not complain with empty name ''
      duplicateCallback( name, found.name.location, found );
  }
  found.$duplicates.push( entry );
  if (Array.isArray( entry.$duplicates ))
    found.$duplicates.push( ...entry.$duplicates );
  else if (duplicateCallback && name) // do not complain with empty name ''
    duplicateCallback( name, entry.name.location, entry );
  entry.$duplicates = true;
  return found;
}

function dictForEach( dict, callback ) {
  // TODO: probably define an extra dictForEachArray()
  for (const name in dict) {
    const entry = dict[name];
    if (Array.isArray( entry )) {
      entry.forEach( callback );
    }
    else {
      callback( entry );
      if (Array.isArray( entry.$duplicates ))
        entry.$duplicates.forEach( callback );
    }
  }
}

// Add entry `entry` with key `name` to the dictionary `dict`.  If an entry
// (called `found`) with the same name is already defined, call
// `messageCallback` with arguments `name` and `loc` assigned to
// `entry.name.location`.  If this is the first duplicate entry and if the
// `filename`s are different, call the callback again on `found.name.location`.
function dictAddArray( dict, name, entry, messageCallback ) {
  const found = dict[name];
  if (!found || found.builtin) { // do not replace a builtin definition
    dict[name] = entry;         // also ok if array (redefined)
    return entry;
  }
  if (Array.isArray( entry )) {
    if (Array.isArray( found )) {
      dict[name] = [ ...found, ...entry ];
    }
    else {
      dict[name] = [ found, ...entry ];
      // Redefinitions from second source -> also complain in first source
      if (messageCallback && name)
        messageCallback( name, found.name.location, found );
    }
  }
  else {
    if (Array.isArray( found )) {
      dict[name] = [ ...found, entry ];
    }
    else {
      dict[name] = [ found, entry ];
      // Definitions from second source -> also complain for definition in first source
      // TODO: with packages, we could also use the package hierarchy
      if (messageCallback && name)
        messageCallback( name, found.name.location, found );
    }
    if (messageCallback && name)
      messageCallback( name, entry.name.location, entry );
  }
  return entry;
}

function dictFirst( dict ) {
  if (!dict)
    return dict;
  for (const name in dict)
    return dict[name];
  return undefined;
}

// Push `entry` to the array value with key `name` in the dictionary `dict`.
function pushToDict( dict, name, ...entries ) {
  if (dict[name])
    dict[name].push( ...entries );
  else if (name.charAt(0) !== '_')
    dict[name] = entries;
  else
    Object.defineProperty( dict, name, { value: entries, configurable: true, writable: true } );
}

module.exports = {
  dictAdd,
  dictForEach,
  dictAddArray,
  dictFirst,
  pushToDict,
};
