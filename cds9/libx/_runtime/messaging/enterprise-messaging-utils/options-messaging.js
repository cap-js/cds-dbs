const _getOAuth2 = (opts, uaa) => {
  const res = {
    ...opts,
    oa2: {
      client: opts.oa2.client || opts.oa2.clientid,
      secret: opts.oa2.secret || opts.oa2.clientsecret,
      endpoint: opts.oa2.endpoint || opts.oa2.tokenendpoint,
      granttype: opts.oa2.granttype
    }
  }
  if (uaa && uaa.certificate) {
    res.oa2.endpoint = uaa.certurl + '/oauth/token'
    res.oa2.mTLS = {
      key: uaa.key,
      cert: uaa.certificate
    }
  }
  return res
}

// protocols are: httprest or amqp10ws
const _getOpts = (options, protocol) => {
  const opts =
    options &&
    options.credentials &&
    options.credentials.messaging &&
    options.credentials.messaging.filter(entry => entry.protocol.includes(protocol))[0]
  if (!opts)
    throw new Error(
      `No ${protocol} credentials found. Hint: You need to bind your app to an Enterprise-Messaging service or provide the necessary credentials through environment variables.`
    )
  return opts
}

const optionsMessagingREST = options => {
  const opts = _getOpts(options, 'httprest')
  const res = _getOAuth2(opts, options.credentials.uaa)
  return res
}

const optionsMessagingAMQP = options => {
  const res = _optionsMessagingAMQP(options)
  if (options.amqp) res.amqp = options.amqp
  return res
}

const _optionsMessagingAMQP = options => {
  const opts = _getOpts(options, 'amqp10ws')
  if (options.credentials.uaa && options.credentials.uaa.certificate) {
    // mTLS
    const amqp = {
      uri: opts.uri,
      wss: {
        key: Buffer.from(options.credentials.uaa.key),
        cert: Buffer.from(options.credentials.uaa.certificate)
      },
      oa2: {
        endpoint: options.credentials.uaa.certurl + '/oauth/token',
        client: opts.oa2.client || opts.oa2.clientid,
        secret: '',
        request: {
          key: Buffer.from(options.credentials.uaa.key),
          cert: Buffer.from(options.credentials.uaa.certificate)
        }
      }
    }
    return amqp
  }
  const res = _getOAuth2(opts, options.credentials.uaa)
  return res
}

module.exports = { optionsMessagingREST, optionsMessagingAMQP }
