// TODO replace w/ common arg parser from node
module.exports = function _args4 (task, argv) {

  const { options:o=[], flags:f=[], shortcuts:s=[] } = task
  const _global = /^--(profile|production|sql|odata|build-.*|cdsc-.*|odata-.*|folders-.*)$/
  const _flags = { '--production':true }
  const options = {}, args = []
  let k,a, env = null

  if (argv.length) for (let i=0; i < argv.length; ++i) {
    if ((a = argv[i])[0] !== '-') args.push(a)
    else if ((k = s.indexOf(a)) >= 0) k < o.length ? add(o[k],argv[++i]) : add(f[k-o.length])
    else if ((k = o.indexOf(a)) >= 0) add(o[k],argv[++i])
    else if ((k = f.indexOf(a)) >= 0) add(f[k])
    else if (_global.test(a)) add_global(a, _flags[a] || argv[++i])
    else throw 'Invalid option: '+ a
  }
  // consistent production setting for NODE_ENV and CDS_ENV
  if (process.env.NODE_ENV !== 'production') { if (process.env.CDS_ENV?.split(',').includes('production')) process.env.NODE_ENV = 'production' }
  else process.env.CDS_ENV = Array.from(new Set([...process.env.CDS_ENV?.split(',') ?? [], 'production']))

  function add (k,v) { options[k.slice(2)] = v || true }
  function add_global (k,v='') {
    if (k === '--production') return process.env.CDS_ENV = Array.from(new Set([...process.env.CDS_ENV?.split(',') ?? [], 'production']))
    if (k === '--profile')    return process.env.CDS_ENV = Array.from(new Set([...process.env.CDS_ENV?.split(',') ?? [], ...v.split(',')]))
    if (k === '--odata') v = { flavor:v }
    let e=env || (env={}), path = k.slice(2).split('-')
    while (path.length > 1) { let p = path.shift(); e = e[p]||(e[p]={}) }
    add (k, e[path[0]] = v)
  }

  if (env) global.cds?.env.add (env)
  return [ args, options ]
}
