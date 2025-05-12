const cdsc = require ('../cdsc')
const cds = require ('../../index')
const TRACE = cds.debug('trace')

if (cds.env.features.precompile_edms !== false) {
  const _precompiled = new WeakMap
  const to_edm = cdsc.to.edm
  cdsc.to.edm = Object.assign((csn, o) => {
    if (o.to === 'openapi') return to_edm(csn, o)
    if (!_precompiled.has(csn)) {
      if (!o.serviceNames) o = { ...o, serviceNames: cds.linked(csn).services.filter(d => 'odata' in d.protocols).map(d => d.name) }
      _precompiled.set(csn, cdsc.to.edm.all(csn, o))
    }
    return _precompiled.get(csn)[o.service]
  }, { all: cdsc.to.edm.all })
}


function cds_compile_to_edm (csn,_o) {
  const o = cdsc._options.for.edm(_o) //> used twice below...
  csn = _4odata(csn,o)
  TRACE?.time('cds.compile 2edm'.padEnd(22))
  try {
    let result, next = ()=> result = o.service === 'all' ? _many ('.json',
      cdsc.to.edm.all (csn,o), o.as === 'str' ? JSON.stringify : x=>x
    ) : cdsc.to.edm (csn,o)
    cds.emit ('compile.to.edmx', csn, o, next) // NOTE: intentionally using same event as for edmx
    return result ??= next() //> in case no handler called next
  }
  finally { TRACE?.timeEnd('cds.compile 2edm'.padEnd(22)) }
}


function cds_compile_to_edmx (csn,_o) {
  const o = cdsc._options.for.edm(_o) //> used twice below...
  csn = _4odata(csn,o)
  TRACE?.time('cds.compile 2edmx'.padEnd(22))
  try {
    let result, next = ()=> result ??= o.service === 'all' ? _many ('.xml',
      cdsc.to.edmx.all (csn,o)
    ) : cdsc.to.edmx (csn,o)
    cds.emit ('compile.to.edmx', csn, o, next)
    return next() //> in case no handler called next
  }
  finally { TRACE?.timeEnd('cds.compile 2edmx'.padEnd(22)) }
}



function _4odata (csn,o) {

  const services = cds.linked(csn).services
  if (services.length < 1) throw new Error (
    `There are no service definitions found at all in given model(s).`
  )

  if (!o.service && services.length > 1) throw new Error (`\n
    Found multiple service definitions in given model(s).
    Please choose by adding one of... \n
    -s all ${services.map (s => `\n    -s ${s.name}`).join('')}
  `)

  if (!o.service) {
    o.service = services[0].name
  } else if (o.service !== 'all') { // fetch first matching service
    const srv = services.find (s => s.name === o.service)
    if (!srv) throw new Error (
      `No service definition matching ${o.service} found in given model(s).`
    )
    o.service = srv.name
  }

  // o.service is specified now
  return cds.env.features.compile_to_edmx_compat ? cds.compile.for.odata(csn,o) : csn //> leave that to cdsc: cds.compile.for.odata(csn,o)
}


function* _many (suffix, all, callback = x=>x) {
  for (let file in all) yield [ callback(all[file]), { file, suffix } ]
}

module.exports = exports = cds_compile_to_edm
cds_compile_to_edm.x = cds_compile_to_edmx
if (cds.env.features.pre_compile_edmxs) {
  cds_compile_to_edmx.files = require('./edm-files')
} else {
  cds_compile_to_edmx.files = ()=> null
}
cds_compile_to_edmx.files.get = ()=> null
