const cds = require('@sap/cds')
const {dirname, relative, join} = require('path')

// Only for local cds runs w/o approuter:
// If there is a relative URL in UI5's manifest.json for the datasource,
// like 'browse/' or 'prefix/browse/', we get called with a prefix to the
// service path, like '/browse/webapp/browse/'.
// Serve these requests by redirecting to the actual service URL.
cds.on ('bootstrap', app => {

  const { env, utils:{find,fs}} = cds
  if (!env.fiori.routes)  return

  const serviceForUri = {}
  const DEBUG = cds.debug('fiori/routes')

  dataSourceURIs (env.folders.app).forEach(({appPath, dataSourceUri}) => {
    const uiRoutes = [
      join('/', appPath,      dataSourceUri, '*'), //  /uiApp/webapp/browse/*
      join('/', appPath, '*', dataSourceUri, '*')  //  /uiApp/webapp/*/browse/*
    ].map(r => r.replace(/\\/g, '/')) // handle Windows \
    DEBUG && DEBUG ('Register routes', uiRoutes)

    app.use(uiRoutes, ({originalUrl}, res, next)=> {
      // any of our special URLs ($fiori-, $api-docs) ? -> next
      if (originalUrl.startsWith('/$'))  return next()

      // plugins may have modified env, so read prefixes here in the handler, not at top
      const v2Prefix = env.protocols?.['odata-v2']?.path || env.odata.v2proxy?.path || '/odata/v2'
      const v4Prefix = env.protocols?.['odata-v4']?.path || '/odata/v4'

      // is there a service for '[prefix]/browse' ?
      const normalizedDataSourceUri = '/'+dataSourceUri
      const pathRegex = url => new RegExp(url + '(/|$)')
      const srv = serviceForUri[dataSourceUri] ??= cds.service.providers.find (srv => {
        if (!srv.path) return
        if (normalizedDataSourceUri.match(pathRegex(srv.path))) return true
        // is it a request to v2 proxy targeting a v4 service with protocol prefix?
        if (normalizedDataSourceUri.match(pathRegex(srv.path.replace(v4Prefix,'')))) return true
      })
      if (srv) {
        // only check path relative to optional protocol prefix
        const relSrvPath = srv.path.replace(v4Prefix,'')
        let redirectUrl
        // odata-proxy may be in the line with its /v2 prefix.  Make sure we retain it.
        const v2Index = originalUrl.lastIndexOf(v2Prefix+relSrvPath)
        if (v2Index >= 0)  // --> /browse/webapp[/prefix]/v2/browse/ -> /v2/browse
          redirectUrl = originalUrl.substring(v2Index)
        else // --> /browse/webapp[/prefix]/browse/ -> /browse
          redirectUrl = originalUrl.substring(originalUrl.lastIndexOf(srv.path+'/'))
        if (originalUrl !== redirectUrl)  {// safeguard to prevent running in loops
          DEBUG && DEBUG ('Redirecting', {src: originalUrl}, '~>', {target: redirectUrl})
          return res.redirect (308, redirectUrl)
        }
      }
      next()
    })
  })

  function dataSourceURIs (dir) {
    const uris = new Set()
    find (dir, ['*/manifest.json', '*/*/manifest.json']).forEach(file => {
      const appPath = relative(join(cds.root, dir), dirname(file))
      const {dataSources: ds} = JSON.parse(fs.readFileSync(file))['sap.app'] || {}
      Object.keys (ds||[])
        .filter (k => ds[k].uri && !ds[k].uri.startsWith('/')) // only consider relative URLs)
        .forEach(k => uris.add({ appPath, dataSourceUri: ds[k].uri }))
    })
    return uris
  }

})
