const cds = require('../cds')
const queued = require('./common-utils/queued')
const ExtendedModels = require('../../../lib/srv/srv-models')

const appId = require('./common-utils/appId')

const _topic = declared => declared['@topic'] || declared.name

// There's currently no mechanism to detect mocked services, this is the best we can do.
class MessagingService extends cds.Service {
  init() {
    // enables queued async operations (without awaiting)
    this.queued = queued()
    this.subscribedTopics = new Map()
    this._listenToAll = { value: false }
    this.LOG = cds.log(this.kind ? `${this.kind}|messaging` : 'messaging')
    // Only for one central `messaging` service, otherwise all technical services would register themselves
    if (this.name === 'messaging') {
      this._registeredServices = new Map()
      // listen for all subscriptions to declared events of remote, i.e. connected services
      cds.on('subscribe', (srv, event) => {
        const declared = srv.events[event]
        if (declared && srv.name in cds.requires && !srv.mocked) {
          // we register self-handlers for declared events, which are supposed
          // to be calles by subclasses calling this.dispatch on incoming events
          let registeredEvents = this._registeredServices.get(srv.name)
          if (!registeredEvents) {
            registeredEvents = new Set()
            this._registeredServices.set(srv.name, registeredEvents)
          }
          if (registeredEvents.has(event)) return
          registeredEvents.add(event)
          const topic = _topic(declared)
          this.on(topic, msg => {
            const { data, headers } = msg
            return srv.tx(msg).emit({ event, data, headers, __proto__: msg })
          })
        }
      })

      // forward all emits for all declared events of local, i.e. served services
      cds.on('serving', srv => {
        for (const declared of srv.events) {
          const event = declared.name.slice(srv.name.length + 1)
          // calls to srv.emit are forwarded to this.emit, which is expected to
          // be overwritten by subclasses to write events to message channel
          const topic = _topic(declared)
          srv.on(event, async msg => {
            const { data, headers } = msg
            const messaging = await cds.connect.to('messaging') // needed for potential outbox
            return messaging.tx(msg).emit({ event: topic, data, headers })
          })
        }
      })
    }

    const { on } = this
    this.on = function (...args) {
      if (Array.isArray(args[0])) {
        const [topics, ...rest] = args
        return topics.map(t => on.call(this, t, ...rest))
      }
      return on.call(this, ...args)
    }
    return super.init()
  }

  async handle(msg) {
    if (msg.inbound) {
      return super.handle(this.message4(msg))
    }
    return super.handle(msg)
  }

  async processInboundMsg(ctx, msg) {
    msg.inbound = true
    if (!cds.context) cds.context = {}
    if (ctx.tenant) cds.context.tenant = ctx.tenant
    if (!ctx.user) ctx.user = cds.User.privileged
    // this.tx expects cds.context.model
    if (cds.model && (cds.env.requires.extensibility || cds.env.requires.toggles))
      cds.context.model = await ExtendedModels.model4(ctx.tenant, ctx.features || {})
    const me = this.options.inboxed || this.options.inbox ? cds.queued(this) : this
    return await me.tx(ctx, tx => tx.emit(msg))
  }

  on(event, cb) {
    // save all subscribed topics (not needed for local-messaging)
    if (event !== '*') this.subscribedTopics.set(this.prepareTopic(event, true), event)
    else this._listenToAll.value = true
    return super.on(event, cb)
  }

  prepareTopic(topic, _inbound) {
    // In local messaging there's a 'short curcuit' so we must not modify the topic
    if (this.options.local) return topic
    let res = topic
    if (!_inbound && this.options.publishPrefix) res = this.options.publishPrefix + res
    if (_inbound && this.options.subscribePrefix) res = this.options.subscribePrefix + res
    res = res.replace(/\$appId/g, appId())
    return res
  }

  prepareHeaders(headers, event) {
    if (this.options.format === 'cloudevents') {
      if (!('id' in headers)) headers.id = cds.utils.uuid()
      if (!('type' in headers)) headers.type = event
      if (!('source' in headers)) headers.source = `/default/sap.cap/${process.pid}`
      if (!('time' in headers)) headers.time = new Date().toISOString()
      if (!('datacontenttype' in headers)) headers.datacontenttype = 'application/json'
      if (!('specversion' in headers)) headers.specversion = '1.0'
    }
  }

  message4(msg) {
    const _msg = { ...msg }
    if (!_msg.headers) _msg.headers = {}
    if (!_msg.inbound) {
      _msg.headers = { ..._msg.headers } // don't change the original object
      this.prepareHeaders(_msg.headers, _msg.event)
      _msg.event = this.prepareTopic(_msg.event, false)
    } else if (this.subscribedTopics) {
      const subscribedEvent =
        this.subscribedTopics.get(_msg.event) ||
        (this.wildcarded && this.subscribedTopics.get(this.wildcarded(_msg.event)))
      if (!subscribedEvent && !this._listenToAll.value) {
        const err = new Error(`No handler for incoming message with topic '${_msg.event}' found.`)
        err.code = 'NO_HANDLER_FOUND' // consumers might want to react to that
        throw err
      }

      _msg.event = subscribedEvent || _msg.event
    }
    return _msg
  }
}

module.exports = MessagingService
