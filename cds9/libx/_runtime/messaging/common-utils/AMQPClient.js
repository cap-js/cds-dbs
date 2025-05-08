const cds = require('../../cds.js')
const ClientAmqp = require('@sap/xb-msg-amqp-v100').Client
const { connect, disconnect } = require('./connections')

const addDataListener = (client, queue, prefix, cb) =>
  new Promise(resolve => {
    const source = `${prefix}${queue}`
    client
      .receiver(queue)
      .attach(source)
      .on('data', async raw => {
        const payload = raw.payload && Buffer.concat(raw.payload.chunks).toString()
        const topic =
          raw.source &&
          raw.source.properties &&
          raw.source.properties.to &&
          raw.source.properties.to.replace(/^topic:\/*/, '')
        if (!topic) return raw.done()
        await cb(topic, payload, null, { done: raw.done, failed: raw.failed })
      })
      .on('subscribed', () => {
        resolve()
      })
  })

const sender = (client, optionsApp) => client.sender(`${optionsApp.appName}-${optionsApp.appID}`)

const emit = ({ data, event: topic, headers = {} }, stream, prefix, LOG) =>
  new Promise((resolve, reject) => {
    LOG._info && LOG.info('Emit', { topic })
    const message = { ...headers, data }
    const payload = {
      chunks: [Buffer.from(JSON.stringify(message))],
      type: ['id', 'source', 'specversion', 'type'].every(el => el in headers)
        ? 'application/cloudevents+json'
        : 'application/json'
    }
    const msg = {
      done: resolve,
      failed: e => {
        if (e.condition === 'amqp:not-allowed') e.unrecoverable = true
        reject(e)
      },
      payload,
      target: {
        properties: {
          to: `${prefix}${topic}`
        }
      }
    }
    stream.write(msg)
  })

class AMQPClient {
  constructor({ optionsAMQP, prefix, service, keepAlive = true }) {
    this.optionsAMQP = optionsAMQP
    this.prefix = prefix
    this.keepAlive = keepAlive
    this.service = service
    cds.on('shutdown', () => this.disconnect())
  }

  async connect() {
    this.client = new ClientAmqp(this.optionsAMQP)
    this.sender = sender(this.client, this.service.optionsApp)
    this.stream = this.sender.attach('')
    await connect(this.client, this.service.LOG, this.keepAlive)
  }

  async disconnect() {
    if (this.client) {
      await disconnect(this.client)
      delete this.client
    }
  }

  async emit(msg) {
    if (!this.client) await this.connect()
    // REVISIT: Is this a robust way to find out if the connection is working?
    if (msg._fromOutbox && !this.sender.opened()) throw new Error('AMQP: Sender is not open')
    await emit(msg, this.stream, this.prefix.topic, this.service.LOG)
    if (!this.keepAlive) return this.disconnect()
  }

  listen(cb) {
    return addDataListener(this.client, this.service.queueName, this.prefix.queue, cb)
  }
}

module.exports = AMQPClient
