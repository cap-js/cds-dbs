/** @typedef {import('./cds.Service')} Service } */

const cds = require('../index')
const EventContext = require('../req/context')
class RootContext extends EventContext {
  static for(_) {
    if (_ instanceof EventContext) return _
    else return super.for(_,'as root')
  }
}
class NestedContext extends EventContext {
  static for(_) {
    if (_ instanceof EventContext) return _
    else return super.for(_)
  }
}


/**
 * This is the implementation of the `srv.tx(req)` method. It constructs
 * a new Transaction as a derivate of the `srv` (i.e. {__proto__:srv})
 * @returns { Promise<Transaction & Service> }
 * @param { EventContext } ctx
 */
module.exports = exports = function srv_tx (ctx,fn) { const srv = this

  if (srv.context) return srv // srv.tx().tx() -> idempotent
  if (!ctx) return RootTransaction.for (srv)

  // Creating root or nested txes for existing contexts
  if (typeof ctx === 'function') [ ctx, fn ] = [ undefined, ctx ]
  else if (ctx instanceof EventContext) {
    if (ctx.tx) return NestedTransaction.for (srv, ctx)
    else return RootTransaction.for (srv, ctx)
  }

  // Last arg may be a function -> srv.tx (tx => { ... })
  if (typeof fn === 'function') {
    const tx = RootTransaction.for (srv, ctx)
    return cds._context.run (tx, ()=> Promise.resolve(fn(tx)) .then (tx.commit, tx.rollback))
  }

  // REVISIT: following is for compatibility with AFC only -> we should get rid of that
  if (ctx._txed_before) return NestedTransaction.for (srv, ctx._txed_before)
  else Object.defineProperty (ctx, '_txed_before', { value: ctx = RootContext.for(ctx) })
  return RootTransaction.for (srv, ctx)
}


class Transaction {

  /**
   * Returns an already started tx for given srv, or creates a new instance
   */
  static for (srv, ctx) {
    const txs = ctx.context.transactions || ctx.context._set ('transactions', new Map)
    let tx = txs.get (srv)
    if (!tx) txs.set (srv, tx = new this (srv,ctx))
    return tx
  }

  /** @param {Service} srv */
  constructor (srv, ctx) {
    const tx = { __proto__:srv, _kind: new.target.name, context: ctx }
    const proto = new.target.prototype
    tx.commit   = proto.commit.bind(tx)
    tx.rollback = proto.rollback.bind(tx)
    if (srv.isExtensible) {
      const m = cds.context?.model
      if (m) tx.model = m
    }
    return _init(tx)
  }

  /**
   * In addition to srv.commit, sets the transaction to committed state,
   * in order to prevent continuous use without explicit reopen (i.e., begin).
   */
  async commit (res) {
    if (this.ready) { //> nothing to do if no transaction started at all
      if (this.__proto__.commit) await this.__proto__.commit.call (this,res)
      _init(this).ready = 'committed'
    }
    return res
  }

  /**
   * In addition to srv.rollback, sets the transaction to rolled back state,
   * in order to prevent continuous use without explicit reopen (i.e., begin).
   */
  async rollback (err) {
    // nothing to do if transaction already rolled back
    if (this.ready === 'rolled back') return

    /*
     * srv.on('error', function (err, req) { ... })
     * synchronous modification of passed error only
     * err is undefined if nested tx (cf. "root.before ('failed', ()=> this.rollback())")
     */
    // FIXME: with noa, this.context === cds.context and not the individual cds.Request
    if (err && this.handlers?._error) for (const each of this.handlers._error) each.handler.call(this, err, this.context)

    if (this.ready) { //> nothing to do if no transaction started at all
      // don't actually roll back if already committed (e.g., error thrown in on succeeded or on done)
      if (this.ready !== 'committed' && this.__proto__.rollback) await this.__proto__.rollback.call (this,err)
      _init(this).ready = 'rolled back'
    }
    if (err) throw err
  }

}


class RootTransaction extends Transaction {

  /**
   * Register the new transaction with the given context.
   * @param {EventContext} ctx
   */
  static for (srv, ctx) {
    ctx = RootContext.for (ctx?.tx?._done ? {} : ctx)
    return ctx.tx = super.for (srv, ctx)
  }

  /**
   * In addition to srv.commit, ensures all nested transactions
   * are informed by emitting 'succeeded' event to them all.
   */
  async commit (res) {
    try {
      await this.context.emit ('commit',res) //> allow custom handlers req.before('commit')
      await super.commit (res)
      this._done = 'committed'
      await this.context.emit ('succeeded',res)
      await this.context.emit ('done')
    } catch (err) {
      await this.rollback (err)
    }
    return res
  }

  /**
   * In addition to srv.rollback, ensures all nested transactions
   * are informed by emitting 'failed' event to them all.
   */
  async rollback (err) {
    // nothing to do if transaction already rolled back (we need to check here as well to not emit failed twice)
    if (this.ready === 'rolled back') return

    this._done = 'rolled back'
    try {
      await this.context.emit ('failed',err)
      await super.rollback (err)
    } finally {
      await this.context.emit ('done')
    }
    if (err) throw err
  }
}


class NestedTransaction extends Transaction {

  static for (srv,ctx) {
    ctx = NestedContext.for (ctx)
    return super.for (srv, ctx)
  }

  /**
   * Registers event listeners with the given context, to commit or rollback
   * when the root tx is about to commit or rollback.
   * @param {EventContext} ctx
   */
  constructor (srv,ctx) {
    super (srv,ctx)
    ctx.before ('succeeded', ()=> this.commit())
    ctx.before ('failed', ()=> this.rollback())
    if ('end' in srv) ctx.once ('done', ()=> srv.end())
  }

}


/**
 * Ensure the service's implementation of .begin is called appropriately
 * before any .dispatch.
 */
const _init = (tx) => {
  if ('begin' in tx) tx.dispatch = _begin
  else tx.ready = true //> to allow subclasses w/o .begin
  return tx
}
const _begin = async function (req) {
  if (!req.query && req.method === 'BEGIN') // IMPORTANT: !req.query is to exclude batch requests
    return this.ready = this.__proto__.dispatch.call (this,req)
  // Protection against unintended tx.run() after root tx.commit/rollback()
  if (this.ready === 'rolled back') throw exports._is_done (this.ready)
  if (this.ready === 'committed') throw exports._is_done (this.ready)
  if (!this.ready && this.context.tx._done) throw exports._is_done (this.context.tx._done)
  if (!this.ready) this.ready = this.begin().then(()=>true)
  await this.ready
  delete this.dispatch
  return this.dispatch (req)
}

exports._is_done = done => new cds.error (
  `Transaction is ${done}, no subsequent .run allowed, without prior .begin`,
  { code: 'TRANSACTION_CLOSED' }
)
