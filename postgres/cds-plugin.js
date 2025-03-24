const cds = require('@sap/cds')
const { fs, path } = cds.utils

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/postgres" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

// requires @sap/cds-dk version >= 7.5.0
cds.build?.register?.('postgres', class PostgresBuildPlugin extends cds.build.Plugin {
  
  static taskDefaults = { src: cds.env.folders.db }
  
  static hasTask() { return cds.requires.db?.kind === 'postgres' }

  init() {
    // different from the default build output structure
    this.task.dest = path.join(cds.root, cds.env.build.target !== '.' ? cds.env.build.target : 'gen', 'pg')
  }

  async build() {
    const model = await this.model()
    if (!model) return

    const promises = []
    if (fs.existsSync(path.join(this.task.src, 'package.json'))) {
      promises.push(this.copy(path.join(this.task.src, 'package.json')).to('package.json'))
    } else {
      const packageJson = {
        dependencies: {
          '@sap/cds': '^8',
          '@cap-js/postgres': '^1'
        },
        scripts: {
          start: 'cds-deploy'
        }
      }
      const assertIntegrity = cds.env?.features?.assert_integrity
      if (assertIntegrity) {
        packageJson.cds ??= {}
        packageJson.cds.features ??= {}
        packageJson.cds.features.assert_integrity = assertIntegrity
      }
      promises.push(        
        this.write(packageJson).to('package.json')
      )
    }
    promises.push(this.write(cds.compile.to.json(model)).to(path.join('db', 'csn.json')))

    let data
    if (fs.existsSync(path.join(this.task.src, 'data'))) {
      data = 'data'
    } else if (fs.existsSync(path.join(this.task.src, 'csv'))) {
      data = 'csv'
    }
    if (data) {
      promises.push(this.copy(data).to(path.join('db', 'data')))
    }
    return Promise.all(promises)
  }
})
