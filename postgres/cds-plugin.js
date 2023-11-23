const cds = require('@sap/cds')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/postgres" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

cds.build?.register?.('postgres', {
  impl: '@cap-js/postgres/lib/build.js',
  taskDefaults: { src: cds.env.folders.db }
})
cds.add?.register?.('@cap-js/postgres', class PostgresTemplate extends cds.add.Plugin {

  async canRun() {
    const { hasMta, hasHelm } = cds.add.readProject()
    if (!hasMta && hasHelm) throw `'cds add postgres' is not available for Kyma yet`
    return true
  }

  getDependencies() {} // TODO: Rename to requires()

  affects() {
    return ['mta', 'helm']
  }

  async run() {
    const { isJava } = cds.add.readProject()
    await cds.add.merge({ dependencies: { '@cap-js/postgres': '^1' }}).into('package.json')
    if (isJava) await cds.add.mvn.add('postgresql')
  }

  async runDependentMerging() {
    const project = cds.add.readProject()
    const { hasMta } = project

    if (hasMta) {
      const { isNodejs, srvPath } = project
      const { srvNode4, srvJava4, postgres, postgresDeployer } = cds.add.registries.mta
      const srv = (isNodejs ? srvNode4 : srvJava4)(srvPath) // REVISIT: runtime agnostic srv determination
      await cds.add.merge(__dirname, 'lib', 'add', 'mta.yml.hbs').into('mta.yaml', { with: {
        additions: [srv, postgres, postgresDeployer], // REVISIT: rename to upsert
        relationships: [{
          insert: [postgres, 'name'], // REVISIT: rename to upsert
          into: [srv, 'requires', 'name']
        }, {
          insert: [postgres, 'name'], // REVISIT: rename to upsert
          into: [postgresDeployer, 'requires', 'name']
        }],
        project
      }})
    }
  }
})
