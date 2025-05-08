'use strict';

// Metadata, e.g. version.

/** The compiler version (taken from package.json) */
function version() {
  return require('../../package.json').version;
}

module.exports = { version };
