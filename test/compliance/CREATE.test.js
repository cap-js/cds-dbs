const assert = require('assert')
const { Readable } = require('stream')
const { buffer } = require('stream/consumers')
const cds = require('../cds.js')
const fspath = require('path')
// Add the test names you want to run as only
const only = []

const toTitle = obj =>
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
    .replace(/\n}/g, '\n\t    }')


const dataTest = async function (entity, table, type, obj) {
  const data = {}
  const transforms = {}
  const expect = {}
  Object.setPrototypeOf(expect, transforms)
  Object.setPrototypeOf(transforms, data)
  let throws = false

  const assign = (t, p, v) => {
    if (typeof v === 'function') {
      Object.defineProperty(t, p, {
        get: v,
        set(v) {
          Object.defineProperty(t, p, { value: v })
        },
        enumerable: true,
        configurable: true,
      })
    } else {
      t[p] = v
    }
  }
  Object.keys(obj).forEach(k => {
    const cur = obj[k]
    if (k === '!') {
      throws = obj[k]
      return
    }
    if (k.length > 1 && k[0] === '=') {
      assign(transforms, k.substring(1), cur)
    } else {
      assign(data, k, cur)
    }
  })

  const keys = []
  for (const e in entity.elements) {
    if (entity.elements[e].key) keys.push(e)
  }

  let cuid = false
  if (entity.elements.ID) {
    const ID = entity.elements.ID
    cuid = ID.key && ID.type === 'cds.UUID'
    if (!data.ID && cuid) {
      data.ID = '00000000-0000-0000-000000000000'
    }
  }

  // It is required for Postgres to reset the transaction
  // Once a query in the transaction throws it is poisoned
  // Making all follow up queries throw
  // This includes commit all previous successfull changes are lost
  let tx = await cds.tx()
  const commit = async () => {
    await tx.commit()
    tx = await cds.tx()
  }

  try {
    await tx.run(cds.ql.DELETE.from(table))
    try {
      await tx.run(cds.ql[type](data).into(table))
    } catch (e) {
      if (throws === false) throw e
      // Check for error test cases
      assert.equal(e.message, throws, 'Ensure that the correct error message is being thrown.')
      return
    }

    await commit()

    // Execute the query an extra time if the entity has an ID key column
    if (cuid) {
      let error
      try {
        await tx.run(cds.ql[type](data).into(table))
        if (type === 'INSERT') error = new Error('Ensure that INSERT queries fail when executed twice')
      } catch (e) {
        // Ensure that UPSERT does not throw when executed twice
        if (type === 'UPSERT') throw e
      }
      await commit()

      try {
        const keysOnly = keys.reduce((l, c) => { l[c] = data[c]; return l }, {})
        await tx.run(cds.ql[type](keysOnly).into(table))
        if (type === 'INSERT') error = new Error('Ensure that INSERT queries fail when executed twice')
      } catch (e) {
        // Ensure that UPSERT does not throw when executed twice
        if (type === 'UPSERT') throw e
      }

      if (error) throw error

      await commit()
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

    let checks = 0
    for (const k in expect) {
      const msg = `Ensure that the Database echos correct data back, property ${k} does not match expected result.`
      if (result[k] instanceof Readable && expect[k] instanceof Readable) {
        result[k] = await buffer(result[k])
        expect[k] = await buffer(expect[k])
      }
      if (result[k] instanceof Buffer && expect[k] instanceof Buffer) {
        assert.equal(result[k].compare(expect[k]), 0, `${msg} (Buffer contents are different)`)
      } else if (expect[k] instanceof RegExp) {
        assert.match(result[k], expect[k], msg)
      } else if (typeof expect[k] === 'object' && expect[k]) {
        assert.deepEqual(result[k], expect[k], msg)
      } else {
        assert.strictEqual(result[k], expect[k], msg)
      }
      checks++
    }
    assert.notEqual(checks, 0, 'Ensure that the test has expectations')
  } finally {
    await tx.commit()
  }
}

describe.skip('CREATE', () => {
  cds.test(__dirname + '/resources')

  // Load model before test suite to generate test suite from model definition
  const model = cds.load(__dirname + '/resources/db', { sync: true })

  const literals = Object.keys(model.definitions)
    .filter(n =>
      n.indexOf('sap.') !== 0 && // Skip all entities in sap namespace
      model.definitions[n].kind === 'entity'
    )

  describe('custom entities', () => {
    const entityName = 'custom.entity'

    afterEach(async () => {
      const db = await cds.connect.to('db')

      const { globals } = cds.entities('basic.literals')

      await db.run({ DROP: { entity: globals.name } }).catch(() => { })
      await db.run({ DROP: { entity: entityName } }).catch(() => { })
      await db.run({ DROP: { table: { ref: [entityName] } } }).catch(() => { })
      await db.run({ DROP: { view: { ref: [entityName] } } }).catch(() => { })
    })

    test('definition provided', async () => {
      const db = await cds.connect.to('db')

      const { globals } = cds.entities('basic.literals')

      const entity = new cds.entity({
        kind: 'entity',
        name: entityName,
        elements: globals.elements
      })
      await db.run({ CREATE: { entity } })
      // REVISIT: reading from entities not in the model requires additional handling in infer
      // await SELECT.from(entity)
    })

    test('definition provided', async () => {
      const db = await cds.connect.to('db')

      const { globals } = cds.entities('basic.literals')

      const query = SELECT.from(globals)
      // REVISIT: reading from entities not in the model requires additional handling in infer
      /*
      const entity = new cds.entity({
        kind: 'entity',
        name: entityName,
        query,
        elements: query.elements
      })
      */

      await db.run({ CREATE: { entity: globals } })
      await db.run({ CREATE: { entity: entityName, as: query } })
      // await SELECT.from(entity)
    })
  })

  literals.forEach(table => {
    const path = table.split('.')
    const type = path[path.length - 1]
    const entity = model.definitions[table]
    const desc = !only.length || only.includes(type) ? describe : () => { }
    if (entity.query) return // Skip complex view as cqn4sql does not allow union views

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
          .catch(() => { })

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
          await deploy.catch(() => { })
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
          .catch(() => { })

        await db.disconnect()
      })

      test('CREATE', async () => {
        // Create table
        await deploy
      })

      try {
        if (entity.projection) return
        const file = entity.$location.file
        const data = require(fspath.resolve(cds.root, file.substring(0, file.length - 4), encodeURIComponent(table) + '.js'))
        const noData = data.length === 0

        describe('INSERT', () => {
          // Prevent INSERT tests from running when CREATE fails
          beforeAll(() => deploy)

          if (noData) test.skip('no data', () => { })
          else
            data.forEach(obj => {
              test(toTitle(obj), dataTest.bind(null, entity, table, 'INSERT', obj))
            })
        })

        describe('UPSERT', () => {
          // Prevent INSERT tests from running when CREATE fails
          beforeAll(() => deploy)

          if (noData) test.skip('no data', () => { })
          else
            data.forEach(obj => {
              test(toTitle(obj), dataTest.bind(null, entity, table, 'UPSERT', obj))
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
