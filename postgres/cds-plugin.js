const cds = require('@sap/cds')
const { fs, path } = cds.utils

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/postgres" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

// copy over build relevant cds options to the package.json of the deployer app
const CDS_BUILD_OPTIONS = ['assert_integrity']

// cdsc options are build relevant too, but we need to filter out some
const CDSC_DISALLOW   = ['moduleLookupDirectories']

// requires @sap/cds-dk version >= 7.5.0
cds.build?.register?.('postgres', class PostgresBuildPlugin extends cds.build.Plugin {
  static taskDefaults = { src: cds.env.folders.db }
  static hasTask () { return cds.requires.db?.kind === 'postgres' }
  init () {
    // different from the default build output structure
    this.task.dest = path.join(cds.root, cds.env.build.target !== '.' ? cds.env.build.target : 'gen', 'pg')
  }

  async build () {
    const model = await this.model()
    if (!model) return

    const promises = []
    if (fs.existsSync(path.join(this.task.src, 'package.json'))) {
      promises.push(this.copy(path.join(this.task.src, 'package.json')).to('package.json'))
    } else {
      const postgresPackageJson = require('./package.json');
      const packageJson = {
        dependencies: {
          '@sap/cds': cds.version,
          '@cap-js/postgres': postgresPackageJson.version
        },
        scripts: { start: 'cds-deploy' }
      }

      // propagate cds.env.features (allow-listed)
      const envFeatures = cds.env?.features ?? {}
      for (const name of CDS_BUILD_OPTIONS) {
        const val = envFeatures[name]
        if (val !== undefined) {
          packageJson.cds ??= {}
          packageJson.cds.features ??= {}
          packageJson.cds.features[name] = val
        }
      }

      if (cds.env?.requires?.db) {
        packageJson.cds ??= {}
        packageJson.cds.requires ??= {}
        packageJson.cds.requires.db = { ...cds.env.requires.db }
      }

      // propagate cds.env.cdsc (minus disallowed)
      const envCdsc = cds.env?.cdsc ?? {}
      const cdscClean = Object.fromEntries(
        Object.entries(envCdsc).filter(([key]) => !CDSC_DISALLOW.includes(key))
      )
      if (Object.keys(cdscClean).length) {
        packageJson.cds ??= {}
        packageJson.cds.cdsc = cdscClean
      }

      promises.push(this.write(packageJson).to('package.json'))
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
