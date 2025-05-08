const cds = require ('../../index'), { decodeURIComponent } = cds.utils
const LOG = cds.log('trace')
if (!LOG._debug) module.exports = ()=>[]; else {

  module.exports = (o={}) => {

    // normalize options
    let { truncate:t = 111, skip = { BEGIN:1, COMMIT:2, ROLLBACK:3 } } = o || {}
    if (typeof t !== 'function') o.truncate = !t ? s=>s : s => s.length <= t ? s : s.slice(0,t)+' ...'
    if (typeof skip !== 'function') o.skip = !skip ? ()=>false : x => (x.event||x) in skip
    const _perf = e => !o.skip(e) && cds.context?.http?.req._perf

    // instrument framework services
    _instrument_cds_services (_perf)
    _instrument_better_sqlite (_perf)
    _instrument_sqlite (_perf)

    // the express middleware function
    return function cap_perf_logger (req, res, next) {
      let perf = req._perf || (req._perf = new PerfTrace)
      perf.log (req.method, decodeURIComponent(req.originalUrl))
      res.on('finish', ()=> LOG.debug ('elapsed times:', perf.toString(o)))
      next()
    }
  }

  const { performance } = require ('perf_hooks')
  const { format } = require ('util')

  class PerfTrace extends Array {
    log (...details) {
      const e = { details, start:performance.now() }
      return this.push(e), e
    }
    done (e) {
      return e.stop = performance.now()
    }
    toString ({truncate}) {
      const t0 = this[0].start; if (!this[0].stop) this[0].stop = performance.now()
      return '\n'+ this.map (e => truncate (format (
        (e.start - t0).toFixed(2).padStart(6), '→',
        (e.stop  - t0).toFixed(2).padEnd(6), '=',
        (e.stop  - e.start).toFixed(2).padStart(6), 'ms',
        '-', ...e.details))
      ).join('\n')
    }
  }
}


function _instrument_cds_services (_get_perf) {
  const me = _instrument_cds_services; if (me.done) return; else me.done = true
  const { handle } = cds.Service.prototype
  cds.Service.prototype.handle = function (req) {
    const perf = _get_perf(req)
    if (perf) {
      const pe = perf.log (this.name, '-', req.event, req.path||'')
      var _done = () => perf.done(pe)
    }
    return handle.apply (this, arguments) .finally (_done)
  }
}

let sqlite
function _instrument_sqlite (_get_perf) {
  const me = _instrument_sqlite; if (me.done) return; else me.done = true
  try { require.resolve('sqlite3') } catch { return }
  sqlite = require('sqlite3').Database.prototype
  for (let each of ['all', 'get', 'run', 'prepare']) _wrap(each,sqlite)
  function _wrap (op,sqlite) {
    const _super = sqlite[op]
    sqlite[op] = function (q, ..._) {
      const perf = _get_perf(q) //> q is a SQL command like BEGIN, COMMIT, ROLLBACK, SELECT ...
      if (perf) {
        const pe = perf.log ('sqlite3', '-', q)
        const callback = _[_.length-1]; _[_.length-1] = function(){
          if (op === 'prepare') callback.apply (this, {
            all: _wrap('all',sqlite),
            get: _wrap('get',sqlite),
            run: _wrap('run',sqlite),
          }); else {
            perf.done(pe)
            callback.apply (this, arguments)
          }
        }
      }
      return _super.call (this, q, ..._)
    }
  }
}

function _instrument_better_sqlite (_get_perf) {
  const me = _instrument_better_sqlite; if (me.done) return; else me.done = true
  try { require.resolve('better-sqlite3') } catch { return }
  const sqlite = require('better-sqlite3').prototype
  for (let each of ['exec', 'prepare']) _wrap(each,sqlite)
  function _wrap (op,sqlite) {
    const _super = sqlite[op]
    sqlite[op] = function (q, ..._) {
      const perf = _get_perf(q) //> q is a SQL command like BEGIN, COMMIT, ROLLBACK, SELECT ...
      if (perf) {
        const pe = perf.log ('better-sqlite3', '-', q)
        try {
          const x = _super.call (this, q, ..._)
          if (op === 'prepare') return {
            all(..._){ try { return x.all(..._) } finally { perf.done(pe) }},
            get(..._){ try { return x.get(..._) } finally { perf.done(pe) }},
            run(..._){ try { return x.run(..._) } finally { perf.done(pe) }},
          }
          else return perf.done(pe), x
        }
        catch(e) { perf.done(pe); throw e }
      }
      else return _super.call (this, q, ..._)
    }
  }
}
