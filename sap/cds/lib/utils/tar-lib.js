const cds = require('../index'), { path, mkdirp } = cds.utils
const tar = require('tar')
const { Readable } = require('stream')
const cons = require('stream/consumers')

const _resolve = (...x) => path.resolve (cds.root,...x)

exports.create = async (root, ...args) => {  
  if (typeof root === 'string') root = _resolve(root)
  if (Array.isArray(root)) [ root, ...args ] = [ cds.root, root, ...args ]

  const options = {}
  if (args.includes('-z')) options.gzip = true
  const index = args.findIndex(el => el === '-f')
  if (index>=0) options.file = _resolve(args[index+1])
  options.cwd = root
    
  let dirs = []
  for (let i=0; i<args.length; i++) {
    if (args[i] === '-z' || args[i] === '-f') break
    if (Array.isArray(args[i])) args[i].forEach(a => dirs.push(_resolve(a)))
    else if (typeof args[i] === 'string') dirs.push(_resolve(args[i]))
  }
  if (!dirs.length) dirs.push(root)
  dirs = dirs.map(d => path.relative(root, d))
  
  const stream = await tar.c(options, dirs)

  return stream && await cons.buffer(stream) 
}

exports.extract = (archive, ...args) => ({
  async to (dest) {
    if (typeof dest === 'string') dest = _resolve(dest)
    const stream = Readable.from(archive)
    
    const options = { C: dest }
    if (args.includes('-z')) options.gzip = true

    return new Promise((resolve, reject) => {
        const tr = tar.x(options)
        stream.pipe(tr)
        tr.on('close', () => resolve())
        tr.on('error', e => reject(e))
    })
  }
})

const tar_ = exports
exports.c = tar_.create
exports.cz = (d,...args) => tar_.c (d, ...args, '-z')
exports.cf = (t,d,...args) => tar_.c (d, ...args, '-f',t)
exports.czf = (t,d,...args) => tar_.c (d, ...args, '-z', '-f',t)
exports.czfd = (t,...args) => mkdirp(path.dirname(t)).then (()=> tar_.czf (t,...args))
exports.x = tar_.xf = tar_.extract
exports.xz = tar_.xzf = a => tar_.x (a, '-z')
exports.xv = tar_.xvf = a => tar_.x (a)
exports.xvz = tar_.xvzf = a => tar_.x (a, '-z')
