const cds = require ('../../index')

/**
 * This is the central function to compile sources to CSN.
 * @param {string|string[]|{}} model one of:
 * - a single filename starting with 'file:'
 * - a single CDL source string
 * - an object with multiple CDL or CSN sources
 * - an array of one or more filenames
 * @param { _flavor | {flavor:_flavor, ...}} options
 * - an options object or a string specifying the flavor of CSN to generate
 * @param { 'inferred'|'xtended'|'parsed' } _flavor - for internal use only(!)
 * @returns {{ namespace?:string, definitions:{}, extensions?:[], meta:{ flavor:_flavor }}} CSN
 */
function cds_compile_to_csn (model, options, _flavor) {

  if (!model) throw cds.error (`Argument 'model' must be specified`)
  if (_is_csn(model) && _assert_flavor(model,_flavor,options)) return model   //> already parsed csn

  const o = _options4 (options,_flavor)
  const cwd = o.cwd || cds.root
  const files = _is_files (model,cwd)
  const cdsc = require ('../cdsc')
  if (files && o.sync) return _finalize (cdsc.compileSync(files,cwd,o))  //> compile files synchroneously
  if (files) return cdsc.compile(files,cwd,o) .then (_finalize)         //> compile files asynchroneously
  else return _finalize (cdsc.compileSources(model,o))                 //> compile CDL sources

  function _finalize (csn) {
    if (o.min) csn = cds.minify(csn)
    // REVISIT: experimental implementation to detect external APIs
    for (let each in csn.definitions) {
      const d = csn.definitions[each]
      if (d.kind === 'service' && cds.requires[each]?.external && (!o.mocked || cds.requires[each].credentials)) {
        Object.defineProperty (d,'@cds.external', { value: cds.requires[each].kind || true })
      }
    }
    if (!csn.meta) csn.meta = {}
    csn.meta.flavor = o.flavor
    return csn
  }
}


const _is_csn = (x) => (x.definitions || x.extensions) && !x.$builtins
const _is_files = (m,root) => {
  if (m === '*' || Array.isArray(m) || /^file:/.test(m) && (m = m.slice(5)))
    return cds.resolve(m,{root}) || cds.error ( `Couldn't find a CDS model for '${m}' in ${root||cds.root}`,{ code:'MODEL_NOT_FOUND', model: m })
}

const _assert_flavor = (m,_flavor,options) => {
  if (!m.meta) return true; const f = _flavor || _flavor4 (options)
  return !f || f === m.meta.flavor || cds.error (`cds.compile(...,{flavor:'${f}'}) called on csn with different meta.flavor='${m.meta.flavor}'`)
}
const _flavors = {
  'parsed':   { level:1, cdsc_options: { parseCdl:true } },
  'xtended':  { level:2, cdsc_options: { csnFlavor:'gensrc' } },
  'inferred': { level:3 },
}
const _flavor4 = (o) => {
  const f = typeof o === 'string' ? o : o && o.flavor
  return !f || f in _flavors ? f : cds.error (`Option 'flavor' must be one of ${Object.keys(_flavors)}; got: '${f}'`)
}

const _options4 = (_o, _flavor) => {
  const flavor = _flavor ? _flavor4(_flavor) : _flavor4(_o) || 'inferred'
  const spec = _flavors[flavor]
  const o = { ..._o, flavor, ...spec.cdsc_options, ...cds.env.cdsc, cdsHome: cds.home } // cdsHome is for the compiler resolving @sap/cds/... files
  if (o.docs) o.docComment = true
  if (o.locations) o.withLocations = true
  if (!o.messages) o.messages = []
  return o
}

module.exports = cds_compile_to_csn
