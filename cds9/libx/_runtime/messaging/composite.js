const cds = require('../cds')
const MessagingService = require('./service.js')

class Composite extends MessagingService {
  async init() {
    const _globToRegExp = string =>
      string &&
      string
        .replace(/\*\*/g, '.<stars>')
        .replace(/\*/g, '[^/.]*')
        .replace(/\?/g, '[^/.]')
        .replace(/<stars>/g, '*')
    const { routes } = this.options
    const keys = routes ? Object.keys(routes) : []
    const services = await Promise.all(keys.map(each => cds.connect.to(each)))
    const channels = keys.map(each =>
      routes[each].map(route => {
        if (typeof route === 'string') return { event: _globToRegExp(route) }
        if (typeof route === 'object') return { event: _globToRegExp(route.event), entity: _globToRegExp(route.entity) }
      })
    )

    // TODO: Match entity
    this._foreach = (event, callback) =>
      channels.map((each, i) => {
        for (const route of each) {
          if (event.match(route.event)) {
            return callback(services[i])
          }
        }
      })
    return super.init()
  }

  on(event, handler) {
    this._foreach(event, srv => srv.on(event, handler))
  }

  emit(eve, ...etc) {
    const context = this.context
    const event = typeof eve === 'object' ? eve.event : eve
    return Promise.all(
      this._foreach(event, srv => (context ? srv.tx(context).emit(eve, ...etc) : srv.emit(eve, ...etc)))
    )
  }
}
module.exports = Composite
