const cds = require('@sap/cds')
const path = require('path')
const fs = require('fs')
let BuildPlugin
try {
  ;({ BuildPlugin } = require('@sap/cds-dk/lib/build'))
} catch (e) {
  if (e.code === 'ENOTFOUND') throw `Please install @sap/cds-dk for development using 'npm i -D @sap/cds-dk'`
  else throw e
}

module.exports = class PostgresBuildPlugin extends BuildPlugin {
  static hasTask() {
    return cds.requires.db.kind === 'postgres'
  }

  static getTaskDefaults() {
    return { src: cds.env.folders.db }
  }

  init() {
    this.task.dest = cds.env.build.target === '.' ? path.join(this.task.dest, 'gen/pg') : path.join(this.task.dest, 'pg')
  }

  async clean() {
    if (fs.existsSync(this.task.dest)) {
      return fs.promises.rm(this.task.dest, {recursive:true})
    }
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
      }).to('../package.json'))
    promises.push(this.write(cds.compile.to.json(model)).to('csn.json'))

    let data
    if (fs.existsSync(path.join(this.task.src, 'data'))) {
      data = 'data'
    } else if (fs.existsSync(path.join(this.task.src, 'csv'))) {
      data = 'csv'
    }
    if (data) {
      promises.push(this.copy(data).to('data'))
    }
    return Promise.all(promises)
  }
}
