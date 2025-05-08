#!/usr/bin/env node

/* eslint @stylistic/js/max-len: 0, no-console: 0 */

'use strict';

// Very simple command-line interface to support model migration
// from compiler v1 to v2.

const commands = {
  ria,
};
const compiler = require('../lib/compiler');
const { smartId } = require('../lib/render/toCdl');

const { argv } = process;
const cmd = commands[argv[2]];
const files = argv.slice(3);
const options = { messages: [] };

if (argv.length > 3 && cmd)
  compiler.compileX( files, '', options ).then( cmd, cmd );
else
  usage();

function usage( err ) {
  if (err)
    console.error( 'ERROR:', err );
  console.error( 'Usage: cdsv2m <cmd> <file>...' );
  console.error( '----------- supported commands <cmd>:' );
  console.error( '  ria:      produce Annotate statements getting the v1 behavior for msg redirected-implicitly-ambiguous' );
  process.exitCode = 2;
  return false;
}

function ria() {
  const annotates = Object.create( null );
  const msgs = options.messages.filter( m => m.messageId === 'redirected-implicitly-ambiguous' );
  // 'Choose via $(ANNO) one of $(SORTED_ARTS) as redirection target for $(TARGET) in … $(ART) otherwise'
  // NOTE: regex match on message text not for productive code!
  for (const msgObj of msgs) {
    // eslint-disable-next-line sonarjs/slow-regex
    const matches = msgObj.message.match( /["“][^"”]+["”]/ug );
    matches.slice( 1, -2 ).forEach( (name) => {
      annotates[name.slice( 1, -1 )] = true;
    } );
  }
  for (const name in annotates) {
    const escaped = name.split('.').map(part => smartId(part)).join('.');
    console.log(`annotate ${ escaped } with @cds.redirection.target: false;`);
  }
}
