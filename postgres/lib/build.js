const cds = require('@sap/cds')
const { fs, path } = cds.utils

module.exports = class PostgresBuildPlugin extends cds.build.BuildPlugin {

  static hasTask() {
    return cds.requires.db?.kind === 'postgres'
  }

  async build() {
    const model = await this.model()
    if (!model) return

    const promises = []
    promises.push(this.write({
        dependencies: { '@sap/cds': '^7', '@cap-js/postgres': '^1' },
        scripts: { start: 'cds-deploy' },
      }).to('pg/package.json'))
    promises.push(this.write(cds.compile.to.json(model)).to(path.join('pg/db', 'csn.json')))

    let data
    if (fs.existsSync(path.join(this.task.src, 'data'))) {
      data = 'data'
    } else if (fs.existsSync(path.join(this.task.src, 'csv'))) {
      data = 'csv'
    }
    if (data) {
      promises.push(this.copy(data).to(path.join('pg/db', 'data')))
    }
    return Promise.all(promises)
  }
}
