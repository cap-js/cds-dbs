const assert = require('assert')
const cds = require('../cds.js')
const fspath = require('path')
// Add the test names you want to run as only
const only = []

const addTest = (ctx, def) => {
  if (typeof def === 'function') {
    return addFunctionTest(ctx, def)
  }
  if (def && typeof def === 'object') {
    return addObjectTest(ctx, def)
  }
}

const addFunctionTest = (ctx, fn) => {
  test(fn.name, async () => {
    await fn(ctx)
  })
}

const addObjectTest = (ctx, obj) => {
  test(
    JSON.stringify(
      obj,
      (_, b) => {
        if (typeof b === 'function') return `${b}`
        return b
      },
      Object.keys(obj).length === 1 ? undefined : '\t      ',
    )
      // Super hacky way to make the jest report look nice
      .replace(/\n}/g, '\n\t    }'),
    async () => {
      const data = {}
      const transforms = {}
      let throws = false
      let complianceMessage

      Object.keys(obj).forEach(k => {
        const cur = obj[k]
        const val = typeof cur === 'function' ? cur() : cur
        if (k === '!') {
          throws = obj[k]
          return
        }
        if (k === '<') {
          complianceMessage = val
          return
        }
        if (k[0] === '=') {
          transforms[k.substring(1)] = val
        } else {
          data[k] = val
        }
      })

      const expect = Object.assign({}, data, transforms)

      try {
        await ctx.db.run(async tx => {
          try {
            await tx.run(cds.ql.INSERT(data).into(ctx.target))
          } catch (e) {
            if (throws === false) throw e
            // Check for error test cases
            assert.equal(e.message, throws, 'Ensure that the correct error message is being thrown.')
            return
          }

          if (throws !== false)
            assert.equal('resolved', throws, 'Ensure that the correct error message is being thrown.')

          // Extract data set
          const sel = await tx.run({
            SELECT: {
              from: { ref: [ctx.target] },
            },
          })

          // TODO: Can we expect all Database to respond in insert order ?
          const result = sel[sel.length - 1]

          Object.keys(expect).forEach(k => {
            const msg = `Ensure that the Database echos correct data back, property ${k} does not match expected result.`
            if (result[k] instanceof Buffer && expect[k] instanceof Buffer) {
              assert.equal(result[k].compare(expect[k]), 0, `${msg} (Buffer contents are different)`)
            } else if (typeof expect[k] === 'object' && expect[k]) {
              assert.deepEqual(result[k], expect[k], msg)
            } else {
              assert.equal(result[k], expect[k], msg)
            }
          })
        })
      } catch (e) {
        if (complianceMessage) {
          global[global.Object.getOwnPropertySymbols(global).find(s => global[s].currentlyRunningTest)].currentlyRunningTest.errors.push(e)
          throw new Error(complianceMessage)
        }
        throw e
      }
    },
  )
}

describe('CSN', () => {
  // Set cds.root before requiring cds.Service as it resolves and caches package.json
  // Call default cds.test API
  const { data } = cds.test(__dirname + '/resources')
  // Prevent deployment
  /* skipping deploy causes issues with running all compliance tests in a single suite
  cds.deploy = () => ({
    to:() => {return cds.db || cds.connect('db')},
    then:() => {return cds.db || cds.connect('db')}
  })
  // */
  data.autoIsolation(true)
  // data._deployed = true // Skip automatic deployment

  // Load model before test suite to generate test suite from model definition
  const model = cds.load(__dirname + '/resources/db', { sync: true })

  const literals = Object.keys(model.definitions).filter(n => {
    const kind = model.definitions[n].kind
    return kind === 'entity' && !model.definitions[n.substring(0, n.lastIndexOf('.'))] // Ignore entities inside contexts
  })

  literals.forEach(table => {
    const path = table.split('.')
    const type = path[path.length - 1]
    const entity = model.definitions[table]
    if (entity['@compliance.ignore']) return
    const desc = !only.length || only.includes(type) ? describe : describe.skip

    desc(`${entity.projection ? 'View' : 'Type'}: ${type}`, () => {
      let deploy
      let clean
      const ctx = { target: table }

      beforeAll(async () => {
        // Very important to use the cds.db instance as it is enhanced
        // When using new SqliteService directly from class constructor it is missing the model
        // Causing all run calls to prefix the target with the service name
        ctx.db = await cds.connect()

        await ctx.db
          .run(async tx => {
            clean = tx.run({
              DROP: {
                entity: table,
              },
            })

            await clean

            if (entity.projection) {
              await tx.run({
                DROP: {
                  entity: entity.projection.from.ref[0],
                },
              })
            }
          })
          .catch(() => {})

        await ctx.db.run(async tx => {
          deploy = Promise.resolve()
          // Create parent entity
          if (entity.projection) {
            deploy = tx.run({
              CREATE: {
                entity: entity.projection.from.ref[0],
              },
            })
          }
          // actually CREATE test
          deploy = deploy.then(() =>
            tx.run({
              CREATE: {
                entity: table,
              },
            }),
          )
          await deploy.catch(() => {})
        })
      })

      test('CREATE', async () => {
        // Create table
        await deploy
      })

      test('DROP', async () => {
        // Drop table
        // REVISIT: make sure that the clean is properly setup
        await clean
      })

      try {
        if (entity.projection) return
        const file = entity.$location.file
        const data = require(fspath.resolve(cds.root, file.substring(0, file.length - 4), table + '.js'))

        describe('INSERT', () => {
          // Prevent INSERT tests from running when CREATE fails
          beforeAll(() => deploy)

          data.forEach(data => addTest(ctx, data))
        })
      } catch (e) {
        test.skip('Test Data missing', () => {
          throw e
        })
      }
    })
  })

  const contexts = Object.keys(model.definitions).filter(n => model.definitions[n].kind === 'context')

  contexts.forEach(context => {
    const path = context.split('.')
    const type = path[path.length - 1]
    const entity = model.definitions[context]
    if (entity['@compliance.ignore']) return
    const desc = !only.length || only.includes(type) ? describe : describe.skip

    const entities = Object.keys(model.definitions).filter(n => n.startsWith(context + '.'))

    desc(`Context: ${type}`, () => {
      let deploy
      let clean
      const ctx = {}

      beforeAll(async () => {
        // Very important to use the cds.db instance as it is enhanced
        // When using new SqliteService directly from class constructor it is missing the model
        // Causing all run calls to prefix the target with the service name
        ctx.db = await cds.connect()

        await ctx.db
          .run(async tx => {
            clean = Promise.resolve()
            entities.forEach(entity => {
              clean = clean.then(() => tx.run({ DROP: { entity } }))
            })
            await clean
          })
          .catch(() => {})

        await ctx.db
          .run(async tx => {
            deploy = Promise.resolve()
            entities.forEach(entity => {
              deploy = deploy.then(() => tx.run({ CREATE: { entity } }))
            })
            await deploy
          })
          .catch(() => {})
      })

      afterAll(async () => {
        await ctx.db
          .run(async tx => {
            clean = Promise.resolve()
            entities.forEach(entity => {
              clean = clean.then(() => tx.run({ DROP: { entity } }))
            })
            await clean
          })
          .catch(() => {})

        await ctx.db.disconnect()
      })

      test('CREATE', async () => {
        // Create entities
        await deploy
      })

      test('DROP', async () => {
        // Drop entities
        // REVISIT: make sure that the clean is properly setup
        await clean
      })

      try {
        const file = entity.$location.file
        const data = require(fspath.resolve(cds.root, file.substring(0, file.length - 4), context + '.js'))

        describe('INSERT', () => {
          // Prevent INSERT tests from running when CREATE fails
          beforeAll(() => deploy)

          data.forEach(data => addTest(ctx, data))
        })
      } catch (e) {
        test.skip('Test Data missing', () => {
          throw e
        })
      }
    })
  })
})
