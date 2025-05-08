const cds = require('../cds')
const MessagingService = require('./service.js')
const optionsApp = require('../common/utils/vcap.js')
const normalizeIncomingMessage = require('./common-utils/normalizeIncomingMessage')
const appId = require('./common-utils/appId')

class AMQPWebhookMessaging extends MessagingService {
  async init() {
    this.optionsApp = optionsApp
    if (this.options.queue) {
      const queueConfig = { ...this.options.queue }
      delete queueConfig.name
      if (Object.keys(queueConfig).length) this.queueConfig = queueConfig
    }
    this.queueName = this.prepareQueueName(
      (this.options.queue && this.options.queue.name) ||
        (this.options.credentials && this.options.credentials.namespace ? '$namespace/$appId' : '$appId')
    )

    cds.once('listening', () => {
      this.startListening()
    })

    return super.init()
  }

  async handle(msg) {
    if (msg.inbound) return super.handle(msg)
    const _msg = this.message4(msg)
    const client = this.getClient()
    await this.queued(() => {})()
    return client.emit(_msg)
  }

  prepareQueueName(queueName) {
    const queue = queueName.replace(/\$appId/g, appId())
    const namespace = (this.options.credentials && this.options.credentials.namespace) || ''
    return queue.replace(/\$namespace/g, namespace)
  }

  startListening(opt = {}) {
    if (!this._listenToAll.value && !this.subscribedTopics.size) return
    if (!opt.doNotDeploy) {
      const management = this.getManagement()
      this.queued(management.createQueueAndSubscriptions.bind(management))()
    }
    this.queued(this.listenToClient.bind(this))(async (_topic, _payload, _other, { done, failed }) => {
      const msg = Object.assign(normalizeIncomingMessage(_payload), _other || {})
      msg.event = _topic

      if (!msg._) msg._ = {}
      msg._.topic = _topic
      try {
        await this.processInboundMsg({ tenant: msg.tenant, _: msg._ }, msg)
        done()
      } catch (e) {
        // In case of AMQP and Solace, the `failed` callback must be called
        // with an error, otherwise there are problems with the redelivery count.
        failed(new Error('processing failed'))
        e.message = 'ERROR occurred in asynchronous event processing: ' + e.message
        this.LOG.error(e)
      }
    })
  }

  listenToClient(cb) {
    return this.getClient().listen(cb)
  }
}

module.exports = AMQPWebhookMessaging
