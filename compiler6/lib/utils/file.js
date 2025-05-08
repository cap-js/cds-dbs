// Util functions for operations usually used with files.

'use strict';

const fs = require('fs');
const util = require('util');
const path = require('path');
const os = require('os');

/**
 * Split the given source string into its lines.  Respects Unix,
 * Windows and Macintosh line breaks.
 *
 * @param {string} src
 * @returns {string[]}
 */
function splitLines( src ) {
  return src.split(/\r\n?|\n/);
}

/**
 * Returns the file's normalized extension, e.g. for `file.CDS` -> `cds`
 * Returns null if the given filename is not a string.
 *
 * @param filename
 * @returns {null|string}
 */
function fileExtension( filename ) {
  if (typeof filename === 'string')
    return path.extname( filename ).slice(1).toLowerCase();
  return null;
}

/**
 * Create a temporary file path using the system's temporary folder and a filename
 * consisting of the given name/extension and a random string.
 *
 * @param {string} name
 * @param {string} extension
 * @returns {string}
 */
function tmpFilePath( name, extension ) {
  const crypto = require('crypto');
  const id = crypto.randomBytes(32).toString('hex');
  const filename = `${ name }-${ id }.${ extension }`;
  return path.join(os.tmpdir(), filename);
}

/**
 * Read input from the given stream.
 * See https://nodejs.org/api/stream.html#readablereadsize
 *
 * @returns {Promise<string>}
 */
function readStream( stream ) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const listeners = {
      __proto__: null,
      data: onData,
      error: onError,
      end: onEnd,
    };
    for (const name in listeners)
      stream.on(name, listeners[name]);

    function onData( chunk ) {
      chunks.push(chunk);
    }

    function onEnd() {
      removeListeners();
      resolve(chunks.join(''));
    }

    function onError( error ) {
      removeListeners();
      reject(error);
    }

    function removeListeners() {
      for (const name in listeners)
        stream.removeListener(name, listeners[name]);
    }
  });
}

/**
 * Returns filesystem utils readFile(), isFile(), realpath() for _CDS_ usage.
 * This includes a trace as well as usage of a file cache.
 *
 * Note: The synchronous versions accept a callback instead of being async (duh!), which
 *       is executed immediately! This is different from NodeJS's readFileSync()!
 *       This is done to allow using it in places where fs.readFile (async) is used.
 *
 * @param {object} fileCache
 * @param {boolean} enableTrace
 */
function cdsFs( fileCache, enableTrace ) {
  const readFile = _wrapReadFileCached(fs.readFile);
  const readFileSync = _wrapReadFileCached((filename, enc, cb) => {
    try {
      cb(null, fs.readFileSync( filename, { encoding: enc } ));
    }
    catch (err) {
      cb(err, null);
    }
  });
  const isFile = _wrapIsFileCached(fs.stat);
  const isFileSync = _wrapIsFileCached(( filename, cb) => {
    try {
      cb(null, fs.statSync( filename ));
    }
    catch (err) {
      cb( err, null );
    }
  });

  return {
    /** @type {function(string, string)} */
    readFileAsync: util.promisify( readFile ),
    readFile,
    readFileSync,
    isFile,
    isFileSync,
    realpath: fs.realpath,
    realpathNative: fs.realpath.native,
    realpathSync,
    realpathSyncNative,
  };


  function realpathSync( filepath, cb ) {
    try {
      cb(null, fs.realpathSync(filepath));
    }
    catch (err) {
      cb(err, null);
    }
  }

  function realpathSyncNative( filepath, cb ) {
    try {
      cb(null, fs.realpathSync.native(filepath));
    }
    catch (err) {
      cb(err, null);
    }
  }

  /**
   * Wraps the given reader into a cached environment including a trace.
   * The given @p reader must have the same signature as fs.readFile.
   *
   * @param {(filename: string, enc, cb: (err, data) => void) => void} reader
   */
  function _wrapReadFileCached( reader ) {
    return (filename, enc, cb) => {
      if (typeof enc === 'function') { // moduleResolve uses old-style API
        cb = enc;
        enc = null;
      }
      let body = fileCache[filename];
      if (body && typeof body === 'object' && body.realname) {
        filename = body.realname; // use fs.realpath.native name
        body = fileCache[filename];
      }
      if (body !== undefined && body !== true) { // true: we just know it is there
        if (body === false) {
          body = new Error( `ENOENT: no such file or directory, open '${ filename }'`);
          body.code = 'ENOENT';
          body.errno = -2;
          body.syscall = 'open';
          body.path = filename;
        }
        if (body && body.stack && body.message) {
          // NOTE: checks for instanceof Error are not reliable if error
          //       created in different execution env
          traceFS( 'READFILE:cache-err:', filename, body.message );
          cb( body );   // no need for process.nextTick( cb, body ) with moduleResolve
        }
        else {
          traceFS( 'READFILE:cache:    ', filename, body );
          cb( null, body );
        }
      }
      else {
        traceFS( 'READFILE:start:    ', filename );
        // TODO: set cache directly to some "delay" - store error differently?
        // e.g. an error of callback functions!
        try {
          reader(filename, enc, (err, data) => {
            fileCache[filename] = err || data;
            traceFS('READFILE:data:     ', filename, err || data);
            cb(err, data);
          });
        }
        catch (err) {
          cb(err); // if filename is not a valid (e.g. contains NUL byte), readFile() may throw
        }
      }
    };
  }

  /**
   * Wraps the given fsStat into a cached environment including a trace.
   * The given @p fsStat must have the same signature as fs.stat.
   *
   * @param {(filename: string, cb: (err, data) => void) => void} fsStat
   */
  function _wrapIsFileCached( fsStat ) {
    return ( filename, cb ) => {
      let body = fileCache[filename];
      if (body !== undefined) {
        traceFS( 'ISFILE:cache:      ', filename, body );
        if (body instanceof Error)
          cb( body );   // no need for process.nextTick( cb, body ) with moduleResolve
        else // body could be empty string
          cb( null, !!body || typeof body === 'string');
      }
      else {
        traceFS( 'ISFILE:start:      ', filename, body );
        // in the future (if we do module resolve ourselves with just readFile),
        // we avoid parallel readFile by storing having an array of `cb`s in
        // fileCache[ filename ] before starting fs.readFile().
        try {
          fsStat(filename, (err, stat) => {
            if (err)
              body = (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? false : err;
            else
              body = !!(stat.isFile() || stat.isFIFO());
            if (fileCache[filename] === undefined) // parallel readFile() has been processed
              fileCache[filename] = body;
            traceFS('ISFILE:data:       ', filename, body);
            if (body instanceof Error)
              cb(err);
            else
              cb(null, body);
          });
        }
        catch (err) {
          cb(err); // if filename is not a valid (e.g. contains NUL byte), fsStat() may throw
        }
      }
    };
  }

  function traceFS( intro, filename, data ) {
    if (!enableTrace)
      return;

    if (typeof data === 'string' || data instanceof Buffer)
      data = typeof data;
    else if (data === undefined)
      data = '?';
    else
      data = `${ data }`;

    // eslint-disable-next-line no-console
    console.log( intro, filename, data);
  }
}

module.exports = {
  splitLines,
  readStream,
  fileExtension,
  tmpFilePath,
  cdsFs,
};
