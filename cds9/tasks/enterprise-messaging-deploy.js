// This is a task which can be executed stand-alone to deploy all messaging artifacts to all tenants.
const optionsApp = require('../libx/_runtime/common/utils/vcap.js')
const authorizedRequest = require('../libx/_runtime/messaging/common-utils/authorizedRequest.js')

const cds = require('../libx/_runtime/cds.js')
const LOG = cds.log('messaging')

const VCAPSERVICESstr = process.env.VCAP_SERVICES
if (!VCAPSERVICESstr) throw new Error('Please provide environment variable `VCAP_SERVICES`')
const VCAPSERVICES = JSON.parse(process.env.VCAP_SERVICES)

const xsuaaSrv = Object.keys(VCAPSERVICES)
  .map(k => VCAPSERVICES[k])
  .map(e => e[0])
  .find(srv => srv.label === 'xsuaa')

if (!xsuaaSrv)
  throw new Error('You need to provide credentials of service `XSUAA` in environment variable `VCAP_SERVICES`')
const tokenStore = {}
const oa2 = {
  client: xsuaaSrv.credentials.clientid,
  secret: xsuaaSrv.credentials.clientsecret,
  endpoint: xsuaaSrv.credentials.url
}

const main = async () => {
  // use authorizedRequest to fire against deploy endpoint
  // (use credentials of XSUAA)
  LOG._info && LOG.info('Deploy all tenants')
  try {
    const { body } = await authorizedRequest({
      method: 'POST',
      uri: optionsApp.appURL,
      path: '/messaging/enterprise-messaging/deploy',
      dataObj: { tenants: ['all'] },
      oa2,
      tokenStore
    })
    LOG._info && LOG.info('Deployment complete:', body)
  } catch (e) {
    const error = new Error(`Deployment failed`)
    error.code = 'DEPLOY_FAILED'
    error.target = { kind: 'DEPLOYMENT' }
    error.reason = e
    LOG.error(error)
    throw error
  }
}

main()
