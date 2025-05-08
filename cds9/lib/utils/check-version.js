let version = /(\d+)(?:\.(\d+).*)?/ .exec (require('../../package.json').engines.node)
let given   = /(\d+)(?:\.(\d+).*)?/ .exec (process.version)
if (+given[1] < +version[1] || given[1] == version[1] && +given[2] < +version[2]) {
  process.stderr.write (`
    Node.js version ${version[0]} or higher is required for @sap/cds.
    Current version ${given[0]} does not satisfy this.
  \n`)
  process.exit(1)
}
