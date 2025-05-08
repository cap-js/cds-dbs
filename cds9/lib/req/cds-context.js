const { AsyncLocalStorage } = require ('async_hooks')
const { EventEmitter } = require('events')
const { isSystemError } = require('../log/cds-error')
const EventContext = require('./context'), ec4 = v => {
  if (v instanceof EventContext || typeof v !== 'object') return v
  if (v.context) return v.context
  else return EventContext.for(v)
}

module.exports = new class extends AsyncLocalStorage {

  run(v,fn,...args) { return super.run (ec4(v),fn,...args) }
  enterWith(v) { return super.enterWith (ec4(v)) }

  spawn (o,fn, /** @type {import('../index')} cds */ cds=this) {
    if (typeof o === 'function') [fn,o] = [o,fn] //> for compatibility
    if (o instanceof EventContext) throw cds.error `The passed options must not be an instance of cds.EventContext.`
    const fx = ()=>{
      const tx = cds.tx({...o}) // create a new detached transaction for each run of the background job
      return cds._context.run (tx, async ()=> {
        // REVISIT: The model must be set _after_ run to make sure that cds.context.tenant is correctly set.
        //          Otherwise, `model4` could query the wrong database to check for extensions.
        if (cds.model && (cds.env.requires.extensibility || cds.env.requires.toggles)) {
          const ctx = cds.context
          const ExtendedModels = require('../srv/srv-models') // the sentinel is automatically started when required
          cds.context.model = await ExtendedModels.model4(ctx.tenant, ctx.features)
          tx.model = cds.context.model
        }
        return Promise.resolve(fn(tx))
        .then (tx.commit, e => {
          cds.log().error(`ERROR occurred in background job:`, e)
          return tx.rollback(e)
        })
        .then (res => Promise.all(em.listeners('succeeded').map(each => each(res))))
        .catch (err => Promise.all(em.listeners('failed').map(each => each(err))))
        .finally (() => Promise.all(em.listeners('done').map(each => each())))
      })
    }
    const em = new EventEmitter
    em.timer = (
      o?.every ? setInterval(fx, o.every) :
      o?.after ? setTimeout(fx, o.after) :
      setImmediate(fx)
    ).unref()
    em.on('failed', e => {
      if (isSystemError(e) && cds.env.server.shutdown_on_uncaught_errors)
        return cds.shutdown(e)
    })
    return em
  }
}
