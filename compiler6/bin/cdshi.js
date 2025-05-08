#!/usr/bin/env node

// Very simple command-line interface for syntax highlighting CDS sources.  The
// interesting part is the correct classification of identifiers versus
// keywords, especially non-reserved ones.  Identifiers might even be
// classified further, especially where the identifier defines a new name.
//
// The output could be used directly by some editors, e.g. Emacs.

/* eslint no-console:off */

'use strict';

const compiler = require('../lib/compiler');
const fs = require('fs');
const stdinFd = 0;
fs.readFile( stdinFd, 'utf8', highlight );

const categoryChars = {         // default: first char of category name
  // first char lowercase = reference other than via extend/annotate:
  artref: 'm',
  uncheckedRef: 'r',
  uncheckedAnno: 'a',
  paramname: 'b',
  typeparamname: 'b',
  // first char uppercase = definition, extend/annotate ref, or path after `namespace`:
  Entity: 'D',
  Enum: 'H',
  Index: 'J',
  AnnoDef: 'V',
  Ext: 'Z',                 // extend/annotate on main def other than service/context
  ExtService: 'S',          // highlight like service definition
  ExtContext: 'C',          // highlight like context definition
  // ExtElement: 'E',       // using the first letter is the default
  ExtBoundAction: 'B',      // highlight like bound action definition
  ExtParam: 'P',            // highlight like entity/action parameter definition
  FromImplicit: 'W',
  Event: 'Y',
  KeyImplicit: 'r',         // handle as normal ref
  // Remark: do not use `x`/`X` (hex literal `x'1e3d'`)
};

const options = { attachTokens: true, messages: [] };

function highlight( err, buf ) {
  if (err) {
    console.error( 'ERROR:', err.toString() );
    return;
  }
  const { tokenStream } = compiler.parseX( buf, 'hi.cds', options );
  const { tokens, lexer } = tokenStream;
  if (!buf.length || !tokens || !tokens.length)
    return;

  const chars = [ ...buf ];
  for (const tok of tokens) {
    if (tok.type === 'Comment') // but interpret DocComment!
      continue;
    const { location, start } = tok;
    if (start < 0)
      continue;
    const stop = lexer.characterPos( location.endLine, location.endCol ) - 1;
    const cat = tok.parsedAs;
    if (!cat) {
      if (stop > start) {
        chars[start] = (cat !== 0 ? '\x0f' : '\x16'); // ^O / ^V (ERROR)
        chars[stop] = '\x17';                         // ^W
      }
      else {
        chars[start] = (cat !== 0 ? '\x0e' : '\x15'); // ^N / ^U (ERROR)
      }
    }
    else if (cat !== 'keyword' && cat !== 'token') {
      if (cat !== 'ref' || chars[start] !== '$')
        chars[start] = categoryChars[cat] || cat.charAt(0);
      if (stop > start)
        chars[start + 1] = '_';
    }
  }
  for (const c of chars)
    process.stdout.write( c );
}
