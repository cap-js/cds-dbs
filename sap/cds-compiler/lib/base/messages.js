// Functions and classes for syntax messages

// See internalDoc/ReportingMessages.md and lib/base/message-registry.js for details.

'use strict';

const { term } = require('../utils/term');
const { Location, locationString } = require('./location');
const { isDeprecatedEnabled, isBetaEnabled } = require('./model');
const { centralMessages, centralMessageTexts, oldMessageIds } = require('./message-registry');
const _messageIdsWithExplanation = require('../../share/messages/message-explanations.json').messages;
const { analyseCsnPath, traverseQuery } = require('../model/csnRefs');
const { CompilerAssertion } = require('./error');
const { getArtifactName } = require('../compiler/base');
const { cdlNewLineRegEx } = require('../language/textUtils');
const meta = require('./meta');

const fs = require('fs');
const path = require('path');
const { inspect } = require('util');

// term instance for messages
const colorTerm = term();

// Functions ensuring message consistency during runtime with --test-mode

let test$severities = null;
let test$texts = null;

/**
 * Returns true if at least one of the given messages is of severity "Error".
 *
 * @param {CompileMessage[]} messages
 * @returns {boolean}
 */
function hasErrors( messages ) {
  return messages && messages.some( m => m.severity === 'Error' );
}

/**
 * Returns true if at least one of the given messages is of severity "Error"
 * and *cannot* be reclassified to a warning for the given module.
 * Won't detect already downgraded messages.
 *
 * @param {CompileMessage[]} messages
 * @param {string} moduleName
 * @param {CSN.Options} options
 * @returns {boolean}
 */
function hasNonDowngradableErrors( messages, moduleName, options ) {
  return messages &&
    messages.some( m => m.severity === 'Error' && !isDowngradable( m.messageId, moduleName, options ));
}

/**
 * Returns true if the given message id exist in the central message register and is
 * downgradable, i.e. an error can be reclassified to a warning or lower.
 * Returns false if the messages is an errorFor the given moduleName.
 *
 * @param {string} messageId
 * @param {string} moduleName
 * @param {CSN.Options} options Options used to check for test mode and beta flags.
 * @returns {boolean}
 */
function isDowngradable( messageId, moduleName, options ) {
  if (!messageId || !centralMessages[messageId])
    return false;

  const msg = centralMessages[messageId];

  // errorFor has the highest priority.  If the message is an error for
  // the module, it is NEVER downgradable.
  if (msg.errorFor && msg.errorFor.includes(moduleName))
    return false;
  if (msg.severity !== 'Error')
    return true;
  // v7 messages are downgradable (except if errorFor also contains the current module).
  if (msg.errorFor && msg.errorFor.includes('v7'))
    return true;
  const { configurableFor } = msg;
  return (Array.isArray( configurableFor ))
    ? configurableFor.includes( moduleName )
    : configurableFor && (configurableFor !== 'deprecated' || isDeprecatedEnabled( options, 'downgradableErrors' ));
}

/**
 * Returns a marker for messages strings indicating whether the message can be downgraded
 * or whether it will be an error in the next cds-compiler release.
 *
 * @returns {string}
 */
function severityChangeMarker( msg, config ) {
  const severity = msg.severity || 'Error';
  if (config.moduleForMarker) {
    if (severity === 'Error' &&
        isDowngradable( msg.messageId, config.moduleForMarker,
                        { deprecated: { downgradableErrors: true } }))
      return '‹↓›';
    if (msg.messageId && centralMessages[msg.messageId]?.errorFor?.includes('v7'))
      return '‹↑›';
  }
  return '';
}

/**
 * Class for combined compiler errors.  Additional members:
 * - `messages`: array of compiler messages (CompileMessage)
 * - `model`: the CSN model
 */
class CompilationError extends Error {
  /**
   * @param {CompileMessage[]} messages
   * @param {XSN.Model} [model] the XSN model, only to be set with options.attachValidNames
   */
  constructor(messages, model) {
    // Because test frameworks such as mocha and jest to not call `toString()` on
    // an unhandled CompilationError and instead use `e.stack` directly, there is
    // no proper message about _what_ the root cause of the exception was.
    // To mitigate that, we serialize the first error in the message as well.
    const firstError = messages.find( m => m.severity === 'Error' )?.toString() || '';
    super( `CDS compilation failed (@sap/cds-compiler v${ meta.version() })\n${ firstError }` );

    /** @since v4.0.0 */
    this.code = 'ERR_CDS_COMPILATION_FAILURE';
    this.messages = [ ...messages ].sort(compareMessageSeverityAware);

    // property `model` is only set with options.attachValidNames:
    Object.defineProperty( this, 'model', { value: model || undefined, configurable: true } );
  }

  /**
   * Called by `console.*()` functions in NodeJs. To avoid `err.messages` being
   * printed using `util.inspect()`.
   *
   * @return {string}
   */
  [inspect.custom]() {
    return this.stack || this.message;
  }

  /**
   * Called when the exception is printed, e.g. when it is not caught.
   * To give users a bit of information what went wrong, return stringified
   * error messages.  But only errors to avoid spamming users.
   *
   * Compiler consumers should catch compilation errors and properly handle
   * them by printing messages themselves.
   *
   * @returns {string}
   */
  toString() {
    let messages = [ 'CDS compilation failed' ];
    if (this.messages) {
      messages = messages.concat(this.messages
        .filter(msg => msg.severity === 'Error')
        .map( m => m.toString()));
    }
    return messages.join('\n');
  }

  /**
   * @deprecated Use `.messages` instead.
   */
  get errors() {
    return this.messages;
  }
}

/**
 * Class for individual compile message.
 *
 * @class CompileMessage
 */
class CompileMessage {
  /**
   * Creates an instance of CompileMessage.
   * @param {CSN.Location} location Location of the message
   * @param {string} msg The message text
   * @param {MessageSeverity} [severity='Error'] Severity: Debug, Info, Warning, Error
   * @param {string} [id] The ID of the message - visible as property messageId
   * @param {any} [home]
   * @param {string} [moduleName] Name of the module that created this message
   *
   * @memberOf CompileMessage
   */
  constructor(location, msg, severity = 'Error', id = null, home = null, moduleName = null) {
    this.message = msg;
    this.$location = { __proto__: Location.prototype, ...location, address: undefined };
    this.validNames = null;
    this.home = home;  // semantic location, e.g. 'entity:"E"/element:"x"'
    this.severity = severity;
    Object.defineProperty( this, 'messageId', { value: id } );
    Object.defineProperty( this, '$module', { value: moduleName, configurable: true } );
    // Uncomment when running TypeScript linter
    // this.messageId = id;
    // this.$module = moduleName;
    // this.error = null;
  }

  toString() {
    // Used by cds-dk in their own `toString` wrapper.
    return messageString( this, {
      normalizeFilename: false,
      noMessageId: true, // no message-id before finalization!
      noHome: false,
      module: null,
    });
  }
}

const severitySpecs = {
  error: { name: 'Error', level: 0 },
  warning: { name: 'Warning', level: 1 },
  info: { name: 'Info', level: 2 },
  debug: { name: 'Debug', level: 3 },
};

/**
 * Get the reclassified severity of the given message using:
 *
 *  1. The specified severity: either centrally provided or via the input severity
 *     - when generally specified as 'Error', immediately return 'Error'
 *       if message is not specified as configurable (for the given module name)
 *     - when generally specified otherwise, immediately return 'Error'
 *       if message is specified as being an error for the given module name
 *  2. User severity wishes in option `severities`: when provided and no 'Error' has
 *     been returned according to 1, return the severity according to the user wishes.
 *  3. Otherwise, use the specified severity.
 *
 * @param {object} msg The CompileMessage.
 * @param {CSN.Options} options
 * @param {string} moduleName
 * @returns {MessageSeverity}
 */
function reclassifiedSeverity( msg, options, moduleName ) {
  const spec = centralMessages[msg.messageId] || { severity: msg.severity, configurableFor: null, errorFor: null };
  let { severity } = spec;

  if (spec.severity === 'Error') {
    if (!isDowngradable(msg.messageId, moduleName, options))
      return 'Error';
  }
  else {
    const { errorFor } = spec;
    if (Array.isArray( errorFor )) {
      if (errorFor.includes(moduleName))
        return 'Error';

      if (errorFor.includes('v7') && isBetaEnabled(options, 'v7preview')) {
        severity = 'Error';
        if (!isDowngradable(msg.messageId, moduleName, options))
          return severity;
      }
    }
  }

  if (!options.severities)
    return severity;

  let newSeverity = options.severities[msg.messageId];
  // The user could have specified a severity through an old message ID.
  if (!newSeverity && spec.oldNames) {
    const oldName = spec.oldNames.find((name => options.severities[name]));
    newSeverity = options.severities[oldName];
  }
  return normalizedSeverity( newSeverity ) || severity;
}

function normalizedSeverity( severity ) {
  if (typeof severity !== 'string')
    return (severity == null) ? null : 'Error';
  const s = severitySpecs[severity.toLowerCase()];
  return s ? s.name : 'Error';
}

/**
 * Compare two severities.  Returns 0 if they are the same, and <0 if
 * `a` has a lower `level` than `b` according to {@link severitySpecs},
 * where "lower" means: comes first when sorted.
 *
 *   compareSeverities('Error', 'Info')  =>  Error < Info  =>  -1
 *
 * @param {MessageSeverity} a
 * @param {MessageSeverity} b
 * @see severitySpecs
 */
function compareSeverities( a, b ) {
  // default: low priority
  const aSpec = severitySpecs[a.toLowerCase()] || { level: 10 };
  const bSpec = severitySpecs[b.toLowerCase()] || { level: 10 };
  return aSpec.level - bSpec.level;
}

/**
 * Find the nearest $location for the given CSN path in the model.
 * If the path does not exist, the parent is used, and so on.
 *
 * @param {CSN.Model} model
 * @param {CSN.Path} csnPath
 * @returns {CSN.Location | null}
 */
function findNearestLocationForPath( model, csnPath ) {
  if (!model)
    return null;
  let lastLocation = null;
  /** @type {object} */
  let currentStep = model;
  for (const step of csnPath) {
    if (!currentStep)
      return lastLocation;
    currentStep = currentStep[step];
    if (currentStep && currentStep.$location)
      lastLocation = currentStep.$location;
  }

  return lastLocation;
}

/**
 * Create the `message` functions to emit messages.
 *
 * @example
 * ```js
 *   const { createMessageFunctions } = require(‘../base/messages’);
 *   function module( …, options ) {
 *     const { message, info, throwWithError } = createMessageFunctions( options, moduleName );
 *     // [...]
 *     message( 'message-id', <location>, <text-arguments>, <severity>, <text> );
 *     info( 'message-id', <location>, [<text-arguments>,] <text> );
 *     // [...]
 *     throwWithError();
 *   }
 * ```
 * @param {CSN.Options} [options]
 * @param {string} [moduleName]
 * @param {object} [model=null] the CSN or XSN model, used for convenience
 */
function createMessageFunctions( options, moduleName, model = null ) {
  return makeMessageFunction( model, options, moduleName );
}

/**
 * Create the `message` function to emit messages.
 *
 * @example
 * ```js
 *   const { makeMessageFunction } = require(‘../base/messages’);
 *   function module( …, options ) {
 *     const { message, info, throwWithError } = makeMessageFunction( model, options, moduleName );
 *     // [...]
 *     message( 'message-id', <location>, <text-arguments>, <severity>, <text> );
 *     info( 'message-id', <location>, [<text-arguments>,] <text> );
 *     // [...]
 *     throwWithError();
 *   }
 * ```
 * @param {object} model
 * @param {CSN.Options} [options]
 * @param {string|null} [_moduleName]
 */
function makeMessageFunction( model, options, _moduleName = null ) {
  let moduleName = _moduleName;

  if (options.testMode) {
    // ensure message consistency during runtime with --test-mode
    _check$Init( options );
    if (!options.messages)
      throw new CompilerAssertion('makeMessageFunction() expects options.messages to exist in testMode!');
  }

  const hasMessageArray = Array.isArray(options.messages);
  /**
   * Array of collected compiler messages. Only use it for debugging. Will not
   * contain the messages created during a `callTransparently` call.
   *
   * @type {CompileMessage[]}
   */
  let messages = hasMessageArray ? options.messages : [];
  /**
   * Whether an error was emitted in the module. Also includes reclassified errors.
   * @type {boolean}
   */
  let hasNewError = false;

  reclassifyMessagesForModule();

  return {
    message,
    error,
    warning,
    info,
    debug,
    messages,
    throwWithError,
    throwWithAnyError,
    callTransparently,
    moduleName,
    setModel,
    setModuleName,
    setOptions,
  };

  function _message( id, location, textOrArguments, severity, texts = null ) {
    _validateFunctionArguments(id, location, textOrArguments, severity, texts);

    // Special case for _info, etc.: textOrArguments may be a string.
    if (typeof textOrArguments === 'string') {
      texts = { std: textOrArguments };
      textOrArguments = {};
    }

    const [ fileLocation, semanticLocation, definition ] = _normalizeMessageLocation(location);
    const text = messageText( texts || centralMessageTexts[id], textOrArguments );

    /** @type {CompileMessage} */
    const msg = new CompileMessage( fileLocation, text, severity, id, semanticLocation, moduleName );
    if (options.internalMsg)
      msg.error = new Error( 'stack' );
    if (definition)
      msg.$location.address = { definition }; // TODO: remove

    if (id) {
      if (options.testMode && !options.$recompile)
        _check$Consistency( id, moduleName, severity, texts, options );
      msg.severity = reclassifiedSeverity( msg, options, moduleName );
    }

    messages.push( msg );
    hasNewError = hasNewError || msg.severity === 'Error' &&
      !(options.testMode && isDowngradable( msg.messageId, moduleName, options ));
    if (!hasMessageArray)
      console.error( messageString( msg ) ); // eslint-disable-line no-console
    return msg;
  }

  /**
   * Validate the arguments for the message() function. This is needed during the transition
   * to the new makeMessageFunction().
   */
  function _validateFunctionArguments( id, location, textArguments, severity, texts ) {
    if (!options.testMode)
      return;

    if (id !== null && typeof id !== 'string')
      _expectedType('id', id, 'string');

    if (location !== null && location !== undefined && !Array.isArray(location) && typeof location !== 'object')
      _expectedType('location', location, 'XSN/CSN location, CSN path');

    if (severity != null && typeof severity !== 'string')
      _expectedType('severity', severity, 'string');

    const isShortSignature = (typeof textArguments === 'string'); // textArguments => texts

    if (isShortSignature) {
      if (texts)
        throw new CompilerAssertion('No "texts" argument expected because text was already provided as third argument.');
    }
    else {
      if (textArguments !== undefined && typeof textArguments !== 'object')
        _expectedType('textArguments', textArguments, 'object');
      if (texts !== undefined && typeof texts !== 'object' && typeof texts !== 'string')
        _expectedType('texts', texts, 'object or string');
    }

    function _expectedType( field, val, type ) {
      throw new CompilerAssertion(`Invalid argument type for ${ field }! Expected ${ type } but got ${ typeof val }. Do you use the old function signature?`);
    }
  }

  /**
   * Normalize the given location. Location may be a CSN path, XSN/CSN location or an
   * array of the form `[CSN.Location, XSN user, suffix]`.
   * TODO: normalize to [ Location, SemanticLocation ]
   *
   * @param {any} location
   * @returns {[CSN.Location, string, string]} Location, semantic location and definition.
   */
  function _normalizeMessageLocation( location ) {
    if (!location)
      // e.g. for general messages unrelated to code
      return [ null, null, null ];

    if (typeof location === 'object' && !Array.isArray(location))
      // CSN.Location (with line/endLine, col/endCol)
      return [ location, location.home || null, null ];

    const isCsnPath = (typeof location[0] === 'string'); // could be `definitions`, `extensions`, ....
    if (isCsnPath) {
      return [
        findNearestLocationForPath( model, location ),
        constructSemanticLocationFromCsnPath( model, options, location ),
        location[1], // location[0] is 'definitions'
      ];
    }

    if (location[1]?.mainKind)
      return [ location[0], location[1].toString(), null ];

    let semanticLocation = location[1] ? homeName( location[1], false ) : null;
    if (location[2]) { // optional suffix, e.g. annotation
      semanticLocation += `/${ (typeof location[2] === 'string') ? location[2] : homeName(location[2]) }`;
    }

    const definition = location[1] ? homeName( location[1], true ) : null;

    // If no XSN location is given, check if we can use the one of the artifact
    let fileLocation = location[0];
    if (!fileLocation && location[1])
      fileLocation = location[1].location || location[1].$location || null;

    return [ fileLocation, semanticLocation, definition ];
  }

  /**
   * Create a compiler message for model developers.
   *
   * @param {string} id Message ID
   * @param {[CSN.Location, XSN.Artifact]|CSN.Path|CSN.Location|CSN.Location} location
   *            Either a (XSN/CSN-style) location, a tuple of file location
   *            and "user" (address) or a CSN path a.k.a semantic location path.
   * @param {object} [textArguments] Text parameters that are replaced in the texts.
   * @param {string|object} [texts]
   */
  function message( id, location, textArguments = null, texts = null ) {
    if (!id)
      throw new CompilerAssertion('A message id is missing!');
    if (!centralMessages[id])
      throw new CompilerAssertion(`Message id '${ id }' is missing an entry in the central message register!`);
    return _message(id, location, textArguments, null, texts);
  }

  /**
   * Create a compiler error message.
   * @see message()
   */
  function error( id, location, textOrArguments = null, texts = null ) {
    return _message(id, location, textOrArguments, 'Error', texts);
  }

  /**
   * Create a compiler warning message.
   * @see message()
   */
  function warning( id, location, textOrArguments = null, texts = null ) {
    return _message(id, location, textOrArguments, 'Warning', texts);
  }

  /**
   * Create a compiler info message.
   * @see message()
   */
  function info( id, location, textOrArguments = null, texts = null ) {
    return _message(id, location, textOrArguments, 'Info', texts);
  }

  /**
   * Create a compiler debug message (usually not shown).
   * @see message()
   */
  function debug( id, location, textOrArguments = null, texts = null ) {
    return _message(id, location, textOrArguments, 'Debug', texts);
  }

  function throwWithError() {
    if (hasNewError)
      throw new CompilationError(messages, options.attachValidNames && model);
  }

  /**
   * Throws a CompilationError exception if there is at least one error message
   * in the model's messages after reclassifying existing messages according to
   * the module name.
   * If `--test-mode` is enabled, this function will only throw if the
   * error *cannot* be downgraded to a warning.  This is done to ensure that
   * developers do not rely on certain errors leading to an exception.
   */
  function throwWithAnyError() {
    if (!messages || !messages.length)
      return;
    const hasError = options.testMode ? hasNonDowngradableErrors : hasErrors;
    if (hasError( messages, moduleName, options ))
      throw new CompilationError(messages, options.attachValidNames && model);
  }

  /**
   * Reclassifies all messages according to the current module.
   * This is required because if throwWithError() throws and the message's
   * severities has `errorFor` set, then the message may still appear to be a warning.
   */
  function reclassifyMessagesForModule() {
    for (const msg of messages) {
      if (msg.messageId && msg.severity !== 'Error') {
        const severity = reclassifiedSeverity( msg, options, moduleName );
        if (severity !== msg.severity) {
          msg.severity = severity;
          // Re-set the module regardless of severity, since we reclassified it.
          Object.defineProperty( msg, '$module', { value: moduleName, configurable: true } );
          hasNewError = hasNewError || severity === 'Error' &&
            !(options.testMode && isDowngradable( msg.messageId, moduleName, options ));
        }
      }
    }
  }

  /**
   * Collects all messages during the call of the callback function instead of
   * storing them in the model. Returns the collected messages.
   * Not yet in use.
   *
   * @param {Function} callback
   * @param  {...any} args
   * @returns {CompileMessage[]}
   */
  function callTransparently( callback, ...args ) {
    const backup = messages;
    messages = [];
    callback(...args);
    const collected = messages;
    messages = backup;
    return collected;
  }

  /**
   * Change the model used to calculate CSN locations.
   * This is necessary if you change the model heavily and rely on $paths relative to the new model.
   *
   * @param {CSN.Model} _model
   */
  function setModel( _model ) {
    model = _model;
  }

  /**
   * Change the moduleName used for reclassifying messages.
   * Needed for to.sql.migration + script
   *
   * @param {string} __moduleName
   */
  function setModuleName( __moduleName ) {
    moduleName = __moduleName;
  }

  /**
   * Change the options used to determine message severities.
   * This is necessary if you change `options.severities`, as otherwise they may not be picked up.
   *
   * @param {CSN.Options} _options
   */
  function setOptions( _options ) {
    options = _options;
  }
}

/**
 * Perform message consistency check during runtime with --test-mode
 */

function _check$Init( options ) {
  if (!test$severities && !options.severities)
    test$severities = Object.create(null);
  if (!test$texts) {
    test$texts = Object.create(null);
    for (const [ id, texts ] of Object.entries( centralMessageTexts ))
      test$texts[id] = (typeof texts === 'string') ? { std: texts } : { ...texts };
  }
}

/**
 * Check the consistency of the given message and run some basic lint checks.  These include:
 *
 *  - Long message IDs must be listed centrally.
 *  - Messages with the same ID must have the same severity (in a module).
 *  - Messages with the same ID must have the same message texts.
 *    This ensures that $(PLACEHOLDERS) are used and that we don't accidentally
 *    use the same ID for different meanings, i.e. texts.
 *
 * @param {string} id
 * @param {string} moduleName
 * @param {string} severity
 * @param {string|object} texts
 * @param {CSN.Options} options
 * @private
 */
function _check$Consistency( id, moduleName, severity, texts, options ) {
  // TODO: replace by linter?
  if (id.length > 32 && !centralMessages[id])
    throw new CompilerAssertion( `The message ID "${ id }" has more than 30 chars and must be listed centrally` );
  if (!options.severities)
    _check$Severities( id, moduleName || '?', severity );
  for (const [ variant, text ] of
    Object.entries( (typeof texts === 'string') ? { std: texts } : texts || {} ))
    _check$Texts( id, variant, text );
}

/**
 * Check the consistency of the message severity for the given message ID.
 * Messages with the same ID must have the same severity (in a module).
 * Non-downgradable errors must never be called with a lower severity.
 *
 * @param {string} id
 * @param {string} moduleName
 * @param {string} severity
 * @private
 */
function _check$Severities( id, moduleName, severity ) {
  if (!severity)                // if just used message(), we are automatically consistent
    return;
  const spec = centralMessages[id];
  if (!spec) {
    const expected = test$severities[id];
    if (!expected)
      test$severities[id] = severity;
    else if (expected !== severity)
      throw new CompilerAssertion( `Inconsistent severity: Expecting "${ expected }" from previous call, not "${ severity }" for message ID "${ id }"` );
    return;
  }
  // now try whether the message could be something less than an Error in the module due to user wishes
  if (!isDowngradable(id, moduleName, { testMode: true, deprecated: { downgradableErrors: true } } )) { // always an error in module
    if (severity !== 'Error')
      throw new CompilerAssertion( `Inconsistent severity: Expecting "Error", not "${ severity }" for message ID "${ id }" in module "${ moduleName }"` );
  }
  else if (spec.severity === 'Error') {
    throw new CompilerAssertion( `Inconsistent severity: Expecting the use of function message() when message ID "${ id }" is a configurable error in module "${ moduleName }"` );
  }
  else if (spec.severity !== severity) {
    throw new CompilerAssertion( `Inconsistent severity: Expecting "${ spec.severity }", not "${ severity }" for message ID "${ id }" in module "${ moduleName }"` );
  }
}

/**
 * Check the consistency of the message text for the given message ID.
 *
 * Messages with the same ID must have the same message texts.
 * This ensures that $(PLACEHOLDERS) are used and that we don't accidentally
 * use the same ID for different meanings, i.e. texts.
 *
 * @param {string} id
 * @param {string} prop
 * @param {string} val
 * @private
 */
function _check$Texts( id, prop, val ) {
  if (!test$texts[id])
    test$texts[id] = Object.create(null);
  const expected = test$texts[id][prop];
  if (!expected)
    test$texts[id][prop] = val;
  else if (expected !== val)
    throw new CompilerAssertion( `Different texts for the same message ID. Expecting “${ expected }”, not “${ val }” for ID “${ id }” and text variant “${ prop }”`);
}

const quote = {            // could be an option in the future
  double: p => `“${ p }”`, // for names, including annotation names (with preceding `@`)
  single: p => `‘${ p }’`, // for other things cited from or expected in the model
  angle: p => `‹${ p }›`, // for tokens like ‹Identifier›, and similar
  direct: p => p,          // e.g. for numbers _not cited from or expected in_ the source
  upper: p => p.toUpperCase(), // for keywords reported by ANTLR, use prop.single in v4
};

const paramsTransform = {
  // simple convenience:
  name: quote.double,
  id: quote.double,
  alias: quote.double,
  anno,
  annos: transformManyWith( anno ),
  delimited: n => quote.single( asDelimitedId(n) ),
  file: quote.single,
  option: quote.single,
  prop: quote.single,
  siblingprop: quote.single,
  parentprop: quote.single,
  subprop: quote.single,
  otherprop: quote.single,
  code: quote.single,
  enum: sym => quote.single( `#${ sym }`),
  newcode: quote.single,
  kind: quote.single,
  meta: quote.angle,
  othermeta: quote.angle,
  keyword,
  module: quote.single,
  // more complex convenience:
  names: transformManyWith( quoted ),
  number: quote.single,         // number cited from source or expected in source
  location: ({ line, col }) => `${ line }:${ col }`,
  count: quote.direct,
  line: quote.direct,
  col: quote.direct,
  literal: quote.direct,
  n: quote.direct,
  m: quote.direct,
  value,
  rawvalue: quote.single,
  rawvalues: transformManyWith( quote.single ),  // no 'double' quotes for strings
  othervalue: value,
  art: transformArg,
  service: transformArg,
  sorted_arts: transformManyWith( transformArg, true ),
  target: transformArg,
  source: transformArg,
  elemref: transformElementRef,
  type: transformArg,
  othertype: transformArg,
  offending: tokenSymbol,
  op: quote.single,
  expecting: transformManyWith( tokenSymbol ),
  // msg: m => m,
  $reviewed: ignoreTextTransform,
  version: quote.single, // TODO delete: just use for OData $(VERSION), with version: 2.0
};

function asDelimitedId( id ) {
  // Same as in toCdl, but we don't want cyclic dependencies to toCdl.
  return `![${ id.replace(/]/g, ']]') }]`;
}

function anno( name ) {
  return (name.charAt(0) === '@') ? quote.double( name ) : quote.double( `@${ name }` );
}

function value( val ) {
  switch (typeof val) {
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined': {
      return quote.single( val );
    }
    case 'string': {
      // TODO: should we also shorten the string if too long? TODO: false, true, null?
      return (!val ||
              Number.parseFloat( val ).toString() === val ||
              // with quotes (TODO: use `…` with escape chars):
              /'/.test( val ))  // sync ')
        ? quote.single( `'${ val.replace(/'/g, '\'\'') }'` )
        : quote.single( val );
    }
    case 'object': {
      return (val)
        ? quote.angle( Array.isArray( val ) ? 'array' : 'object' )
        : quote.single( val );
    }
    default:
      return quote.angle( typeof val );
  }
}

const keywordRepresentations = {
  association: 'Association',
  composition: 'Composition',
};
function keyword( val ) {
  const v = val.toLowerCase();
  return quote.single( keywordRepresentations[v] || v );
}

function ignoreTextTransform() {
  return null;
}

function transformManyWith( t, sorted ) {
  return function transformMany( many, r, args, texts ) {
    const prop = [ 'none', 'one', 'two' ][many.length];
    const names = many.map(t);
    if (sorted)
      names.sort();
    if (!prop || !texts[prop] || args['#'] )
      return names.join(', ');
    r['#'] = prop;              // text variant
    if (many.length === 2)
      r.second = names[1];
    return many.length && names[0];
  };
}

/**
 * Quote the given string.  Performs a type sanity check.
 *
 * @param {string} name
 * @return {string}
 */
function quoted( name ) {
  if (typeof name === 'string')
    return quote.double( name );
  throw new CompilerAssertion( `Expecting a string, not ${ typeof name } (${ JSON.stringify(name) })` );
}

function tokenSymbol( token ) {
  if (token.match( /^[A-Z][A-Z]/ )) // keyword
    return keyword( token );
  else if (token.match( /^[A-Z][a-z]/ )) // Number, Identifier, ...
    return quote.angle( token );
  if (token.startsWith('\'') && token.endsWith('\'')) // operator token symbol
    return quote.single( token.slice( 1, -1 ));
  else if (token === '<EOF>')
    return quote.angle( 'EOF' );
  return quote.single( token ); // should not happen
}

/**
 * Transform an element reference (/path), e.g. on-condition path.
 */
function transformElementRef( arg ) {
  const ref = arg.ref || arg.path;
  if (!ref)
    return quoted( arg );
  // Can be used by CSN backends or compiler to create a simple path such as E:elem
  return quoted(
    ((arg.scope === 'param' || arg.param) ? ':' : '') +
    ref.map(
      item => (typeof item !== 'string'
        ? `${ item.id }${ item.args ? '(…)' : '' }${ item.where ? '[…]' : '' }`
        : item)
    ).join('.')
  );
}

function transformArg( arg, r, args, texts ) {
  if (!arg || typeof arg !== 'object')
    return quoted( arg );
  if (arg._artifact)
    arg = arg._artifact;
  while (arg._outer) // nested 'items'
    arg = arg._outer;
  if (args['#'] || args.member )
    return shortArtName( arg );
  if (arg.ref) {
    // Can be used by CSN backends to create a simple path such as E:elem
    if (arg.ref.length > 1)
      return quoted(`${ pathId(arg.ref[0]) }:${ arg.ref.slice(1).map(pathId).join('.') }`);
    return quoted(pathId(arg.ref[0]));
  }
  if (!arg.name)
    return quoted( arg.name );
  const name = getArtifactName( arg );
  const prop = [ 'element', 'param', 'action', 'alias' ].find( p => name[p] );
  // if (!prop) throw Error()
  if (!prop || !texts[prop] )
    return shortArtName( arg );
  r['#'] = texts[name.$variant] && name.$variant || prop; // text variant (set by searchName)
  r.member = quoted( name[prop] );
  return artName( arg, prop );
}

function pathId( item ) {
  return (typeof item === 'string') ? item : item.id;
}

// TODO: very likely delete this function
function searchName( art, id, variant ) {
  if (!variant) {
    // used to mention the "effective" type in the message, not the
    // originally provided one (TODO: mention that in the message text)
    const type = art._effectiveType && art._effectiveType.kind !== 'undefined' ? art._effectiveType : art;
    if (type.elements) {        // only mentioned elements
      art = type.target?._artifact || type;
      variant = 'element';
    }
    else {
      variant = 'absolute';
    }
  }
  if (variant === 'absolute') {
    const absolute = `${ art.name.id }.${ id }`;
    return {
      kind: art.kind,
      name: { id: absolute, $variant: variant },
    };
  }
  const undef = {
    kind: variant || art.kind,
    name: { id, $variant: variant },
  };
  Object.defineProperty( undef, '_parent',
                         { value: art, configurable: true, writable: true } );
  Object.defineProperty( undef, '_main',
                         { value: art._main || art, configurable: true, writable: true } );
  // console.log('SN:',undef)
  return undef;
}

function messageText( texts, params, transform ) {
  if (typeof texts === 'string')
    texts = { std: texts };
  const args = {};
  for (const p in params) {
    if (params[p] !== undefined) {
      const t = transform && transform[p] || paramsTransform[p];
      args[p] = (t) ? t( params[p], args, params, texts ) : params[p];
    }
  }
  const variant = args['#'];
  return replaceInString( variant && texts[variant] || texts.std, args );
}

function replaceInString( text, params ) {
  const usedParams = [ '#', '$reviewed' ];
  const pattern = /\$\(([A-Z_]+)\)/g;
  const parts = [];
  let start = 0;
  for (let p = pattern.exec( text ); p; p = pattern.exec( text )) {
    const prop = p[1].toLowerCase();
    parts.push( text.substring( start, p.index ),
                (prop in params ? params[prop] : p[0]) );
    usedParams.push(prop);
    start = pattern.lastIndex;
  }
  parts.push( text.substring( start ) );
  const remain = (params['#']) ? [] : Object.keys( params ).filter( n => !usedParams.includes(n) );
  if (remain.length) {
    const remains = remain.map( n => `${ n.toUpperCase() } = ${ params[n] }` ).join(', ');
    return `${ parts.join('') }; ${ remains }`;
  }
  return parts.join('');
}

/**
 * Return message string with location if present in compact form (i.e. one line).
 *
 * IMPORTANT:
 *   cds-compiler <v4 used following signature:
 *   `messageString( err, normalizeFilename, noMessageId, noHome, moduleName = undefined ) : string`
 *   This signature is still supported for backwards compatibility but is deprecated.
 *
 * Example:
 *   <source>.cds:3:11: Error message-id: Can't find type `nu` in this scope (in entity:“E”/element:“e”)
 *
 * @param {CompileMessage} err
 *
 * @param {object} [config = {}]
 *
 * @param {boolean} [config.normalizeFilename]
 *     If true, the file path will be normalized to use `/` as the path separator (instead of `\` on Windows).
 *
 * @param {boolean} [config.noMessageId]
 *     If true, will _not_ show the message ID (+ explanation hint) in the output.
 *
 * @param {boolean} [config.noHome]
 *     If true, will _not_ show message's semantic location.
 *
 * @param {string} [config.moduleForMarker]
 *     If set, downgradable error messages will get a '‹↓›' marker, depending on whether
 *     the message can be downgraded for the given module.  A `‹↑›` is used if the message
 *     will be an error in the next major cds-compiler release.
 *
 * @returns {string}
 */
function messageString( err, config ) {
  // backwards compatibility <v4
  if (!config || typeof config === 'boolean' || arguments.length > 2) {
    config = {
      /* eslint-disable prefer-rest-params */
      normalizeFilename: arguments[1],
      noMessageId: arguments[2],
      noHome: arguments[3],
      moduleForMarker: arguments[4],
      /* eslint-enable prefer-rest-params */
    };
  }
  config.moduleForMarker ??= config.module; // v4.8.0 or earlier compatibility

  const location = (err.$location?.file ? `${ locationString( err.$location, config.normalizeFilename ) }: ` : '');
  const severity = err.severity || 'Error';
  const downgradable = severityChangeMarker(err, config);
  // even with noHome, print err.home if the location is weak
  const home = !err.home || config.noHome && err.$location?.endLine ? '' : ` (in ${ err.home })`;
  const msgId = (err.messageId && !config.noMessageId) ? `[${ err.messageId }]` : '';
  return `${ location }${ severity }${ downgradable }${ msgId }: ${ err.message }${ home }`;
}

/**
 * Return message hash which is either the message string without the file location,
 * or the full message string if no semantic location is provided.
 *
 * @param {CompileMessage} msg
 * @returns {string} can be used to uniquely identify a message
 */
function messageHash( msg ) {
  // parser messages do not provide semantic location, therefore$ we need to use the file location
  if (!msg.home)
    return messageString(msg);
  const copy = { ...msg };
  // Note: This is a hack. deduplicateMessages() would otherwise remove
  //       all but one message about duplicated artifacts.
  if (!msg.messageId || !msg.messageId.includes('duplicate'))
    copy.$location = undefined;
  return messageString(copy);
}

/**
 * Returns a message string with file- and semantic location if present in multiline form
 * with a source code snippet below that has highlights for the message's location.
 * The message (+ message id) are colored according to their severity.
 *
 * @param {CompileMessage} err
 *
 * @param {object} [config = {}]
 *
 * @param {boolean} [config.normalizeFilename]
 *     If true, the file path will be normalized to use `/` as the path separator (instead of `\` on Windows).
 *
 * @param {boolean} [config.noMessageId]
 *     If true, will _not_ show the message ID (+ explanation hint) in the output.
 *
 * @param {boolean} [config.hintExplanation]
 *     If true, messages with explanations will get a "…" marker.
 *
 * @param {string} [config.moduleForMarker]
 *     If set, downgradable error messages will get a '‹↓›' marker, depending on whether
 *     the message can be downgraded for the given module.  A `‹↑›` is used if the message
 *     will be an error in the next major cds-compiler release.
 *
 * @param {Record<string, string>} [config.sourceMap]
 *     A dictionary of filename<->source-code entries.  You can pass the `fileCache` that is used
 *     by the compiler.
 *
 * @param {Record<string, number[]>} [config.sourceLineMap]
 *     A dictionary of filename<->source-newline-indices entries. Is used to extract source code
 *     snippets for message locations.  If not set, will be set and filled by this function on-demand.
 *     An entry is an array of character/byte offsets to new-lines, for example sourceLineMap[1] is the
 *     end-newline for the second line.
 *
 * @param {string} [config.cwd]
 *     The current working directory (cwd) that was passed to the compiler.
 *     This value is only used if a source map is provided and relative paths needs to be
 *     resolved to absolute ones.
 *
 * @param {boolean | 'auto' | 'never' | 'always'} [config.color]
 *     If true/'always', ANSI escape codes will be used for coloring the severity.  If false/'never',
 *     no coloring will be used.  If 'auto', we will decide based on certain factors such
 *     as whether the shell is a TTY and whether the environment variable `NO_COLOR` is
 *     unset or whether `FORCE_COLOR` is set.
 *
 * @returns {string}
 */
function messageStringMultiline( err, config = {} ) {
  colorTerm.changeColorMode(config ? config.color : 'auto');

  config.moduleForMarker ??= config.module; // v4.8.0 or earlier compatibility

  const explainHelp = (config.hintExplanation && hasMessageExplanation(err.messageId)) ? '…' : '';
  const home = !err.home ? '' : (`at ${ err.home }`);
  const severity = err.severity || 'Error';
  const downgradable = severityChangeMarker(err, config);
  const msgId = (err.messageId && !config.noMessageId) ? `${ downgradable }[${ err.messageId }${ explainHelp }]` : '';

  let location = '';
  let context = '';
  if (err.$location?.file) {
    location += locationString( err.$location, config.normalizeFilename );
    if (home)
      location += ', ';
    context = _messageContext(err, config);
    if (context !== '')
      context = `\n${ context }`;
  }
  else if (!home) {
    return `${ colorTerm.severity(severity, severity + msgId) } ${ err.message }`;
  }

  const additionalIndent = err.$location ? `${ err.$location.endLine || err.$location.line || 1 }`.length : 1;
  const lineSpacer = `\n  ${ ' '.repeat( additionalIndent ) }|`;

  return `${ colorTerm.severity(severity, severity + msgId) }: ${ err.message }${ lineSpacer }\n  ${ location }${ home }${ context }`;
}

/**
 * Used by _messageContext() to create an array of line start offsets.
 * Each entry in the returned array contains the offset for the start line,
 * where the line is the index in the array.
 *
 * @param source
 * @return {number[]}
 * @private
 */
function _createSourceLineMap( source ) {
  const newlines = [ 0 ];

  const re = new RegExp(cdlNewLineRegEx, 'g');
  let line;
  while ((line = re.exec(source)) !== null)
    newlines.push(line.index + line[0].length);

  newlines.push(source.length); // EOF marker

  return newlines;
}

/**
 * Returns a context (code) string that is human-readable (similar to rust's compiler).
 *
 * IMPORTANT: In case that `config.sourceMap[err.loc.file]` does not exist, this function
 *            uses `path.resolve()` to get the absolute filename.
 *
 * Example Output:
 *     |
 *   3 |     num * nu
 *     |           ^^
 *
 * @param {CompileMessage} err Error object containing all details like line, message, etc.
 * @param {object} [config = {}] See `messageStringMultiline()` for details.
 *
 * @returns {string}
 * @private
 */
function _messageContext( err, config ) {
  const MAX_COL_LENGTH = 100;

  const loc = err.$location;
  if (!loc || !loc.line || !loc.file || !config.sourceMap)
    return '';

  let filepath = config.sourceMap[loc.file]?.realname || loc.file;
  if (!config.sourceMap[filepath])
    filepath = path.resolve(config.cwd || '', filepath);

  const source = config.sourceMap[filepath];
  if (!source || source === true) // true: file exists, no further knowledge
    return '';

  if (!config.sourceLineMap)
    config.sourceLineMap = Object.create(null);
  if (!config.sourceLineMap[filepath])
    config.sourceLineMap[filepath] = _createSourceLineMap(source);

  const sourceLines = config.sourceLineMap[filepath];

  // Lines are 1-based, we need 0-based ones for arrays
  const startLine = Math.min(sourceLines.length, loc.line - 1);
  const endLine = Math.min(sourceLines.length, loc.endLine ? loc.endLine - 1 : startLine);
  /** Only print N lines even if the error spans more lines. */
  const maxLine = Math.min((startLine + 2), endLine);

  // check that source lines exists
  if (typeof sourceLines[startLine] !== 'number')
    return '';

  const digits = String(endLine + 1).length;
  const severity = err.severity || 'Error';
  const indent = ' '.repeat(2 + digits);

  // Columns are limited in width to avoid too long output.
  // "col" is 1-based but could still be set to 0, e.g. by CSN frontend.
  const startColumn = Math.min(MAX_COL_LENGTH, loc.col || 1);
  // end column points to the place *after* the last character index,
  // e.g. for single character locations it is "start + 1"
  let endColumn = (loc.endCol && loc.endCol > loc.col) ? loc.endCol - 1 : loc.col;
  endColumn = Math.min(MAX_COL_LENGTH, endColumn);

  let msg = `${ indent }|\n`;

  // print source line(s)
  for (let line = startLine; line <= maxLine; line++) {
    // Replaces tabs with 1 space
    let sourceCode = source.substring(sourceLines[line], sourceLines[line + 1] || source.length).trimEnd();
    sourceCode = sourceCode.replace(/\t/g, ' ');
    if (sourceCode.length >= MAX_COL_LENGTH)
      sourceCode = sourceCode.slice(0, MAX_COL_LENGTH);
    // Only prepend space if the line contains any sources.
    sourceCode = sourceCode.length ? ` ${ sourceCode }` : '';
    msg += ` ${ String(line + 1).padStart(digits, ' ') } |${ sourceCode }\n`;
  }

  if (startLine === endLine && loc.col > 0) {
    // highlight only for one-line locations with valid columns
    // at least one character is highlighted
    let highlighter = ' '.repeat(startColumn - 1).padEnd(endColumn, '^');
    // Indicate that the error is further to the right.
    if (endColumn === MAX_COL_LENGTH)
      highlighter = highlighter.replace('  ^', '..^');
    msg += `${ indent }| ${ colorTerm.severity(severity, highlighter) }`;
  }
  else if (maxLine !== endLine) {
    // error spans more lines which we don't print
    msg += `${ indent }| …`;
  }
  else {
    msg += `${ indent }|`;
  }

  return msg;
}

/**
 * Returns a context (code) string that is human-readable (similar to rust's compiler)
 *
 * Example Output:
 *     |
 *   3 |     num * nu
 *     |           ^^
 *
 * @param {string[]} sourceLines The source code split up into lines, e.g. by `splitLines(src)`
 *                               from `lib/utils/file.js`
 * @param {CompileMessage} err Error object containing all details like line, message, etc.
 * @param {object} [config = {}]
 * @param {boolean | 'auto'} [config.color] If true, ANSI escape codes will be used for coloring the `^`.  If false, no
 *                                          coloring will be used.  If 'auto', we will decide based on certain factors such
 *                                          as whether the shell is a TTY and whether the environment variable 'NO_COLOR' is
 *                                          unset or `FORCE_COLOR` is set.
 * @returns {string}
 *
 * @deprecated Use `messageStringMultiline()` with `config.sourceMap` and `config.sourceLineMap` instead!
 */
function messageContext( sourceLines, err, config ) {
  const loc = err.$location;
  if (!loc || !loc.line || !loc.file)
    return '';

  colorTerm.changeColorMode(config ? config.color : 'auto');
  const sourceMap = { [err.$location.file]: sourceLines.join('\n') };
  return _messageContext(err, { ...config, sourceMap });
}

/**
 * Compare two messages `a` and `b`. Return 0 if they are equal, 1 if `a` is
 * larger than `b`, and -1 if `a` is smaller than `b`. Messages without a location
 * are considered larger than messages with a location.
 *
 * @param {CompileMessage} a
 * @param {CompileMessage} b
 */
function compareMessage( a, b ) {
  const aFile = a.$location && a.$location.file;
  const bFile = b.$location && b.$location.file;
  if (aFile && bFile) {
    const aEnd = a.$location.endLine && a.$location.endCol && a.$location || { endLine: Number.MAX_SAFE_INTEGER, endCol: Number.MAX_SAFE_INTEGER }; // eslint-disable-line @stylistic/js/max-len
    const bEnd = b.$location.endLine && b.$location.endCol && b.$location || { endLine: Number.MAX_SAFE_INTEGER, endCol: Number.MAX_SAFE_INTEGER }; // eslint-disable-line @stylistic/js/max-len
    return ( c( aFile, bFile ) ||
             c( a.$location.line, b.$location.line ) ||
             c( a.$location.col, b.$location.col ) ||
             c( aEnd.endLine, bEnd.endLine ) ||
             c( aEnd.endCol, bEnd.endCol ) ||
             c( homeSortName( a ), homeSortName( b ) ) ||
             // TODO: severities?
             c( a.message, b.message ) );
  }
  else if (!aFile && !bFile) {
    return ( c( homeSortName( a ), homeSortName( b ) ) ||
             c( a.message, b.message ) );
  }
  else if (!aFile) {
    return (a.messageId && a.messageId.startsWith( 'api-' )) ? -1 : 1;
  }
  return (b.messageId && b.messageId.startsWith( 'api-' )) ? 1 : -1;

  function c( x, y ) {
    if (x === y)
      return 0;
    return (x > y) ? 1 : -1;
  }
}

/**
 * Compare two messages `a` and `b`.  Return 0 if they are equal in both their
 * location and severity, >0 if `a` is larger than `b`, and <0 if `a` is smaller
 * than `b`. See `compareSeverities()` for how severities are compared.
 *
 * @param {CompileMessage} a
 * @param {CompileMessage} b
 */
function compareMessageSeverityAware( a, b ) {
  const c = compareSeverities(a.severity, b.severity);
  return c || compareMessage( a, b );
}

/**
 * Return sort-relevant part of semantic location (after the ':').
 * Messages without semantic locations are considered smaller (for syntax errors)
 * and (currently - should not happen in v6) larger for other messages.
 *
 * @param {CompileMessage} msg
 */
function homeSortName( { home, messageId } ) {
  if (!home)
    return (messageId && /^(syntax|api)-/.test( messageId ) ? ` ${ messageId }` : '~');
  return home.substring( home.indexOf(':') ); // i.e. starting with the ':', is always there
}

/**
 * Removes duplicate messages from the given messages array without destroying
 * references to the array, i.e. removes them in-place.
 *
 * _Note_: Does NOT keep the original order!
 *
 * Two messages are the same if they have the same message hash. See messageHash().
 * If one of the two is more precise, then it replaces the other.
 * A message is more precise if it is contained in the other or if
 * the first does not have an endLine/endCol.
 *
 * @param {CompileMessage[]} messages
 */
function deduplicateMessages( messages ) {
  // sort messages to make it processing sequence independent which messages (with
  // which $location!) wins
  messages.sort(compareMessage);
  const seen = new Map();
  for (const msg of messages) {
    const hash = messageHash(msg);

    if (!seen.has(hash)) {
      seen.set(hash, msg);
    }
    else if (msg.$location) {
      const existing = seen.get(hash);
      // If this messages has an end but the existing does not, then the new message is more precise.
      // If both messages do (or don't) have an endLine, then compare them based on their location.
      // Assume that a message is more precise if it comes later (i.e. may be included in the other).
      if (msg.$location.endLine && !existing.$location.endLine ||
         (!msg.$location.endLine === !existing.$location.endLine && compareMessage(msg, existing) > 0))
        seen.set(hash, msg);
    }
  }

  messages.length = 0;
  seen.forEach(msg => messages.push(msg));
}

function shortArtName( art ) {
  if (!art.name || art.kind === '$annotation')
    return artName( art );
  const name = getArtifactName( art );
  if ([ 'select', 'action', 'alias', 'param' ].every( n => name[n] == null || name[n] === 1 ) &&
      !name.absolute.includes(':'))
    return quote.double( name.element ? `${ name.absolute }:${ name.element }` : name.absolute );
  return artName( art );
}

function artName( art, omit ) {
  let suffix = 0;
  while (!art.name && art._outer && art.kind !== '$annotation') {
    ++suffix;
    art = art._outer;
  }

  const name = getArtifactName( art );
  if (!name) {
    const loc = art.location ? ` at ${ locationString( art.location ) }` : '';
    throw new CompilerAssertion(
      art.path
        ? `No artifact for ${ art.path.map( i => i.id ).join( '.' ) }${ loc }`
        : `No name found in ${ Object.keys( art ).join( '+' ) }${ loc }`
    );
  }

  const r = (name.absolute) ? [ quoted( name.absolute ) ] : [];
  if (name.select && name.select > 1 || name.select != null && art.kind !== 'element') // Yes, omit select:1 for element - TODO: re-check
    r.push( (art.kind === 'extend' ? 'block:' : 'query:') + name.select ); // TODO: rename to 'select:1' and consider whether there are more selects
  if (name.action != null && omit !== 'action')
    r.push( `${ memberActionName(art) }:${ quoted( name.action ) }` );
  if (name.alias != null && art.kind !== '$self' && name.$inferred !== '$internal')
    r.push( (art.kind === 'mixin' ? 'mixin:' : 'alias:') + quoted( name.alias ) );
  if (name.param != null && omit !== 'param')
    r.push( name.param ? `param:${ quoted( name.param ) }` : 'returns' ); // TODO: join

  if (name.element != null && omit !== 'element') {
    if (name.select != null && !art.$inferred)
      r.push( `column:${ quoted( name.element ) }` );
    else if (art.kind === 'builtin')
      return `$var:${ quoted( name.element ) }`;
    else
      // r.push( `${ art.kind }: ${ quoted( name.element )}` ); or even better element:"assoc"/key:"i" same with enum
      r.push( (art.kind === 'enum' ? 'enum:' : 'element:') + quoted( name.element ) );
  }

  if (art.kind === '$self')
    r.push( `alias:${ quoted( name.alias ) }` ); // should be late due to $self in anonymous aspect

  if (suffix && art.targetAspect)
    r.push( 'target' );
  else if (suffix)
    r.push( art.items?.items ? `items:${ suffix }` : 'items' );

  return r.join('/');
}

function memberActionName( art ) {
  while (art && art._main) {
    if (art.kind === 'action' || art.kind === 'function')
      return art.kind;
    art = art._parent;
  }
  return 'action';
}

// TODO: XSN-specific things should probably move out
function homeName( art, absoluteOnly ) {
  if (!art)
    return art;
  if (art._user)               // when providing a path item with filter as “user”
    return homeName( art._user, absoluteOnly );
  if (art._outer) {              // in items property, or annotation with path
    const outer = homeName( art._outer, absoluteOnly );
    if (art.kind === '$annotation') // eslint-disable-next-line sonarjs/no-nested-template-literals
      return `${ outer }/${ quoted( `@${ art.name.id }` ) }`;
    return outer;
  }
  else if (art.kind === 'source' || !art.name) { // error reported in parser or on source level
    return null;
  }
  else if (art.kind === 'using') {
    return `using:${ quoted( art.name.id ) }`;
  }
  else if (art.kind === 'extend' || art.kind === 'annotate') {
    return !absoluteOnly && homeNameForExtend( art );
  }
  else if (!art.kind) {          // annotation assignments are not really supported
    return (absoluteOnly) ? art.name.id : quoted( `@${ art.name.id }` );
  }
  else if (art.name._artifact) {            // block, extend, annotate
    return homeName( art.name._artifact, absoluteOnly ); // use corresponding definition
  }
  let main = art._main || art;
  while (main._outer)           // anonymous aspect
    main = main._outer._main || main._outer; // w/o `_main` if wrongly in `type`
  return (absoluteOnly) ? main.name.id : `${ main.kind }:${ artName( art ) }`;
}

// The "home" for extensions is handled differently because `_artifact` is not
// set for unknown extensions, and we could have nested extensions.
// TODO: delete this function, just set correct name/_parent for extensions
function homeNameForExtend( art ) {
  if (art._main)                // new-style member name
    return `${ art._main.kind }:${ artName( art ) }`;
  const kind = art.kind || 'extend';
  // TODO: fix the following - do like in collectArtifactExtensions() or
  //       basically resolveUncheckedPath()
  const absoluteName = art.name.id != null ? art.name.id
    : (!art.name.element && art.name.absolute || art.name.path && art.name.path.map(s => s && s.id).join('.'));

  // Surrounding parent may be another extension.
  const parent = art._parent;
  if (!parent && art.name.absolute)
    return `${ kind }:${ artName(removeBlock(art)) }`;
  else if (!parent)
    return `${ kind }:${ quoted(absoluteName) }`;

  if (art.name.param && parent.params) {
    const fakeArt = { kind: 'param', name: { param: absoluteName } };
    return `${ homeNameForExtend(parent) }/${ artName(fakeArt) }`;
  }
  else if (art.name.action && parent.actions) {
    const type = art.name._artifact?.kind || 'action';
    const fakeArt = { kind: type, name: { action: absoluteName }, _main: art.name._artifact?._main };
    return `${ homeNameForExtend(parent) }/${ artName(fakeArt) }`;
  }
  else if (parent.enum || parent.elements || parent.returns?.elements) {
    // For enum, extensions may store them in `elements`, i.e. don't differ between enum/elements,
    // so we need to look at the parent artifact.
    // For `extend <art> with enum`, there is `enum`.
    const parentArt = parent.name?._artifact;
    const fakeKind = (parent.enum || parentArt?.enum) ? 'enum' : 'element';
    const fakeArt = { kind: fakeKind, name: { element: art.name.element } };
    let parentOfElementChain = parent;
    while (parentOfElementChain.name?.element && parentOfElementChain._parent)
      parentOfElementChain = parentOfElementChain._parent;

    return `${ homeNameForExtend(parentOfElementChain) }/${ artName(fakeArt) }`;
  }
  // This case should not happen, but just in case
  return `${ kind }:${ artName(parent) }`;

  /**
   * Remove `select` from the 'art's name to avoid `block:1` in artName().
   * @TODO: Refactor homeNameForExtend (and possibly artName) to get rid of this function
   * */
  function removeBlock( obj ) {
    return { ...obj, name: { ...obj.name, select: null } };
  }
}

/**
 * Construct a semantic location for the given CSN path.
 * Works without a CSN model, but is less precise.
 *
 * Example:
 *   path:   ["definitions", "E", "elements", "s"],
 *   result: entity:“E”/element:“s”
 *
 * @param {CSN.Model} model
 * @param {CSN.Options} options
 * @param {CSN.Path} csnPath
 * @return {string|null}
 */
function constructSemanticLocationFromCsnPath( model, options, csnPath ) {
  if (!model)
    return null;

  if (options.testMode)
    sanitizeCsnPath(csnPath);

  const _quoted = options.testMode ? quoted : quote.double;

  let result = '';
  const csnDictionaries = [
    'args', 'params', 'enum', 'mixin', 'elements', 'actions', 'definitions', 'vocabularies',
  ];
  // Properties that (currently) end the semantic location.
  const queryPropsLast = [ 'where', 'groupBy', 'having', 'orderBy', 'limit', 'offset' ];

  let index = 0;
  /** @type {CSN.PathSegment} */
  let step = csnPath[index];
  let currentThing = model?.[step];

  function next( steps = 1 ) {
    for (; steps > 0; --steps) {
      ++index;
      step = csnPath[index];
      currentThing = currentThing && currentThing[step];
    }
  }

  function peek( steps = 1 ) {
    return csnPath[index + steps];
  }

  // First step; always one of: -------------------------------------

  if (step === 'definitions') {
    next(); // "definitions"
    const kind = currentThing?.kind || 'artifact';
    result += `${ kind }:${ _quoted(step) }`;
  }
  else if (step === 'vocabularies') {
    next(); // dictionary name
    if (index < csnPath.length)
      result += `annotation:${ _quoted(csnPath[index]) }`;
    else
      result += 'vocabularies';
  }
  else if (step === 'extensions') {
    next(); // "extensions"
    if (!currentThing) {
      result += `extension:${ step }`;
    }
    else {
      const name = currentThing.annotate || currentThing.extend;
      const kind = currentThing.annotate ? 'annotate' : 'extend';
      result += `${ kind }:${ _quoted(name) }`;
    }
  }

  if (!currentThing)
    return result;

  const selectDepth = (csnPath[0] !== 'extensions') ? queryDepthForMessage(csnPath, model, currentThing) : null;

  // Artifact ref -------------------------------------

  next();
  while (index < csnPath.length) {
    if (step === 'elements' || step === 'items') {
      if (index >= csnPath.length - 1)
        break; // last segment

      const elementHierarchy = [];
      while (index < (csnPath.length - 1) && (step === 'items' || step === 'elements')) {
        if (step === 'elements') {
          next();
          elementHierarchy.push(step);
        }
        next();
      }
      if (elementHierarchy.length > 0)
        result += `/element:${ _quoted(elementHierarchy.join('.')) }`;
      // no trailing /elements or /items
      continue;
    }
    else if (step === 'actions') {
      next(); // "actions"
      if (index < csnPath.length) {
        const kind = currentThing?.kind || 'action';
        result += `/${ kind }:${ _quoted(csnPath[index]) }`;
      }
      else { // actions is last segment
        result += '/actions';
      }
    }
    else if (step === 'params') {
      dictEntry('param');
    }
    else if (step === 'enum' || step === 'mixin') {
      dictEntry(step);
    }
    else if (step === 'cast') {
      // To shorten the location, only print 'cast' if it's not a
      // redirection target.
      if (csnPath[index + 1] !== 'on' && csnPath[index + 1] !== 'target')
        result += '/cast';
    }
    // @ts-ignore
    else if (queryPropsLast.includes(step)) {
      result += `/${ step }`;
      break; // always last step
    }
    else if (step === 'on') {
      result += '/on';
      break;
    }
    else if (step === 'target') {
      if (currentThing)
        result += `/target:${ _quoted(currentThing) }`;
      else
        result += '/target';
      break;
    }
    else if (step === 'targetAspect') {
      // skip
    }
    else if (step === 'xpr' || step === 'default' || step === 'ref' || step === 'as' || step === 'value') {
      break; // don't go into xprs, refs, aliases, values, etc.
    }
    else if (step === 'returns') {
      result += '/returns';
    }
    else if (step === 'query' || step === 'projection') {
      if (!queryPath())
        break; // something failed
      continue;
    }
    else if (step === 'cardinality') {
      // ignore; all messages pointing to cardinality already mention "cardinality".
      // Also, no annotations on cardinalities.
      break;
    }
    else if (step === 'type') {
      break; // we don't go into types
    }
    else if (step === 'keys') { // e.g. association foreign keys
      next(); // "keys"
      if (index < csnPath.length) {
        const key = aliasOrReference();
        result += `/key:${ key ? _quoted(key) : step }`;
      }
      break;
    }
    else if (step[0] === '@') {
      // Annotations are always the last step.
      // Nothing comes after them, everything is user defined.
      result += `/${ _quoted(csnPath[index]) }`;
      break;
    }
    else {
      if (options.testMode)
        throw new CompilerAssertion(`semantic location: Unhandled segment: ${ csnPath[index] } for path ${ JSON.stringify( csnPath) }`);
      break;
    }
    next();
  }

  return result;

  function dictEntry( prefix ) {
    next(); // dictionary name
    if (index < csnPath.length)
      result += `/${ prefix }:${ _quoted(csnPath[index]) }`;
  }

  /**
   * @return {string}
   */
  function currentRefName() {
    if (currentThing?.id)
      return currentThing?.id;
    else if (currentThing?.as)
      return currentThing?.as;
    else if (typeof currentThing === 'string')
      return currentThing;
    return undefined;
  }

  function aliasOrReference() {
    if (!currentThing?.as && currentThing?.ref) {
      // Create implicit alias.
      const { ref } = currentThing;
      const name = ref[ref.length - 1]?.id || ref[ref.length - 1];
      if (csnPath[index + 1] === 'ref' && csnPath[index + 2] === ref.length - 1) {
        // if the next ref points to the implicit alias, consume it to avoid duplicate names.
        next(2);
      }
      return name;
    }
    return currentRefName();
  }

  function queryPath() {
    next();
    while (index < csnPath.length) {
      if (step === 'SELECT' || step === 'SET') {
        if (selectDepth > 0) {
          // Once inside a SELECT, go to the "last" SELECT. Only print path steps after
          // the last SELECT, e.g. "columns".
          for (let j = csnPath.length - 1; j > index; --j) {
            // @ts-ignore
            if (csnPath[j] === 'SELECT' && !csnDictionaries.includes(csnPath[j - 1])) {
              next(j - index); // found last SELECT
              break;
            }
          }
          result += `/select:${ selectDepth }`;
        }
        else {
          result += '/select';
        }
      }
      else if (step === 'from') {
        // Don't check for alias, possibly confuses users.
        result += '/from';
      }
      else if (step === 'columns') {
        next();
        if (index >= csnPath.length)
          continue; // no column name

        const elementHierarchy = [];

        // Concat column+expand/inline to get a name similar to elements.
        do {
          if (currentThing?.inline)
            elementHierarchy.push(quote.angle(step + 1));
          else if (currentThing === '*')
            elementHierarchy.push(quote.angle(currentThing));
          else
            elementHierarchy.push(aliasOrReference());

          if (peek() === 'expand' || peek() === 'inline') {
            next(); // skip expand/inline
            next(); // go to next column
          }
          else {
            break;
          }
        } while (index < csnPath.length);

        if (elementHierarchy.length > 0)
          result += `/column:${ _quoted(elementHierarchy.join('.')) }`;
      }
      else if (step === 'args') {
        // Should only be reached for cases, where no SELECT in a union is picked.
        next(); // skip index
      }
      else {
        return true;
      }
      next();
    }
    return true;
  }
}

/**
 * Traverse the view's query until targetQuery is found and count the depth.
 * If there is only one or no query at all, returns `0` so that the semantic
 * location knows it does not need to print the query index.
 *
 * @param {CSN.Path} csnPath
 * @param {CSN.Model} model
 * @param {CSN.Artifact} view
 * @return {number}
 */
function queryDepthForMessage( csnPath, model, view ) {
  const { query: targetQuery } = analyseCsnPath(csnPath, model, false);
  if (!targetQuery)
    return 0;
  const rootQuery = view.query || { SELECT: view.projection };
  let depth = 0;
  let totalDepth = 0;
  let isFound = false;
  traverseQuery(rootQuery, null, null, (q) => {
    if (q.SELECT) {
      totalDepth += 1;
      if (!isFound)
        depth += 1;
    }
    if (q === targetQuery)
      isFound = true;
  });
  if (totalDepth > 1)
    return depth;
  return 0;
}

function sanitizeCsnPath( csnPath ) {
  for (const step of csnPath) {
    if (typeof step !== 'string' && typeof step !== 'number')
      throw new CompilerAssertion(`Found CSN path step that is neither string nor number: ${ step } ${ JSON.stringify(csnPath) }`);
  }
}

/**
 * Get the explanation string for the given message-id.
 * Ensure to have called hasMessageExplanation() before.
 *
 * @param {string} messageId
 * @returns {string}
 * @throws May throw an ENOENT error if the file cannot be found.
 * @see hasMessageExplanation()
 */
function explainMessage( messageId ) {
  messageId = oldMessageIds[messageId] || messageId;
  if (Array.isArray(messageId))
    messageId = messageId[0]; // take first just in case
  const filename = path.join(__dirname, '..', '..', 'share', 'messages', `${ messageId }.md`);
  return fs.readFileSync(filename, 'utf8');
}

/**
 * Returns true if the given message has an explanation file.
 * Takes into account changed message ids, i.e. looks up if the new
 * message id has an explanation.
 *
 * @param {string} messageId
 * @returns {boolean}
 */
function hasMessageExplanation( messageId ) {
  let id = oldMessageIds[messageId] || messageId || false;
  if (Array.isArray(id))
    id = id[0];
  return id && _messageIdsWithExplanation.includes(id);
}

/**
 * Returns an array of message IDs that have an explanation text.
 */
function messageIdsWithExplanation() {
  return _messageIdsWithExplanation;
}

module.exports = {
  hasErrors,
  locationString,
  messageString,
  messageStringMultiline,
  messageContext,
  searchName,
  createMessageFunctions,
  makeMessageFunction,
  artName,
  sortMessages: (m => m.sort(compareMessage)),
  sortMessagesSeverityAware: (m => m.sort(compareMessageSeverityAware)),
  deduplicateMessages,
  CompileMessage,
  CompilationError,
  explainMessage,
  hasMessageExplanation,
  messageIdsWithExplanation,
  // for tests only
  constructSemanticLocationFromCsnPath,
  homeName,
};
