#!/usr/bin/env node
"use strict"

const https = require('https')
const { execSync: _execSync } = require('child_process')

const _opts = {
  cwd: __dirname,
  stdio: 'inherit'
}

let command = 'docker'
const execSync = (str, opts) => _execSync(`${command} ${str}`, Object.assign({}, _opts, opts))

try {
  execSync('--help', { stdio: 'pipe' })
} catch (e) {
  command = 'podman'
  execSync('--help', { stdio: 'pipe' })
}


const hosts = {
  hce: 'repositories.cloud.sap',
  hxe: 'docker.com',
}

const fetchLatestHXE = () => new Promise((resolve, reject) => {
  const req = https.request({
    hostname: `hub.${hosts.hxe}`,
    port: '443',
    path: '/v2/repositories/saplabs/hanaexpress/tags/?page_size=1&page=1&name&ordering',
  })

  req.on('response', async res => {
    let response = ''
    for await (const chunk of res) {
      response += chunk
    }
    resolve(JSON.parse(response).results[0].name)
  })
  req.on('error', reject)

  req.end()
})

const fetchLatestHCE = (released = true) => new Promise((resolve, reject) => {
  const req = https.request({
    hostname: `public.int.${hosts.hce}`,
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
    resolve(JSON.parse(response).data.versions.edges[0].node.name)
  })
  req.on('error', reject)

  req.end(
    `{"graphQL":{"query":"query ($filter: VersionFilter\u0021, $first: Int, $orderBy: VersionOrder) { versions (filter: $filter, first: $first, orderBy: $orderBy) { edges { node { name } } } }","variables":{"filter":{"packageId":"gav://com.sap.hana.cloud.hana:hana-master","name":"*","ignorePreRelease":${released ? 'true' : 'false'}},"first":1,"orderBy":{"field":"NAME_SEMVER","direction":"DESC"}}}}`,
  )
});

const getContainerName = () => {
  const names = [
    'hana-hana-1', // Latest docker compose name
    'hana_hana_1', // old docker compose name
  ]

  return names.find(n => execSync(`container ls -f name=${n} -q`, { stdio: 'pipe' }).length)
}

const startHCE = async (released) => {
  console.log('Starting HCE')
  const image = `public.int.${hosts.hce}/com.sap.hana.cloud.hana/hana-master:${await fetchLatestHCE(released)}`

  const ret = execSync(`images ${image} -q`, { stdio: 'pipe' })

  if (!`${ret}`) {
    execSync(`pull ${image}`)
  }

  execSync(`tag ${image} hana:current`)
  execSync(`compose -f hce.yml up -d`)

  const container = getContainerName()

  execSync(`exec ${container} /bin/bash -c "while ! ./check_hana_health ; do sleep 10 ; done;"`)
}

const startHXE = async () => {
  console.log('Starting HXE')
  const image = `saplabs/hanaexpress:${await fetchLatestHXE()}`

  const ret = execSync(`images ${image} -q`, { stdio: 'pipe' })

  if (!`${ret}`) {
    execSync(`pull ${image}`)
  }

  execSync(`tag ${image} hana:current`)
  execSync(`compose -f hxe.yml up -d`)

  const container = getContainerName()

  execSync(`exec ${container} bash -c "until /check_hana_health -n -e ready-status > /dev/null; do sleep 1; done;"`)
  execSync(`cp ./start-hdi.sql ${container}:/usr/sap/HXE/start-hdi.sql`)
  execSync(`exec ${container} bash -c "/usr/sap/HXE/HDB90/exe/hdbsql -i 90 -d SYSTEMDB -u SYSTEM -p Manager1 -I /usr/sap/HXE/start-hdi.sql > /dev/null && sleep 10"`)
}

const experimental = !process.argv.slice(2).find(arg => arg in {
  '--experimental': 1,
  '-e': 1
})

startHCE(experimental)
  .catch(() => startHXE())
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })

