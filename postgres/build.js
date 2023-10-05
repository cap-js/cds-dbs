const cds = require('@sap/cds')

let BuildPlugin
try {
  ({ BuildPlugin } = require('@sap/cds-dk/lib/build'))
} catch (e) {
  if (e.code === 'ENOTFOUND') throw `No build plugin mechanism for @sap/cds-dk found. Please install @sap/cds-dk for development using 'npm i -D @sap/cds-dk@^7.3.0'`
  else throw e
}

const { fs, path, rimraf, write, mkdirp } = cds.utils

module.exports = class PostgresBuildPlugin extends BuildPlugin {
  static hasTask() { // REVISIT: should be unnecessary -> plugin mechanism knows what to pull
    return cds.requires.db.kind === 'postgres'
  }

  static getTaskDefaults() {
    return { src: cds.env.folders.db }
  }

  init() {
    this.task.dest = cds.env.build.target === '.' ? path.join('gen','pg') : path.join('gen', 'pg')
  }

  async clean() {
    await rimraf(this.task.dest)
  }

  async build() {
    const model = await this.model()
    if (!model) {
      return
    }

    const promises = []
    promises.push(this.write({
        dependencies: { '@sap/cds': '^7', '@cap-js/postgres': '^1' },
        scripts: { start: 'cds-deploy' },
      }).to('package.json'))
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
}
