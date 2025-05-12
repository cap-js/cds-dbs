'use strict';

/**
 * Create a command line option processor and define valid commands, options and parameters.
 * In order to understand a command line like this:
 *   $ node cdsc.js -x 1 --foo toXyz -y --bar-wiz bla arg1 arg2
 *
 * The following definitions should be made:
 *
 * ```js
 *   const optionProcessor = createOptionProcessor();
 *   optionProcessor
 *     .help(`General help text`);
 *     .option('-x, --long-form <i>')
 *     .option('    --foo')
 *   optionProcessor.command('toXyz')
 *     .help(`Help text for command "toXyz")
 *     .option('-y  --y-in-long-form')
 *     .option('    --bar-wiz <w>', { valid: ['bla', 'foo'] })
 *     .option('-z  --name-in-cdsc', { optionName: 'nameInOptions' })
 * ```
 *
 * Options *must* have a long form, can have at most one <param>, and optionally
 * an array of valid param values as strings.  Commands and param values must not
 * start with '-'. The whole processor and each command may carry a help text.
 * To actually parse a command line, use
 *   const cli = optionProcessor.processCmdLine(process.argv);
 * (see below)
 */
function createOptionProcessor() {
  const optionProcessor = {
    commands: {},
    options: {},
    positionalArguments: [],
    optionClashes: [],
    option,
    command,
    positionalArgument(argumentDefinition) {
      // Default positional arguments; may be overwritten by commands.
      _setPositionalArguments(argumentDefinition);
      return optionProcessor;
    },
    help,
    processCmdLine,
    makePositionalArgumentsOptional,
  };
  return optionProcessor;

  /**
   * API: Define a general option.
   * @param {string} optString Option string describing the command line option.
   * @param {object} [options] Further options such as `ignoreCase: true` and `valid: []`.
   * @param {string[]} [options.valid] Valid values for the option.
   * @param {string[]} [options.ignoreCase] Ignore the case for "options.valid".
   * @param {string[]} [options.optionName] Name of the option after parsing CLI arguments.
   *                                        Defaults to the camelified name of the long name.
   */
  function option( optString, options ) {
    return _addOption(optionProcessor, optString, options);
  }

  /**
   * API: Define the main help text (header and general options)
   * @param {string} text Help text describing all options, etc.
   */
  function help( text ) {
    optionProcessor.helpText = text;
    return optionProcessor;
  }

  /**
   * API: Define a command
   * @param {string} cmdString Command name, short and long form, e.g. 'S, toSql'
   */
  function command( cmdString ) {
    /** @type {object} */
    const cmd = {
      options: {},
      positionalArguments: [],
      option: commandOption,
      positionalArgument(argumentDefinition) {
        _setPositionalArguments(argumentDefinition, cmd.positionalArguments);
        return cmd;
      },
      help: commandHelp,
      ..._parseCommandString(cmdString),
    };
    if (optionProcessor.commands[cmd.longName])
      throw new Error(`Duplicate assignment for long command ${ cmd.longName }`);

    optionProcessor.commands[cmd.longName] = cmd;

    if (cmd.shortName) {
      if (optionProcessor.commands[cmd.shortName])
        throw new Error(`Duplicate assignment for short command ${ cmd.shortName }`);

      optionProcessor.commands[cmd.shortName] = cmd;
    }
    return cmd;

    // Command API: Define a command option
    function commandOption( optString, options ) {
      return _addOption(cmd, optString, options);
    }

    // Command API: Define the command help text
    function commandHelp( text ) {
      cmd.helpText = text;
      return cmd;
    }
  }

  /**
   * Set the positional arguments to the command line processor. Instructs the processor
   * to either require N positional arguments or a dynamic number (but at least one).
   * Note that you can only call this function once.  Only the last invocation sets
   * the positional arguments.
   *
   * @param {string}   argumentDefinition Positional arguments, e.g. '<input> <output>' or '<files...>'
   * @param {object[]} argList            Array, to which the parsed arguments will be added.  Default is global scope.
   * @private
   */
  function _setPositionalArguments( argumentDefinition, argList = optionProcessor.positionalArguments ) {
    if (argList.find(arg => arg.isDynamic))
      throw new Error('Can\'t add positional arguments after a dynamic one');

    const registeredNames = argList.map(arg => arg.name);
    const args = argumentDefinition.split(' ');

    for (const arg of args) {
      // Remove braces, dots and camelify.
      const argName = arg.replace('<', '')
        .replace('>', '')
        .replace('...', '')
        .replace(/[ -]./g, s => s.substring(1).toUpperCase());

      if (registeredNames.includes(argName))
        throw new Error(`Duplicate positional argument: ${ arg }`);

      if (!isParam(arg) && !isDynamicPositionalArgument(arg))
        throw new Error(`Unknown positional argument syntax: ${ arg }`);

      argList.push({
        name: argName,
        isDynamic: isDynamicPositionalArgument(arg),
        required: true,
      });

      registeredNames.push(argName);
    }
  }

  /**
   * Internal: Define a general or command option.
   * Throws if the option is already registered in the given command context.
   * or in the given command.
   *
   * @private
   * @see option()
   */
  function _addOption( cmd, optString, options ) {
    const cliOpt = _parseOptionString(optString, options);
    Object.assign(cliOpt, options);
    _addOptionName(cmd, cliOpt.longName, cliOpt);
    _addOptionName(cmd, cliOpt.shortName, cliOpt);

    for (const alias of cliOpt.aliases || []) {
      const aliasOpt = Object.assign({ }, cliOpt, { isAlias: true });
      _addOptionName(cmd, alias, aliasOpt); // use same optionName, etc. for alias
    }

    return cmd;
  }

  /**
   * Internal: Add a name to the list of options.
   * Throws if the option is already registered in the given command context.
   * or in the given command.
   *
   * @private
   * @see _addOption()
   */
  function _addOptionName( cmd, name, opt ) {
    if (!name)
      return;
    if (cmd.options[name]) {
      throw new Error(`Duplicate assignment for option ${ name }`);
    }
    else if (optionProcessor.options[name]) {
      // This path is only taken if optString is for commands
      optionProcessor.optionClashes.push({
        option: name,
        description: `Command '${ cmd.longName }' has option clash with general options for: ${ name }`,
      });
    }
    cmd.options[name] = opt;
  }

  // Internal: Parse one command string like "F, toFoo". Return an object like this
  // {
  //   longName: 'toFoo',
  //   shortName: 'F',
  // }
  function _parseCommandString( cmdString ) {
    let longName;
    let shortName;

    const tokens = cmdString.trim().split(/, */);
    switch (tokens.length) {
      case 1:
        // Must be "toFoo"
        longName = tokens[0];
        break;
      case 2:
        // Must be "F, toFoo"
        shortName = tokens[0];
        longName = tokens[1];
        break;
      default:
        throw new Error(`Invalid command description: ${ cmdString }`);
    }
    return {
      longName,
      shortName,
    };
  }

  // Internal: Parse one option string like "-f, --foo-bar <p>". Returns an object like this
  // {
  //   longName: '--foo-bar',
  //   shortName: '-f',
  //   optionName: 'fooBar', // or options.optionName if provided
  //   param: '<p>'
  //   valid
  // }
  function _parseOptionString( optString, options ) {
    let longName;
    let shortName;
    let param;

    // split at spaces (with optional preceding comma)
    const tokens = optString.trim().split(/,? +/);
    switch (tokens.length) {
      case 1:
        // Must be "--foo"
        if (isLongOption(tokens[0]))
          longName = tokens[0];

        break;
      case 2:
        // Could be "--foo <bar>", or "-f --foo"
        if (isLongOption(tokens[0]) && isParam(tokens[1])) {
          longName = tokens[0];
          param = tokens[1];
        }
        else if (isShortOption(tokens[0]) && isLongOption(tokens[1])) {
          shortName = tokens[0];
          longName = tokens[1];
        }
        break;
      case 3:
        // Must be "-f --foo <bar>"
        if (isShortOption(tokens[0]) && isLongOption(tokens[1]) && isParam(tokens[2])) {
          shortName = tokens[0];
          longName = tokens[1];
          param = tokens[2];
        }
        break;
      default:
        throw new Error(`Invalid option description, too many tokens: ${ optString }`);
    }
    if (!longName)
      throw new Error(`Invalid option description, missing long name: ${ optString }`);

    if (!param && options?.valid)
      throw new Error(`Option description has valid values but no param: ${ optString }`);

    if (options?.valid) {
      options.valid.forEach((value) => {
        if (typeof value !== 'string')
          throw new Error(`Valid values must be of type string: ${ optString }`);
      });
    }

    return {
      longName,
      shortName,
      optionName: options?.option ?? camelifyLongOption(longName),
      param,
      valid: options?.valid,
      isAlias: false, // default
    };
  }

  function makePositionalArgumentsOptional() {
    for (const arg of optionProcessor.positionalArguments || [])
      arg.required = false;

    for (const cmd in optionProcessor.commands) {
      for (const arg of optionProcessor.commands[cmd].positionalArguments || [])
        arg.required = false;
    }
  }

  // API: Let the option processor digest a command line 'argv'
  // The expectation is to get a commandline like this:
  //       $ node cdsc.js -x 1 --foo toXyz -y --bar-wiz bla arg1 arg2
  // Ignore: ^^^^^^^^^^^^
  // General options: ----^^^^^^^^^^
  // Command: -----------------------^^^^^
  // Command options: ---------------------^^^^^^^^^^^^^^^^
  // Arguments: ------------------------------------------- ^^^^^^^^^
  // Expect everything that starts with '-' to be an option, up to '--'.
  // Be tolerant regarding option placement: General options may also occur
  // after the command (but command options must not occur before the command).
  // Options may also appear after arguments. Report errors and resolve conflicts
  // under the assumption that placement was correct.
  // The return object should look like this:
  // {
  //   command: 'toXyz'
  //   options: {
  //     xInLongForm: 1,
  //     foo: true,
  //     toXyz: {
  //       yInLongForm: true,
  //       barWiz: 'bla',
  //     }
  //   },
  //   unknownOptions: [],
  //   args: {
  //     length: 4,
  //     foo: 'value1',
  //     bar: [ 'value2', 'value3', 'value4' ]
  //   },
  //   cmdErrors: [],
  //   errors: [],
  // }
  function processCmdLine( argv ) {
    const result = {
      command: undefined,
      options: { },
      unknownOptions: [],
      args: {
        length: 0,
      },
      cmdErrors: [],
      errors: [],
    };

    // Iterate command line
    let seenDashDash = false;
    // 0: "node", 1: filename
    for (let i = 2; i < argv.length; i++) {
      let arg = argv[i];
      // To be compatible with NPM arguments, we need to support `--arg=val` as well.
      if (arg.includes('=')) {
        argv = [ ...argv.slice(0, i), ...arg.split('='), ...argv.slice(i + 1) ];
        arg = argv[i];
      }

      if (arg === '--') {
        // No more options after '--'
        seenDashDash = true;
      }
      else if (!seenDashDash && arg.startsWith('--')) {
        i += processOption(i);
      }
      else if (!seenDashDash && arg.startsWith('-')) {
        splitSingleLetterOption(argv, i); // `-ab` -> `-a -b`
        i += processOption(i);
      }
      else if (result.command === undefined) { // Command or arg
        if (optionProcessor.commands[arg]) {
          // Found as command
          result.command = optionProcessor.commands[arg].longName;
          result.options[result.command] = {};
        }
        else {
          // Not found as command, take as arg and stop looking for commands
          processPositionalArgument(arg);
          result.command = null;
        }
      }
      else {
        processPositionalArgument(arg);
      }
    }
    // Avoid 'toXyz: {}' for command without options
    if (result.command && Object.keys(result.options[result.command]).length === 0)
      delete result.options[result.command];


    // Complain about first missing positional arguments
    const missingArg = getCurrentPositionArguments().find(arg => arg.required && !result.args[arg.name]);
    if (missingArg) {
      const forCommand = result.command ? ` for '${ result.command }'` : '';
      const errorMsg = `Missing positional argument${ forCommand }: <${ missingArg.name }${ missingArg.isDynamic ? '...' : '' }>`;
      if (forCommand)
        result.cmdErrors.push(errorMsg);
      else
        result.errors.push(errorMsg);
    }

    return result;

    /**
     * Specific commands may have custom positional arguments.
     * If the current one does, use it instead of the defaults.
     *
     * @returns {object[]} Array of positional argument configurations.
     */
    function getCurrentPositionArguments() {
      const cmd = optionProcessor.commands[result.command];
      return ( cmd && cmd.positionalArguments && cmd.positionalArguments.length )
        ? cmd.positionalArguments
        : optionProcessor.positionalArguments;
    }

    function processPositionalArgument( argumentValue ) {
      const argList = getCurrentPositionArguments();
      if ( result.args.length === 0 && argList.length === 0 )
        return;
      const inBounds = result.args.length < argList.length;
      const lastIndex = inBounds ? result.args.length : argList.length - 1;
      const nextUnsetArgument = argList[lastIndex];
      if (!inBounds && !nextUnsetArgument.isDynamic) {
        if (result.command)
          result.errors.push(`Too many arguments. '${ result.command }' expects ${ argList.length }`);
        else
          result.errors.push(`Too many arguments. Expected ${ argList.length }`);
        return;
      }
      result.args.length += 1;
      if (nextUnsetArgument.isDynamic) {
        result.args[nextUnsetArgument.name] = result.args[nextUnsetArgument.name] || [];
        result.args[nextUnsetArgument.name].push(argumentValue);
      }
      else {
        result.args[nextUnsetArgument.name] = argumentValue;
      }
    }

    // (Note that this works on 'argv' and 'result' from above).
    // Process 'argv[i]' as an option.
    // Check the option definition to see if a parameter is expected.
    // If so, take it (complain if one is found in 'argv').
    // Populate 'result.options' with the result. Return the number params found (0 or 1).
    function processOption( i ) {
      const arg = argv[i];
      let currentCommand = result.command;

      // First check top-level options
      let currentOption = optionProcessor.options[arg];
      if (currentCommand) {
        // If there is a command and it has an option that overrides it, use it instead.
        const cmdOpt = optionProcessor.commands[currentCommand].options[arg];
        if (cmdOpt)
          currentOption = cmdOpt;
        else if (currentOption)
          // Otherwise, if there exist a top-level option, set 'command' to null.
          currentCommand = null;
      }

      if (!currentOption)
        return reportUnknown();

      if (!currentOption.param) {
        setCurrentOption(true);
        return 0;
      }

      const param = paramForOption(currentOption);
      if (param === null)
        return 0;
      setCurrentOption(param);
      return 1;

      /**
       * Report that an option is unknown. If the option exists for other
       * commands or if the next argument looks like a param, return 1,
       * otherwise 0, indicating how many argv fields have been consumed.
       *
       * @returns {number}
       */
      function reportUnknown() {
        if (currentCommand)
          result.unknownOptions.push(`Unknown option "${ arg }" for the command "${ currentCommand }"`);
        else
          result.unknownOptions.push(`Unknown option "${ arg }"`);

        if (currentCommand) {
          // Not found at all.  We dig into the other cdsc commands in order to check if
          // the option expects a parameter and if so to take the next argument as a value
          const otherCmd = Object.keys(optionProcessor.commands).find(cmd => optionProcessor.commands[cmd].options[arg]);
          const otherCmdOpt = otherCmd && optionProcessor.commands[otherCmd].options[arg];
          if (otherCmdOpt && hasParamForUnknown(otherCmdOpt))
            return 1;
        }

        if (hasParamForUnknown(null))
          return 1;

        return 0;
      }

      function setCurrentOption( val ) {
        if (currentCommand) {
          if (!result.options[currentCommand])
            result.options[currentCommand] = {};
          result.options[currentCommand][currentOption.optionName] = val;
        }
        else {
          result.options[currentOption.optionName] = val;
        }
      }

      function reportMissingParam( opt ) {
        const short = opt.shortName ? `${ opt.shortName }, ` : '';
        let error = `Missing param "${ opt.param }" for option "${ short }${ opt.longName }"`;
        if (currentCommand) {
          error = `${ error } of command "${ currentCommand }"`;
          result.cmdErrors.push(error);
        }
        else {
          result.errors.push(error);
        }
      }

      function reportInvalidValue( opt, value ) {
        const shortOption = opt.shortName ? `${ opt.shortName }, ` : '';
        const errors = currentCommand ? result.cmdErrors : result.errors;
        errors.push(`Invalid value "${ value }" for option "${ shortOption }${ opt.longName }" - use one of [${ opt.valid }]`);
      }

      /**
       * Get the value for the option's parameter. If the option does not require one,
       * returns `null`. Reports missing parameters and invalid values.
       *
       * @returns {null|*}
       */
      function paramForOption( opt, reportMissing = true ) {
        if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
          if (reportMissing)
            reportMissingParam(opt);
          return null;
        }

        const value = argv[i + 1];
        if (!isValidOptionValue(opt, value) && reportMissing)
          reportInvalidValue(opt, value);

        return value;
      }

      /**
       * Returns true if:
       *  - we didn't find an option (opt === null) _or_
       *  - we found an option and it requires a param
       * _and_ if the next arg looks like an argument.
       *
       * @param {object|null} opt
       * @returns {boolean}
       */
      function hasParamForUnknown( opt ) {
        return ((!opt || opt.param) && (i + 1) < argv.length && !argv[i + 1].match('(^[.-])|[.](csn|cdl|cds|json)$'));
      }
    }
  }

  function isValidOptionValue( opt, value ) {
    // Explicitly convert to string, input 'value' may be boolean
    value = String(value);
    if (!opt.valid?.length)
      return true;
    if (opt.ignoreCase)
      return opt.valid.some( valid => valid.toLowerCase() === value.toLowerCase() );
    return opt.valid.includes(value);
  }
}

/**
 * Splits `-abc` into `-a -b -c`. Does this in-place on argv.
 *
 * @param {string[]} argv Argument array
 * @param {number} i Current option index.
 */
function splitSingleLetterOption( argv, i ) {
  const arg = argv[i];
  if (arg.length > 2) { // must be at least `-ab`.
    const rest = argv.slice(i + 1);
    argv.length = i; // trim array
    argv.push(...arg.split('').slice(1).map(a => `-${ a }`), ...rest);
  }
}

/**
 * Return a camelCase name "fooBar" for a long option "--foo-bar"
 */
function camelifyLongOption( opt ) {
  return opt.substring(2).replace(/-./g, s => s.substring(1).toUpperCase());
}

/**
 * Check if 'opt' looks like a "-f" short option
 */
function isShortOption( opt ) {
  return /^-[a-zA-Z?]$/.test(opt);
}

/**
 * Check if 'opt' looks like a "--foo-bar" long option
 */
function isLongOption( opt ) {
  return /^--[a-zA-Z0-9-]+$/.test(opt);
}

/**
 * Check if 'opt' looks like a "<foobar>" parameter
 */
function isParam( opt ) {
  return /^<[a-zA-Z-]+>$/.test(opt);
}

/**
 * Check if 'arg' looks like "<foobar...>"
 */
function isDynamicPositionalArgument( arg ) {
  return /^<[a-zA-Z-]+[.]{3}>$/.test(arg);
}

module.exports = {
  createOptionProcessor,
  isShortOption,
  isLongOption,
  isParam,
  isDynamicPositionalArgument,
};
