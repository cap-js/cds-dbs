#!/usr/bin/env node

// Update CDS Delimited Identifiers
//
// This script replaces the old delimited identifier style with the new one
// that is mandatory in cds-compiler v2.
//
// Example CDS:
//    entity "My Entity" { ... }
// will become:
//    entity ![My Entity] { ... }
//
// Usage:
//   ./cds_update_identifiers.js my_file.cds
//
// If you want to update all identifiers in a directory, you can use
// this Shell script:
//   find . -type f -iname '*.cds' -exec ./cds_update_identifiers.js {} \;
//
// Note that you need to update the path to this script in the commands above.
//

/* eslint no-process-exit: 0, no-console: 0 */

'use strict';

const parsers = require('../lib/parsers');
const { createMessageFunctions } = require('../lib/base/messages');

const fs = require('fs');
const path = require('path');

const cliArgs = process.argv.slice(2);
const filepath = cliArgs[0];

if (filepath === '--help' || filepath === '-h')
  exitError();

if (cliArgs.length !== 1)
  exitError(`Expected exactly one argument, ${ cliArgs.length } given`);

if (!filepath)
  exitError('Expected non-empty filepath as argument!');

// Do not use allow-list approach.
// There may be CDS files with other extensions than `.cds`.
if (filepath.endsWith('.csn') || filepath.endsWith('.json'))
  exitError('Only CDS files can be passed! Found CSN file!');

let sourceStr = fs.readFileSync(filepath, 'utf-8');
sourceStr = modernizeIdentifierStyle(sourceStr, filepath);
fs.writeFileSync(filepath, sourceStr);
process.exit(0); // success

// --------------------------------------------------------

function modernizeIdentifierStyle( source, filename ) {
  // TODO: Switch to new parser
  const options = { messages: [], attachTokens: true };
  const messageFunctions = createMessageFunctions( options, 'parse', null );

  // parseCdl does not throw on CompilationError, so
  // we do not need a try...catch block.
  const ast = parsers.parseCdl(source, filename, options, messageFunctions);

  // To avoid spam, only report errors.
  // Users should use the compiler to get all messages.
  const errors = options.messages
    .filter(msg => (msg.severity === 'Error' && msg.messageId !== 'syntax-deprecated-ident'));
  if (errors.length > 0) {
    errors.forEach((msg) => {
      console.error(msg.toString());
    });
    console.error(`Found ${ errors.length } errors! \n`);
    exitError('The CDS parser emitted errors. Fix them first and try again.');
  }

  let currentOffset = 0;

  const { tokens } = ast.tokenStream;
  for (const token of tokens) {
    if (token.type === 'Id' && !token.keyword && token.text.startsWith('"'))
      updateIdent(token);
  }

  return source;

  // -----------------------------------------------

  function updateIdent( identToken ) {
    const newIdentText = toNewIdentStyle(identToken.text);

    const start = identToken.start + currentOffset;
    // 'end' points at the position *before* the character
    const end = identToken.start + identToken.text.length + currentOffset;

    source = replaceSliceInSource(source, start, end, newIdentText);

    currentOffset += (newIdentText.length - identToken.text.length);
  }

  function toNewIdentStyle( oldIdentText ) {
    let ident = oldIdentText.slice(1, oldIdentText.length - 1);

    // There are only two replacement rules we need to check for:
    ident = ident.replace(/""/g, '"');
    ident = ident.replace(/]/g, ']]');

    return `![${ ident }]`;
  }
}

/**
 * Replaces a given span with @p replaceWith
 *
 * @param {string} source
 * @param {number} startIndex
 * @param {number} endIndex
 * @param {string} replaceWith
 * @return {string}
 */
function replaceSliceInSource( source, startIndex, endIndex, replaceWith ) {
  return source.substring(0, startIndex) +
          replaceWith +
          source.substring(endIndex);
}

/**
 * @param {string} [msg]
 */
function exitError( msg ) {
  if (msg)
    console.error(msg);
  usage();
  process.exit(1);
}

function usage() {
  console.error('');
  console.error(`usage: ${ path.basename(process.argv[1]) } <filename>`);
}
