const cds = require('../../../cds')

const serviceHandler = require('./service')
const requiresHandler = require('./requires')
const readOnlyHandler = require('./readOnly')
const insertOnlyHandler = require('./insertOnly')
const capabilitiesHandler = require('./capabilities')
const autoexposeHandler = require('./autoexpose')
const restrictHandler = require('./restrict')
const restrictExpandHandler = require('./expand')

module.exports = cds.service.impl(function authorization() {
  // REVISIT: general approach to dependent auth:
  //          add restrictions to auth-dependent entities as if modeled to allow static access during request processing
  // // TODO: where to do?
  // // add restrictions to auth-dependent entities
  // const defs = this.model.definitions
  // const deps = []
  // for (const each of this.entities) {
  //   for (const k in each.compositions) {
  //     const c = each.compositions[k]
  //     const ct = defs[c.target]
  //     if (defs[ct?.elements.up_?.target] === each && !ct['@requires'] && !ct['@restrict']) {
  //       deps.push(c.target)
  //     }
  //   }
  // }
  // for (const each of deps) {
  //   const e = defs[each]
  //   let rstr
  //   let cur = defs[e.elements.up_.target]
  //   while (cur && !rstr) {
  //     rstr = cur['@requires'] || cur['@restrict']
  //     cur = defs[cur.elements.up_?.target]
  //   }
  //   if (rstr) {
  //     // TODO: normalize restriction to @restrict syntax
  //     // TODO: add rewrite paths in instance-based auth
  //     e['@restrict'] = rstr
  //   }
  // }

  // mark entities that depend on ancestor for auth with that ancestor
  const defs = this.model?.definitions
  for (const each of this.entities) {
    for (const k in each.compositions) {
      const c = each.compositions[k]
      const ct = defs[c.target]
      if (defs[ct?.elements.up_?.target] === each && !ct['@requires'] && !ct['@restrict']) {
        let rstr
        let cur = defs[ct.elements.up_.target]
        while (!rstr && cur) {
          if (cur['@requires'] || cur['@restrict']) rstr = cur
          cur = defs[cur.elements.up_?.target]
        }
        if (rstr) Object.defineProperty(ct, '_auth_depends_on', { value: rstr })
      }
    }
  }

  // service-level restrictions (not all requests are dispatched by protocol adapter with its early access check)
  // REVISIT cds^10: remove opt-out
  if (cds.env.features.service_level_restrictions !== false && this.definition) this.before('*', serviceHandler)

  /*
   * @requires
   */
  this.before('*', requiresHandler)

  /*
   * access control (cheaper than @restrict -> do first)
   */
  this.before('*', readOnlyHandler)
  this.before('*', insertOnlyHandler)
  this.before('*', capabilitiesHandler)
  this.before('*', autoexposeHandler)

  /*
   * @restrict
   */
  this.before('*', restrictHandler)

  /*
   * expand restrictions
   */
  this.before('READ', '*', restrictExpandHandler)
})
