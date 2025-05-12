const cds = require('../_runtime/cds')

module.exports = class HttpRequest extends cds.Request {
  constructor(args) {
    super(args)
    this.req = args.req
    this.res = args.res
  }

  get protocol() {
    throw new Error('Not implemented')
  }
}
