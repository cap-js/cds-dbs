const cds = require('../cds')
const LOG = cds.log('ucl')

const fs = require('fs').promises
const https = require('https')

class UCLService extends cds.Service {
  async init() {
    await super.init()

    this._applicationTemplate = _getApplicationTemplate(this.options)
    if (!this._applicationTemplate.applicationNamespace) {
      throw new Error(
        'The UCL service requires a valid `applicationTemplate`, please provide it as described in the documentation.'
      )
    }

    if (!cds.requires.multitenancy && cds.env.profile !== 'mtx-sidecar')
      throw new Error(
        'The UCL service requires multitenancy, please enable it in your cds configuration with `cds.requires.multitenancy` or by using the mtx sidecar.'
      )
    if (!this.options.credentials)
      throw new Error('No credentials found for the UCL service, please bind the service to your app.')

    if (!this.options.x509.cert && !this.options.x509.certPath)
      throw new Error('UCL requires `x509.cert` or `x509.certPath`.')
    if (!this.options.x509.pkey && !this.options.x509.pkeyPath)
      throw new Error('UCL requires `x509.pkey` or `x509.pkeyPath`.')

    const [cert, key] = await Promise.all([
      this.options.x509.cert ?? fs.readFile(cds.utils.path.resolve(cds.root, this.options.x509.certPath)),
      this.options.x509.pkey ?? fs.readFile(cds.utils.path.resolve(cds.root, this.options.x509.pkeyPath))
    ])
    this.agent = new https.Agent({ cert, key })

    const existingTemplate = await this.readTemplate()
    const template = existingTemplate ? await this.updateTemplate(existingTemplate) : await this.createTemplate() // TODO: Make sure return value is correct

    if (!template) throw new Error('The UCL service could not create an application template.')

    cds.once('listening', async () => {
      const provisioning = await cds.connect.to('cds.xt.SaasProvisioningService')
      provisioning.prepend(() => {
        provisioning.on('dependencies', async (_, next) => {
          const dependencies = await next()
          dependencies.push({ xsappname: template.labels.xsappnameCMPClone })
          return dependencies
        })
      })
    })
  }

  // Replace with fetch
  async _request(query, variables) {
    const opts = {
      host: this.options.host,
      path: this.options.path,
      agent: this.agent,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }
    return new Promise((resolve, reject) => {
      const req = https.request(opts, res => {
        const chunks = []

        res.on('data', chunk => {
          chunks.push(chunk)
        })

        res.on('end', () => {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString()
          }
          const body = JSON.parse(response.body)
          if (body.errors)
            throw new Error('Request to UCL service failed with:\n' + JSON.stringify(body.errors, null, 2))
          resolve(body.data)
        })
      })

      req.on('error', error => {
        reject(error)
      })

      if (query) {
        req.write(JSON.stringify({ query, variables }))
      }
      req.end()
    })
  }

  _handleResponse(result) {
    if (result.response && result.response.errors) {
      let errorMessage = result.response.errors[0].message
      throw new Error(errorMessage)
    } else {
      return result.result
    }
  }

  async readTemplate() {
    const xsappname = this.options.credentials.xsappname
    const variables = { key: 'xsappname', value: `"${xsappname}"` }
    const res = await this._request(READ_QUERY, variables)
    if (res) return res.applicationTemplates.data[0]
  }

  async createTemplate() {
    try {
      return this._handleResponse(await this._request(CREATE_MUTATION, { input: this._applicationTemplate }))
    } catch (e) {
      this._handleResponse(e)
    }
  }

  async updateTemplate(template) {
    try {
      const input = { ...this._applicationTemplate }
      delete input.labels
      const response = this._handleResponse(await this._request(UPDATE_MUTATION, { id: template.id, input }))
      LOG.info('Application template updated successfully.')
      return response
    } catch (e) {
      this._handleResponse(e)
    }
  }

  async deleteTemplate() {
    const template = await this.readTemplate()
    if (!template) return
    return this._handleResponse(await this._request(DELETE_MUTATION, { id: template.id }))
  }
}

const READ_QUERY = `
  query ($key: String!, $value: String!) {
    applicationTemplates(filter: { key: $key, query: $value }) {
      data {
        id
        name
        description
        placeholders {
          name
          description
        }
        applicationInput
        labels
        webhooks {
          type
        }
      }
    }
  }`

const CREATE_MUTATION = `
  mutation ($input: ApplicationTemplateInput!) {
    result: createApplicationTemplate (
      in: $input
    ) {
      id
      name
      labels
      applicationInput
      applicationNamespace
    }
  }`

const UPDATE_MUTATION = `
  mutation ($id: ID!, $input: ApplicationTemplateUpdateInput!) {
    result: updateApplicationTemplate(
      id: $id
      in: $input
    ) {
      id
      name
      labels
      description
      applicationInput
    }
  }`

const DELETE_MUTATION = `
  mutation ($id: ID!) {
    result: deleteApplicationTemplate(
      id: $id
    ) {
      id
      name
      description
    }
  }`

const _getApplicationTemplate = options => {
  let applicationTemplate = {
    applicationInput: {
      providerName: 'SAP',
      localTenantID: '{{tenant-id}}',
      labels: {
        displayName: '{{subdomain}}'
      }
    },
    labels: {
      managed_app_provisioning: true,
      xsappname: '${xsappname}'
    },
    placeholders: [
      { name: 'subdomain', description: 'The subdomain of the consumer tenant' },
      {
        name: 'tenant-id',
        description: "The tenant id as it's known in the product's domain",
        jsonPath: '$.subscribedTenantId'
      }
    ],
    accessLevel: 'GLOBAL'
  }
  applicationTemplate = cds.utils.merge(applicationTemplate, options.applicationTemplate)

  const pkg = require(cds.root + '/package')
  if (!applicationTemplate.name) applicationTemplate.name = pkg.name
  if (!applicationTemplate.applicationInput.name) applicationTemplate.applicationInput.name = pkg.name
  if (applicationTemplate.labels.xsappname === '${xsappname}')
    applicationTemplate.labels.xsappname = options.credentials.xsappname

  return applicationTemplate
}

module.exports = UCLService
