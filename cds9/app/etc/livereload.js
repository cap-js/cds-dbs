// Connects to a live reload server started by cds watch

const cds = require('../../lib')
const { livereload: config } = cds.env

if (config && config.path && config.url) {
  const liveReload = require(config.path) // path to connect-livereload, set by cds watch
  cds.on ('bootstrap', app => app.use (liveReload({ src: config.url })))
}
