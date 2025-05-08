'use strict';

// csn version functions

// The CSN file format version produced by this compiler
// (Note that all 0.x.x versions are floating targets, i.e. the format is frequently
// changed without notice. The versions only signal certain combinations of "flavors", see below)
// (Note: the SQL name mapping mode is not reflected in the content of the csn, the version only
// signals which default name mapping a backend has to use)
// Historic versions:
//  0.0.1  : Used by SAP HANA CDS for its CSN output
//           (incomplete, not well defined, quite different from CDX ...)
//  0.0.2  : CDX in the initial versions with old-style CSN, default for SQL
//           name mapping is 'quoted'
//  0.0.99 : Like 0.0.2, but with new-style CSN
// Versions that are currently produced by compiler:
//  0.1.0  : Like 0.0.2, default for SQL name mapping is 'plain'
//  0.1.99 : Like 0.1.0, but with new-style CSN
//  0.2 : same as 0.1.99, but with new top-level properties: $version, meta

// Use literal version constants intentionally and not number intervals to
// record all published version strings of the core compiler.
const newCSNVersions = [ '0.1.99', '0.2', '0.2.0', '1.0', '2.0' ];

// Check if new-style CSN is requested, i.e. versions >= 0.1.99
function isNewCSN( csn, options ) {
  return !( options?.newCsn === false ||
        (csn.version && !newCSNVersions.includes(csn.version.csn)) ||
        (csn.$version && !newCSNVersions.includes(csn.$version)));
}

function checkCSNVersion( csn, options ) {
  if (!isNewCSN(csn, options)) {
    // the new transformer works only with new CSN

    const { makeMessageFunction } = require('../base/messages');
    const { error, throwWithAnyError } = makeMessageFunction(csn, options);

    const version = csn.version?.csn ? csn.version.csn : (csn.$version || 'unknown');
    const variant = options.newCsn !== undefined ? 'newCsn' : 'std';
    error('api-unsupported-csn-version', null,
          { '#': variant, version, code: options.newCsn }, {
            std: 'CSN version $(VERSION) not supported',
            newCsn: 'CSN version $(VERSION) not supported; options.newCsn: $(CODE)',
          });
    throwWithAnyError();
  }
}

module.exports = {
  isNewCSN,
  checkCSNVersion,
};
