const _checkRequiredCredentials = options => {
  if (!options || !options.credentials || !options.credentials.management) {
    throw new Error(
      'No management credentials found. Hint: You need to bind your app to a Message-Queuing service or provide the necessary credentials through environment variables.'
    )
  }
}

const _oa2 = credentials => {
  const management = credentials.management
  const oa2 = {
    ...management,
    auth: {
      ...management.auth,
      oauth2: {
        client: management.auth.oauth2.clientId,
        secret: management.auth.oauth2.clientSecret,
        endpoint: management.auth.oauth2.tokenUrl
      }
    }
  }
  if (credentials.uaa && credentials.uaa.certificate) {
    // mTLS
    oa2.auth.oauth2.mTLS = { cert: credentials.uaa.certificate, key: credentials.uaa.key }
    oa2.auth.oauth2.endpoint = credentials.uaa.certurl
  }
  return oa2
}

module.exports = options => {
  _checkRequiredCredentials(options)
  const oa2 = _oa2(options.credentials)
  return oa2
}
