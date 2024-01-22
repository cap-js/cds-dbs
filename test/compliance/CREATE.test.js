const assert = require('assert')
const  { Readable } = require('stream')
const { buffer } = require('stream/consumers')
const cds = require('../cds.js')
const fspath = require('path')
// Add the test names you want to run as only
const only = []

describe('CREATE', () => {
  // TODO: reference to ./definitions.test.js

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
  data._deployed = true // Skip automatic deployment

  // Load model before test suite to generate test suite from model definition
  const model = cds.load(__dirname + '/resources/db', { sync: true })

  const literals = Object.keys(model.definitions).filter(n => model.definitions[n].kind === 'entity')

  literals.forEach(table => {
    const path = table.split('.')
    const type = path[path.length - 1]
    const entity = model.definitions[table]
    const desc = !only.length || only.includes(type) ? describe : describe.skip

    desc(`${entity.projection ? 'View' : 'Type'}: ${type}`, () => {
      let db
      let deploy

      beforeAll(async () => {
        // Very important to use the cds.db instance as it is enhanced
        // When using new SqliteService directly from class constructor it is missing the model
        // Causing all run calls to prefix the target with the service name
        db = await cds.connect()

        await db
          .run(async tx => {
            await tx.run({
              DROP: {
                entity: table,
              },
            })

            if (entity.projection) {
              await tx.run({
                DROP: {
                  entity: entity.projection.from.ref[0],
                },
              })
            }
          })
          .catch(() => {})

        await db.run(async tx => {
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

      afterAll(async () => {
        // DROP as normal deployment already deployed the model
        await db
          .run(async tx => {
            await tx.run({
              DROP: {
                entity: table,
              },
            })

            if (entity.projection) {
              await tx.run({
                DROP: {
                  entity: entity.projection.from.ref[0],
                },
              })
            }
          })
          .catch(() => {})

        await db.disconnect()
      })

      test('CREATE', async () => {
        // Create table
        await deploy
      })

      try {
        if (entity.projection) return
        const file = entity.$location.file
        const data = require(fspath.resolve(cds.root, file.substring(0, file.length - 4), table + '.js'))

        describe('INSERT', () => {
          // Prevent INSERT tests from running when CREATE fails
          beforeAll(() => deploy)

          data.forEach(obj => {
            test(
              JSON.stringify(
                obj,
                (_, b) => {
                  if (Buffer.isBuffer(b) || b?.type === 'Buffer') {
                    return `Buffer(${b.byteLength || b.data?.length})`
                  }
                  if (b instanceof Readable) {
                    return 'Readable'
                  }
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

                Object.keys(obj).forEach(k => {
                  const cur = obj[k]
                  const val = typeof cur === 'function' ? cur() : cur
                  if (k === '!') {
                    throws = obj[k]
                    return
                  }
                  if (k[0] === '=') {
                    transforms[k.substring(1)] = val
                  } else {
                    data[k] = val
                  }
                })

                const expect = Object.assign({}, data, transforms)

                await db.run(async tx => {
                  try {
                    await tx.run(cds.ql.INSERT(data).into(table))
                  } catch (e) {
                    if (throws === false) throw e
                    // Check for error test cases
                    assert.equal(e.message, throws, 'Ensure that the correct error message is being thrown.')
                    return
                  }

                  if (throws !== false)
                    assert.equal('resolved', throws, 'Ensure that the correct error message is being thrown.')

                  const columns = []
                  for (let col in entity.elements) {
                    columns.push({ ref: [col] })
                  }

                  // Extract data set
                  const sel = await tx.run({
                    SELECT: {
                      from: { ref: [table] },
                      columns 
                    },
                  })

                  // TODO: Can we expect all Database to respond in insert order ?
                  const result = sel[sel.length - 1]

                  await Promise.all(Object.keys(expect).map(async k => {
                    const msg = `Ensure that the Database echos correct data back, property ${k} does not match expected result.`
                    if (result[k] instanceof Readable) {
                      result[k] = await buffer(result[k])
                    }
                    if (expect[k] instanceof Readable) {
                      expect[k] = await buffer(expect[k])
                    }
                    if (result[k] instanceof Buffer && expect[k] instanceof Buffer) {
                      assert.equal(result[k].compare(expect[k]), 0, `${msg} (Buffer contents are different)`)
                    } else if (typeof expect[k] === 'object' && expect[k]) {
                      assert.deepEqual(result[k], expect[k], msg)
                    } else {
                      assert.equal(result[k], expect[k], msg)
                    }
                  }))
                })
              },
            )
          })
        })
      } catch (e) {
        test.skip('Test Data missing', () => {
          throw e
        })
      }
    })
  })
})
