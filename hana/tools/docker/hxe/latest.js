const https = require('https')

const host = 'docker.com'
const fetchLatest = () => {
  const req = https.request({
    hostname: `hub.${host}`,
    port: '443',
    path: '/v2/repositories/saplabs/hanaexpress/tags/?page_size=1&page=1&name&ordering',
  })

  req.on('response', async res => {
    let response = ''
    for await (const chunk of res) {
      response += chunk
    }
    console.log(JSON.parse(response).results[0].name)
    process.exit(0)
  })
  req.on('error', error => {
    console.error(error)
    process.exit(1)
  })

  req.end()
}

fetchLatest()
