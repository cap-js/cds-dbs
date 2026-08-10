const cds = require('@sap/cds')
const { fs, path } = cds.utils

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

    // csvFileDetection (default on, for parity with the HANA build task) collects initial
    // data from all model sources - app-local db/data AND every reuse module's db/data - so
    // the deployer artifact matches `cds deploy` from source. When disabled, only the
    // app-local data/csv folder is copied (legacy behaviour).
    const csvFileDetection = this.task.options?.csvFileDetection ?? true
    if (csvFileDetection && typeof cds.deploy?.resources === 'function') {
      for (const [dest, sources] of await collectInitialData(model)) {
        const to = path.join('db', 'data', dest)
        if (sources.length === 1) {
          promises.push(this.copy(sources[0]).to(to))
        } else {
          promises.push(this.write(mergeCsvFiles(sources)).to(to))
        }
      }
    } else {
      let data
      if (fs.existsSync(path.join(this.task.src, 'data'))) {
        data = 'data'
      } else if (fs.existsSync(path.join(this.task.src, 'csv'))) {
        data = 'csv'
      }
      if (data) {
        promises.push(this.copy(data).to(path.join('db', 'data')))
      }
    }
    return Promise.all(promises)
  }
})

// Discover initial-data resources across app + reuse modules, grouped by their
// destination file name. Files that resolve to the same destination (e.g. a code list
// extended by a reuse module and the consumer) are merged; init.js/ts is skipped as it
// cannot be reproduced from the artifact's db/data folder.
async function collectInitialData (model) {
  const resources = await cds.deploy.resources(model)
  const byDest = new Map()
  for (const [file, entity] of Object.entries(resources)) {
    if (entity === '*') continue // init.js/ts
    const dest = path.basename(file)
    const group = byDest.get(dest)
    if (group) group.push(file)
    else byDest.set(dest, [file])
  }
  return byDest
}

// Merge several CSV files for the same entity into the union of their rows under a unified
// header. Files are discovered reuse-module-first, so base rows precede consumer rows.
function mergeCsvFiles (files) {
  const columns = []
  const seen = new Set()
  const records = []
  for (const file of files) {
    const [header, ...rows] = cds.parse.csv(fs.readFileSync(file, 'utf8'))
    if (!header) continue
    for (const column of header) if (!seen.has(column)) { seen.add(column); columns.push(column) }
    for (const row of rows) {
      const record = {}
      header.forEach((column, i) => { record[column] = row[i] })
      records.push(record)
    }
  }
  const lines = [columns.map(csvEscape).join(',')]
  const emitted = new Set()
  for (const record of records) {
    const line = columns.map(column => csvEscape(record[column] ?? '')).join(',')
    if (emitted.has(line)) continue
    emitted.add(line)
    lines.push(line)
  }
  return lines.join('\n') + '\n'
}

function csvEscape (value) {
  value = String(value)
  return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value
}
