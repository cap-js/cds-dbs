const cds = require('@sap/cds')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/postgres" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

// requires @sap/cds-dk version >= 7.3.2
cds.build?.register?.('postgres', {
  impl: '@cap-js/postgres/lib/build.js',
  taskDefaults: { src: cds.env.folders.db }
})
