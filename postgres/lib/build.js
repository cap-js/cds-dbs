const cds = require('@sap/cds')
const path = require('path')
const { rimraf } = cds.utils
let BuildTaskHandler
try {
  ;({ BuildTaskHandler } = require('@sap/cds-dk/lib/build'))
} catch (e) {
  if (e.code === 'ENOTFOUND') throw `Please install @sap/cds-dk for development using 'npm i -D @sap/cds-dk'`
  else throw e
}

module.exports = class PostgresBuildPlugin extends BuildTaskHandler {
  static hasTask() {
    return cds.requires.db.kind === 'postgres'
  }

  static getTask() {
    return { for: 'postgres', src: 'db' }
  }

  init() {
    this.task.dest = cds.env.build.target === '.' ? path.join(this.task.dest, 'gen/pg') : path.join(this.task.dest, 'pg')
  }

  async clean() {
    await rimraf(this.task.dest)
  }

  async build() {
    const model = await this.model()
    if (!model) {
      return
    }
    await Promise.all([
      this.write({
        dependencies: { '@sap/cds': '^7', '@cap-js/postgres': '^1' },
        scripts: { start: 'cds-deploy' },
      }).to('package.json'),
      this.write(cds.compile.to.json(model)).to('csn.json'),
      this.copy('data').to('data'),
    ])
  }
}
