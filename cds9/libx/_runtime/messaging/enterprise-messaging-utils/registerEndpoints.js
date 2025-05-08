const cds = require('../../cds.js')
const express = require('express')
const getTenantInfo = require('./getTenantInfo.js')
const isSecured = () => cds.requires.auth && (cds.requires.auth.impl || cds.requires.auth.credentials)

const _isAll = a => a && a.includes('all')

class EndpointRegistry {
  constructor(basePath, LOG) {
    const deployPath = basePath + '/deploy'
    this.webhookCallbacks = new Map()
    this.deployCallbacks = new Map()
    if (isSecured()) {
      if (cds.requires.auth.impl) {
        cds.app.use(basePath, cds.middlewares.before) // contains auth, trace, context
      } else {
        const jwt_auth = require('../../../../lib/srv/middlewares/auth/jwt-auth.js')
        cds.app.use(basePath, cds.middlewares.context())
        cds.app.use(basePath, jwt_auth(cds.requires.auth))
        cds.app.use(basePath, (err, req, res, next) => {
          if (err === 401) res.sendStatus(401)
          else next(err)
        })
      }
      // unsuccessful auth doesn't automatically reject!
      cds.app.use(basePath, (req, res, next) => {
        // REVISIT: we should probably pass an error into next so that a (custom) error middleware can handle it
        if (cds.context.user._is_anonymous) return res.status(401).end()
        next()
      })
    } else if (process.env.NODE_ENV === 'production') {
      LOG.warn('Messaging endpoints not secured')
    } else {
      // auth middlewares set cds.context.user
      cds.app.use(basePath, cds.middlewares.context())
    }
    cds.app.use(basePath, express.json({ type: 'application/*+json' }))
    cds.app.use(basePath, express.json())
    cds.app.use(basePath, express.urlencoded({ extended: true }))
    LOG._debug && LOG.debug('Register inbound endpoint', { basePath, method: 'OPTIONS' })

    // Clear cds.context as it would interfere with subsequent transactions
    // cds.app.use(basePath, (_req, _res, next) => {
    //   cds.context = undefined // REVISIT: Why is that necessary?
    //   next()
    // })

    cds.app.options(basePath, (req, res) => {
      try {
        if (isSecured() && !cds.context.user.is('emcallback')) return res.sendStatus(403)
        res.set('webhook-allowed-origin', req.headers['webhook-request-origin'])
        res.sendStatus(200)
      } catch {
        res.sendStatus(500)
      }
    })
    LOG._debug && LOG.debug('Register inbound endpoint', { basePath, method: 'POST' })
    cds.app.post(basePath, (req, res) => {
      try {
        if (isSecured() && !cds.context.user.is('emcallback')) return res.sendStatus(403)
        const queueName = req.query.q
        if (!queueName) {
          LOG.error('Query parameter `q` not found.')
          return res.sendStatus(400)
        }
        const xAddress = req.headers['x-address']
        const topic = xAddress && xAddress.match(/^topic:(.*)/)?.[1]
        if (!topic) {
          LOG.error('Incoming message does not contain a topic in header `x-address`: ' + xAddress)
          return res.sendStatus(400)
        }
        const payload = req.body
        const cb = this.webhookCallbacks.get(queueName)
        if (!cb) return res.sendStatus(200)
        const { tenant } = cds.context
        const other = tenant
          ? {
              _: { req, res }, // For `cds.context.http`
              tenant
            }
          : {}
        if (!cb) return res.sendStatus(200)
        cb(topic, payload, other, {
          done: () => {
            res.sendStatus(200)
          },
          failed: () => {
            res.sendStatus(500)
          }
        })
      } catch (error) {
        LOG.error(error)
        return res.sendStatus(500)
      }
    })
    cds.app.post(deployPath, async (req, res) => {
      try {
        if (isSecured() && !cds.context.user.is('emmanagement')) return res.sendStatus(403)
        const tenants = req.body && !_isAll(req.body.tenants) && req.body.tenants
        const queues = req.body && !_isAll(req.body.queues) && req.body.queues
        const options = { wipeData: req.body && req.body.wipeData }

        if (tenants && !Array.isArray(tenants)) res.send(400).send('Request parameter `tenants` must be an array.')
        if (queues && !Array.isArray(queues)) res.send(400).send('Request parameter `queues` must be an array.')

        const tenantInfo = tenants ? await Promise.all(tenants.map(t => getTenantInfo(t))) : await getTenantInfo()

        const callbacks = queues ? queues.map(q => this.deployCallbacks.get(q)) : [...this.deployCallbacks.values()]
        const results = await Promise.all(callbacks.map(c => c(tenantInfo, options)))

        // [{ queue: '...', failed: [...], succeeded: [...] }, ...]
        const hasError = results.some(r => r.failed.length)
        if (hasError) return res.status(500).send(results)
        return res.status(201).send(results)
      } catch {
        // REVISIT: Still needed with cds-mtxs?
        // If an unknown tenant id is provided, cds-mtx will crash ("Cannot read property 'hanaClient' of undefined")
        return res.sendStatus(500)
      }
    })
  }

  registerWebhookCallback(queueName, cb) {
    this.webhookCallbacks.set(queueName, cb)
  }

  registerDeployCallback(queueName, cb) {
    this.deployCallbacks.set(queueName, cb)
  }
}

// Singleton registries per basePath
const registries = new Map()

// REVISIT: Use cds mechanism instead of express? -> Need option method and handler for specifica
const registerWebhookEndpoints = (basePath, queueName, LOG, cb) => {
  const registry =
    registries.get(basePath) ||
    (registries.set(basePath, new EndpointRegistry(basePath, LOG)) && registries.get(basePath))
  registry.registerWebhookCallback(queueName, cb)
}

const registerDeployEndpoints = (basePath, queueName, cb) => {
  const registry =
    registries.get(basePath) || (registries.set(basePath, new EndpointRegistry(basePath)) && registries.get(basePath))
  registry.registerDeployCallback(queueName, cb)
}

// Only needed for testing, not used in productive code
const __clearRegistries = () => registries.clear()

module.exports = { registerWebhookEndpoints, registerDeployEndpoints, __clearRegistries }
