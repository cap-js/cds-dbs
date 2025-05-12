// Custom resolve functionality for the CDS compiler
//
// See `internalDoc/ModuleResolution.md` for details on the algorithm.
// See also <https://cap.cloud.sap/docs/cds/cdl#model-resolution>.
// The algorithm is based on NodeJS's `require()`.
//
// For debugging purpose, if the option variable `options.traceFs` is set,
// we log file lookups.  This makes it easier to debug why a file was not
// found when setting custom search directories.
//
// You can set this option via your `.cdsrc.json` or `package.json`:
// `{ "cds": { "cdsc": { "traceFs": true } } }`.

'use strict';

const path = require('path');

const { cdsFs } = require('./file');

const DEFAULT_ENCODING = 'utf-8';

/**
 * Default lookup-extensions.  If a module "./index" is requested, then
 * "./index.cds" is checked first, then "index.csn" and so on.
 *
 * Keep in sync with documentation!
 */
const extensions = [ '.cds', '.csn', '.json' ];
/**
 * Default module-lookup directories.  Used when resolving modules.
 * Since version v4.2, this option can be configured.  Before that,
 * only node_modules/ was a valid module-lookup directory.
 *
 * @type {string[]}
 */
const defaultLookupDirectories = [ 'node_modules/' ];

/**
 * A global `cds.home` or local `options.cdsHome` configuration can be set that
 * forces the cds-compiler to use a certain directory for all @sap/cds/ includes.
 * This function handles such module paths.
 *
 * @param {string} modulePath
 * @param {CSN.Options} options
 * @returns {string}
 */
function adaptCdsModule( modulePath, options = {} ) {
  if (modulePath.startsWith( '@sap/cds/' )) {
    if (options.cdsHome)
      return options.cdsHome + modulePath.slice(8);
    // eslint-disable-next-line
    if (global['cds'] && global['cds'].home)
      // eslint-disable-next-line
      return global['cds'].home + modulePath.slice(8);
  }
  return modulePath;
}

/**
 * Create the module resolver, namely `resolveModule(dep)`.
 *
 * @param {CSN.Options} options
 * @param {object} fileCache
 * @param {object} messageFunctions
 */
function makeModuleResolver( options, fileCache, messageFunctions ) {
  const _fs = cdsFs(fileCache, options.traceFs);
  /** @type {ResolveConfig} */
  const opts = {
    extensions,
    isFile: _fs.isFile,
    readFile: _fs.readFile,
    realpath: _fs.realpathNative,
    lookupDirs: _getLookupDirectories( options, messageFunctions ),
  };

  return {
    resolveModule,
  };

  function resolveModule( dep ) {
    return new Promise( (fulfill, reject) => {
      const lookupPath = adaptCdsModule( dep.module, options );
      _resolveCDS( lookupPath, dep.basedir, opts, (err, res) => {
        // console.log('RESOLVE', dep, res, err)
        if (err) {
          reject(err);
        }
        else {
          const body = fileCache[res];
          if (body === undefined || body === true) { // use fs if no or just temp entry
            dep.absname = res;
            _fs.realpath( res, function realPathResult(realpathErr, modulePath) {
              if (realpathErr) {
                cb(realpathErr, modulePath);
              }
              else {
                _fs.realpathNative( res, function nativeRealPathResult(nativeErr, nativePath) {
                  if (!nativeErr)
                    checkFileCase( dep, modulePath, nativePath, messageFunctions );
                  // Pass the _native_ path to ensure that we use the actual
                  // file's path (include case-differences)
                  cb(realpathErr, nativePath);
                });
              }
            } );
          }
          else if (body && typeof body === 'object' && body.realname) {
            // dep.absname = body.realname;
            cb( null, body.realname ); // use fs.realpath name
          }
          else {
            // dep.absname = res;
            cb( null, res );
          }
        }
      });

      function cb( err, res ) {
        if (err) {
          reject(err);
        }
        else {
          if (dep.absname)
            fileCache[dep.absname] = (dep.absname === res) || { realname: res };
          dep.resolved = res;   // store in dep that module resolve was successful
          for (const from of dep.usingFroms)
            from.realname = res;
          fulfill(res);
        }
      }
    }).catch( () => {
      _errorFileNotFound(dep, options, messageFunctions);
      return false;
    });
  }
}


/**
 * Create the synchronous module resolver, namely `resolveModuleSync(dep)`.
 *
 * @param {CSN.Options} options
 * @param {object} fileCache
 * @param {object} messageFunctions
 */
function makeModuleResolverSync( options, fileCache, messageFunctions ) {
  const _fs = cdsFs(fileCache, options.traceFs);
  /** @type {ResolveConfig} */
  const opts = {
    extensions,
    isFile: _fs.isFileSync,
    readFile: _fs.readFileSync,
    realpath: _fs.realpathSyncNative,
    lookupDirs: _getLookupDirectories( options, messageFunctions ),
  };

  return {
    resolveModuleSync,
  };

  function resolveModuleSync( dep ) {
    let result = null;
    let error = null;
    const lookupPath = adaptCdsModule(dep.module, options);

    _resolveCDS( lookupPath, dep.basedir, opts, (err, res) => {
      if (err)
        error = err;
      if (res)
        result = res;
    });

    if (error) {
      _errorFileNotFound(dep, options, messageFunctions);
      return false;
    }

    const body = result ? fileCache[result] : undefined;
    if (body === undefined || body === true) { // use fs if no or just temp entry
      dep.absname = result;
      _fs.realpathSync( result, function realPathResult(realpathErr, modulePath) {
        if (realpathErr) {
          error = realpathErr;
        }
        else {
          _fs.realpathSyncNative( result, function nativeRealPathResult(nativeErr, nativePath) {
            if (nativeErr) {
              error = nativeErr;
            }
            else {
              checkFileCase(dep, modulePath, nativePath, messageFunctions);
              // Use the _native_ path to ensure that we use the actual
              // file's path (include case-differences)
              result = nativePath;
            }
          });
        }
      });
    }
    else if (body && typeof body === 'object' && body.realname) {
      result = body.realname;
    }

    if (error) {
      _errorFileNotFound(dep, options, messageFunctions);
      return false;
    }

    if (dep.absname)
      fileCache[dep.absname] = (dep.absname === result) || { realname: result };
    dep.resolved = result;   // store in dep that module resolve was successful
    for (const from of dep.usingFroms)
      from.realname = result;

    return result;
  }
}

/**
 * Get a list of module-lookup directories and ensure that user-provided lookup
 * directories match our expectations / validate them.
 *
 * In case of errors (e.g. invalid options), returns the default list.
 *
 * @param {CSN.Options} options
 * @param {object} messageFunctions
 * @return {string[]}
 */
function _getLookupDirectories( options, messageFunctions ) {
  const dirs = options?.moduleLookupDirectories || defaultLookupDirectories;

  if (!Array.isArray(dirs)) {
    messageFunctions.error('api-invalid-option', null, {
      '#': 'type',
      option: 'moduleLookupDirectories',
      value: 'string[]',
      othervalue: typeof options.moduleLookupDirectories,
    });
    return defaultLookupDirectories;
  }

  if (!dirs.includes('node_modules/')) {
    // Special case of call-side-errors and to ensure old behavior.
    dirs.push('node_modules/');
  }

  for (const dir of dirs) {
    if (!dir.endsWith('/')) {
      messageFunctions.error('api-invalid-lookup-dir', null, {
        '#': 'slash',
        option: 'moduleLookupDirectories',
        value: dir,
        othervalue: '/',
      } );
      return defaultLookupDirectories;
    }
    if (dir.startsWith('./') || dir.startsWith('../')) {
      // Avoid relative directories, as we don't want to give the impression that they
      // are resolved relative to the caller.
      messageFunctions.error('api-invalid-lookup-dir', null, {
        '#': 'relative',
        option: 'moduleLookupDirectories',
        value: dir,
        othervalue: './',
      });
      return defaultLookupDirectories;
    }
  }

  return dirs;
}

function _errorFileNotFound( dep, options, { error } ) {
  if (dep.resolved) {
    let resolved = path.relative( dep.basedir, dep.resolved );
    if (options.testMode)
      resolved = resolved.replace( /\\/g, '/' );
    for (const from of dep.usingFroms) {
      error( 'file-not-readable', from.location, { file: resolved },
             'Can\'t read file $(FILE)' );
    }
  }
  else if (isLocalFile( dep.module ) ) {
    for (const from of dep.usingFroms) {
      error( 'file-unknown-local', from.location, { file: dep.module },
             'Can\'t find local module $(FILE)' );
    }
  }
  else {
    const internal = /[\\/]/.test( dep.module ) && 'internal';
    for (const from of dep.usingFroms) {
      error( 'file-unknown-package', from.location,
             { file: dep.module, '#': internal }, {
               std: 'Can\'t find package $(FILE)',
               internal: 'Can\'t find package module $(FILE)',
             } );
    }
  }
}

/**
 * Resolve the given path according to NodeJS's rules for `require()`.
 *
 * We use the interface of the NodeJS package `resolve` for compatibility
 * with existing code.  This may change at a later point.
 *
 * @param {string} moduleName Module to load, e.g. `./Include.cds` or `@sap/cds/common`.
 * @param {ResolveConfig} config
 * @param {string} baseDir
 * @param {(err, result) => void} callback
 */
function _resolveCDS( moduleName, baseDir, config, callback ) {
  const isWindows = (process.platform === 'win32');
  let resolvedBaseDir = path.resolve(baseDir);
  const lookupDirs = [ ...config.lookupDirs ];

  // NodeJS does not preserve symbolic links when resolving modules.
  // So neither do we.
  config.realpath(resolvedBaseDir, (realPathErr, realPath) => {
    // There may be an error in resolving the symlink.
    // We ignore the error and simply use the original path.
    // Otherwise, cds-lsp tests would fail because they don't have real
    // files in their tests.
    if (!realPathErr)
      resolvedBaseDir = realPath;
    load();
  });

  function load() {
    if (isLocalFile(moduleName))
      loadFromLocalFileOrDirectory();
    else
      loadAsModule(resolvedBaseDir);
  }

  /**
   * The module is local and not a in a node_module directory.
   * Try to load it as a file or directory.
   */
  function loadFromLocalFileOrDirectory() {
    // Also handles absolute file paths.
    const withBase = path.resolve(resolvedBaseDir, moduleName);
    // If the local moduleName ends with a slash (or references the sub-directory)
    // it is a good indicator that we want to load a directory and we save some
    // file lookups.  Slashes cannot be used in filenames (both *nix and Windows).
    // Shortcut to 2b)
    if (moduleName === '..' || moduleName.endsWith('/'))
      loadAsDirectory(withBase, callback);
    else
      loadAsLocalFileOrDirectory(withBase, callback);
  }

  /**
   * Combines LOAD_AS_FILE() and LOAD_AS_DIRECTORY() from our specification.
   * If no file can be found, it tries to load the moduleName as a directory,
   * i.e. tries to load a `package.json`, etc.
   *
   * @param {string} absoluteModulePath
   * @param {(err, filepath: string|null) => void} cb
   */
  function loadAsLocalFileOrDirectory( absoluteModulePath, cb ) {
    loadAsFile(absoluteModulePath, (err, filepath) => {
      if (!err && filepath)
        cb(null, filepath);
      else
        loadAsDirectory(absoluteModulePath, cb);
    });
  }

  /**
   * Try to load the module from absoluteModulePath with different extensions.
   * Instead of the hard-coded extensions, we use the ones supplied by `options.extensions`.
   *
   * @param {string} absoluteModulePath
   * @param {(err, filepath: string|null) => void} cb
   */
  function loadAsFile( absoluteModulePath, cb ) {
    const extensionsToTry = [ '' ].concat(config.extensions);
    loadFileWithExtensions(extensionsToTry);

    /**
     * Tries to load `absoluteModulePath` with the given extensions one after another.
     *
     * @param {string[]} exts The extensions to try. Loaded in the order of the array.
     */
    function loadFileWithExtensions( exts ) {
      if (exts.length === 0) {
        // If we reach this point then no file with the given extensions could be found.
        cb(makeNotFoundError(), null);
        return;
      }
      const file = absoluteModulePath + exts.shift();
      config.isFile(file, (err, foundAndIsFile) => {
        if (!err && foundAndIsFile)
          cb(null, file);
        else
          loadFileWithExtensions(exts);
      });
    }
  }

  /**
   * Load the module as a directory, i.e. use either the main entry of `package.json`
   * in the directory or an index.ext file.
   *
   * @param {string} absoluteModulePath
   * @param {(err, filepath: string|null) => void} cb
   */
  function loadAsDirectory( absoluteModulePath, cb ) {
    loadAndParsePackageJsonInDirectory(absoluteModulePath, (packageErr, packageJson) => {
      const main = packageCdsMain(packageJson);
      if (!packageErr && main)
        loadMain(main);
      else
        loadIndex();
    });

    function loadMain( main ) {
      const file = path.join(absoluteModulePath, main);
      loadAsFile(file, (fileErr, filePath) => {
        if (!fileErr && filePath)
          cb(null, filePath);
        else
          loadIndex();
      });
    }

    function loadIndex() {
      const filename = 'index';
      const file = path.join(absoluteModulePath, filename);
      loadAsFile(file, (fileErr, filePath) => {
        if (!fileErr && filePath)
          cb(null, filePath);
        else
          cb(makeNotFoundError(), null);
      });
    }
  }

  /**
   * Try to load the module from a specified module-lookup directory such
   * as `node_modules/`.
   * Start at `absoluteDir` and go through all parent directories.
   *
   * @param {string} absoluteDir
   */
  function loadAsModule( absoluteDir ) {
    const dirGen = modulePaths(absoluteDir);
    loadNextDir();

    function loadNextDir() {
      const dir = dirGen.next();
      if (dir.done) {
        // We're at root
        callback(makeNotFoundError(), null);
        return;
      }
      const file = path.join(dir.value, moduleName);
      loadAsLocalFileOrDirectory(file, (err, filepath) => {
        if (!err && filepath)
          callback(null, filepath);
        else
          loadNextDir();
      });
    }
  }

  /**
   * Try to load the package.json from the given directory.
   * Is only successful if the file can be read and parsed by JSON.parse().
   *
   * @param {string} packageDir
   * @param {(err, json) => void} cb
   */
  function loadAndParsePackageJsonInDirectory( packageDir, cb ) {
    const file = path.join(packageDir, 'package.json');

    config.readFile(file, DEFAULT_ENCODING, (err, content) => {
      if (err) {
        cb(err, null);
        return;
      }
      try {
        const json = JSON.parse(content);
        cb(null, json);
      }
      catch (parseErr) {
        cb(parseErr, null);
      }
    });
  }

  /**
   * Get a list of all `node_modules` directories that MAY exist.
   * Starting from `absoluteStart` upwards until at root.
   *
   * @param {string} absoluteStart   *
   * @return {Generator<string>} Possible module directories for the given path.
   */
  function* modulePaths( absoluteStart ) {
    // Use platform-dependent separator.  All NodeJS `path` methods use the system's path separator.
    const parts = absoluteStart.split(path.sep);

    // If we're on *nix systems, the first part is just an empty string ''
    // because the path is absolute.  Re-add it here because `path.join()`
    // ignores empty segments which would result in a relative path.
    if (!isWindows && parts.length > 0 && parts[0] === '')
      parts[0] = '/';

    for (let i = parts.length - 1; i >= 0; i--) {
      for (let j = 0; j < lookupDirs.length; ++j) {
        const dir = lookupDirs[j];
        if (dir && path.isAbsolute(dir)) {
          // Only look up absolute paths once.
          lookupDirs[j] = null;
          yield dir;
        }
        else if (dir && parts[i] && !lookupDirs.includes(`${ parts[i] }/`)) {
          yield path.join(...parts.slice(0, i + 1), dir);
        }
      }
    }
  }

  /**
   * Create a not found error that can be passed to the caller.
   *
   * @returns {Error}
   */
  function makeNotFoundError() {
    const moduleError = new Error(`Can't find module '${ moduleName }' from '${ config.basedir }'`);
    // eslint-disable-next-line
    moduleError['code'] = 'MODULE_NOT_FOUND';
    return moduleError;
  }
}

/**
 * Returns true if the given module name is a local file.
 *
 * @param {string} moduleName
 */
function isLocalFile( moduleName ) {
  // Starts with or is equal to '..'
  // Starts with '/'
  // Starts with 'C:/' or 'C:\'
  return (/^(\.\.?(\/|$)|\/|(\w:)?[/\\])/).test(moduleName);
}

/**
 * Get the `cds.main` entry of the package.json
 * @param {object} pkg
 */
function packageCdsMain( pkg ) {
  if (pkg && pkg.cds && typeof pkg.cds.main === 'string')
    return pkg.cds.main;
  return null;
}

/**
 * Check if the given paths for case-differences.  If there are case differences
 * emit a warning.  This can happen on systems with case-insensitive file
 * systems.  As that is a hard-to-debug issue, we help the user by emitting
 * a corresponding warning.
 *
 * @param {object} dep
 * @param {string} realpath
 * @param {string} nativeRealpath
 * @param {object} messageFunctions
 */
function checkFileCase( dep, realpath, nativeRealpath, messageFunctions ) {
  if (realpath === nativeRealpath)
    return;
  if (realpath.toLowerCase() !== nativeRealpath.toLowerCase()) {
    // safe-guard: in case realpath() resolved symlinks more deeply or sockets/pipes were used,
    // which realpath.native() handles differently, don't report a possible false positive.
    return;
  }
  for (const using of dep.usingFroms) {
    const { warning } = messageFunctions;
    warning('file-unexpected-case-mismatch', [ using.location, using ], {},
            // eslint-disable-next-line @stylistic/js/max-len
            'The imported filename differs on the filesystem; ensure that capitalization matches the actual file\'s name');
  }
}

/**
 * @typedef {object} ResolveConfig
 * @property {string[]} lookupDirs
 *     Directories to look in for modules, e.g. node_modules/.
 * @property {string[]} extensions
 * @property {(path: string, callback: (err, foundAndIsFile: boolean) => void) => void} isFile
 * @property {(path: string, encoding: string, callback:
 *              (err, content: string) => void) => void} readFile
 * @property {(path: string, callback: (err, realpath: string) => void) => void} realpath
 *   used to read `package.json` files.
 */

module.exports = {
  makeModuleResolver,
  makeModuleResolverSync,
  // exported for unit tests
  _resolveCDS,
  _getLookupDirectories,
  isLocalFile,
  extensions,
};
