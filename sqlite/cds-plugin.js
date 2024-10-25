const cds = require('@sap/cds')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/sqlite" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}
