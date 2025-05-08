
const cds = require ('..'), {fs} = cds.utils
const LOG = cds.log('serve|bindings',{label:'cds'})
const registry = '~/.cds-services.json'

class Bindings {

  provides = {}
  servers = {}
  #bound = {}

  then (r,e) {
    delete Bindings.prototype.then // only once per process
    cds.prependOnceListener ('connect', ()=> LOG.info ('connect using bindings from:', { registry }))
    cds.once('listening', server => this.export (cds.service.providers, server.url))
    return this.import() .then (r,e)
  }

  bind (service) {
    let required = cds.requires [service]
    let binding = this.provides [required?.service || service]
    if (binding) {
      // in case of cds.requires.Foo = { ... }
      if (typeof required === 'object') required.credentials = {
        ...required.credentials,
        ...binding.credentials
      }
      // in case of cds.requires.Foo = true
      else required = cds.requires[service] = {
        ...cds.requires.kinds [binding.kind],
        ...binding
      }
      // REVISIT: temporary fix to inherit kind as well for mocked odata services
      // otherwise mocking with two services does not work for kind:odata-v2
      if (required.kind === 'odata-v2' || required.kind === 'odata-v4') required.kind = 'odata'
    }
    return required
  }

  // used by cds.connect
  at (service) {
    return this.#bound [service] ??= this.bind (service)
  }

  get registry() {
    return Bindings.registry ??= registry.replace(/^~/, require('os').homedir())
  }

  async load (read = fs.promises.readFile) {
    LOG.debug ('reading bindings from:', registry)
    try {
      let src = read (this.registry)
      let {cds} = JSON.parse (src.then ? await src : src)
      Object.assign (this, cds)
    }
    catch { /* ignored */ }
    return this
  }

  async store (write = fs.promises.writeFile) {
    LOG.debug ('writing bindings to:', registry)
    const json = JSON.stringify ({ cds: this },null,'  ')
    return write (this.registry, json)
  }

  async import() {
    await this.load()
    for (let each in cds.requires) this.bind (each)
    return this
  }

  async export (services, url) {
    this.cleanup (url)
    const { servers, provides } = this, { pid } = process
    // register our server
    servers[pid] = {
      root: 'file://' + cds.root,
      url
    }
    // register our services
    for (let each of services) {
      // if (each.name in cds.env.requires)  continue
      const options = each.options || {}
      provides[each.name] = {
        kind: options.to || each.endpoints[0]?.kind || 'odata',
        credentials: {
          ...options.credentials,
          url: url + each.path
        },
        server: pid
      }
      // if (each.endpoints.length > 1)  provides[each.name].other = each.endpoints.slice(1).map(
      //   ep => ({ kind: ep.kind, url: url + ep.path })
      // )
    }
    process.on ('exit', ()=> this.purge())
    cds.on ('shutdown', ()=> this.purge())
    return this.store()
  }

  purge() {
    if (this.done) return;
    this.load (fs.readFileSync)
    LOG.debug ('purging bindings from:', registry)
    this.cleanup()
    this.store (fs.writeFileSync)
    this.done = true
  }

  /**
   * Remove all services served by this server or at the given url.
   */
  cleanup (url) {
    const { servers, provides } = this, { pid } = process
    for (let [key,srv] of Object.entries (provides))
      if (srv.server === pid || url && srv.credentials?.url?.startsWith(url)) delete provides [key]
    delete servers [pid.toString()]
    return this
  }
}

const {NODE_ENV} = process.env
if (NODE_ENV === 'test' || global.it || cds.env.no_bindings) {
  Object.defineProperty (module, 'exports', { value: { at: ()=> undefined }})
} else {
  module.exports = new Bindings
}
