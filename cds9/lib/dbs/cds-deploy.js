#!/usr/bin/env node
const cds = require('../index'), { local, path } = cds.utils
const DEBUG = cds.debug('deploy')
const TRACE = cds.debug('trace')


/** Fluent API: cds.deploy(model).to(db) */
const deploy = module.exports = function cds_deploy (model, options, csvs) {

  return { async to (/** @type {import('../srv/cds.Service')} */ db, o = options||{}) {
    /* eslint-disable no-console */

    // prepare logging
    const [ GREY, RESET ] = process.stdout.isTTY && !process.env.NO_COLOR || process.env.FORCE_COLOR ? ['\x1b[2m', '\x1b[0m' ] : ['','']
    const LOG = !o.silent && !o.dry && cds.log('deploy')._info ? console.log : undefined

    // prepare model
    if (!model) throw new Error('Must provide a model or a path to model, received: ' + model)
    if (!model?.definitions) model = await cds.load(model).then(cds.minify)
    if (o.mocked) deploy.include_external_entities_in(model)
    else deploy.exclude_external_entities_in(model)

    // prepare db
    if (!db.run) db = await cds.connect.to(db)
    if (!cds.db) cds.db = cds.services.db = db
    if (!db.model) db.model = model // NOTE: this calls compile.for.nodejs! Has to happen here for db/init.js to access cds.entities
    // NOTE: This ^^^^^^^^^^^^^^^^^ is to support tests that use cds.deploy() to bootstrap a functional db like so:
    // const db = await cds.deploy ('<filename>') .to ('sqlite::memory:')

    // prepare db description for log output below
    let descr = db.url4 (cds.context?.tenant)
    if (descr === ':memory:') descr = 'in-memory database.'
    else if (!descr.startsWith('http:')) descr = local (descr)

    // deploy schema and initial data...
    try {
      const _run = fn => o.dry ? fn(db) : db.run(fn)
      await _run (async tx => {
        let any = await deploy.schema (tx, model, o)
        if ((any || csvs) && !o.dry) await deploy.data (tx, model, o, csvs, file => LOG?.(GREY, ' > init from', local(file), RESET))
      })
      LOG?.('/> successfully deployed to', descr, '\n')
    } catch (e) {
      LOG?.('/> deployment to', descr, 'failed\n')
      throw e
    }
    return db
  },

  // Also support await cds.deploy()...
  then(n, e) {
    return this.to(cds.db || cds.requires.db && 'db' || 'sqlite::memory:').then(n,e)
  },
  catch(e) {
    return this.to(cds.db || cds.requires.db && 'db' || 'sqlite::memory:').catch(e)
  },
}}

/** Deploy database schema, i.e., generate and apply SQL DDL. */
deploy.schema = async function (db, csn = db.model, o) {

  if (!o.to || o.to === db.options.kind)  o = { ...db.options, ...o }
  let schema_log
  if (Array.isArray(o.schema_log)) schema_log = { log: (...args) => args.length ? o.schema_log.push(...args) : o.schema_log.push('') }
  else if (o.dry)                  schema_log = console

  let drops, creas
  let schevo = (o.kind === 'postgres' && o.schema_evolution !== false)
  || o.schema_evolution === 'auto'
  || o['with-auto-schema-evolution']
  || o['model-only']
  || o['delta-from']
  if (schevo) {
    const { prior, table_exists } = await get_prior_model()
    const { afterImage, drops: d, createsAndAlters } = cds.compile.to.sql.delta(csn, o, prior);
    const after = JSON.stringify(afterImage)
    if (!o.dry && after != prior) {
      if (!table_exists) {
        const CLOB = o.dialect === 'postgres' || o.kind === 'postgres' ? 'text' : 'CLOB'
        await db.run(`CREATE table cds_model (csn ${CLOB})`)
        await db.run(`INSERT into cds_model values (?)`, after)
      } else {
        await db.run(`UPDATE cds_model SET csn = ?`, after)
      }
    }
    o.schema_evolution = 'auto' // for INSERT_from4 below
    // cds deploy --model-only > fills in table cds_model above
    if (o['model-only']) return o.dry && schema_log.log(after)
    // cds deploy -- with auto schema evolution > upgrade by applying delta to former model
    creas = createsAndAlters
    drops = d
  } else {
    // cds deploy -- w/o auto schema evoution > drop-create db
    creas = cds.compile.to.sql(csn,o) // NOTE: this used to call cds.linked(cds.minify) and thereby corrupted the passed in csn
  }

  TRACE?.time('cds.deploy schema'.padEnd(22))

  if (!drops) {
    drops = [];
    creas.forEach(each => {
        // For postgres, we add constraints via "ALTER TABLE" - so our regex might not match.
        let [, kind, entity] = each.match(/^CREATE (TABLE|VIEW) ("[^"]+"|[^\s(]+)/im) || []
        if(kind && entity)
          drops.push(`DROP ${kind} IF EXISTS ${entity};`);
      });

    drops.reverse()
  }


  if (!drops.length && !creas.length) return !o.dry

  if (schema_log) {
    schema_log.log(); for (let each of drops) schema_log.log(each)
    schema_log.log(); for (let each of creas) schema_log.log(each, '\n')
  }
  if (o.dry)  return

  await db.run(drops)
  await db.run(creas)

  TRACE?.timeEnd('cds.deploy schema'.padEnd(22))
  return true

  async function get_prior_model() {
    let file = o['delta-from']
    if (file) {
      let prior = await cds.utils.read (file)
      return { prior: typeof prior === 'string' ? JSON.parse(prior) : prior }
    }
    if (o.dry) return {}

    let [table_exists] = await db.run(
      db.kind === 'postgres' ? `SELECT 1 from pg_tables WHERE tablename = 'cds_model' and schemaname = current_schema()` :
      db.kind === 'sqlite' ? `SELECT 1 from sqlite_schema WHERE name = 'cds_model'` :
      cds.error`Schema evolution is not supported for ${db.kind} databases`,
    )

    if (o['model-only'])
      return { table_exists };

    if (table_exists) {
      let [{ csn }] = await db.run('SELECT csn from cds_model')
      return { prior: csn && JSON.parse(csn), table_exists }
    }
    return { table_exists } // no prior csn
  }
}


/** Deploy initial data */
deploy.data = async function (db, csn = db.model, o, srces, log=()=>{}) {

  const t = cds.context?.tenant; if (t && t === cds.requires.multitenancy?.t0) return

  return db.run (async tx => {
    TRACE?.time('cds.deploy data'.padEnd(22))

    const m = tx.model = cds.compile.for.nodejs(csn) // NOTE: this used to create a redundant 4nodejs model for the same csn
    const data = await deploy.prepare (m,srces)
    const query = _queries4 (db,m)
    const INSERT_from = INSERT_from4 (db,m,o)

    for await (let [ file, entity, src ] of data) {
      log (file)
      if (entity) {
        const q = INSERT_from (file) .into (entity, src)
        if (q) try { await tx.run (query(q)) } catch(e) {
          throw Object.assign (e, { message: 'in cds.deploy(): ' + e.message +'\n'+ cds.utils.inspect(q, {depth:11}) })
        }
      } else {  //> init.js/ts case
        if (typeof src === 'function') await src(tx,csn)
      }
    }

    TRACE?.timeEnd('cds.deploy data'.padEnd(22))
  })


  /** Prepare special handling for new db services */
  function _queries4 (db, m) {
    return !db.cqn2sql ? q => q : q => {
      const { columns, rows } = q.INSERT || q.UPSERT; if (!columns) return q // REVISIT: .entries are covered by current runtime -> should eventually also be handled here
      const entity = m.definitions[q._target.name]

      // Fill in missing primary keys...
      const { uuid } = cds.utils
      for (let k in entity.keys) if (entity.keys[k].isUUID && !columns.includes(k)) {
        columns.push(k)
        rows.forEach(row => row.push(uuid()))
      }

      // Fill in missing managed data...
      const pseudos = { $user: 'anonymous', $now: (new Date).toISOString() }
      for (let k in entity.elements) {
        const managed = entity.elements[k]['@cds.on.insert']?.['=']
        if (managed && !columns.includes(k)) {
          columns.push(k)
          rows.forEach(row => row.push(pseudos[managed]))
        }
      }
      return q
    }
  }

  function INSERT_from4 (db,m,o) {
    const schevo = o?.schema_evolution === 'auto' || db.options.schema_evolution === 'auto'
    const INSERT_into = (schevo ? UPSERT : INSERT).into
    return (file) => ({
      '.json': { into (entity, json) {
        let records = JSON.parse(json); if (!records.length) return
        _add_ID_texts4 (entity, m, records)
        return INSERT_into(entity).entries(records)
      }},
      '.csv': { into (entity, csv) {
        let [cols, ...rows] = cds.parse.csv(csv); if (!rows.length) return
        _add_ID_texts4 (entity, m, rows, cols)
        return INSERT_into(entity).columns(cols).rows(rows)
      }},
    }) [path.extname(file)]
  }

  /**
   * Fills in missing ID_texts for respective .texts entities.
   * IMPORTANT: we use UUIDs generated from hashes of all original key values (ID, locale, ...)
   * to ensure same ID_texts values for same keys across different deployments.
   */
  function _add_ID_texts4 (entity, m, records, cols) {
    if (entity.name)  entity = entity.name  //> entity can be an entity name or a definition
    if (!m.definitions[entity]?.keys?.ID_texts) return // it's not a .texts entity with ID_texts key
    if ((cols || Object.keys(records[0])).includes('ID_texts')) return // already there
    else DEBUG?.(`adding ID_texts for ${entity}`)
    const keys = Object.keys (m.definitions[entity.slice(0,-6)].keys) .concat ('locale')
    const crypto = require('crypto')
    if (cols) {
      cols.push ('ID_texts')
      const indexes = keys.map (k => cols.indexOf(k))
      for (let each of records) each.push (_uuid4(each,indexes))
    } else {
      for (let each of records) each.ID_texts = _uuid4(each,keys)
    }
    function _uuid4 (data, keys) {
      const s = keys.reduce ((s,k) => s + data[k],'')
      const h = crypto.createHash('md5').update(s).digest('hex')
      return h.slice(0,8) + '-' + h.slice(8,12) + '-' + h.slice(12,16) + '-' + h.slice(16,20) + '-' + h.slice(20)
    }
  }
}


/** Prepare input from .csv, .json, init.js, ... */
deploy.prepare = async function (csn, srces) {
  // In case of extension deployment .csv or .json input are provided through argument `srces`.
  if (srces) return Object.entries(srces) .map (([file, src]) => {
    let e = _entity4 (path.basename(file,'.csv'), csn)
    return [ file, e, src ]
  })
  // If not, we load them from cds.deploy.resources(csn)
  const data = []
  const resources = await deploy.resources(csn, { testdata: cds.env.features.test_data })
  const resEntries = Object.entries(resources).reverse() // reversed $sources, relevant as UPSERT order
  for (const [file,e] of resEntries) {
    if (e === '*') {
      let init_js = await cds.utils._import (file)
      data.push([ file, null, init_js.default || init_js ])
    } else {
      let src = await cds.utils.read (file, 'utf8')
      data.push([ file, e, src ])
    }
  }
  return data
}


/** Resolve initial data resources for given model */
deploy.resources = async function (csn, opts) {
  if (!csn || !csn.definitions) csn = await cds.load (csn||'*') .then (cds.minify)
  const { fs, isdir, isfile } = cds.utils
  const folders = await deploy.folders(csn, opts)
  const found={}, ts = process.env.CDS_TYPESCRIPT
  for (let folder of folders) {
    // fetching .csv and .json files
    for (let each of ['data','csv']) {
      const subdir = isdir(folder,each); if (!subdir) continue
      const files = await fs.promises.readdir (subdir)
      for (let fx of files) {
        if (fx[0] === '-') continue
        const ext = path.extname(fx); if (ext in {'.csv':1,'.json':2}) {
          const f = fx.slice(0,-ext.length)
          if (/[._]texts$/.test(f) && files.some(g => g.startsWith(f+'_'))) {
            // ignores 'Books_texts.csv/json' if there is any 'Books_texts_LANG.csv/json'
            DEBUG?.(`ignoring '${fx}' in favor of translated ones`)
            continue
          }
          const e = _entity4(f,csn); if (!e || e['@cds.persistence.skip'] === true) continue
          if (cds.env.features.deploy_data_onconflict === 'replace' && !/[._]texts_/.test(f)) {
            const seenBefore = Object.entries(found).find(([,entity]) => entity === e.name )
            if (seenBefore) {
              DEBUG?.(`Conflict for '${e.name}': replacing '${local(seenBefore[0])}' with '${local(path.join(subdir,fx))}'`)
              continue
            }
          }
          found[path.join(subdir,fx)] = e.name
        }
      }
    }
    // fetching init.js files -> Note: after .csv files to have that on top, when processing in .reverse order
    const init_js = ts && isfile(folder,'init.ts') || isfile(folder,'init.js')
    if (init_js) found[init_js] = '*'
  }
  return found
}


/** Resolve folders to fetch for initial data resources for given model */
deploy.folders = async function (csn, o={}) {
  if (!csn || !csn.definitions) csn = await cds.load (csn||'*') .then (cds.minify)
  const folders = new Set (csn.$sources.map (path.dirname) .filter (f => f !== cds.home))
  if (cds.env.folders.db) folders.add (path.resolve(cds.root, cds.env.folders.db))
  if (o.testdata) folders.add (path.resolve(cds.root,'test/'))
  return folders
}


/** Include external entities in the given model */
deploy.include_external_entities_in = function (csn) {
  if (csn._mocked) return csn; else Object.defineProperty(csn,'_mocked',{value:true})
  for (let each in csn.definitions) {
    const def = csn.definitions[each]
    if (def['@cds.persistence.mock'] === false) continue
    if (def['@cds.persistence.skip'] === true) {
      DEBUG?.('including mocked', each)
      delete def['@cds.persistence.skip']
    }
  }
  deploy.exclude_external_entities_in (csn)
  return csn
}

/** Exclude external entities from the given model */
deploy.exclude_external_entities_in = function (csn) {
  // IMPORTANT to use cds.env.requires below, not cds.requires !!
  for (let [each,{service=each,model,credentials}] of Object.entries (cds.env.requires)) {
    if (!model) continue //> not for internal services like cds.requires.odata
    if (!credentials && csn._mocked) continue //> not for mocked unbound services
    DEBUG?.('excluding external entities for', service, '...')
    const prefix = service+'.'
    for (let each in csn.definitions) if (each.startsWith(prefix)) _exclude (each)
  }
  return csn

  function _exclude (each) {
    const def = csn.definitions[each]; if (def.kind !== 'entity') return
    if (def['@cds.persistence.table'] === true) return // do not exclude replica table
    DEBUG?.('excluding external entity', each)
    def['@cds.persistence.skip'] = true
    // propagate to all views on top...
    for (let other in csn.definitions) {
      const d = csn.definitions[other]
      const p = d.query && d.query.SELECT || d.projection
      if (p && p.from.ref && p.from.ref[0] === each) _exclude (other)
    }
  }

}


/** Helper for resolving entity for given .csv file */
const _entity4 = (file, csn) => {
  const name = file.replace(/-/g,'.')
  const entity = csn.definitions [name]
  if (!entity) {
    if (/(.+)[._]texts_?/.test(name)) { // 'Books.texts', 'Books.texts_de'
      const base = csn.definitions [RegExp.$1]
      return base?.elements?.texts && _entity4 (base.elements.texts.target, csn)
    }
    else return DEBUG?.(`warning: ${name} not in model`)
  }
  // We also support insert into simple views if they have no projection
  const p = entity.query && entity.query.SELECT || entity.projection
  if (p && !p.columns && p.from.ref && p.from.ref.length === 1) {
    if (csn.definitions [p.from.ref[0]])  return entity
  }
  return entity.name ? entity : { name, __proto__:entity }
}

/** CLI used as via cds-deploy as deployer for PostgreSQL */
if (!module.parent) (async function CLI () {
  cds.cli = { command: 'deploy', argv: process.argv.slice(2), options: {} }
  await cds.plugins // IMPORTANT: that has to go before any call to cds.env, like through cds.deploy or cds.requires below
  let db = cds.requires.db
  try {
    let o={}, recent
    for (let each of process.argv.slice(2)) {
      if (each.startsWith('--')) o[(recent = each.slice(2))] = true
      else o[recent] = each
    }
    if (o.to) {
      db = { kind: o.to, dialect: o.to }
      if (o.url) (db.credentials ??= {}).url = o.url
      if (o.host) (db.credentials ??= {}).host = o.host
      if (o.port) (db.credentials ??= {}).port = o.port
      if (o.username) (db.credentials ??= {}).username = o.username
      if (o.password) (db.credentials ??= {}).password = o.password
    }
    cds.cli.options = o
    db = await cds.connect.to(db);
    db = await cds.deploy('*',o).to(db)
  } finally {
    await db?.disconnect?.()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
