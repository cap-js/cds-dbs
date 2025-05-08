const AMQPWebhookMessaging = require('./AMQPWebhookMessaging')
const AMQPClient = require('./common-utils/AMQPClient.js')

const optionsMessaging = require('./message-queuing-utils/options-messaging.js')
const optionsManagement = require('./message-queuing-utils/options-management.js')
const authorizedRequest = require('./common-utils/authorizedRequest')

class MQManagement {
  constructor({ options, queueConfig, queueName, subscribedTopics, LOG }) {
    this.options = options
    this.queueConfig = queueConfig
    this.queueName = queueName
    this.subscribedTopics = subscribedTopics
    this.LOG = LOG
  }

  async getQueue(queueName = this.queueName) {
    this.LOG._info && this.LOG.info('Get queue', { queue: queueName })
    try {
      const res = await authorizedRequest({
        method: 'GET',
        uri: this.options.url,
        path: `/v1/management/queues/${encodeURIComponent(queueName)}`,
        oa2: this.options.auth.oauth2,
        target: { kind: 'QUEUE', queue: queueName },
        tokenStore: this
      })
      return res.body
    } catch (e) {
      const error = new Error(`Queue "${queueName}" could not be retrieved`)
      error.code = 'GET_QUEUE_FAILED'
      error.target = { kind: 'QUEUE', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async getQueues() {
    this.LOG._info && this.LOG.info('Get queues')
    try {
      const res = await authorizedRequest({
        method: 'GET',
        uri: this.options.url,
        path: `/v1/management/queues`,
        oa2: this.options.auth.oauth2,
        target: { kind: 'QUEUE' },
        tokenStore: this
      })
      return res.body && res.body.results
    } catch (e) {
      const error = new Error(`Queues could not be retrieved`)
      error.code = 'GET_QUEUES_FAILED'
      error.target = { kind: 'QUEUE' }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async createQueue(queueName = this.queueName) {
    this.LOG._info && this.LOG.info('Create queue', { queue: queueName })
    try {
      const queueConfig = this.queueConfig && { ...this.queueConfig }
      if (queueConfig?.deadMessageQueue)
        queueConfig.deadMessageQueue = queueConfig.deadMessageQueue.replace(/\$namespace/g, '')
      const res = await authorizedRequest({
        method: 'PUT',
        uri: this.options.url,
        path: `/v1/management/queues/${encodeURIComponent(queueName)}`,
        oa2: this.options.auth.oauth2,
        dataObj: queueConfig,
        tokenStore: this
      })
      if (res.statusCode === 201) return true
    } catch (e) {
      const error = new Error(`Queue "${queueName}" could not be created`)
      error.code = 'CREATE_QUEUE_FAILED'
      error.target = { kind: 'QUEUE', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async deleteQueue(queueName = this.queueName) {
    this.LOG._info && this.LOG.info('Delete queue', { queue: queueName })
    try {
      await authorizedRequest({
        method: 'DELETE',
        uri: this.options.url,
        path: `/v1/management/queues/${encodeURIComponent(queueName)}`,
        oa2: this.options.auth.oauth2,
        tokenStore: this
      })
    } catch (e) {
      const error = new Error(`Queue "${queueName}" could not be deleted`)
      error.code = 'DELETE_QUEUE_FAILED'
      error.target = { kind: 'QUEUE', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async getSubscriptions(queueName = this.queueName) {
    this.LOG._info && this.LOG.info('Get subscriptions', { queue: queueName })
    try {
      const res = await authorizedRequest({
        method: 'GET',
        uri: this.options.url,
        path: `/v1/management/queues/${encodeURIComponent(queueName)}/subscriptions/topics`,
        oa2: this.options.auth.oauth2,
        tokenStore: this
      })
      return res.body
    } catch (e) {
      const error = new Error(`Subscriptions for "${queueName}" could not be retrieved`)
      error.code = 'GET_SUBSCRIPTIONS_FAILED'
      error.target = { kind: 'SUBSCRIPTION', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async createSubscription(topicPattern, queueName = this.queueName) {
    this.LOG._info && this.LOG.info('Create subscription', { topic: topicPattern, queue: queueName })
    try {
      const res = await authorizedRequest({
        method: 'PUT',
        uri: this.options.url,
        path: `/v1/management/queues/${encodeURIComponent(queueName)}/subscriptions/topics/${encodeURIComponent(
          topicPattern
        )}`,
        oa2: this.options.auth.oauth2,
        tokenStore: this
      })
      if (res.statusCode === 201) return true
    } catch (e) {
      const error = new Error(`Subscription "${topicPattern}" could not be added to queue "${queueName}"`)
      error.code = 'CREATE_SUBSCRIPTION_FAILED'
      error.target = { kind: 'SUBSCRIPTION', queue: queueName, topic: topicPattern }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async deleteSubscription(topicPattern, queueName = this.queueName) {
    this.LOG._info && this.LOG.info('Delete subscription', { topic: topicPattern, queue: queueName })
    try {
      await authorizedRequest({
        method: 'DELETE',
        uri: this.options.url,
        path: `/v1/management/queues/${encodeURIComponent(queueName)}/subscriptions/topics/${encodeURIComponent(
          topicPattern
        )}`,
        oa2: this.options.auth.oauth2,

        target: { kind: 'SUBSCRIPTION', queue: queueName, topic: topicPattern },
        tokenStore: this
      })
    } catch (e) {
      const error = new Error(`Subscription "${topicPattern}" could not be deleted from queue "${queueName}"`)
      error.code = 'DELETE_SUBSCRIPTION_FAILED'
      error.target = { kind: 'SUBSCRIPTION', queue: queueName, topic: topicPattern }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async createQueueAndSubscriptions() {
    this.LOG._info && this.LOG.info(`Create messaging artifacts`)
    const created = await this.createQueue()
    if (!created) {
      // We need to make sure to only keep our own subscriptions
      const resGet = await this.getSubscriptions()
      if (resGet && resGet.results && Array.isArray(resGet.results)) {
        const existingSubscriptions = resGet.results.map(s => s.topic)
        const obsoleteSubs = existingSubscriptions.filter(s => !this.subscribedTopics.has(s))
        const additionalSubs = [...this.subscribedTopics]
          .map(kv => kv[0])
          .filter(s => !existingSubscriptions.some(e => s === e))
        await Promise.all([
          ...obsoleteSubs.map(s => this.deleteSubscription(s)),
          ...additionalSubs.map(t => this.createSubscription(t))
        ])
        return
      }
    }
    await Promise.all([...this.subscribedTopics].map(kv => kv[0]).map(t => this.createSubscription(t)))
  }

  waitUntilReady() {
    return this
  }
}

class MessageQueuing extends AMQPWebhookMessaging {
  async init() {
    await super.init()
    await this.getClient().connect()
  }

  prepareTopic(topic, inbound) {
    return super.prepareTopic(topic, inbound).replace(/\./g, '/')
  }

  getClient() {
    if (this.client) return this.client
    const optionsAMQP = optionsMessaging(this.options)
    this.client = new AMQPClient({
      optionsAMQP,
      prefix: { topic: 'topic://', queue: 'queue://' },
      service: this
    })
    return this.client
  }

  getManagement() {
    if (this.management) return this.management
    const _optionsManagement = optionsManagement(this.options)
    const queueConfig = this.queueConfig
    const queueName = this.queueName
    this.management = new MQManagement({
      options: _optionsManagement,
      queueConfig,
      queueName,
      subscribedTopics: this.subscribedTopics,
      LOG: this.LOG
    })
    return this.management
  }
}

module.exports = MessageQueuing
