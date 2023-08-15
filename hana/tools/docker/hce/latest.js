const dns = require('dns')
const https = require('https')

const host = 'repositories.cloud.sap'

const hasAccess = () => {
  dns.lookup(host, { all: true }, (err, res) => {
    if (err || res.length < 4) return process.exit(1)
    fetchLatest()
  })
}

const fetchLatest = () => {
  const req = https.request({
    hostname: `public.int.${host}`,
    port: '443',
    path: '/ui/api/v1/mds/versions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  })

  req.on('response', async res => {
    let response = ''
    for await (const chunk of res) {
      response += chunk
    }
    console.log(JSON.parse(response).data.versions.edges[0].node.name)
    process.exit(0)
  })
  req.on('error', error => {
    console.error(error)
    process.exit(1)
  })

  req.end(
    '{"graphQL":{"query":"query ($filter: VersionFilter\u0021, $first: Int, $orderBy: VersionOrder) { versions (filter: $filter, first: $first, orderBy: $orderBy) { edges { node { name } } } }","variables":{"filter":{"packageId":"gav://com.sap.hana.cloud.hana:hana-master","name":"*","ignorePreRelease":true},"first":1,"orderBy":{"field":"NAME_SEMVER","direction":"DESC"}}}}',
  )
}

hasAccess()
