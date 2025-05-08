module.exports = ()=> {

  const cds = require ('../../index'), LOG = cds.log()
  const context_model_required = cds.requires.extensibility || cds.requires.toggles
  if (!context_model_required) return []

  const { model4 } = require('../srv-models')
  return async function cds_context_model (req,res, next) {
    if (req.baseUrl.startsWith('/-/')) return next() //> our own tech services cannot be extended
    const ctx = cds.context
    if (ctx.tenant || ctx.features?.given) try {
      ctx.model = req.__model = await model4 (ctx.tenant, ctx.features) // REVISIT: req.__model is because of Okra
    } catch (e) {
      LOG.error(e)
      return res.status(503) .json ({ // REVISIT: we should throw a simple error, nothing else! -> this is overly OData-specific!
        error: { code: '503', message:
          process.env.NODE_ENV === 'production' ? 'Service Unavailable' :
          'Unable to get context-specific model due to: ' + e.message
        }
      })
    }
    next()
  }

}
