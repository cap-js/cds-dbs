const _oa2 = (management, uaa) => {
  const oa2 = {
    ...management,
    oa2: {
      client: management.oa2.clientid,
      secret: management.oa2.clientsecret,
      endpoint: management.oa2.tokenendpoint
    }
  }
  if (uaa && uaa.certificate) {
    oa2.oa2.mTLS = { cert: uaa.certificate, key: uaa.key }
    oa2.oa2.endpoint = uaa.certurl
  }
  return oa2
}

module.exports = options => {
  if (!options || !options.credentials || !options.credentials.management) {
    throw new Error(
      'No management credentials found. Hint: You need to bind your app to an Enterprise-Messaging service or provide the necessary credentials through environment variables.'
    )
  }
  return _oa2(options.credentials.management[0], options.credentials.uaa)
}
