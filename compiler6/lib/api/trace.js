
'use strict';

const shouldTraceApi = process?.env?.CDSC_TRACE_API;

/**
 * Placeholder for disabled tracing (no-op).
 *
 * @param {string} apiName API name
 * @param {object} options Options passed to the API.
 * @param {...any} [args] Arguments to be logged to stderr
 */
// eslint-disable-next-line no-unused-vars
function noOp( apiName, options, ...args ) {
  // no-op
}

/**
 * Print args to stderr if CDSC_TRACE_API is set
 *
 * @param {string} apiName API name
 * @param {object} options Options passed to the API.
 * @param {...any} [args] Arguments to be logged to stderr
 */
function traceApi( apiName, options, ...args ) {
  const optStr = typeof options === 'object' ? JSON.stringify(options, null, 2) : options;
  const argsStr = args.map(val => JSON.stringify(val)).join(', ');
  const rest = args.length > 0 ? ` | ${ argsStr }` : '';
  // Local require: Only load on-demand, not when tracing is disabled.
  const { version } = require('../../package.json');
  // eslint-disable-next-line no-console
  console.error( `CDSC_TRACE_API | ${ version } | ${ apiName }(…) | options: ${ optStr }${ rest }`);
}

module.exports = {
  traceApi: shouldTraceApi ? traceApi : noOp,
};
