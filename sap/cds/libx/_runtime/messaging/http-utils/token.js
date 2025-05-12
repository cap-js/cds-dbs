const https = require('https')

const _errorObj = result => {
  const errorObj = new Error('Authorization failed')
  errorObj.target = { kind: 'TOKEN' }
  errorObj.response = result
  return errorObj
}

const requestToken = ({ client, secret, endpoint, mTLS }, tenant, tokenStore) =>
  new Promise((resolve, reject) => {
    const options = {
      host: endpoint.replace('/oauth/token', '').replace('https://', ''),
      headers: {}
    }
    if (mTLS) {
      options.method = 'POST'
      options.path = '/oauth/token'
      options.headers['content-type'] = 'application/x-www-form-urlencoded'
      options.cert = mTLS.cert
      options.key = mTLS.key
    } else {
      options.method = 'GET'
      options.path = '/oauth/token?grant_type=client_credentials&response_type=token'
      options.headers.Authorization = 'Basic ' + Buffer.from(client + ':' + secret).toString('base64')
    }

    if (tenant) options.headers['x-zid'] = tenant

    const req = https.request(options, res => {
      res.setEncoding('utf8')
      let chunks = ''
      res.on('data', chunk => {
        chunks += chunk
      })
      res.on('end', () => {
        const result = { body: chunks, headers: res.headers, statusCode: res.statusCode }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(_errorObj(result))
        }
        try {
          const json = JSON.parse(result.body)
          if (!json.access_token) {
            reject(_errorObj(result))
            return
          }
          // store token on tokenStore
          tokenStore.token = json.access_token
          resolve(json.access_token)
        } catch {
          reject(_errorObj(result))
        }
      })
    })
    if (options.method === 'POST') req.write(`client_id=${client}&grant_type=client_credentials&response_type=token`)
    req.end()
  })

module.exports = requestToken
