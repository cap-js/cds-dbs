const cds = require('../../test/cds.js')

describe('Data Integration', () => {
  before(() => {
    cds.env.features.ieee754compatible = true
  })

  const _deploy = cds.deploy
  cds.deploy = async function () {
    const sys = await cds.connect.to('sys', {
      ...cds.requires.db,
      credentials: {
        ...cds.db.options.credentials,
        user: `${cds.db.options.credentials.database}_USER_MANAGER`,
        password: `${cds.db.options.credentials.database}_USER_MANAGER`,
      },
    })
    await sys.run(`CREATE EXTENSION IF NOT EXISTS http SCHEMA public`)

    const db = await cds.connect.to('db')

    const convertInput = cds.db.class.CQN2SQL._convertInput ?? new cds.db.class.CQN2SQL().class._convertInput

    for (const name in cds.model.definitions) {
      const entity = cds.model.definitions[name]
      if (!entity.__REMOTE__) continue

      const columns = []
      function add(element, name = element.name) {
        if (element.isAssociation) {
          for (const key of element.keys || []) {
            if (key.ref.length > 1) { cds.error`Association with deep foreign key currently not supported!!!` }
            if (!entity.elements[`${name}_${key.ref[0]}`]) add(element._target.elements[key.ref[0]], `${name}_${key.ref[0]}`)
          }
        } else {
          const converter = element[convertInput] || (a => a)
          columns.push(`${converter(`value->>'${name}'`)} as ${name}`)
        }
      }

      for (const name in entity.elements) add(entity.elements[name])

      const from = `jsonb_array_elements((SELECT (content::jsonb->>'value')::jsonb FROM public.http_get('http://host.docker.internal:4004/browse/${name.split('.').at(-1)}?src=postgres') LIMIT 1))`

      await db.run(`CREATE VIEW ${entity} AS SELECT ${columns} FROM ${from}`)
    }

    return _deploy.apply(this, arguments)
  }

  cds.on('loaded', (csn) => {
    const remotes = []
    for (const name in csn.definitions) {
      const service = csn.definitions[name]
      if (service.kind !== 'service') continue
      if (service['@data.product']) remotes.push(name)
    }

    for (const name in csn.definitions) {
      const entity = csn.definitions[name]
      if (entity.kind !== 'entity') continue
      const service = remotes.find(srv => name.startsWith(srv))
      if (!service) continue
      entity.__REMOTE__ = true
      entity['@cds.persistence.exists'] = true
    }
  })

  const { expect, GET } = cds.test(__dirname, 'integration.cds')

  test('debug', async () => {
    const [db, org] = await Promise.all([
      GET`/odata/v4/integration/Books`,
      GET`http://localhost:4004/browse/ListOfBooks?src=test`,
    ])
    expect(db.data.value).deep.eq(org.data.value)
  })

  test('expand', async () => {
    const [db, org] = await Promise.all([
      GET`/odata/v4/integration/Books?$expand=genre`,
      GET`http://localhost:4004/browse/ListOfBooks?$expand=genre&src=test`,
    ])
    expect(db.data.value).deep.eq(org.data.value)
  })
})