const cds = require('@sap/cds')

let BuildPlugin
try {
  ({ BuildPlugin } = require('@sap/cds-dk/lib/build'))
} catch (e) {
  if (e.code === 'ENOTFOUND') throw `No build plugin mechanism for @sap/cds-dk found. Please install @sap/cds-dk for development using 'npm i -D @sap/cds-dk@^7.3.1'`
  else throw e
}

const { fs, path } = cds.utils

module.exports = class PostgresBuildPlugin extends BuildPlugin {

  async build() {
    const model = await this.model()
    if (!model) return

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
