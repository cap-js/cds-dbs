const cds = require('@sap/cds')

function getIsolate() {
  const { options = {} } = cds
  const fts = cds.requires.toggles && cds.resolve(cds.env.features.folders)
  const src = [options.from || '*', ...(fts || [])]

  const isolation = process.env.TRAVIS_JOB_ID || process.env.GITHUB_RUN_ID || require('os').userInfo().username || 'test_db'
  const srchash = hash([cds.root, ...src.flat()].join('/'))

  return {
    src,
    // Create one database for each overall test execution
    database: 'D' + hash(isolation),
    // Create one tenant for each model source definition
    tenant: 'T' + srchash,
    // Track source definition hash
    source: srchash,
  }
}

const hash = str => {
  const { createHash } = require('crypto')
  const hash = createHash('sha1')
  hash.update(str)
  return hash.digest('hex')
}

async function beforeWrite(dbs, isolate) {
  const { ten } = dbs
  const modified = isolate.modified = {}
  ten.before(['*'], async (req) => {
    if (
      !req.query ||
      (typeof req.query === 'string' && /^(BEGIN|COMMIT|ROLLBACK)/i.test(req.query))
    ) return // Ignore event requests

    const d = delay()
    if (
      req.query?.SELECT ||
      (typeof req.query === 'string' && /^\W*SELECT/i.test(req.query))
    ) return d // Stay in read only isolation for read requests

    if (req.target) modified[req.target.name] = true
    if (d) return d
    if (ten._writeable) return

    // Add modification tracking for deep-queries internal calls
    for (const fn of ['onSIMPLE', 'onUPDATE', 'onINSERT']) {
      const org = ten[fn]
      ten[fn] = function (req) {
        if (req.query?.target) modified[req.query.target.name] = true
        return org.apply(this, arguments)
      }
    }

    ten._writeable = true
    ten._isolating = getWriteTenant(dbs, isolate).then(() => { ten._isolating = undefined })
    return delay()

    function delay() {
      if (req.context._isolating) return req.context._isolating
      if (ten._isolating) return (req.context._isolating = req.tx.commit()
        .then(() => ten._isolating)
        .then(() => {
          req.context._isolating = undefined
          return req.tx.begin()
        }))
    }
  })
}

async function deploy(dbs, isolate) {
  console.log('DEPLOYING:', isolate.tenant)
  const { ten } = dbs
  await ten.tx(async () => {
    try {
      const src = isolate.src
      const { options = {} } = cds
      const m = await cds.load(src, options).then(cds.minify)
      // options.schema_evolution = 'auto'
      await cds.deploy(m).to(ten, options)
    } catch (err) {
      if (err.code === 'MODEL_NOT_FOUND') return
      throw err
    }
  })
}

async function getReadTenant(dbs, isolate) {
  const { dat, ten } = dbs
  const { schemas } = dat.entities()
  const deployTimeout = 120 // seconds

  let isnew = false
  try {
    await dat.run(cds.ql.CREATE('schemas')).catch(() => { })
    await dat.tx(async tx => {
      await tx.run(DELETE.from(schemas).where`tenant=${isolate.tenant} and available=${false} and seconds_between(started, $now) > ${deployTimeout}`)
      // If insert works the schema does not yet exist and this client has won the race and can deploy the contents
      await tx.run(INSERT({ tenant: isolate.tenant, source: isolate.source, available: false, started: new Date() }).into(schemas))
      isnew = true
    })
  } catch (err) {
    const query = cds.ql`SELECT FROM ${schemas} {
      (SELECT count(1) FROM ${schemas} WHERE tenant=${isolate.tenant} and available=${false} and seconds_between(started, $now) < ${deployTimeout}) as progress,
      (SELECT count(1) FROM ${schemas} WHERE tenant=${isolate.tenant} and available=${true}) as available,
    }`
    // If the schema already exists wait for the row to be updated with available=true
    await dat.tx(async tx => {
      let available = 0
      let progress = 1
      while (progress && !available) [{ progress, available }] = await tx.run(query)
      if (!available) cds.error`Failed to acquire database isolation external deployment failed.`
    })
  }

  await ten.database(isolate)
  await ten.tenant(isolate)

  if (isnew) {
    let err
    await deploy(dbs, isolate).catch(e => { err = e })
    if (err) await ten.tenant(isolate, true)
    await dat.tx(async tx => {
      if (err) {
        await tx.run(DELETE(schemas).where`tenant=${isolate.tenant}`)
      } else {
        await tx.run(UPDATE(schemas).where`tenant=${isolate.tenant}`.with({ available: true }))
      }
    })
    if (err) throw err
  }
}

async function getWriteTenant(dbs, isolate) {
  const { ten, dat, sys } = dbs
  const { schemas } = dat.entities()

  let isnew = false
  await dat.tx(async tx => {
    const available = await tx.run(SELECT.from(schemas).where`tenant!=${isolate.tenant} and source=${isolate.source} and available=${true}`.forUpdate().limit(1))
    if (available.length) {
      const tenant = isolate.tenant = available[0].tenant
      await tx.run(UPDATE(schemas).where`tenant=${tenant}`.with({ available: false, started: new Date() }))
    } else {
      isolate.tenant = 'T' + cds.utils.uuid()
      await tx.run(INSERT({ tenant: isolate.tenant, source: isolate.source, available: false, started: new Date() }).into(schemas))
      isnew = true
    }
  })

  console.log('USING:', isolate.tenant)

  await dat.tenant(isolate)
  if (isnew) await deploy({ ten: dat }, isolate)
  await ten.disconnect()
  ten.options.credentials = dat.options.credentials
  await dat.database(isolate)

  // Release schema for follow up test runs
  cds.on('shutdown', async () => {
    try {
      try {
        // Clean tenant entities
        await ten.tx(async tx => {
          await tx.begin()
          for (const entity in isolate.modified) {
            const query = DELETE(entity).where`true=true`
            if (!query.target._unresolved) await tx.onSIMPLE({ query }) // Skip deep delete
          }
          // UPSERT all data sources again
          await cds.deploy.data(tx, tx.model, { schema_evolution: 'auto' })
        })

        await dat.run(UPDATE(schemas).where`tenant=${isolate.tenant}`.with({ available: true }))
      } catch (err) {
        // Try to cleanup broken tenant isolation
        await ten.tenant(isolate, true)
        // Remove cleaned up schema
        await dat.run(DELETE(schemas).where`tenant=${isolate.tenant}`)
      } finally {
        await ten.disconnect()
        await dat.disconnect()
        await sys.disconnect()
      }
    } catch (err) {
      // if an shutdown handler throws an error it goes into an infinite loop
      console.error(err)
    }
  })
}

module.exports = async function (db) {
  const isolate = getIsolate()
  // Just deploy when the database doesn't have isolation implementations available
  if (typeof db.database !== 'function' || typeof db.tenant !== 'function') return deploy({ ten: db }, isolate)

  const dbs = {
    ten: db,
    sys: await cds.connect.to('db_sys', { ...cds.requires.db, isolate: false }),
    dat: await cds.connect.to('db_dat', {
      ...cds.requires.db, isolate: false,
      model: await cds.load(cds.utils.path.join(__dirname, 'database'))
    }),
  }

  cds.on('shutdown', async () => {
    try {
      const { ten, dat, sys } = dbs

      await Promise.all([
        ten.disconnect(),
        dat.disconnect(),
        sys.disconnect(),
      ])
    } catch { }
  })

  await dbs.dat.database(isolate)

  await getReadTenant(dbs, isolate)

  await db.database(isolate)
  await db.tenant(isolate)

  beforeWrite(dbs, isolate)
}