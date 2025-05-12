#!/usr/bin/env node

// command line interface to the cds api resp. cds compiler
// Usage: cdsc [options] <file> ...
// Call cdsc --help for a detailed description
// Exit codes are:
//   0   for success
//   1   compilation error
//   2   command line usage error

// For recursive *.cds expansion, use
//   cdsc $(find . -name '*.cds' -type f)

'use strict';

/* eslint no-console:off */

const compiler = require('../lib/compiler');
const main = require('../lib/main');
const { for_sql: forSql, for_hdi: forHdi, for_hdbcds: forHdbcds } = require('../lib/api/main');
const { compactModel } = require('../lib/json/to-csn');
const { toRename: _toRename } = require('../lib/render/toRename');
const util = require('util');
const fs = require('fs');
const path = require('path');
const { reveal } = require('../lib/model/revealInternalProperties');
const enrichCsn = require('../lib/model/enrichCsn');
const { optionProcessor } = require('../lib/optionProcessor');
const {
  explainMessage, hasMessageExplanation, sortMessages,
  messageIdsWithExplanation, makeMessageFunction,
} = require('../lib/base/messages');
const { term } = require('../lib/utils/term');
const { addLocalizationViews } = require('../lib/transform/localized');
const { addTenantFields } = require('../lib/transform/addTenantFields');
const { availableBetaFlags } = require('../lib/base/model');
const { alterConstraintsWithCsn } = require('../lib/render/manageConstraints');
const { tmpFilePath, readStream } = require('../lib/utils/file');

// Note: Instead of throwing ProcessExitError, we would rather just call process.exit(exitCode),
// but that might truncate the output of stdout and stderr, both of which are async (or rather,
// may possibly be async, depending on OS and whether I/O goes to TTY, socket, file, ... sigh)
class ProcessExitError extends Error {
  constructor(exitCode, ...args) {
    super(...args);
    this.exitCode = exitCode;
  }
}

try {
  cdscMain();
}
catch (err) {
  // This whole try/catch is only here because process.exit does not work in combination with
  // stdout/err - see comment at ProcessExitError
  if (err instanceof ProcessExitError)
    process.exitCode = err.exitCode;
  else
    throw err;
}

function remapCmdOptions( options, command ) {
  if (!command || !options[command])
    return;

  for (const [ key, value ] of Object.entries(options[command])) {
    switch (key) {
      case 'user':
        options.variableReplacements ??= {};
        options.variableReplacements.$user ??= {};
        options.variableReplacements.$user.id = value;
        break;
      case 'locale':
        options.variableReplacements ??= {};
        options.variableReplacements.$user ??= {};
        options.variableReplacements.$user.locale = value;
        break;
      case 'serviceNames':
        options.serviceNames = value.split(',');
        break;
      case 'noStandardDatabaseFunctions':
        options.standardDatabaseFunctions = false;
        delete options.noStandardDatabaseFunctions;
        break;
      default:
        options[key] = value;
    }
  }
  delete options[command];
}

function cdscMain() {
  if (process.argv.some(arg => arg === '-i' || arg === '--stdin'))
    optionProcessor.makePositionalArgumentsOptional();

  // Parse the command line and translate it into options
  const cmdLine = optionProcessor.processCmdLine(process.argv);

  // Deal with '--version' explicitly
  if (cmdLine.options.version) {
    process.stdout.write(`${ main.version() }\n`);
    throw new ProcessExitError(0);
  }
  // Deal with '--help' explicitly
  if (cmdLine.command) {
    // Command specific help
    if (cmdLine.options.help || cmdLine.options[cmdLine.command]?.help)
      displayUsage(null, optionProcessor.commands[cmdLine.command].helpText, 0);
  }
  else if (cmdLine.options.help) {
    // General help
    displayUsage(null, optionProcessor.helpText, 0);
  }

  if (cmdLine.unknownOptions.length > 0) {
    // Print an INFO message about unknown options but
    // continue with defaults and do not abort execution.
    cmdLine.unknownOptions.forEach(msg => process.stderr.write(`cdsc: INFO: ${ msg }\n`));
  }

  // Report complaints if any
  if (cmdLine.cmdErrors.length > 0) {
    // Command specific errors
    displayUsage(cmdLine.cmdErrors, optionProcessor.commands[cmdLine.command].helpText, 2);
  }
  else if (cmdLine.errors.length > 0) {
    // General errors
    displayUsage(cmdLine.errors, optionProcessor.helpText, 2);
  }

  if (cmdLine.options.options) {
    if (!loadOptionsFromJson(cmdLine))
      return;
  }

  // Default warning level is 2 (info); default value only needed for cdsc output
  if (!cmdLine.options.warning)
    cmdLine.options.warning = 2;

  // Default output goes to stdout
  if (!cmdLine.options.out)
    cmdLine.options.out = '-';

  // --cds-home <dir>: modules starting with '@sap/cds/' are searched in <dir>
  // -> cmdLine.options.cdsHome is passed down to moduleResolve

  // Set default command if required
  cmdLine.command = cmdLine.command || 'toCsn';

  if (cmdLine.options.rawOutput)
    cmdLine.options.attachValidNames = true;

  // Internally, parseCdl/parseOnly are options, so we map the command to it.
  if (cmdLine.command === 'parseCdl') {
    cmdLine.command = 'toCsn';
    cmdLine.options.toCsn = cmdLine.options.parseCdl;
    cmdLine.options.parseCdl = true;
    cmdLine.args.files = [ cmdLine.args.file ];
  }
  else if (cmdLine.command === 'parseOnly') {
    // Remap command and command-specific options.
    cmdLine.command = 'toCsn';
    cmdLine.options.toCsn = cmdLine.options.parseOnly;
    cmdLine.options.parseOnly = true;
    cmdLine.args.files = [ cmdLine.args.file ];
  }

  if (cmdLine.options.directBackend)
    validateDirectBackendOption(cmdLine.command, cmdLine.options, cmdLine.args);

  // If set through CLI (and not options file), `beta` is a string and needs processing.
  if (typeof cmdLine.options.beta === 'string') {
    const features = cmdLine.options.beta.split(',');
    cmdLine.options.beta = {};
    features.forEach((val) => {
      cmdLine.options.beta[val] = true;
    });
  }

  const to = cmdLine.options.toSql ? 'toSql' : 'toHana';
  if (cmdLine.options[to]) {
    const opt = cmdLine.options[to];
    // remap string values in options to boolean
    if (opt.assertIntegrity &&
        (opt.assertIntegrity === 'true' ||
         opt.assertIntegrity === 'false')
    )
      opt.assertIntegrity = opt.assertIntegrity === 'true';

    if (opt.withHanaAssociations)
      opt.withHanaAssociations = opt.withHanaAssociations !== 'false';

    if (opt.betterSqliteSessionVariables)
      opt.betterSqliteSessionVariables = opt.betterSqliteSessionVariables === 'true';
    if (opt.v6Now)
      opt.v6$now = true;
  }

  // Enable all beta-flags if betaMode is set to true
  if (cmdLine.options.betaMode)
    cmdLine.options.beta = availableBetaFlags;

  const { shuffle } = cmdLine.options;
  if (shuffle != null) {
    const num = Number.parseInt( shuffle, 10 );
    cmdLine.options.testMode = (num > 0)
      ? num
      : Math.floor( Math.random() * 4294967296 ) + 1;
    console.error( `Running ‘${ cmdLine.command }’ with test-mode shuffle ${ cmdLine.options.testMode } …` );
  }

  // If set through CLI (and not options file), `deprecated` and `moduleLookupDirectories`
  // are strings and needs processing.
  if (typeof cmdLine.options.deprecated === 'string') {
    const features = cmdLine.options.deprecated.split(',');
    cmdLine.options.deprecated = {};
    features.forEach((val) => {
      cmdLine.options.deprecated[val] = true;
    });
  }
  if (typeof cmdLine.options.moduleLookupDirectories === 'string')
    cmdLine.options.moduleLookupDirectories = cmdLine.options.moduleLookupDirectories.split(',');

  if (cmdLine.options.stdin)
    cmdLine.options.fallbackParser ??= 'auto!';

  const commandOptions = cmdLine.options[cmdLine.command];
  if (commandOptions?.transitiveLocalizedViews) {
    cmdLine.options.fewerLocalizedViews = !commandOptions.transitiveLocalizedViews;
    delete commandOptions.transitiveLocalizedViews;
  }

  if (cmdLine.options.oldParser) {
    cmdLine.options.newParser = false;
    delete cmdLine.options.oldParser;
  }

  if (commandOptions?.noRenderCdlDefinitionNesting) {
    commandOptions.renderCdlDefinitionNesting = false;
    delete commandOptions.noRenderCdlDefinitionNesting;
  }
  if (commandOptions?.noRenderCdlCommonNamespace) {
    commandOptions.renderCdlCommonNamespace = false;
    delete commandOptions.noRenderCdlCommonNamespace;
  }
  if (commandOptions?.noBooleanEquality) {
    commandOptions.booleanEquality = false;
    delete commandOptions.noBooleanEquality;
  }


  parseSeverityOptions(cmdLine);

  // Do the work for the selected command
  executeCommandLine(cmdLine.command, cmdLine.options, cmdLine.args);
}

/**
 * `--direct-backend` can only be used with certain backends and with certain files.
 * This function checks these pre-conditions and emits an error if a condition isn't
 * fulfilled.
 *
 * @param {string} command
 * @param {CSN.Options} options
 * @param {object} args
 */
function validateDirectBackendOption( command, options, args ) {
  if (![ 'toCdl', 'toOdata', 'toHana', 'toCsn', 'toSql', 'forJava' ].includes(command)) {
    displayUsage(`Option '--direct-backend' can't be used with command '${ command }'`,
                 optionProcessor.helpText, 2);
  }
  if (!options.stdin && (!args.files || args.files.length !== 1)) {
    displayUsage(`Option '--direct-backend' expects exactly one JSON file, but ${ args.files?.length || 'none' } given`,
                 optionProcessor.helpText, 2);
  }
  const filename = args.files?.[0];
  if (filename && !filename.endsWith('.csn') && !filename.endsWith('.json')) {
    displayUsage('Option \'--direct-backend\' expects a filename with a *.csn or *.json suffix',
                 optionProcessor.helpText, 2);
  }
}

// Display help text 'helpText' and 'error' (if any), then exit with exit code <code>
function displayUsage( error, helpText, code ) {
  // Display non-error output (like help) to stdout
  const out = (code === 0 && !error) ? process.stdout : process.stderr;
  // Display help text first, error at the end (more readable, no scrolling)
  out.write(`${ helpText }\n`);
  if (error) {
    if (error instanceof Array) {
      const errors = error.map(err => `cdsc: ERROR: ${ err }`).join('\n');
      out.write(`${ errors }\n`);
    }
    else {
      out.write(`cdsc: ERROR: ${ error }\n`);
    }
  }
  throw new ProcessExitError(code);
}

/**
 * As the compiler is file-based and will always at least try to call `realpath()` on a file,
 * we fake a "stdin" file for it.
 *
 * @returns {Promise<string>}
 */
async function createTemporaryFileFromStdin() {
  const contents = await readStream(process.stdin);
  const file = tmpFilePath('cds-compiler-stdin', 'cds');
  await fs.promises.writeFile(file, contents);
  return file;
}

// Executes a command line that has been translated to 'command' (what to do),
// 'options' (how) and 'args' (which files)
async function executeCommandLine( command, options, args ) {
  const normalizeFilename = options.testMode && process.platform === 'win32';
  const messageLevels = {
    Error: 0, Warning: 1, Info: 2, Debug: 3,
  };
  // All messages are put into the message array, even those which should not
  // been displayed (severity 'Debug')

  // Create output directory if necessary
  if (options.out && options.out !== '-' && !fs.existsSync(options.out))
    fs.mkdirSync(options.out);

  // Default color mode is 'auto'
  const colorTerm = term(options.color || 'auto');

  // Add implementation functions corresponding to commands here
  const commands = {
    toCdl,
    toCsn,
    toHana,
    toOdata,
    forJava,
    toRename,
    manageConstraints,
    toSql,
    inspect,
    forEffective,
    forSeal,
  };
  const commandsWithoutCompilation = {
    explain,
  };

  if (!commands[command] && !commandsWithoutCompilation[command])
    throw new Error(`Missing implementation for command ${ command }`);

  remapCmdOptions( options, command );

  if (commandsWithoutCompilation[command]) {
    commandsWithoutCompilation[command]();
    return;
  }

  options.messages = [];
  args.files ??= [];

  // Load a file from stdin if no explicit file is given and stdin is not a TTY.
  if (options.stdin)
    args.files.push(await createTemporaryFileFromStdin());

  const fileCache = Object.create(null);
  const compiled = options.directBackend
    ? util.promisify(fs.readFile)( args.files[0], 'utf-8' ).then(str => JSON.parse( str ))
    : compiler.compileX( args.files, undefined, options, fileCache );

  await compiled.then( commands[command] )
    .then( displayMessages, displayErrors )
    .catch( catchErrors );

  // below are only command implementations.

  // Execute the command line option '--to-cdl' and display the results.
  // Return the original model (for chaining)
  function toCdl( model ) {
    const csn = options.directBackend ? model : compactModel(model, options);
    const cdlResult = main.to.cdl(csn, options);
    for (const name in cdlResult)
      writeToFileOrDisplay(options.out, `${ name }.cds`, cdlResult[name]);

    return model;
  }

  function forEffective( model ) {
    const features = [
      'resolveSimpleTypes', 'resolveProjections',
      'remapOdataAnnotations', 'keepLocalized',
    ];
    for (const feature of features) {
      if (options[feature]) // map to boolean equivalent
        options[feature] = options[feature] === 'true';
    }
    const csn = options.directBackend ? model : compactModel(model, options);
    displayNamedCsn(main.for.effective(csn, options), 'effective');

    return model;
  }

  function forSeal( model ) {
    const features = [ 'remapOdataAnnotations', 'deriveAnalyticalAnnotations' ];
    for (const feature of features) {
      if (options[feature]) // map to boolean equivalent
        options[feature] = options[feature] === 'true';
    }
    const csn = options.directBackend ? model : compactModel(model, options);
    displayNamedCsn(main.for.seal(csn, options), 'seal');

    return model;
  }

  // Execute the command line option 'toCsn' and display the results.
  // Return the original model (for chaining)
  function toCsn( model ) {
    if (options.directBackend) {
      displayNamedCsn(model, 'csn');
    }
    else {
      // Result already provided by caller
      displayNamedXsn(model, 'csn');
    }
    return model;
  }

  // Execute the command line command 'forJava' and display the results.
  // Return the original model
  function forJava( model ) {
    const csn = options.directBackend ? model : compactModel(model, options);
    displayNamedCsn( main.for.java( csn, options ), 'java');
    return model;
  }

  // Execute the command line option '--to-hana' and display the results.
  // Return the original model (for chaining)
  function toHana( model ) {
    const csn = options.directBackend ? model : compactModel(model, options);

    if (options.csn) {
      displayNamedCsn(forHdbcds(csn, options), 'hana_csn');
    }
    else {
      const hanaResult = main.to.hdbcds(csn, options);
      for (const name in hanaResult)
        writeToFileOrDisplay(options.out, name, hanaResult[name]);
    }

    return model;
  }

  // Execute the command line option '--to-odata' and display the results.
  // Return the original model (for chaining)
  function toOdata( model ) {
    if (options.odataVersion === 'v4x') {
      options.odataVersion = 'v4';
      options.odataFormat = 'structured';
      options.odataContainment = true;
    }
    if (options.odataVocabularies && typeof options.odataVocabularies === 'string')
      options.odataVocabularies = JSON.parse(options.odataVocabularies);

    const csn = options.directBackend ? model : compactModel(model, options);
    if (options.csn) {
      const odataCsn = main.for.odata(csn, options);
      displayNamedCsn(odataCsn, 'odata_csn');
    }
    else if (options.json) {
      const result = main.to.edm.all(csn, options);
      for (const serviceName in result)
        writeToFileOrDisplay(options.out, `${ serviceName }.json`, result[serviceName]);
    }
    else {
      const result = main.to.edmx.all(csn, options);
      for (const serviceName in result)
        writeToFileOrDisplay(options.out, `${ serviceName }.xml`, result[serviceName]);
    }
    return model;
  }

  // Execute the command line option '--to-rename' and display the results.
  // Return the original model (for chaining)
  //
  // / THIS MUST SURVIVE IF WE REMOVE THE OLD API
  // / DO NOT DELETE THIS TORENAME FUNCTIONALITY!!
  function toRename( model ) {
    const csn = options.directBackend ? model : compactModel(model, options);
    const messageFunctions = makeMessageFunction(csn, options, 'to.rename');
    const renameResult = _toRename(csn, options, messageFunctions);
    let storedProcedure = `PROCEDURE RENAME_${ renameResult.options.sqlMapping.toUpperCase() }_TO_PLAIN LANGUAGE SQLSCRIPT AS BEGIN\n`;
    for (const name in renameResult.rename) {
      storedProcedure += `  --\n  -- ${ name }\n  --\n`;
      storedProcedure += renameResult.rename[name];
    }
    storedProcedure += 'END;\n';
    writeToFileOrDisplay(options.out, `storedProcedure_${ renameResult.options.sqlMapping }_to_plain.sql`, storedProcedure, true);
    return model;
  }

  // Execute the command line option 'manageConstraints' and display the results.
  function manageConstraints( model ) {
    const csn = options.directBackend ? model : compactModel(model, options);
    const { src } = options || {};
    const messageFunctions = makeMessageFunction(csn, options, 'alterConstraints');
    const alterConstraintsResult = alterConstraintsWithCsn(csn, options, messageFunctions);
    Object.keys(alterConstraintsResult).forEach((id) => {
      const renderedConstraintStatement = alterConstraintsResult[id];
      if (src === 'hdi')
        writeToFileOrDisplay(options.out, `${ id }.hdbconstraint`, renderedConstraintStatement);
      else
        writeToFileOrDisplay(options.out, `${ id }.sql`, renderedConstraintStatement);
    });
  }

  // Execute the command line option '--to-sql' and display the results.
  // Return the original model (for chaining)
  function toSql( model ) {
    const csn = options.directBackend ? model : compactModel(model, options);
    if (options.src === 'hdi') {
      if (options.csn) {
        displayNamedCsn(forHdi(csn, options), 'hdi_csn');
      }
      else {
        const hdiResult = main.to.hdi(csn, options);
        for (const name in hdiResult)
          writeToFileOrDisplay(options.out, name, hdiResult[name]);
      }
    }
    else if (options.csn) {
      displayNamedCsn(forSql(csn, options), 'sql_csn');
    }
    else {
      const sqlResult = main.to.sql(csn, options);
      writeToFileOrDisplay(options.out, 'model.sql', sqlResult.join('\n\n'), true);
    }
    return model;
  }

  function explain() {
    if (args.messageId === 'list') {
      console.log(messageIdsWithExplanation().join('\n'));
      throw new ProcessExitError(0);
    }

    if (!hasMessageExplanation(args.messageId))
      console.error(`Message '${ args.messageId }' does not have an explanation!`);
    else
      console.log(explainMessage(args.messageId));
  }

  function inspect( model ) {
    const inspectModel = require('../lib/inspect');

    if (options.statistics) {
      const result = inspectModel.inspectModelStatistics(model, options);
      if (result)
        console.log(result);
    }

    if (options.propagation) {
      const result = inspectModel.inspectPropagation(model, options, options.propagation);
      if (result)
        console.log(result);
    }

    return model;
  }

  // Display error messages in `err` resulting from a compilation.  Also set
  // process.exitCode - process.exit() will force the process to exit as quickly
  // as possible = is problematic, since console.error() might be asynchronous
  function displayErrors( err ) {
    if (err instanceof main.CompilationError) {
      if (options.rawOutput)
        console.error( util.inspect( reveal( err.model, options.rawOutput ), false, null ));
      else
        displayMessages( err.model, err.messages );
      process.exitCode = 1;
    }
    else if (err instanceof compiler.InvocationError) {
      console.error( '' );
      for (const sub of err.errors)
        console.error( sub.message );
      console.error( '' );
      process.exitCode = 2;
    }
    else {
      throw err;
    }

    err.hasBeenReported = true;
    throw err;
  }

  /**
   * Print the model's messages to stderr in a human readable way.
   *
   * @param {CSN.Model | XSN.Model} model
   * @param {CompileMessage[]} messages
   */
  function displayMessages( model, messages = options.messages ) {
    if (!Array.isArray(messages) || options.quiet)
      return model;

    const log = console.error;

    sortMessages(messages);

    const msgConfig = {
      normalizeFilename,
      noMessageId: !!options.noMessageId,
      hintExplanation: true,
      color: options.color,
      module: options.testMode && 'compile', // TODO: use module name
      sourceMap: fileCache,
      cwd: '',
    };

    if (options.internalMsg) {
      messages.map(msg => util.inspect( msg, { depth: null, maxArrayLength: null } ) )
        .forEach(msg => log(msg));
    }
    else if (options.noMessageContext) {
      messages.filter(msg => (messageLevels[msg.severity] <= options.warning))
        .forEach(msg => log(main.messageString( msg, msgConfig )));
    }
    else {
      let hasAtLeastOneExplanation = false;
      messages.filter(msg => messageLevels[msg.severity] <= options.warning).forEach((msg) => {
        hasAtLeastOneExplanation = hasAtLeastOneExplanation ||
          main.hasMessageExplanation(msg.messageId);
        log(main.messageStringMultiline(msg, msgConfig));
        log(); // newline
      });
      if (!options.noMessageId && hasAtLeastOneExplanation)
        log(`${ colorTerm.asHelp('help') }: Messages marked with '…' have an explanation text. Use \`cdsc explain <message-id>\` for a more detailed error description.`);
    }
    return model;
  }

  // Write the model 'model' to file '<name>.{json|raw.txt}' in directory 'options.out',
  // or display it to stdout if 'options.out' is '-'.
  // Depending on 'options.rawOutput', the model is either compacted to 'name.json' or
  // written in raw form to '<name>_raw.txt'.
  function displayNamedXsn( xsn, name ) {
    if (options.rawOutput)
      writeToFileOrDisplay(options.out, `${ name }_raw.txt`, util.inspect(reveal(xsn, options.rawOutput), false, null), true);
    else if (options.internalMsg)
      writeToFileOrDisplay(options.out, `${ name }_raw.txt`, util.inspect(reveal(xsn).messages, { depth: null, maxArrayLength: null }), true);
    else if (!options.parseOnly) // no output if parseOnly but not rawOutput
      displayNamedCsn(compactModel(xsn, options), name);
  }

  /**
   * @param {CSN.Model} csn
   * @param {string} name
   */
  function displayNamedCsn( csn, name ) {
    if (!csn) // only print CSN if it is set.
      return;

    if (command === 'toCsn' ) {
      // If requested, run some CSN postprocessing.
      if (options.tenantDiscriminator)
        addTenantFields(csn, options); // always _before_ localized convenience views are added
      if (options.withLocalized)
        addLocalizationViews(csn, options);
    }

    if (options.enrichCsn)
      enrichCsn( csn, options );

    if (options.internalMsg)
      writeToFileOrDisplay(options.out, `${ name }_raw.txt`, options.messages, true);

    else if (!options.internalMsg)
      writeToFileOrDisplay(options.out, `${ name }.json`, csn, true);
  }

  /**
   * Write the result 'content' to a file 'filename' in directory 'dir', except if 'dir' is '-'.
   * In that case, display 'content' to stdout.
   * If 'content' is not a string, JSON-stringify it
   * If displaying to stdout, prepend a headline containing 'filename',
   * unless 'omitHeadline' is set.
   * For filenames, illegal characters (slash, backslash, colon) are replaced by '_'.
   *
   * @param {string} dir
   * @param {string} fileName
   * @param {string} content
   * @param {boolean} [omitHeadline]
   */
  function writeToFileOrDisplay( dir, fileName, content, omitHeadline = false ) {
    if (options.internalMsg)
      return;
    fileName = fileName.replace(/[:/\\]/g, '_');

    // replace all dots with underscore to get deployable .hdbcds sources
    // (except the one before the file extension)
    if (options.transformation === 'hdbcds')
      fileName = fileName.replace(/\.(?=.*?\.)/g, '_');

    if (typeof content !== 'string')
      content = JSON.stringify(content, null, 2);

    if (dir === '-') {
      if (options.quiet)
        return;
      if (!omitHeadline) {
        const sqlTypes = {
          sql: true, hdbconstraint: true, hdbtable: true, hdbview: true,
        };
        const commentStarter = fileName.split('.').pop() in sqlTypes ? '--$' : '//';
        process.stdout.write(`${ commentStarter } ------------------- ${ fileName } -------------------\n`);
      }

      process.stdout.write(`${ content }\n`);
      if (!omitHeadline)
        process.stdout.write('\n');
    }
    else {
      // TODO: We might consider using async file-system API ...
      fs.writeFileSync(path.join(dir, fileName), content);
    }
  }
}

function loadOptionsFromJson( cmdLine ) {
  try {
    let opt = JSON.parse(fs.readFileSync(cmdLine.options.options, 'utf-8'));
    if (opt.cds)
      opt = opt.cds;
    if (opt.cdsc)
      opt = opt.cdsc;
    Object.assign(cmdLine.options, opt);
    return true;
  }
  catch (e) {
    catchErrors(e);
    return false;
  }
}

function catchErrors( err ) {
  // @ts-ignore
  if (err instanceof Error && err.hasBeenReported)
    return;
  console.error( '' );
  console.error( 'INTERNAL ERROR:' );
  console.error( util.inspect(err, false, null) );
  console.error( '' );
  process.exitCode = 70;
}

/**
 * Parses the options `--error` and similar.
 * Sets the dictionary `severities` on the given options.
 *
 * @param {object} options
 */
function parseSeverityOptions({ options }) {
  if (!options.severities)
    options.severities = Object.create(null);

  const severityMap = {
    error: 'Error',
    warn: 'Warning',
    info: 'Info',
    debug: 'Debug',
  };

  // Note: We use a for loop to ensure that the order of the options on
  //       the command line is respected, i.e. `--warn id --error id` would
  //       lead to `id` being reclassified as an error and not a warning.
  for (const key in options) {
    switch (key) {
      case 'error':
      case 'warn':
      case 'info':
      case 'debug':
        parseSeverityOption(options[key], severityMap[key]);
        break;
      default:
        break;
    }
  }

  function parseSeverityOption( list, severity ) {
    const ids = list.split(',');
    for (let id of ids) {
      id = id.trim();
      if (id)
        options.severities[id] = severity;
    }
  }
}
