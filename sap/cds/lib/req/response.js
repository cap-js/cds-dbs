const cds = require ('../index')
const placeholders = [...'x'.repeat(9)].map((x,i) => `{${i+1}}`)

/**
 * Messages Collector, used for `req.errors` and `req.messages`
 */
class Responses extends Array {
  static get (severity, code, message, target, args) {
    let e // be filled in below...
    if (code?.raw) {
      if (typeof message === 'object') {
        target = Object.keys(message)[0]
        args = [ ...arguments ].slice(3)
        e = {
          message: String.raw (code, target, ...args),
          target, text: '{0} '+ String.raw (code,'', ...placeholders.slice(0,args.length)).trim(),
          args,
        }
      } else e = {
        message: String.raw (code, ...[...arguments].slice(2))
      }
    } else {
      if (typeof code === 'object') e = code; else {
        if (typeof code === 'number') e = { code }; else [ code, message, target, args, e ] = [ undefined, code, message, target, {} ]
        if (typeof message === 'object') e = Object.assign(message,e); else {
          if (typeof target === 'object') [ target, args ] = [ undefined, target ]
          if (message) e.message = message //; else if (code) e.message = String(code)
          if (target) e.target = target
          if (args) e.args = args
        }
      }
    }
    if (!e.numericSeverity) e.numericSeverity = severity
    return e
  }

  add (...args) {
    const response = Responses.get(...args)
    this.push(response)
    return response
  }
}

class Errors extends Responses {
  push(e) {
    'stack' in e || Error.captureStackTrace (e = Object.assign(new Error,e), cds.Request.prototype.error)
    return super.push(e)
  }
}

module.exports = { Responses, Errors }
