const cds = require('../cds')
// eslint-disable-next-line
const { Kafka } = require('kafkajs')

class KafkaService extends cds.MessagingService {
  async init() {
    await super.init()

    // We might also support subscribeTopic and publishTopic in the future
    // but we keep it as simple as possible for now.

    this._topics_in_kafka = new Set()

    this._cachedKeyFns = new Map()

    this.consumerGroup = this.options.consumerGroup || appId() + '/' + this.options.topic

    if (!this.options.local && !this.options.credentials) {
      throw new Error(
        'No Kafka credentials found.\n\nHint: You need to bind your application to a Kafka service instance.'
      )
    }

    const config = this.options.local ? await _getConfigLocal(this) : await _getConfig(this)
    this.client = new Kafka(config)

    // check for proper credentials
    const producer = this.client.producer()
    await producer.connect()
    await producer.disconnect()

    cds.once('listening', () => {
      this.startListening()
    })
  }

  async handle(msg) {
    if (msg.inbound) return super.handle(msg)
    const _msg = this.message4(msg)
    this.LOG._info && this.LOG.info('Emit', { topic: _msg.event })
    if (!this.producer) {
      this.producer = this.client.producer()
      await this.producer.connect()
    }
    // In the future, we might allow to set the topic manually:
    // const topic = _msg.headers?.["@kafka.topic"] ?? this.options.topic;
    const topic = this.options.topic
    let key = _msg.headers['@kafka.key']

    if (!key) {
      let keyFn = this._cachedKeyFns.get(_msg.event)
      if (keyFn === undefined) {
        // `null` means there is no keyFn for that event
        keyFn = _getKeyFn(_msg.event)
        this._cachedKeyFns.set(_msg.event, keyFn)
      }
      key = keyFn?.(_msg.data)
    }

    const headers = { ...(_msg.headers || {}) }
    headers['x-sap-cap-effective-topic'] = _msg.event
    delete headers['@kafka.key']
    // delete headers["@kafka.topic"];
    const tenant = cds.context?.tenant
    if (tenant) headers['x-sap-cap-tenant-id'] = tenant
    const message = {
      value: (typeof _msg.data === 'string' && _msg.data) || JSON.stringify(_msg.data),
      headers
    }
    if (key) message.key = key
    await this._ensureTopicsExist([topic])
    const payload = {
      topic,
      messages: [message]
    }
    if (this.LOG._debug) this.LOG.debug('Sending', payload)
    await this.producer.send(payload)
  }

  async _ensureTopicsExist(topics) {
    const toBeCheckedTopics = topics.filter(t => !this._topics_in_kafka.has(t))
    if (!toBeCheckedTopics.length) return
    const admin = this.client.admin()
    await admin.connect()

    const existingTopics = await admin.listTopics()
    const missingTopics = toBeCheckedTopics.filter(t => !existingTopics.includes(t))
    if (missingTopics.length) {
      this.LOG._info && this.LOG.info(`Creating topics: ${missingTopics}`)
      await admin.createTopics({ topics: missingTopics.map(t => ({ topic: t })) })
      // Let's just cache used ones
      for (const missingTopic of missingTopics) this._topics_in_kafka.add(missingTopic)
    }
  }

  async startListening() {
    const consumer = this.client.consumer({ groupId: this.consumerGroup })
    await consumer.connect()

    // In the future, we might allow to support the annotation @kafka.topic
    // but then, we'd need to collect them like this:
    // const topics = []
    // const messaging = cds.env.requires.messaging && await cds.connect.to('messaging')
    // if (messaging) {
    //   for (const [_, declared] of messaging._registeredEvents) {
    //     for (const [_, event] of this.subscribedTopics) {
    //       const kafkaTopic = declared['@kafka.topic']
    //       // `this` only knows about the subscribed topics (from `@topic` of fully-qualified name)
    //       if (kafkaTopic && (declared['@topic'] === event || declared.name === event)) {
    //         topics.push(kafkaTopic)
    //       }
    //     }
    //   }
    // }
    // this.subscribeTopics = this.subscribeTopics.concat(topics)

    await this._ensureTopicsExist([this.options.topic])

    this.LOG._info && this.LOG.info(`Subscribe to ${this.options.topic}`)
    await consumer.subscribe({ topics: [this.options.topic] })
    await consumer.run({
      eachMessage: async raw => {
        try {
          const msg = _normalizeIncomingMessage(raw.message.value.toString())
          msg.headers = {}
          for (const header in raw.message.headers || {}) {
            msg.headers[header] = raw.message.headers[header]?.toString()
          }
          msg.event =
            raw.message.headers['x-sap-cap-effective-topic']?.toString() ?? raw.message.headers.type?.toString()
          msg.tenant = raw.message.headers['x-sap-cap-tenant-id']
          if (!msg.event) return

          await this.processInboundMsg({ tenant: msg.tenant }, msg)
        } catch (e) {
          if (e.code === 'NO_HANDLER_FOUND') return // consume
          this.LOG.error('ERROR occured in asynchronous event processing:', e)
          throw e
        }
      }
    })
  }
}

module.exports = KafkaService

// TODO: Make public?
const appId = require('./common-utils/appId')

function _JSONorString(string) {
  try {
    return JSON.parse(string)
  } catch {
    return string
  }
}

function _normalizeIncomingMessage(message) {
  const _payload = _JSONorString(message)
  let data, headers
  if (typeof _payload === 'object' && 'data' in _payload) {
    data = _payload.data
    headers = { ..._payload }
    delete headers.data
  } else {
    data = _payload
    headers = {}
  }

  return {
    data,
    headers
  }
}

function _getDef(topicOrEvent) {
  const found = cds?.model.definitions[topicOrEvent]
  if (found) return found

  for (const def in cds.model?.definitions) {
    const definition = cds.model.definitions[def]
    if (definition['@topic'] === topicOrEvent) return definition
  }
}

function _getKeyFn(topicOrEvent) {
  const definition = _getDef(topicOrEvent)
  if (!definition) return null
  const keys = []
  for (const el in definition.elements) {
    // definition.keys doesn't seem to work
    const element = definition.elements[el]
    if (element.key) keys.push(element.name)
  }
  if (keys.length) {
    keys.sort()
    return data =>
      JSON.stringify(
        keys.reduce((res, curr) => {
          res[curr] = data[curr]
          return res
        }, {})
      )
  }
  return null
}

async function _getConfig(srv) {
  const caCerts = await _getCaCerts(srv)

  const allBrokers =
    srv.options.credentials.cluster?.['brokers.client_ssl'] ||
    srv.options.credentials['cluster.public']?.['brokers.client_ssl']
  const brokers = allBrokers.split(',')

  return {
    clientId: srv.consumerGroup,
    // logLevel: 4,
    connectionTimeout: 15000,
    authenticationTimeout: 15000,
    brokers,
    ssl: {
      rejectUnauthorized: true,
      ca: caCerts,
      key: srv.options.credentials.clientkey,
      cert: srv.options.credentials.clientcert
    }
  }
}

async function _getConfigLocal() {
  const creds = await fetch('http://localhost:8004/v1/credentials', {
    headers: { encoding: 'utf-8', accept: 'application/json' }
  }).then(r => r.json())

  const url = 'http://localhost:8005/v1/undefined/token'
  const token = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ grant_type: 'client_credentials' }),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      encoding: 'utf-8',
      Authorization: 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`, 'utf-8').toString('base64')
    }
  })
    .then(r => r.json())
    .then(r => r.access_token)
  return {
    brokers: ['127.0.0.1:19093', '127.0.0.1:29093', '127.0.0.1:39093'],
    ssl: {
      rejectUnauthorized: false
    },
    sasl: {
      mechanism: 'plain',
      username: creds.username,
      password: token
    }
  }
}

async function _getCaCerts(srv) {
  const certCurrent = await fetch(srv.options.credentials.urls.cert_current).then(r => r.text())
  try {
    const certNext = await fetch(srv.options.credentials.urls.cert_next).then(r => r.text())
    return [certCurrent, certNext]
  } catch {
    return [certCurrent]
  }
}
