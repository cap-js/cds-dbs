#!/usr/bin/env node
const cds = require('@sap/cds/lib'),
  { local } = cds.utils
const COLORS = !!process.stdout.isTTY && !!process.stderr.isTTY
const GREY = COLORS ? '\x1b[2m' : ''
const RESET = COLORS ? '\x1b[0m' : ''

module.exports = exports = cds_deploy

function cds_deploy(model, options, csvs) {
  return {
    /** @param {import('@sap/cds/lib/srv/srv-api')} db */
    async to(db, o = options || cds.options || {}) {
      const TRACE = cds.debug('trace')
      try {
        TRACE?.time('cds.deploy db  ')

        if (!model) throw new Error('Must provide a model or a path to model, received: ' + model)
        if (model && !model.definitions) model = await cds.load(model).then(cds.minify)

        if (o.mocked) exports.include_external_entities_in(model)
        else exports.exclude_external_entities_in(model)

        if (!db.run) db = await cds.connect.to(db)
        if (!cds.db) cds.db = cds.services.db = db
        if (!db.model) db.model = model

        // eslint-disable-next-line no-console
        const LOG = o.silent || o.dry || !cds.log('deploy')._info ? () => {} : console.log
        const _deploy = async tx => {
          // create / update schema
          let any = await exports.create(tx, model, o)
          if (!any && !csvs) return db
          // fill in initial data
          await exports.init(tx, model, o, csvs, file => LOG(GREY, ` > init from ${local(file)}`, RESET))
        }
        await (o.dry ? _deploy(db) : db.run(_deploy))

        // done
        let url = db.url4(cds.context?.tenant)
        if (url === ':memory:') url = 'in-memory database.'
        LOG('/> successfully deployed to', url, '\n')
      } finally {
        TRACE?.timeEnd('cds.deploy db  ')
      }
      return db
    },

    // continue to support cds.deploy() as well...
    then(n, e) {
      return this.to(cds.db || 'db').then(n, e)
    },
    catch(e) {
      return this.to(cds.db || 'db').catch(e)
    },
  }
}

async function cds_deploy_create(db, csn = db.model, options) {
  /* eslint-disable no-console */

  const o = { ...options, ...db.options }
  if (o.impl === '@cap-js/sqlite') {
    // REVISIT: What's that ?!?
    // it's required to set both properties
    o.betterSqliteSessionVariables = true
    o.sqlDialect = 'sqlite'
  }

  let drops, creas
  let schevo = o.schema_evolution === 'auto' || o['with-auto-schema-evolution'] || o['model-only'] || o['delta-from'] //|| o.kind === 'postgres'
  if (schevo) db.options.schema_evolution = 'auto'
  if (schevo) {
    const { prior, table_exists } = await get_prior_model()
    const { afterImage, drops: d, createsAndAlters } = cds.compile.to.sql.delta(csn, o, prior && JSON.parse(prior))
    const after = JSON.stringify(afterImage)
    if (!o.dry && after != prior) {
      if (!table_exists) {
        await db.run(`CREATE table cds_model (csn text)`)
        await db.run(`INSERT into cds_model values (?)`, after)
      } else {
        await db.run(`UPDATE cds_model SET csn = ?`, after)
      }
    }
    // cds deploy --model > activate schema evolution by creating and filling in table cds_model
    if (o['model-only']) return o.dry && console.log(after)
    // cds deploy --with-auto-schema-evolution > upgrade by applying delta to former model
    creas = createsAndAlters
    drops = d
  } else {
    // cds deploy -- w/o auto schema evoution > drop-create db
    creas = cds.compile.to.sql(csn, o)
  }

  if (!drops)
    drops = creas
      .map(each => {
        let [, kind, entity] = each.match(/^CREATE (TABLE|VIEW) ("[^"]+"|[^\s(]+)/im) || []
        return `DROP ${kind} IF EXISTS ${entity};`
      })
      .reverse()

  if (!drops.length && !creas.length) return !o.dry

  if (o.dry) {
    console.log()
    for (let each of drops) console.log(each)
    console.log()
    for (let each of creas) console.log(each, '\n')
    return
  }

  // Set the context model while deploying for cqn42sql in new db layers
  db.model = cds.compile.for.nodejs(csn)
  await db.run(drops)
  await db.run(creas)
  return true

  async function get_prior_model() {
    if (o['model-only']) return {}
    let file = o['delta-from']
    if (file) {
      let prior = await cds.utils.read(file)
      return { prior }
    }
    let [table_exists] = await db.run(
      // REVISIT: prettier forced this horrible, unreadable formatting:
      db.kind === 'postgres'
        ? `SELECT 1 from pg_tables WHERE tablename = 'cds_model' and schemaname = current_schema()`
        : db.kind === 'sqlite'
        ? `SELECT 1 from sqlite_schema WHERE name = 'cds_model'`
        : cds.error`Schema evolution is not supported for ${db.kind} databases`,
    )
    if (table_exists) {
      let [{ csn }] = await db.run('SELECT csn from cds_model')
      return { prior: csn, table_exists }
    }
    return { table_exists } // no prior csn
  }
}

if (module.parent) {
  cds.deploy = Object.assign(cds_deploy, cds.deploy, { create: cds_deploy_create })
} else
  (async () => {
    const o = {}
    let recent
    for (let each of process.argv.slice(2)) {
      if (each.startsWith('--')) o[(recent = each.slice(2))] = true
      else o[recent] = each
    }
    await cds.plugins // IMPORTANT: that has to go before any call to cds.env, like through cds.deploy or cds.requires below
    cds.deploy = Object.assign(cds_deploy, cds.deploy, { create: cds_deploy_create })
    let db = cds.requires.db
    if (o.to) {
      db = { kind: o.to }
      if (o.url) (db.credentials ??= {}).url = o.url
      if (o.username) (db.credentials ??= {}).username = o.username
      if (o.password) (db.credentials ??= {}).password = o.password
    }
    await cds.deploy('*', o).to(db)
  })().catch(console.error)
