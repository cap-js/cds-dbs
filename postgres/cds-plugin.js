const cds = require('@sap/cds-dk/lib')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/postgres" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

cds.build.register('postgres', {
  impl: __dirname + '/lib/build.js',
  taskDefaults: { src: cds.env.folders.db, dest: 'pg' }
})
