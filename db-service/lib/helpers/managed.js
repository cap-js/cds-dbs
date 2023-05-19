const cds = require('@sap/cds/lib'),
  DEBUG = cds.log('managed')

module.exports = (db = cds.db) => {
  for (let entity of db.entities) {
    const on_insert = Object.values(entity.elements).filter(e => e['@cds.on.insert'])
    if (on_insert.length) {
      DEBUG?.('Handling', '@cds.on.insert', 'for entity', entity.name)

      db.before(['INSERT', 'UPSERT'], entity, onINSERT.bind(null, on_insert))
    }

    const on_update = Object.values(entity.elements).filter(e => e['@cds.on.update'])
    if (on_update.length) {
      DEBUG?.('Handling', '@cds.on.update', 'for entity', entity.name)

      db.before('UPSERT', entity, onINSERT.bind(null, on_update))
      db.before('UPDATE', entity, onUPDATE.bind(null, on_update))
    }
  }
}

function onINSERT(on, req) {
  const cqn = req.query.INSERT || req.query.UPSERT
  const ctx = _context()
  if (cqn.entries)
    for (let each of cqn.entries) {
      for (let e of on)
        if (!(e.name in each)) {
          each[e.name] = _value4(e, '@cds.on.insert', ctx)
        }
    }
  else {
    const { columns } = cqn,
      rows = cqn.rows || [cqn.values]
    for (let e of on)
      if (!columns.includes(e.name)) {
        columns.push(e.name)
        for (let each of rows) {
          each.push(_value4(e, '@cds.on.insert', ctx))
        }
      }
  }
}

function onUPDATE(on, req) {
  let ctx,
    { data = {}, with: _with = {} } = req.query.UPDATE
  for (let e of on) {
    if (e.name in _with || e.name in data) continue
    data[e.name] = _value4(e, '@cds.on.update', (ctx ??= _context()))
  }
}

function _value4(def, anno, ctx) {
  const fn = _pseudos[def[anno]['=']]
  if (fn) return fn(ctx)
  else throw cds.error`${def.name} ${anno} to be $now or $user, but got ${def[anno]}`
}

const _pseudos = {
  $now: ctx => ctx.timestamp,
  $user: ctx => ctx.user.id
  // REVISIT: Did we ever officially support anything else?
}

const _context = () =>
  cds.context || {
    user: cds.User.anonymous,
    timestamp: new Date()
  }
