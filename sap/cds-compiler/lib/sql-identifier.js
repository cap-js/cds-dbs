// API functions returning the SQL identifier token text for a name

// The CDS compiler has different SQL “naming modes” with the following intentions:
//
//  - the recommended 'plain': as often as possible, use a regular identifier
//    (i.e. without surrounding quotes) which looks the same (modulo prior `.`
//    to `_` replacements) as the name used in CDS.
//  - not provided (should have been the only alternative to 'plain'): construct
//    an identifier such that the effective name (the one in the DB schema) is
//    the same as the name used in CDS.
//  - 'quoted' and 'hdbcds' for HANA only: similar to the non-provided previous
//    mode, with different adaptations to HANA CDS and XS (classic) restrictions.

// The main objective of this file is to support the 'plain' mode in a “smart”
// manner.  If we would use the CDS name (after `.` to `_` replacements)
// directly as the identifier token text, the deployment would fail if names
// had been used in a model which were “reserved” on the target database.
//
// Using the provided function smartId() instead of an identity function avoids
// this situation: it constructs delimited identifiers for the reserved names.
// Other names are returned directly to avoid that people think that they
// had to use all-upper names in CDS.

// Please note that `.` to `_` replacements (and similar replacements for the
// naming mode 'hdbcds') had to be done before calling these functions.

// The main function can be used for:
// - table and view names,
// - query source aliases (“correlation names”),
// - column and association names, column aliases,
// - constraint names,
// - NOT: function names - use smartFuncId() instead,
// - NOT: parameter names,
// - NOT: data types (we render builtins only anyway).

'use strict';

const keywords = require( './base/keywords' );

const sqlDialects = {
  plain: {},
  h2: {
    // See http://www.h2database.com/html/grammar.html#name
    regularRegex: /^[A-Za-z_][A-Za-z_0-9]*$/,
    reservedWords: keywords.h2,
    effectiveName: name => name.toUpperCase(),
    asDelimitedId: name => `"${ name.replace(/"/g, '""') }"`,
  },
  sqlite: {
    regularRegex: /^[A-Za-z_][A-Za-z_$0-9]*$/,
    reservedWords: keywords.sqlite,
    effectiveName: name => name,
    asDelimitedId: name => `"${ name.replace(/"/g, '""') }"`,
  },
  postgres: {
    regularRegex: /^[A-Za-z_][A-Za-z_$0-9]*$/,
    reservedWords: keywords.postgres,
    effectiveName: name => name.toLowerCase(),
    asDelimitedId: name => `"${ name.replace(/"/g, '""') }"`,
  },
  hana: {
    regularRegex: /^[A-Za-z_][A-Za-z_$#0-9]*$/,
    reservedWords: keywords.hana,
    effectiveName: name => name.toUpperCase(),
    asDelimitedId: name => `"${ name.replace(/"/g, '""') }"`,
  },
  hdbcds: {
    regularRegex: /^[A-Za-z_][A-Za-z_0-9]*$/,
    reservedWords: keywords.hdbcds,
    effectiveName: name => name,
    asDelimitedId: name => `"${ name.replace(/"/g, '""') }"`,
  },
};

function smartId( name, dialect ) {
  const s = (typeof dialect === 'string')
    ? sqlDialects[dialect]
    : dialect;
  if (s.regularRegex && !s.regularRegex.test( name ) ||
      s.reservedWords && s.reservedWords.includes( name.toUpperCase() ))
    return s.asDelimitedId( s.effectiveName( name ) );
  return name;
}

function smartFuncId( name, dialect ) {
  const s = (typeof dialect === 'string')
    ? sqlDialects[dialect]
    : dialect;
  if (s.regularRegex && !s.regularRegex.test( name ))
    return s.asDelimitedId( s.effectiveName( name ) );
  return name;
}

function delimitedId( name, dialect ) {
  const s = (typeof dialect === 'string')
    ? sqlDialects[dialect]
    : dialect;
  return s.asDelimitedId( name );
}

module.exports = { smartId, smartFuncId, delimitedId };
