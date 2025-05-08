const cds = require('../../../')

const crypto = require('crypto')

const getODataMetadata = require('../utils/metadata')

const normalize_header = value => value.split(',').map(str => str.trim())

const validate_etag = (header, etag) => {
  const normalized = normalize_header(header)
  return normalized.includes(etag) || normalized.includes('*') || normalized.includes('"*"')
}

const generateEtag = s => `W/"${crypto.createHash('sha256').update(s).digest('base64')}"`

module.exports = adapter => {
  const { service } = adapter

  return function service_document(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const msg = `Method ${req.method} is not allowed for calls to the service endpoint`
      throw Object.assign(new Error(msg), { statusCode: 405 })
    }

    const model = cds.context.model ?? service.model
    const csnService = model.definitions[service.definition.name]

    if (req.headers['if-match']) {
      if (csnService.srvDocEtag) {
        const valid = validate_etag(req.headers['if-match'], csnService.srvDocEtag)
        if (!valid) return res.status(412).end()
      }
    }

    if (req.headers['if-none-match']) {
      if (csnService.srvDocEtag) {
        const unchanged = validate_etag(req.headers['if-none-match'], csnService.srvDocEtag)
        if (unchanged) {
          res.set('ETag', csnService.srvDocEtag)
          return res.status(304).end()
        }
      }
    }

    const srvEntities = model.entities(service.definition.name)

    const exposedEntities = []
    for (const e in srvEntities) {
      if (e === 'DraftAdministrativeData') continue

      const entity = srvEntities[e]
      if (entity['@cds.api.ignore']) continue
      if (cds.env.effective.odata.containment && csnService._containedEntities.has(entity.name)) continue

      const odataName = e.replace(/\./g, '_')
      const obj = { name: odataName, url: odataName }

      if (entity['@odata.singleton'] || entity['@odata.singleton.nullable']) obj.kind = 'Singleton'

      exposedEntities.push(obj)
    }

    csnService.srvDocEtag = generateEtag(JSON.stringify(exposedEntities))
    res.set('ETag', csnService.srvDocEtag)

    const { context: odataContext } = getODataMetadata({
      SELECT: { from: { ref: [service.definition.name] } },
      _target: service.definition
    })

    return res.json({
      '@odata.context': odataContext,
      '@odata.metadataEtag': csnService.srvDocEtag,
      value: exposedEntities
    })
  }
}
