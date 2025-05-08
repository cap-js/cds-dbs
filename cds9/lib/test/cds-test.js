// Overwrite require to support IntelliSense in VS Code...
const {resolve} = require, paths = [ process.cwd(),  __dirname ]
require = id => module.require (resolve(id,{paths})) // eslint-disable-line no-global-assign

module.exports = require ('@cap-js/cds-test')
