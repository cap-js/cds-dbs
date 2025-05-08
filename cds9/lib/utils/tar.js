const child_process = require('child_process')
const spawn = /\btar\b/.test(process.env.DEBUG) ? (cmd, args, options) => {
  Error.captureStackTrace(spawn,spawn)
  process.stderr.write(cmd +' ', args.join(' ') +' '+ spawn.stack.slice(7) + '\n')
  return child_process.spawn(cmd, args, options)
} : child_process.spawn

const cds = require('../index'), { fs, path, mkdirp, exists, rimraf } = cds.utils
const _resolve = (...x) => path.resolve (cds.root,...x)

// tar does not work properly on Windows (by npm/jest tests) w/o this change
const win = path => {
  if (!path) return path
  if (typeof path === 'string') return path.replace('C:', '//localhost/c$').replace(/\\+/g, '/')
  if (Array.isArray(path)) return path.map(el => win(el))
}

async function copyDir(src, dest) {
  if ((await fs.promises.stat(src)).isDirectory()) {
    const entries = await fs.promises.readdir(src)
    return Promise.all(entries.map(async each => copyDir(path.join(src, each), path.join(dest, each))))
  } else {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })
    return fs.promises.copyFile(src, dest)
  }
}

// Copy resources containing files and folders to temp dir on Windows and pack temp dir.
// cli tar has a size limit on Windows.
const createTemp = async (root, resources) => {
  // Asynchronously copies the entire content from src to dest.
  const temp = await fs.promises.mkdtemp(`${fs.realpathSync(require('os').tmpdir())}${path.sep}tar-`)
  for (let resource of resources) {
    const destination = path.join(temp, path.relative(root, resource))
    if ((await fs.promises.stat(resource)).isFile()) {
      const dirName = path.dirname(destination)
      if (!await exists(dirName)) {
        await fs.promises.mkdir(dirName, { recursive: true })
      }
      await fs.promises.copyFile(resource, destination)
    } else {
      if (fs.promises.cp) {
        await fs.promises.cp(resource, destination, { recursive: true })
      } else {
        // node < 16
        await copyDir(resource, destination)
      }
    }
  }

  return temp
}

const tarInfo = async (info) => {
  let cmd, param
  if (info === 'version') {
    cmd = 'tar'
    param = ['--version']
  } else {
    cmd = process.platform === 'win32' ? 'where' : 'which'
    param = ['tar']
  }

  const c = spawn (cmd, param)

  return {__proto__:c,
    then (resolve, reject) {
      let data=[], stderr=''
      c.stdout.on('data', d => {
        data.push(d)
      })
      c.stderr.on('data', d => stderr += d)
      c.on('close', code => {
        code ? reject(new Error(stderr)) : resolve(Buffer.concat(data).toString().replace(/\n/g,'').replace(/\r/g,''))
      })
      c.on('error', reject)
    }
  }
}

const logDebugTar = async () => {
  const LOG = cds.log('tar')
  if (!LOG?._debug) return
  try {
    LOG (`tar path: ${await tarInfo('path')}`)
    LOG (`tar version: ${await tarInfo('version')}`)
  } catch (err) {
    LOG('tar error', err)
  }
}

/**
 * Creates a tar archive, to an in-memory Buffer, or piped to write stream or file.
 * @example ```js
 *  const buffer = await tar.c('src/dir')
 *  await tar.c('src/dir') .to (fs.createWriteStream('t.tar'))
 *  await tar.c('src/dir') .to ('t.tar')
 *  await tar.c('src/dir','-f t.tar *')
 * ```
 * @param {string} dir - the directory to archive, used as `cwd` for the tar process
 * @param {string} [args] - additional arguments passed to tar (default: `'*'`)
 * @param {string[]} [more] - more of such additional arguments like `args`
 * @example ```js
 *  // Passing additional arguments to tar
 *  tar.c('src/dir','-v *')
 *  tar.c('src/dir','-v -f t.tar *')
 *  tar.c('src/dir','-vf','t.tar','*')
 *  tar.c('src/dir','-vf','t.tar','file1','file2')
 * ```
 * @returns A `ChildProcess` as returned by [`child_process.spawn()`](
 * https://nodejs.org/api/child_process.html#child_processspawncommand-args-options),
 * augmented by two methods:
 * - `.then()` collects the tar output into an in-memory `Buffer`
 * - `.to()` is a convenient shortcut to pipe the output into a write stream
 */
exports.create = (dir='.', ...args) => {
  logDebugTar()
  if (typeof dir === 'string') dir = _resolve(dir)
  if (Array.isArray(dir)) [ dir, ...args ] = [ cds.root, dir, ...args ]

  let c, temp
  args = args.filter(el => el)
  if (process.platform === 'win32') {
    const spawnDir = (dir, args) => {
      if (args.some(arg => arg === '-f')) return spawn ('tar', ['c', '-C', win(dir), ...win(args)])
      else return spawn ('tar', ['cf', '-', '-C', win(dir), ...win(args)])
    }
    args.push('.')
    if (Array.isArray(args[0])) {
      c = createTemp(dir, args.shift()) .then (t => spawnDir(t,args))
    } else {
      c = spawnDir(dir, args)
    }
  } else {
    if (Array.isArray(args[0])) {
      args.push (...args.shift().map (f => path.isAbsolute(f) ? path.relative(dir,f) : f))
    } else {
      args.push('.')
    }

    c = spawn ('tar', ['c', '-C', dir, ...args], { env: { COPYFILE_DISABLE: 1 }})
  }

  return {__proto__:c, // returning a thenable + fluent ChildProcess...

    /**
     * Turns the returned `ChildProcess` into a thenable, resolving to an
     * in-memory Buffer holding the tar output, hence enabling this usage:
     * @example const buffer = await tar.c('src/dir')
     */
    then (resolve, reject) {
      let data=[], stderr=''
      c.stdout.on('data', d => data.push(d))
      c.stderr.on('data', d => stderr += d)
      c.on('close', code => code ? reject(new Error(stderr)) : resolve(Buffer.concat(data)))
      c.on('error', reject)
      if (process.platform === 'win32') {
        c.on('close', () => temp && exists(temp) && rimraf(temp))
        c.on('error', () => temp && exists(temp) && rimraf(temp))
      }
    },

    /**
     * Turns the returned `ChildProcess` into fluent API, allowing to pipe
     * the tar's `stdout` into a write stream. If the argument is a string,
     * it will be interpreted as a filename and a write stream opened on it.
     * In that case, more filenames can be specified which are path.joined.
     */
    to (out, ...etc) {
      if (typeof out === 'string') {
        // fs.mkdirSync(path.dirname(out),{recursive:true})
        out = fs.createWriteStream (_resolve(out,...etc))
      }
      // Returning a thenable ChildProcess.stdout
      return {__proto__: c.stdout.pipe (out),
        then (resolve, reject) {
          out.on('close', code => code ? reject(code) : resolve())
          c.on('error', reject)
        }
      }
    }
  }
}

/**
 * Extracts a tar archive, from an in-memory Buffer, or piped from a read stream or file.
 * @example ```js
 *  await tar.x(buffer) .to ('dest')
 *  await tar.x(fs.createReadStream('t.tar')) .to ('dest')
 *  await tar.x('t.tar') .to ('dest')
 *  await tar.x('t.tar','-C dest')
 * ```
 * @param {String|Buffer|ReadableStream} [archive] - the tar file or content to extract
 * @param {String[]} [args] - additional arguments passed to tar, .e.g. '-C dest'
 */
exports.extract = (archive, ...args) => ({

  /**
   * Fluent API method to actually start the tar x command.
   * @param  {...string} dest - path names to a target dir → get `path.resolved` from `cds.root`.
   * @returns A `ChildProcess` as returned by [`child_process.spawn()`](
   * https://nodejs.org/api/child_process.html#child_processspawncommand-args-options),
   * augmented by a method `.then()` to allow `await`ing finish.
   */
  to (...dest) {
    if (typeof dest === 'string') dest = _resolve(...dest)
    const input = typeof archive !== 'string' || archive == '-' ? '-' : _resolve(archive)
    const x = spawn('tar', ['xf', win(input), '-C', win(dest), ...args])
    if (archive === '-') return x.stdin
    if (Buffer.isBuffer(archive)) archive = require('stream').Readable.from (archive)
    if (typeof archive !== 'string') (archive.stdout || archive) .pipe (x.stdin)
    let stdout='', stderr=''
    x.stdout.on ('data', d => stdout += d)
    x.stderr.on ('data', d => stderr += d)
    return {__proto__:x,
      then (resolve, reject) {
        x.on('close', code => {
          if (code) return reject (new Error(stderr))
          if (process.platform === 'linux') stdout = stderr
          resolve (stdout ? stdout.split('\n').slice(0,-1).map(x => x.replace(/^x |\r/g,'')): undefined)
        })
        x.on('error', reject)
      }
    }
  },

  /**
   * Shortcut to extract to current working directory, i.e. `cds.root`,
   * or for this kind of usage:
   * @example await tar.x(...,'-C _out')
   * @returns `stdin` of the tar child process
   */
  then (r,e) { return this.to('.') .then(r,e) },

})


exports.list = (archive, ...more) => {
  const input = typeof archive !== 'string' ? '-' : archive === '-' ? archive : _resolve(archive)
  const x = spawn(`tar tf`, [ input, ...more ], { shell:true })
  let stdout='', stderr=''
  x.stdout.on ('data', d => stdout += d)
  x.stderr.on ('data', d => stderr += d)
  return {__proto__:x,
    then (resolve, reject) {
      x.on('close', code => code ? reject(new Error(stderr)) : resolve(stdout.split('\n').slice(0,-1)))
      x.on('error', reject)
    }
  }
}

// Common tar command shortcuts
const tar = exports
exports.c = tar.create
exports.cz = (d,...args) => tar.c (d, ...args, '-z')
exports.cf = (t,d,...args) => tar.c (d, ...args, '-f',t)
exports.czf = (t,d,...args) => tar.c (d, ...args, '-z', '-f',t)
exports.czfd = (t,...args) => mkdirp(path.dirname(t)).then (()=> tar.czf (t,...args))
exports.x = tar.xf = tar.extract
exports.xz = tar.xzf = (a,...args) => tar.x (a, ...args, '-z')
exports.xv = tar.xvf = (a,...args) => tar.x (a, ...args, '-v')
exports.xvz = tar.xvzf = (a,...args) => tar.x (a, ...args, '-v', '-z')
exports.t = tar.tf = tar.list

/**
 * Shortcut for that kind of usage:
 * @example fs.createReadStream('t.tar') .pipe (tar.x.to('dest/dir'))
 * @returns `stdin` of the tar child process
 */
 exports.extract.to = function (..._) { return this('-').to(..._) }



// ---------------------------------------------------------------------------------
// Compatibility...

exports.packTarArchive = (resources,d) => d ? tar.cz (d,resources) : tar.cz (resources)
exports.unpackTarArchive = (x,dir) => tar.xz(x).to(dir)
