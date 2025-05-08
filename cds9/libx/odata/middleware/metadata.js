const cds = require('../../../')
const LOG = cds.log('odata')

const crypto = require('crypto')

const _requestedFormat = (queryOption, header) => {
  if (queryOption) return queryOption.match(/json/i) ? 'json' : 'xml'
  if (header) {
    if (header.indexOf('*/*') > -1) return 'xml' //> default to xml for backward compatibility
    const jsonIndex = header.indexOf('application/json')
    if (jsonIndex === -1) return 'xml'
    const xmlIndex = header.indexOf('application/xml')
    if (xmlIndex === -1) return 'json'
    return jsonIndex < xmlIndex ? 'json' : 'xml'
  }
  return 'xml'
}

const _metadataFromFile = async srv => {
  const fs = require('fs')
  const filePath = cds.root + `/srv/odata/v4/${srv.definition.name}.xml`
  let exists
  try {
    exists = !(await fs.promises.access(filePath, fs.constants.F_OK))
  } catch {
    LOG._debug && LOG.debug(`No metadata file found for service ${srv.definition.name} at ${filePath}`)
  }
  if (exists) {
    const file = await fs.promises.readFile(filePath)
    return file.toString()
  }
}

const normalize_header = value => {
  return value.split(',').map(str => str.trim())
}

const validate_etag = (header, etag) => {
  const normalized = normalize_header(header)
  return normalized.includes(etag) || normalized.includes('*') || normalized.includes('"*"')
}

const generateEtag = s => {
  return `W/"${crypto.createHash('sha256').update(s).digest('base64')}"`
}

module.exports = adapter => {
  const { service } = adapter

  return async function metadata(req, res, next) {
    if (req.method !== 'GET') {
      const msg = `Method ${req.method} is not allowed for calls to the metadata endpoint`
      return next(Object.assign(new Error(msg), { statusCode: 405 }))
    }

    const format = _requestedFormat(req.query['$format'], req.headers['accept'])
    const locale = cds.context.locale || cds.env.i18n.default_language

    // REVISIT: edm(x) and etag cache is only evicted with model
    const csnService = (cds.context.model || cds.model).definitions[service.definition.name]
    const metadataCache = (csnService.metadataCache = csnService.metadataCache || { jsonEtag: {}, xmlEtag: {} }) // REVISIT: yet another uncontrolled cache?

    const etag = format === 'json' ? metadataCache.jsonEtag?.[locale] : metadataCache.xmlEtag?.[locale]

    if (req.headers['if-match']) {
      if (etag) {
        const valid = validate_etag(req.headers['if-match'], etag)
        if (!valid) return res.status(412).end()
      }
    }

    if (req.headers['if-none-match']) {
      if (etag) {
        const unchanged = validate_etag(req.headers['if-none-match'], etag)
        if (unchanged) {
          res.set('ETag', etag)
          return res.sendStatus(304)
        }
      }
    }

    const { 'cds.xt.ModelProviderService': mps } = cds.services
    if (mps) {
      if (format === 'json') {
        LOG._warn && LOG.warn('JSON metadata is not supported in case of cds.requires.extensibility: true')
        const msg = 'JSON metadata is not supported for this service'
        return next(Object.assign(new Error(msg), { statusCode: 501 }))
      }

      const { tenant, features } = cds.context

      try {
        let edmx
        // If no extensibility nor fts, do not provide model to mtxs
        const modelNeeded = cds.env.requires.extensibility || features?.given
        edmx =
          metadataCache.edm ||
          (await mps.getEdmx({
            tenant,
            model: modelNeeded ? await mps.getCsn(tenant, features) : undefined,
            service: service.definition.name
          }))
        metadataCache.edm = edmx
        const extBundle = cds.env.requires.extensibility && (await mps.getI18n({ tenant, locale }))
        edmx = cds.localize(service.model, locale, edmx, extBundle)
        metadataCache.xmlEtag[locale] = generateEtag(edmx)
        res.set('ETag', metadataCache.xmlEtag[locale])
        res.set('Content-Type', 'application/xml')
        res.send(edmx)
        return
      } catch (e) {
        if (LOG._error) {
          e.message = 'Unable to get EDMX for tenant ' + tenant + ' due to error: ' + e.message
          LOG.error(e)
        }
        return next(Object.assign(new Error('503'), { statusCode: 503 }))
      }
    }

    if (format === 'json') {
      const edm =
        metadataCache.edm ||
        (metadataCache.edm = cds.compile.to.edm(service.model, { service: service.definition.name }))
      const localized = cds.localize(service.model, locale, edm)
      metadataCache.jsonEtag[locale] = generateEtag(localized)
      res.set('ETag', metadataCache.jsonEtag[locale])
      return res.json(JSON.parse(localized))
    }

    const edmx =
      metadataCache.edmx ||
      (await _metadataFromFile(service)) ||
      (metadataCache.edmx = cds.compile.to.edmx(service.model, { service: service.definition.name }))
    const localized = cds.localize(service.model, locale, edmx)
    metadataCache.xmlEtag[locale] = generateEtag(localized)
    res.set('ETag', metadataCache.xmlEtag[locale])
    res.set('Content-Type', 'application/xml')
    return res.send(localized)
  }
}
