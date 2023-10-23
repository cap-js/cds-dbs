const cds = require('@sap/cds')

const { fs, path } = cds.utils

module.exports = class PostgresBuildPlugin extends cds.build.BuildPlugin {

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
