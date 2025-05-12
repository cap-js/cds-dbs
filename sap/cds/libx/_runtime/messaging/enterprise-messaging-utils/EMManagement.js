const authorizedRequest = require('../common-utils/authorizedRequest')
const sleep = require('util').promisify(setTimeout)

const _getWebhookName = queueName => queueName

// REVISIT: Maybe use `error` definitions as in req.error?

class EMManagement {
  constructor({
    optionsManagement,
    queueConfig,
    queueName,
    optionsMessagingREST,
    optionsWebhook,
    path,
    optionsApp,
    subscribedTopics,
    maxRetries,
    subdomain,
    namespace,
    LOG
  }) {
    this.subdomain = subdomain
    this.options = optionsManagement
    this.queueConfig = queueConfig
    this.queueName = queueName
    this.optionsMessagingREST = optionsMessagingREST
    this.optionsWebhook = optionsWebhook
    this.path = path
    this.optionsApp = optionsApp
    this.subscribedTopics = subscribedTopics
    this.maxRetries = maxRetries === undefined ? 10 : maxRetries
    this.subdomainInfo = this.subdomain ? `(subdomain: ${this.subdomain})` : ''
    this.namespace = namespace
    this.LOG = LOG
  }
  async getQueue(queueName = this.queueName) {
    this.LOG._info &&
      this.LOG.info(
        'Get queue',
        this.subdomain ? { queue: queueName, subdomain: this.subdomain } : { queue: queueName }
      )
    try {
      const res = await authorizedRequest({
        method: 'GET',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/queues/${encodeURIComponent(queueName)}`,
        oa2: this.options.oa2,
        tokenStore: this
      })
      return res.body
    } catch (e) {
      const error = new Error(`Queue "${queueName}" could not be retrieved ${this.subdomainInfo}`)
      error.code = 'GET_QUEUE_FAILED'
      error.target = { kind: 'QUEUE', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async getQueues() {
    this.LOG._info && this.LOG.info('Get queues', this.subdomain ? { subdomain: this.subdomain } : {})
    try {
      const res = await authorizedRequest({
        method: 'GET',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/queues`,
        oa2: this.options.oa2,
        tokenStore: this
      })
      return res.body
    } catch (e) {
      const error = new Error(`Queues could not be retrieved ${this.subdomainInfo}`)
      error.code = 'GET_QUEUES_FAILED'
      error.target = { kind: 'QUEUE' }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async createQueue(queueName = this.queueName) {
    this.LOG._info &&
      this.LOG.info(
        'Create queue',
        this.subdomain ? { queue: queueName, subdomain: this.subdomain } : { queue: queueName }
      )
    try {
      const queueConfig = this.queueConfig && { ...this.queueConfig }
      if (queueConfig?.deadMsgQueue)
        queueConfig.deadMsgQueue = queueConfig.deadMsgQueue.replace(/\$namespace/g, this.namespace)
      const res = await authorizedRequest({
        method: 'PUT',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/queues/${encodeURIComponent(queueName)}`,
        oa2: this.options.oa2,
        dataObj: queueConfig,
        tokenStore: this
      })
      if (res.statusCode === 201) return true
    } catch (e) {
      const error = new Error(`Queue "${queueName}" could not be created ${this.subdomainInfo}`)
      error.code = 'CREATE_QUEUE_FAILED'
      error.target = { kind: 'QUEUE', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async deleteQueue(queueName = this.queueName) {
    this.LOG._info &&
      this.LOG.info(
        'Delete queue',
        this.subdomain ? { queue: queueName, subdomain: this.subdomain } : { queue: queueName }
      )
    try {
      await authorizedRequest({
        method: 'DELETE',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/queues/${encodeURIComponent(queueName)}`,
        oa2: this.options.oa2,
        tokenStore: this
      })
    } catch (e) {
      const error = new Error(`Queue "${queueName}" could not be deleted ${this.subdomainInfo}`)
      error.code = 'DELETE_QUEUE_FAILED'
      error.target = { kind: 'QUEUE', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async getSubscriptions(queueName = this.queueName) {
    this.LOG._info &&
      this.LOG.info(
        'Get subscriptions',
        this.subdomain ? { queue: queueName, subdomain: this.subdomain } : { queue: queueName }
      )
    try {
      const res = await authorizedRequest({
        method: 'GET',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/queues/${encodeURIComponent(queueName)}/subscriptions`,
        oa2: this.options.oa2,
        target: { kind: 'SUBSCRIPTION', queue: queueName },
        tokenStore: this
      })
      return res.body
    } catch (e) {
      const error = new Error(`Subscriptions for "${queueName}" could not be retrieved ${this.subdomainInfo}`)
      error.code = 'GET_SUBSCRIPTIONS_FAILED'
      error.target = { kind: 'SUBSCRIPTION', queue: queueName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async createSubscription(topicPattern, queueName = this.queueName) {
    this.LOG._info &&
      this.LOG.info(
        'Create subscription',
        this.subdomain
          ? { topic: topicPattern, queue: queueName, subdomain: this.subdomain }
          : { topic: topicPattern, queue: queueName }
      )
    try {
      const res = await authorizedRequest({
        method: 'PUT',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/queues/${encodeURIComponent(
          queueName
        )}/subscriptions/${encodeURIComponent(topicPattern)}`,
        oa2: this.options.oa2,
        tokenStore: this
      })
      if (res.statusCode === 201) return true
    } catch (e) {
      const error = new Error(
        `Subscription "${topicPattern}" could not be added to queue "${queueName}" ${this.subdomainInfo}`
      )
      error.code = 'CREATE_SUBSCRIPTION_FAILED'
      error.target = { kind: 'SUBSCRIPTION', queue: queueName, topic: topicPattern }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async deleteSubscription(topicPattern, queueName = this.queueName) {
    this.LOG._info &&
      this.LOG.info(
        'Delete subscription',
        this.subdomain
          ? { topic: topicPattern, queue: queueName, subdomain: this.subdomain }
          : { topic: topicPattern, queue: queueName }
      )
    try {
      await authorizedRequest({
        method: 'DELETE',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/queues/${encodeURIComponent(
          queueName
        )}/subscriptions/${encodeURIComponent(topicPattern)}`,
        oa2: this.options.oa2,
        tokenStore: this
      })
    } catch (e) {
      const error = new Error(
        `Subscription "${topicPattern}" could not be deleted from queue "${queueName}" ${this.subdomainInfo}`
      )
      error.code = 'DELETE_SUBSCRIPTION_FAILED'
      error.target = { kind: 'SUBSCRIPTION', queue: queueName, topic: topicPattern }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async getWebhook(queueName = this.queueName) {
    const webhookName = _getWebhookName(queueName)
    this.LOG._info &&
      this.LOG.info(
        'Get webhook',
        this.subdomain
          ? { webhook: webhookName, queue: queueName, subdomain: this.subdomain }
          : { webhook: webhookName, queue: queueName }
      )
    try {
      const res = await authorizedRequest({
        method: 'GET',
        uri: this.optionsMessagingREST.uri,
        path: `/messagingrest/v1/subscriptions/${encodeURIComponent(webhookName)}`,
        oa2: this.optionsMessagingREST.oa2,
        tokenStore: this
      })
      return res.body
    } catch (e) {
      const error = new Error(`Webhook "${webhookName}" could not be retrieved ${this.subdomainInfo}`)
      error.code = 'GET_WEBHOOK_FAILED'
      error.target = { kind: 'WEBHOOK', queue: queueName, webhook: webhookName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async createWebhook(queueName = this.queueName) {
    const webhookName = _getWebhookName(queueName)
    this.LOG._info &&
      this.LOG.info(
        'Delete webhook',
        this.subdomain
          ? { webhook: webhookName, queue: queueName, subdomain: this.subdomain }
          : { webhook: webhookName, queue: queueName }
      )
    try {
      await authorizedRequest({
        method: 'DELETE',
        uri: this.optionsMessagingREST.uri,
        path: `/messagingrest/v1/subscriptions/${encodeURIComponent(webhookName)}`,
        oa2: this.optionsMessagingREST.oa2,
        tokenStore: this
      })
    } catch (e) {
      const error = new Error(`Webhook "${webhookName}" could not be deleted ${this.subdomainInfo}`)
      error.code = 'DELETE_WEBHOOK_FAILED'
      error.target = { kind: 'WEBHOOK', queue: queueName, webhook: webhookName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
    const pushConfig = {
      type: 'webhook',
      endpoint: this.optionsApp.appURL + this.path,
      exemptHandshake: false,
      defaultContentType: 'application/json'
    }

    // Use credentials from Enterprise Messaging.
    // For it to work, you'll need to add scopes in your
    // xs-security.json:
    //
    // scopes: [{
    //   "name": "$XSAPPNAME.em",
    //   "description": "EM Callback Access",
    //   "grant-as-authority-to-apps": ["$XSSERVICENAME(messaging-name)"]
    // }]

    if (this.optionsMessagingREST.oa2.mTLS) {
      pushConfig.securitySchema = {
        type: 'oauth2-x509',
        grantType: 'client_credentials',
        clientId: this.optionsMessagingREST.oa2.client,
        certificate: this.optionsMessagingREST.oa2.mTLS.cert,
        key: this.optionsMessagingREST.oa2.mTLS.key,
        tokenUrl: this.optionsMessagingREST.oa2.endpoint
      }
    } else {
      pushConfig.securitySchema = {
        type: 'oauth2',
        grantType: 'client_credentials',
        clientId: this.optionsMessagingREST.oa2.client,
        clientSecret: this.optionsMessagingREST.oa2.secret,
        tokenUrl: this.optionsMessagingREST.oa2.endpoint // this is the changed tokenUrl
      }
    }

    const dataObj = {
      name: webhookName,
      address: `queue:${queueName}`,
      qos: 1,
      ...(this.optionsWebhook || {}),
      pushConfig: { ...pushConfig, ...((this.optionsWebhook && this.optionsWebhook.pushConfig) || {}) }
    }

    this.LOG._info &&
      this.LOG.info(
        'Create webhook',
        this.subdomain
          ? { webhook: webhookName, queue: queueName, subdomain: this.subdomain }
          : { webhook: webhookName, queue: queueName }
      )
    try {
      const res = await authorizedRequest({
        method: 'POST',
        uri: this.optionsMessagingREST.uri,
        path: '/messagingrest/v1/subscriptions',
        oa2: this.optionsMessagingREST.oa2,
        dataObj,
        tokenStore: this
      })
      if (res.statusCode === 201) return true
    } catch (e) {
      if (e.body?.error?.code === 'CONFLICT') return true // might have been created by another instance
      const error = new Error(`Webhook "${webhookName}" could not be created ${this.subdomainInfo}`)
      error.code = 'CREATE_WEBHOOK_FAILED'
      error.target = { kind: 'WEBHOOK', queue: queueName, webhook: webhookName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async deleteWebhook(queueName = this.queueName) {
    const webhookName = _getWebhookName(queueName)
    this.LOG._info &&
      this.LOG.info(
        'Delete webhook',
        this.subdomain
          ? { webhook: webhookName, queue: queueName, subdomain: this.subdomain }
          : { webhook: webhookName, queue: queueName }
      )
    try {
      await authorizedRequest({
        method: 'DELETE',
        uri: this.optionsMessagingREST.uri,
        path: `/messagingrest/v1/subscriptions/${encodeURIComponent(webhookName)}`,
        oa2: this.optionsMessagingREST.oa2,
        tokenStore: this
      })
    } catch (e) {
      const error = new Error(`Webhook "${webhookName}" could not be deleted ${this.subdomainInfo}`)
      error.code = 'DELETE_WEBHOOK_FAILED'
      error.target = { kind: 'WEBHOOK', queue: queueName, webhook: webhookName }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async createQueueAndSubscriptions() {
    this.LOG._info && this.LOG.info(`Create messaging artifacts ${this.subdomainInfo}`)

    const created = await this.createQueue()
    if (!created) {
      // We need to make sure to only keep our own subscriptions
      const resGet = await this.getSubscriptions()
      if (Array.isArray(resGet)) {
        const existingSubscriptions = resGet.map(s => s.topicPattern)
        const obsoleteSubs = existingSubscriptions.filter(s => !this.subscribedTopics.has(s))
        const additionalSubs = [...this.subscribedTopics]
          .map(kv => kv[0])
          .filter(s => !existingSubscriptions.some(e => s === e))
        const unchangedSubs = []
        // eslint-disable-next-line no-unused-vars
        for (const [s, _] of this.subscribedTopics) {
          if (existingSubscriptions.some(e => s === e)) unchangedSubs.push(s)
        }
        this.LOG._info && this.LOG.info('Unchanged subscriptions', unchangedSubs, ' ', this.subdomainInfo)
        await Promise.all([
          ...obsoleteSubs.map(s => this.deleteSubscription(s)),
          ...additionalSubs.map(async t => this.createSubscription(t))
        ])
        return
      }
    }
    await Promise.all([...this.subscribedTopics].map(kv => kv[0]).map(t => this.createSubscription(t)))
  }

  async deploy() {
    await this.createQueueAndSubscriptions()
    if (this.optionsMessagingREST) await this.createWebhook()
  }

  async undeploy() {
    this.LOG._info && this.LOG.info(`Delete messaging artifacts ${this.subdomainInfo}`)
    await this.deleteQueue()
    if (this.optionsMessagingREST) await this.deleteWebhook()
  }

  async readinessCheck() {
    this.LOG._info && this.LOG.info(`Readiness Check ${this.subdomainInfo}`)
    try {
      await authorizedRequest({
        method: 'GET',
        uri: this.options.uri,
        path: `/hub/rest/api/v1/management/messaging/readinessCheck`,
        oa2: this.options.oa2,
        tokenStore: this
      })
    } catch (e) {
      const error = new Error(`Readiness Check failed ${this.subdomainInfo}`)
      error.code = 'READINESS_CHECK_FAILED'
      error.target = { kind: 'READINESSCHECK' }
      error.reason = e
      this.LOG.error(error)
      throw error
    }
  }

  async waitUntilReady({ maxRetries = this.maxRetries, waitingPeriod } = {}) {
    let tries = 0
    const check = async () => {
      try {
        tries++
        await this.readinessCheck()
      } catch (e) {
        if (tries <= maxRetries) {
          if (e.reason.statusCode !== 503) {
            throw e
          }
          const retryAfter = e.reason && e.reason.headers && e.reason.headers['retry-after']
          const _waitingPeriod = waitingPeriod || (retryAfter && Number(retryAfter) * 1000) || 120 * 1000
          this.LOG._info &&
            this.LOG.info(
              `Readiness Check failed ${this.subdomainInfo}, retrying in ${_waitingPeriod / 1000} seconds...`
            )
          await sleep(_waitingPeriod)
          await check()
        } else {
          const errObj = new Error('Readiness Check: Maximum tries exceeded', {
            tokenEndpoint: this.options.oa2.endpoint,
            uri: this.options.uri
          })
          errObj.target = e.target
          errObj.code = e.code
          throw errObj
        }
      }
    }
    await check()
    return this
  }
}

module.exports = EMManagement
