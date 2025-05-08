const cds = require ('../../index')
const path = '/-/cds/log'

module.exports = class LogService extends cds.Service {

  static serveIn (app) {

    // Secure by basic auth from xsuaa in production
    if (process.env.NODE_ENV === 'production') {
      const { xsuaa } = (process.env.VCAP_SERVICES && JSON.parse(process.env.VCAP_SERVICES)) || {}
      if (xsuaa) {
        const { clientid, clientsecret } = xsuaa[0].credentials
        const secret = 'Basic ' + Buffer.from (clientid + ':' + clientsecret).toString('base64')
        app.use (path, (req, res, next) => {
          const { authorization } = req.headers
          if (!authorization || authorization !== secret) return res.status(401).end()
          next()
        })
      } else {
        // do not offer service if in production and no xsuaa creds
        return
      }
    }

    // serve embedded UI
    const express = require('express')
    app.use (path+'/ui', express.static(__dirname+'/vue.html'))

    // Construct and mount CAP service
    return cds.serve (__dirname+'/model.cds',{silent:true})
    .with(this)
    .at(path)
    .in(app)
  }

  init(){

    const LOG = cds.log('cds.log')

    // tell the UI which app instance this is via header
    const { CF_INSTANCE_INDEX } = process.env
    if (CF_INSTANCE_INDEX) this.before('*', req => req._.res.set('x-app-instance', CF_INSTANCE_INDEX))

    this.on('GET','Loggers', (req)=>{
      let loggers = Object.values(cds.log.loggers).map (_logger)
      let {$search} = req._.req.query
      if ($search) {
        const re = RegExp($search,'i')
        loggers = loggers.filter (l => re.test(l.id) || re.test(l.level))
      }
      return loggers
    })

    this.on('PUT','Loggers', (req)=>{
      const {id} = req.data
      if (!id) return req.reject('No logger id specified in request')
      return _logger (cds.log (id, req.data))
    })

    this.on('debug', (req)=>{
      const [,id] = /debug\(module=([^)]+)\)/.exec(req.params[0]) || []
      if (!id) return req.reject('No logger id specified in request')
      return _logger (cds.log (id, {level:'debug'}))
    })

    this.on('reset', (req)=>{
      const [,id] = /reset\(module=([^)]+)\)/.exec(req.params[0]) || []
      if (!id) return req.reject('No logger id specified in request')
      return _logger (cds.log (id, {level:'info'}))
    })

    this.on('format', (req)=>{
      const $ = req.data
      cds.log.format = (module, level, ...args) => {
        const fmt = []
        if ($.timestamp) fmt.push ('|', (new Date).toISOString())
        if ($.level) fmt.push ('|', _levels[level].padEnd(5))
        if ($.tenant) fmt.push ('|', cds.context && cds.context.tenant)
        if ($.reqid) fmt.push ('|', cds.context && cds.context.id)
        if ($.module) fmt.push ('|', module)
        fmt[0] = '[', fmt.push ('] -', ...args)
        return fmt
      }
      Object.values(cds.log.loggers).forEach (l => l.setFormat (cds.log.format))
      LOG.info('format:',$)
    })
  }

}

const _logger = ({id,level}) => ({id, level:_levels[level] })
const _levels = [ 'SILENT', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE' ]
