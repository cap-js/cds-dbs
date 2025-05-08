// Main entry point for the CDS Compiler (API)
//
// Other NPM modules must not require any other files than this one.

// Proposed intra-module lib dependencies:
//  - lib/base/<file>.js: can be required by all others, requires no other
//    of this project, except a lib/base/<other-file>.js
//  - lib/util/<file>.js: TODO - clarify diff to lib/base/
//  - lib/<dir>/<file>.js: can be required by other files lib/<dir>/,
//    can require other files in lib/<dir>/ and lib/base/<file>.js,
//    and lib/<other-dir>/ (the index.js in <other-dir>).
//  - lib/main.js (this file): can be required by none in lib/ (only in
//    bin/ and test/), can require any other

'use strict';

const lazyload = require('./base/lazyload')( module );

const { traceApi } = require('./api/trace');

const snapi = lazyload('./api/main');
const csnUtils = lazyload('./model/csnUtils');
const model_api = lazyload('./model/api');
const messages = lazyload('./base/messages');
const sqlIdentifier = lazyload('./sql-identifier');
const keywords = lazyload( './base/keywords' );
const toCdl = lazyload('./render/toCdl');

const parsers = lazyload('./parsers');
const compiler = lazyload('./compiler');
const shared = lazyload('./compiler/shared');
const define = lazyload('./compiler/define');
const builtins = lazyload('./base/builtins');
const base = lazyload('./compiler/base');
const finalizeParseCdl = lazyload('./compiler/finalize-parse-cdl');
const lsp = lazyload('./compiler/lsp-api');
const meta = lazyload('./base/meta');


const toCsn = lazyload('./json/to-csn')

function parseCdl( cdlSource, filename, options = {} ) {
  options = Object.assign( {}, options, { parseCdl: true } );
  const sources = Object.create(null);
  /** @type {XSN.Model} */
  const model = { sources, options, $functions: {}, $volatileFunctions: {} };
  const messageFunctions = messages.createMessageFunctions( options, 'parse', model );
  model.$messageFunctions = messageFunctions;

  const xsn = parsers.parseCdl( cdlSource, filename, Object.assign( { parseOnly: true }, options ),
                                messageFunctions );
  sources[filename] = xsn;
  shared.fns( model );
  define( model );
  finalizeParseCdl( model );
  messageFunctions.throwWithError();
  return toCsn.compactModel( model );
}

function parseCql( cdlSource, filename = '<query>.cds', options = {} ) {
  const messageFunctions = messages.createMessageFunctions( options, 'parse' );
  const xsn = parsers.parseCdl( cdlSource, filename, Object.assign( { parseOnly: true }, options ),
                                messageFunctions, 'query' );
  messageFunctions.throwWithError();
  return toCsn.compactQuery( xsn );
}

function parseExpr( cdlSource, filename = '<expr>.cds', options = {} ) {
  const messageFunctions = messages.createMessageFunctions( options, 'parse' );
  const xsn = parsers.parseCdl( cdlSource, filename, Object.assign( { parseOnly: true }, options ),
                                messageFunctions, 'expr' );
  messageFunctions.throwWithError();
  return toCsn.compactExpr( xsn );
}

// FIXME: The implementation of those functions that delegate to 'backends' should probably move here
// ATTENTION: Keep in sync with main.d.ts!
module.exports = {
  // Compiler
  version: () => meta.version(),
  compile: (filenames, dir, options, fileCache) => { // main function
    traceApi( 'compile', options );
    return compiler.compileX(filenames, dir, options, fileCache).then(toCsn.compactModel);
  },
  compileSync: (filenames, dir, options, fileCache) => { // main function
    traceApi('compileSync', options);
    return toCsn.compactModel(compiler.compileSyncX(filenames, dir, options, fileCache));
  },
  compileSources: (sourcesDict, options) => { // main function
    traceApi('compileSources', options);
    return toCsn.compactModel(compiler.compileSourcesX(sourcesDict, options));
  },
  compactModel: csn => csn,     // for easy v2 migration
  get CompilationError() {
    Object.defineProperty(this, 'CompilationError', {
      value: messages.CompilationError,
      writable: false,
      configurable: false,
      enumerable: true
    });
    return messages.CompilationError;
  },
  sortMessages: (...args) => messages.sortMessages(...args),
  sortMessagesSeverityAware: (...args) => messages.sortMessagesSeverityAware(...args),
  deduplicateMessages: (...args) => messages.deduplicateMessages(...args),
  messageString: (...args) => messages.messageString(...args),
  messageStringMultiline: (err, config) => messages.messageStringMultiline(err, config),
  messageContext: (...args) => messages.messageContext(...args),
  explainMessage: (...args) => messages.explainMessage(...args),
  hasMessageExplanation: (...args) => messages.hasMessageExplanation(...args),
  get InvocationError() {
    Object.defineProperty(this, 'InvocationError', {
      value: compiler.InvocationError,
      writable: false,
      configurable: false,
      enumerable: false
    });
    return compiler.InvocationError;
  },
  hasErrors: (...args) => messages.hasErrors(...args),

  // additional API:
  parse: {
    cdl: (...args) => parseCdl(...args),
    cql: (...args) => parseCql(...args),
    expr: (...args) => parseExpr(...args)
  },
  // SNAPI
  for: {
    odata: (...args) => snapi.odata(...args),
    java: (...args) => snapi.java(...args),
    effective: (...args) => snapi.for_effective(...args),
    seal: (...args) => snapi.for_seal(...args),
  },
  to: {
    cdl: Object.assign((...args) => snapi.cdl(...args), {
      keywords: Object.freeze([ ...keywords.cdl ] ),
      functions: Object.freeze([ ...keywords.cdl_functions ] ),
      smartId: (...args) => toCdl.smartId(...args),
      smartFunctionId: (...args) => toCdl.smartFunctionId(...args),
      delimitedId: (...args) => toCdl.delimitedId(...args),
    }),
    sql: Object.assign((...args) => snapi.sql(...args), {
      migration: (...args) => snapi.sql.migration(...args),
      sqlite: {
        keywords: Object.freeze([ ...keywords.sqlite ] )
      },
      postgres: {
        keywords: Object.freeze([ ...keywords.postgres ] )
      },
      h2: {
        keywords: Object.freeze([ ...keywords.h2 ] )
      },
      smartId: (...args) => sqlIdentifier.smartId(...args),
      smartFunctionId: (...args) => sqlIdentifier.smartFuncId(...args),
      delimitedId: (...args) => sqlIdentifier.delimitedId(...args),
    }),
    hdi: Object.assign((...args) => snapi.hdi(...args), {
      migration: (...args) => snapi.hdi.migration(...args),
      keywords: Object.freeze([ ...keywords.hana ] ),
    }),
    hdbcds: Object.assign((...args) => snapi.hdbcds(...args), {
      keywords: Object.freeze([ ...keywords.hdbcds ] ),
    }),
    edm: Object.assign((...args) => snapi.edm(...args), {
      all: (...args) => snapi.edm.all(...args)
    }),
    edmx: Object.assign((...args) => snapi.edmx(...args), {
      all: (...args) => snapi.edmx.all(...args)
    }),
    odata: Object.assign((...args) => snapi.odata2(...args), {
      all: (...args) => snapi.odata2.all(...args)
    }),
  },
  // Convenience for hdbtabledata calculation in @sap/cds
  getArtifactCdsPersistenceName: (...args) => csnUtils.getArtifactDatabaseNameOf(...args),
  getElementCdsPersistenceName: (...args) => csnUtils.getElementDatabaseNameOf(...args),

  // Other API functions:
  traverseCsn: (...args) => model_api.traverseCsn(...args),

  // INTERNAL functions for the cds-lsp package and friends - before you use
  // it, you MUST talk with us - there can be potential incompatibilities with
  // new releases (even having the same major version):
  $lsp: {
    parse: (...args) => compiler.parseX(...args),
    compile: (...args) => compiler.compileX(...args),
    getArtifactName: (art) => base.getArtifactName(art),
    traverseSemanticTokens: (xsn, options) => lsp.traverseSemanticTokens(xsn, options),
    getSemanticTokenOrigin: (obj) => lsp.getSemanticTokenOrigin(obj),
  },

  // CSN Model related functionality
  model: {
    isInReservedNamespace: (...args) => builtins.isInReservedNamespace(...args),
  },
};
