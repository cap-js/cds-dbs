module.exports = require('@sap/cds/lib')

let stableUUID = 0
const utils = module.exports.utils
utils.uuid
utils.uuid = function () {
  const id = stableUUID++
  return /(.{8})(.{4})(.{4})(.{4})(.{12})/.exec(`${id}`.padStart(32, '0')).slice(1).join('-')
}

// Adding cds.hana types to cds.builtin.types
// REVISIT: Where should we put this?
const hana = module.exports.linked({
  definitions: {
    'cds.hana.SMALLDECIMAL': { type: 'cds.Decimal' },
    'cds.hana.SMALLINT': { type: 'cds.Int16' },
    'cds.hana.TINYINT': { type: 'cds.UInt8' },
    'cds.hana.REAL': { type: 'cds.Double' },
    'cds.hana.CHAR': { type: 'cds.String' },
    'cds.hana.CLOB': { type: 'cds.String' },
    'cds.hana.NCHAR': { type: 'cds.String' },
    'cds.hana.BINARY': { type: 'cds.String' },
    'cds.hana.ST_POINT': { type: 'cds.String' },
    'cds.hana.ST_GEOMETRY': { type: 'cds.String' },
  },
})
Object.assign(module.exports.builtin.types, hana.definitions)

const cdsTest = module.exports.test

jest.useFakeTimers({
  doNotFake: ['setImmediate'],
  now: new Date('2000-01-01T00:00:00.000Z'),
})

let isolateCounter = 0

const orgIn = cdsTest.constructor.prototype.in
cdsTest.constructor.prototype.in = function () {
  global.before(() => {
    orgIn.apply(this, arguments)
  })
}

// REVISIT: move this logic into cds when stabilized
// Overwrite cds.test with autoIsolation logic
module.exports.test = Object.setPrototypeOf(function () {
  let ret

  global.before(async () => {
    // reset UUID for each test suite
    stableUUID = 0

    try {
      // Determine database driver based upon test source path
      const serviceDefinitionPath = /.*\/test\//.exec(require.main.filename)?.[0] + 'service.json'
      cds.env.requires.db = require(serviceDefinitionPath)
    } catch (e) {
      // Default to sqlite for packages without their own service
      cds.env.requires.db = require('@cap-js/sqlite/test/service.json')
    }
  })

  // Run original cds.test function
  ret = cdsTest(...arguments)

  global.before(async () => {
    // Setup isolation after cds has prepare the project (e.g. cds.model)
    if (ret.data._autoIsolation) {
      await ret.data.isolate()
    }
  })

  const cds = ret.cds

  ret.data.isolate =
    ret.data.isolate ||
    async function (db) {
      if (!db) db = await cds.connect.to('db')

      // Take and check snapshot state from expect to adjust snapshot driver behavior
      const snapshotState = expect.getState().snapshotState
      // snapshotState._updateSnapshot = 'all'
      const updateSnapshots = snapshotState._updateSnapshot === 'all'

      // Create isolation information
      const { createHash } = require('crypto')
      const hash = createHash('sha1')
      const rootLength = __dirname.length - 5
      const isolateName = (require.main.filename?.slice(rootLength) || 'test_tenant') + isolateCounter++
      hash.update(isolateName)
      const isolate = {
        // Create one database for each overall test execution
        database: process.env.TRAVIS_JOB_ID || process.env.GITHUB_RUN_ID || 'test_db',
        // Create one tenant for each test suite
        tenant: 'T' + hash.digest('hex'),
      }

      // If database driver supports database and tenant isolation run test in isolation
      if (updateSnapshots && typeof db.database === 'function' && typeof db.tenant === 'function') {
        // Create new database isolation
        await db.database(isolate)

        // Create new tenant isolation in database
        await db.tenant(isolate)

        ret.credentials = db.options.credentials
      }

      // Queue for database prepare and exec calls for stability
      const queue = new Queue()

      // create snapshot driver
      if (typeof db.prepare === 'function' && typeof db.exec === 'function') {
        const setCall = async function(action, args) {
          const hash = createHash('sha1')
          hash.update(JSON.stringify(args))
          expect(`${action} - ${hash.digest('base64')}`).toMatchSnapshot()
        }

        // Echo existing snapshots
        if (!updateSnapshots) {
          // Remove database connection factory
          db.pools._factory = {
            create: () => ({}),
            destroy: () => {},
            validate: () => true,
            options: {
              acquireTimeoutMillis: 1000,
              destroyTimeoutMillis: 1000,
            },
          }

          // For databases that use isolation simulate isolation logic
          if (db.options.credentials) {
            db.options.credentials.schema = isolate.tenant
          }

          const getResult = async function () {
            // Detach to simulate network round trip
            await new Promise(res => setImmediate(res))
            const next = snapshotState.match({
              testName: expect.getState().currentTestName || '',
            })
            const ret = snapshotState._initialData[next.key]
            snapshotState.unmatched--
            return JSON.parse(ret.slice(1, -1))
          }

          db.prepare = async function () {
            const lock = await queue
            await new Promise(res => setImmediate(res))
            setCall('prepare', arguments)
            return {
              run: async function () {
                const { done } = await lock.sub
                try {
                  setCall('run', arguments)
                  return await getResult()
                } finally {
                  done()
                }
              },
              get: async function () {
                const { done } = await lock.sub
                try {
                  setCall('get', arguments)
                  return await getResult()
                } finally {
                  done()
                }
              },
              all: async function () {
                const { done } = await lock.sub
                try {
                  setCall('all', arguments)
                  return await getResult()
                } finally {
                  done()
                }
              },
            }
          }

          db.exec = async function (sql) {
            const { done } = await queue
            try {
              setCall('exec', arguments)
              return await getResult()
            } finally {
              done()
            }
          }

          return
        }


        const setResult = async function (ret) {
          ret = await ret
          expect(JSON.stringify(ret)).toMatchSnapshot()
          return ret
        }

        // capture snapshots with actual database driver passthrough
        const orgPrepare = db.prepare
        db.prepare = async function (sql) {
          const lock = await queue
          setCall('prepare', arguments)
          const stmt = orgPrepare.apply(this, arguments)
          return {
            run: async function () {
              const { done } = await lock.sub
              try {
                setCall('run', arguments)
                return await setResult(stmt.run(...arguments))
              } finally {
                done()
              }
            },
            get: async function () {
              const { done } = await lock.sub
              try {
                setCall('get', arguments)
                return await setResult(stmt.get(...arguments))
              } finally {
                done()
              }
            },
            all: async function () {
              const { done } = await lock.sub
              try {
                setCall('all', arguments)
                return await setResult(stmt.all(...arguments))
              } finally {
                done()
              }
            },
          }
        }

        const orgExec = db.exec
        db.exec = async function () {
          const { done } = await queue
          try {
            setCall('exec', arguments)
            return await setResult(orgExec.apply(this, arguments))
          } finally {
            done()
          }
        }
      }
    }

  ret.data.autoIsolation =
    ret.data.autoIsolation ||
    function (enabled) {
      this._autoIsolation = enabled
      return this
    }
  // TODO: require explicit isolation definition in each test
  // to not do the isolation if the test does not need that database
  ret.data.autoIsolation(true)

  // Deploy as the cds.test call will not call deploy with cds.env.requires.db defined
  global.before(async () => {
    if (ret.data._autoIsolation && !ret.data._deployed) {
      ret.data._deployed = cds.deploy(cds.options.from[0])
      await ret.data._deployed
    }
  })

  // Remove all database connections and clean up database related caches
  global.after(async () => {
    // Clean database connection pool
    await cds.db?.disconnect?.()

    // Clean cache
    delete cds.services._pending.db
    delete cds.services.db
    delete cds.db
    delete cds.model
    global.cds.resolve.cache = {}
  })

  const axiosQueue = new Queue()
  const axiosFunctions = [
    'get',
    'GET',
    'put',
    'PUT',
    'post',
    'POST',
    'patch',
    'PATCH',
    'delete',
    'DELETE',
    'DEL',
    'options',
    'OPTIONS',
  ]

  axiosFunctions.forEach(f => {
    const org = ret[f]
    ret[f] = async function () {
      const { done } = await axiosQueue
      try {
        return await org.apply(this, arguments)
      } finally {
        done()
      }
    }
  })

  return ret
}, cdsTest.constructor.prototype)

const Queue = class {
  constructor(parent) {
    // Allow for parent queue (e.g. prepare().run())
    this.parent = parent
  }

  proms = []

  // Called when the async task is done and the next can be executed
  done() {
    const next = this.proms.shift()
    if (next) {
      next.resolve({
        done: this.done.bind(this),
        sub: new Queue(this),
      })
    } else {
      this.busy = false
      if (this.parent) {
        this.parent.done()
      }
    }
  }

  // Create lock and wait for the request its turn
  then(resolve, reject) {
    const prom = {
      resolve: resolve,
      reject: reject,
    }

    if (this.busy) {
      this.proms.push(prom)
      return prom.prom
    } else {
      this.busy = true
      return resolve({
        done: this.done.bind(this),
        sub: new Queue(this),
      })
    }
  }
}
