const redis = require('redis')
const cds = require('../../../lib')
const waitingTime = require('../common/utils/waitingTime')
const normalizeIncomingMessage = require('./common-utils/normalizeIncomingMessage')

const _handleReconnects = (client, LOG) => {
  client.on('reconnecting', () => {
    LOG.warn('Reconnecting')
  })

  client.on('error', error => {
    LOG.warn('Failed to connect to Redis: ', error)
  })
}

class RedisMessaging extends cds.MessagingService {
  async init() {
    await super.init()
    const credentials = this.options && this.options.credentials
    const config = {
      socket: {
        reconnectStrategy: attempts => {
          const _waitingTime = waitingTime(attempts)
          this.LOG.warn(`Connection to Redis lost: Reconnecting in ${Math.round(_waitingTime / 1000)} s`)
          return _waitingTime
        }
      }
    }
    // rediss://someUserName:somePassword@hostName:port -> rediss://:somePassword@hostName:port
    const url = credentials && credentials.uri && credentials.uri.replace(/\/\/.*?:/, '//:')
    if (!url) this.LOG._warn && this.LOG.warn('No Redis credentials found, using default credentials')
    else config.url = url
    this.client = redis.createClient(config)
    _handleReconnects(this.client, this.LOG)

    try {
      await this.client.connect()
    } catch (e) {
      throw new Error('Connection to Redis could not be established: ' + e)
    }

    this._ready = true
    this.client.on('end', () => {
      this._ready = false
    })
    this.client.on('error', () => {
      this._ready = false
    })
    this.client.on('ready', () => {
      this._ready = true
    })

    cds.once('listening', () => {
      this.startListening()
    })
  }

  async handle(msg) {
    if (msg.inbound) return super.handle(msg)
    const _msg = this.message4(msg)
    this.LOG._info && this.LOG.info('Emit', { topic: _msg.event })
    if (!this._ready && msg._fromOutbox) throw new Error('Redis connection not ready')
    await this.client.publish(_msg.event, JSON.stringify({ data: _msg.data, ...(_msg.headers || {}) }))
  }

  async startListening() {
    let subscriber
    for (const topic of [...this.subscribedTopics].map(kv => kv[0])) {
      if (!subscriber) {
        // For subscriptions we need to duplicate the connection
        subscriber = this.client.duplicate()
        _handleReconnects(subscriber)
        await subscriber.connect()
      }
      this.LOG._info && this.LOG('Create subscription', { topic })
      await subscriber.subscribe(topic, async message => {
        const msg = normalizeIncomingMessage(message)
        msg.event = topic
        try {
          await this.processInboundMsg({}, msg)
        } catch (e) {
          e.message = 'ERROR occurred in asynchronous event processing: ' + e.message
          this.LOG.error(e)
        }
      })
    }
  }
}

module.exports = RedisMessaging
