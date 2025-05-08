const cds = require('../cds.js')
const AMQPWebhookMessaging = require('./AMQPWebhookMessaging.js')
const { optionsMessagingREST } = require('./enterprise-messaging-utils/options-messaging.js')
const optionsManagement = require('./enterprise-messaging-utils/options-management.js')
const EMManagement = require('./enterprise-messaging-utils/EMManagement.js')
const optionsForSubdomain = require('./common-utils/optionsForSubdomain.js')
const authorizedRequest = require('./common-utils/authorizedRequest')
const getTenantInfo = require('./enterprise-messaging-utils/getTenantInfo')
const sleep = require('util').promisify(setTimeout)
const {
  registerDeployEndpoints,
  registerWebhookEndpoints
} = require('./enterprise-messaging-utils/registerEndpoints.js')
const cloudEvents = require('./enterprise-messaging-utils/cloudEvents.js')

const BASE_PATH = '/messaging/enterprise-messaging'

const _checkAppURL = appURL => {
  if (!appURL)
    throw new Error(
      'Enterprise Messaging: You need to provide an HTTPS endpoint to your application.\n\nHint: You can set the application URI in environment variable `VCAP_APPLICATION.application_uris[0]`. This is needed because incoming messages are delivered through HTTP via webhooks.\nExample: `{ ..., "VCAP_APPLICATION": { "application_uris": ["my-app.com"] } }`\nIn case you want to use Enterprise Messaging in shared (that means single-tenant) mode, you can use kind `enterprise-messaging-shared`.'
    )

  if (appURL.startsWith('https://localhost'))
    throw new Error(
      'The endpoint of your application is local and cannot be reached from Enterprise Messaging.\n\nHint: For local development you can set up a tunnel to your local endpoint and enter its public https endpoint in `VCAP_APPLICATION.application_uris[0]`.\nIn case you want to use Enterprise Messaging in shared (that means single-tenant) mode, you can use kind `enterprise-messaging-shared`.'
    )
}

// REVISIT: It's bad to have to rely on the subdomain.
// For all interactions where we perform the token exchange ourselves,
// we will be able to use the zoneId instead of the subdomain.
const _subdomainFromContext = context => context?.http.req?.authInfo?.getSubdomain?.()

class EnterpriseMessaging extends AMQPWebhookMessaging {
  init() {
    cloudEvents.defaultOptions(this.options)
    return super.init()
  }

  // New mtx based on @sap/cds-mtxs
  async addMTXSHandlers() {
    // REVISIT: Is that tested with MTX services in sidecar?
    const deploymentSrv = await cds.connect.to('cds.xt.DeploymentService')
    const provisioningSrv = await cds.connect.to('cds.xt.SaasProvisioningService')
    deploymentSrv.prepend(() => {
      deploymentSrv.after('subscribe', async (_res, req) => {
        const { subscribedSubdomain: subdomain } = req.data.metadata
        const management = await this.getManagement(subdomain).waitUntilReady()
        await management.deploy()
      })
      deploymentSrv.before('unsubscribe', async req => {
        const { tenant } = req.data
        let subdomain
        try {
          const tenantInfo = await getTenantInfo(tenant)
          subdomain = tenantInfo.subdomain
        } catch (e) {
          if (e.status === 404) return // idempotent
          throw e
        }
        try {
          const management = await this.getManagement(subdomain).waitUntilReady()
          await management.undeploy()
        } catch (error) {
          this.LOG.error('Failed to delete messaging artifacts for subdomain', subdomain, '(', error, ')')
        }
      })
    })
    provisioningSrv.prepend(() => {
      provisioningSrv.on('dependencies', async (_req, next) => {
        this.LOG._info && this.LOG.info('Include Enterprise-Messaging as SaaS dependency')
        const res = (await next()) || []
        const xsappname = this.options.credentials?.xsappname
        if (xsappname) {
          const exists = res.some(d => d.xsappname === xsappname)
          if (!exists) res.push({ xsappname })
        }
        return res
      })
    })
  }

  startListening() {
    const doNotDeploy = cds.requires.multitenancy && !this.options.deployForProvider
    if (doNotDeploy) this.LOG._info && this.LOG.info('Skipping deployment of messaging artifacts for provider account')
    super.startListening({ doNotDeploy })
    if (!doNotDeploy && (this._listenToAll.value || this.subscribedTopics.size)) {
      const management = this.getManagement()
      // Webhooks will perform an OPTIONS call on creation to check the availability of the app.
      // On systems like Cloud Foundry the app URL will only be advertised once
      // the app is healthy, i.e. when the health check was performed successfully.
      // Therefore we need to wait a few seconds (configurable) to make sure the app
      // can be reached from Enterprise Messaging.
      const waitingPeriod = this.options.webhook && this.options.webhook.waitingPeriod
      if (waitingPeriod === 0) return this.queued(management.createWebhook.bind(management))()
      sleep(waitingPeriod || 5000).then(() => this.queued(management.createWebhook.bind(management))())
    }
  }

  async listenToClient(cb) {
    _checkAppURL(this.optionsApp.appURL)
    registerWebhookEndpoints(BASE_PATH, this.queueName, this.LOG, cb)
    if (cds.requires.multitenancy) {
      await this.addMTXSHandlers()
      registerDeployEndpoints(BASE_PATH, this.queueName, async (tenantInfo, options) => {
        const result = { queue: this.queueName, succeeded: [], failed: [] }
        await Promise.all(
          tenantInfo.map(async info => {
            try {
              const management = await this.getManagement(info.subdomain).waitUntilReady()
              if (options.wipeData) await management.undeploy()
              await management.deploy()
              result.succeeded.push(info.tenant)
            } catch (error) {
              this.LOG.error('Failed to create messaging artifacts for subdomain', info.subdomain, ':', error)
              result.failed.push({ error: error.message, tenant: info.tenant })
            }
          })
        )
        return result
      })
    }
  }

  getManagement(subdomain) {
    const _subdomain = (typeof subdomain === 'string' && subdomain) || _subdomainFromContext(this.context || subdomain)
    const optsManagement = optionsManagement(this.options)
    const queueConfig = this.queueConfig
    const queueName = this.queueName
    const optsManagementSwitched = _subdomain
      ? optionsForSubdomain.oa2ForSubdomain(optsManagement, _subdomain)
      : optsManagement
    const _optionsMessagingREST = optionsMessagingREST(this.options)
    const _optionsMessagingRESTSwitched = _subdomain
      ? optionsForSubdomain.oa2ForSubdomain(_optionsMessagingREST, _subdomain)
      : _optionsMessagingREST
    const optionsWebhook = { ...this.options.webhook }
    delete optionsWebhook.waitingPeriod

    return new EMManagement({
      optionsManagement: optsManagementSwitched,
      queueConfig,
      queueName,
      optionsMessagingREST: _optionsMessagingRESTSwitched,
      optionsWebhook,
      optionsApp: this.optionsApp,
      maxRetries: this.options.maxRetries,
      path: `${BASE_PATH}?q=${this.queueName}`,
      subscribedTopics: this.subscribedTopics,
      alternativeTopics: this.alternativeTopics,
      subdomain: _subdomain,
      namespace: this.options.credentials && this.options.credentials.namespace,
      LOG: this.LOG
    })
  }

  async handle(msg) {
    if (msg.inbound) return super.handle(msg)
    const _msg = this.message4(msg)
    const _optionsMessagingREST = optionsMessagingREST(this.options)
    const context = this.context || cds.context
    const tenant = cds.requires.multitenancy && context && context.tenant
    const topic = _msg.event
    const message = { ...(_msg.headers || {}), data: _msg.data }

    const contentType =
      _msg.headers && ['id', 'source', 'specversion', 'type'].every(el => el in _msg.headers)
        ? 'application/cloudevents+json'
        : 'application/json'

    await this.queued(() => {})()

    try {
      const params = {
        method: 'POST',
        uri: _optionsMessagingREST.uri,
        path: `/messagingrest/v1/topics/${encodeURIComponent(topic)}/messages`,
        oa2: _optionsMessagingREST.oa2,
        dataObj: message,
        headers: {
          'Content-Type': contentType,
          'x-qos': 1
        },
        tokenStore: {}
      }
      if (tenant) params.tenant = tenant
      await authorizedRequest(params)
    } catch (e) {
      // Note: If the topic rules don't allow the topic, we get a 403 (which is a strange choice by Event Mesh)
      if (e && (e.statusCode === 400 || e.statusCode === 403)) e.unrecoverable = true
      throw e
    }
  }

  wildcarded(topic) {
    return topic.replace(/.*?\/.*?\/.*?\//, '+/+/+/')
  }

  prepareTopic(topic, inbound) {
    return cloudEvents.prepareTopic(topic, inbound, this.options, super.prepareTopic.bind(this))
  }

  prepareHeaders(headers, event) {
    cloudEvents.prepareHeaders(headers, event, this.options, super.prepareHeaders.bind(this))
  }
}

module.exports = EnterpriseMessaging
