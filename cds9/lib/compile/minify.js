const cds = require('../index')
const DEBUG = cds.debug('minify')

module.exports = function cds_minify (csn, roots = cds.env.features.skip_unused) {
  if (roots === false) return csn
  if ((csn.meta??={}).minified) return csn
  const all = csn.definitions, reached = new Set
  if (roots === 'services') {
    for (let n in all) if (all[n].kind === 'service') _visit_service(n)
  } else if (typeof roots === 'string') {
    _visit_service(roots)
  } else for (let n in all) {
    let d = all[n]
    if (d.kind === 'service') _visit_service(n)
    else if (d.kind === 'entity') {
      if (d['@cds.persistence.skip'] === 'if-unused') continue
      if (n.endsWith('.texts')) {
        let e = all[n.slice(0,-6)]
        if (e && e['@cds.persistence.skip'] === 'if-unused') continue
      }
      _visit(d)
    }
  }
  function _visit_service (service) {
    reached.add (all[service])
    for (let e in all) if (e.startsWith(service+'.')) _visit(all[e])
  }
  function _visit_query (q) {
    if (q.SELECT) return _visit_query (q.SELECT)
    if (q.SET) return q.SET.args.forEach (_visit_query)
    if (q.from) {
      if (q.from.join) return q.from.args.forEach (_visit)
      else return _visit (q.from)
    }
  }
  function _visit (d) {
    if (typeof d === 'string') {
      d = all[d]
      if (!d) return // builtins like cds.String
    } else if (d.ref) return d.ref.reduce((p,n) => {
      let d = (p.elements || all[p.target || p.type].elements)[n.id || n] // > n.id -> view with parameters
      if (d)  _visit(d)
      return d
    },{elements:all})
    if (reached.has(d)) return; else reached.add(d)
    if (d.includes)   d.includes.forEach(i => _visit(all[i]))  // Note: with delete d.includes, redirects in AFC broke
    if (d.projection)         _visit_query (d.projection)
    if (d.query)              _visit_query (d.query)
    if (d.type)               _visit (d.type)
    if (d.target)             _visit (d.target)
    if (d.targetAspect)       _visit (d.targetAspect)
    if (d.items)              _visit (d.items)
    if (d.returns)            _visit (d.returns)
    for (let e in d.elements) _visit (d.elements[e])
    for (let a in d.actions)  _visit (d.actions[a])
    for (let p in d.params)   _visit (d.params[p])
  }
  const minified = csn, less = minified.definitions = {}
  for (let n in all) if (reached.has(all[n])) less[n] = all[n]
  else DEBUG?.('skipping', all[n].kind, n)
  ;(minified.meta??={}).minified = true
  return minified
}
