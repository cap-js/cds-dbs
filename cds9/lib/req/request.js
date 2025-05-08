const cds = require('../index'), {production} = cds.env
const { Responses, Errors } = require('./response')

/**
 * Class Request represents requests received via synchronous protocols.
 * It extends its base class Event by methods to return results, errors
 * or info messages.
 */
class Request extends require('./event') {

  constructor(_) { super(_)
    /** For IntelliSense only: @type import('../ql/cds.ql-Query') */
    this.query
  }

  toString() { return `${this.event} ${this.path}` }

  get assert(){ return super.assert = require('./assert')(this) }

  set method(m) { if (m) super.method = m }
  get method() {
    return this._set ('method', Crud2Http[this.event] || this.event)
  }

  set event(e) { if (e) super.event = e }
  get event() {
    if (this._.method) return this._set ('event', Http2Crud[this._.method] || this._.method)
    if (this.query) return this._set ('event', Query2Crud(this.query))
    return this._set ('event', undefined)
  }

  set entity(e) { if (e) super.entity = e.name ? (this.target = e).name : e }
  get entity() {
    return this._set ('entity', this.target?.name)
  }

  set params(p) { if (p) super.params = p }
  get params() {
    return this._set ('params', [])
  }

  set path(p) { if (p) super.path = p.startsWith('/') ? p.slice(1) : p }
  get path() {
    const q = this.query; if (this.query) { // IMPORTANT: Bulk queries don't have a _.query
      if (q.SELECT) return this._set ('path', _path4 (q.SELECT,'from'))
      if (q.INSERT) return this._set ('path', _path4 (q.INSERT,'into'))
      if (q.UPSERT) return this._set ('path', _path4 (q.UPSERT,'into'))
      if (q.UPDATE) return this._set ('path', _path4 (q.UPDATE,'entity'))
      if (q.DELETE) return this._set ('path', _path4 (q.DELETE,'from'))
    }
    const {_} = this
    if (_.target) return this._set ('path', _.target.name)
    if (_.entity) return this._set ('path', _.entity.name || _.entity)
    return this._set ('path', undefined)
  }

  set data(d) { if (d) super.data = d }
  get data() {
    const q = this.query; if (!q) return this._set ('data', undefined)
    const I = q.INSERT || q.UPSERT; if (I) return this._set ('data', I.rows || I.values || I.entries && (I.entries.length > 1 ? I.entries : I.entries[0]) ||{})
    const U = q.UPDATE; if (U) return this._set ('data', U.data ||{})
    return this._set ('data', {})
  }

  set subject(d) { if (d) super.subject = d }
  get subject() {
    const q = this.query
    if (q) {
      let subject = q._subject
        || q.SELECT?.from
        || q.INSERT?.into
        || q.UPSERT?.into
        || q.UPDATE?.entity
        || q.DELETE?.from
      if (!subject) return super.subject = undefined
      while ('SELECT' in subject) subject = subject.SELECT.from
      return super.subject = { ref: subject.ref } // REVISIT: copy is neccessary for now, as there's code modifying req.subject
    }

    const {target} = this; if (!target) return super.subject = undefined
    const where = []
    for (const param of this.params) {
      if (typeof param === 'object') {
        for (const key in param) {
          if (key in target.keys) {
            if (where.length > 1) where.push('and')
            where.push({ ref: [key] }, '=', { val: param[key] })
          }
        }
      } else {
        where.push({ ref: [Object.keys(target.keys)[0]] }, '=', { val: param })
      }
    }
    const ref = [{ id: target.name, where }]
    return super.subject = { ref }
  }

  reply (results, ...etc) {
    if (etc.length) Object.assign (results, ...etc)
    return this.results = results
  }
  notify (...args) { return this._messages.add (1, ...args) }
  info   (...args) { return this._messages.add (2, ...args) }
  warn   (...args) { return this._messages.add (3, ...args) }
  error  (...args) { return this._errors.add (4, ...args) }
  reject (...args) {
    if (args.length === 0 && this.errors) {
      let errs = this.errors
      if (errs.length === 1) throw errs[0]
      let me = new cds.error ('MULTIPLE_ERRORS', { details: errs }, this.reject)
      if (!production) me.stack += errs.map (e => '\n---------------------------------\n'+ e.stack
        .replace('\n',': '+ (e.element||e.target||'')+'\n---------------------------------\n')
        .replace(/^Error: /,'')
      ).join('')
      throw me
    }
    let e = this.error(...args)
    if (!e.stack) Error.captureStackTrace (e = Object.assign(new Error,e), this.reject)
    if (!e.message) e.message = String (e.code || e.status)
    throw e
  }

  // Lazily create message collectors for .errors and .messages
  /** @private */ get _messages() { return this.messages = this._set ('_messages', new Responses) }
  /** @private */ get _errors() { return this.errors = this._set ('_errors', new Errors) }
}

module.exports = Request


//
//  Helpers...
//

const Crud2Http = {
  READ: 'GET',
  CREATE: 'POST',
  UPDATE: 'PATCH',
  UPSERT: 'PUT',
  DELETE: 'DELETE',
}

const Http2Crud = {
  POST: 'CREATE',
  GET: 'READ',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
}

const SQL2Crud = {
  SELECT:   'READ',
  INSERT:   'CREATE',
  UPSERT:   'UPSERT',
  UPDATE:   'UPDATE',
  DELETE:   'DELETE',
  BEGIN:    'BEGIN',
  COMMIT:   'COMMIT',
  ROLLBACK: 'ROLLBACK',
  CREATE:   'CREATE ENTITY',
  DROP:     'DROP ENTITY',
}

const Query2Crud = (q) => {
  for (let each in q) if (each in SQL2Crud) return SQL2Crud[each]
}

const _path4 = (x,p) => {
  const name = x[p]
  if (typeof name === 'string') return name
  if (name.ref) return name.ref.map(x=>x.id||x).join('/')
  else return '<complex query>'
}


//////////////////////////////////////////////////////////////////////////
//
//  REVISIT: Legacy stuff...
//
Object.defineProperty (Request.prototype, 'diff', {
  get() {
    const { reqDiff: diff } = require ('../../libx/_runtime/common/utils/differ')
    Object.defineProperty (Request.prototype, 'diff', { value: diff })
    return diff
  },
  configurable: true
})
