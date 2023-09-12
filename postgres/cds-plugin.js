const cds = require('@sap/cds/lib')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/postgres" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

if (cds.cli.command === 'build') {
  const { write, copy, rimraf } = cds.utils

  let BuildTaskHandler
  try {
    ({ BuildTaskHandler } = require("@sap/cds-dk/lib/build"))
  } catch (e) {
    if (e.code === 'ENOTFOUND') throw `Please install @sap/cds-dk for development using 'npm i -D @sap/cds-dk'`
    else throw e
  }

  module.exports = class PostgresBuildTask extends BuildTaskHandler {

    static hasTask() {
        return true // TODO: What to put in here?
    }

    static getTask() {
        return { for: 'postgres', src: 'db' }
    }

    async clean() {
      await rimraf('gen/pg') // TODO: What to put in here?
    }

    async build() {
      const model = await this.model()
      if (!model) {
          return
      }
      await Promise.all([
        write('gen/pg/package.json', {
          dependencies: { '@sap/cds': '^7', '@cap-js/postgres': '^1' },
          scripts: { start: 'cds-deploy' }
        }, { spaces: 2 }),
        write('gen/pg/db/csn.json', cds.compile(model), { spaces: 2 }),
        copy('db/data').to('gen/pg/db/data')
      ])
    }
  }
}
