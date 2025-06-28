const path = require('node:path')

module.exports = {
  "impl": "@cap-js/sqlite",
  "credentials": {
    "database": path.resolve(__dirname,"../../test/db.sqlite")
  }
}
