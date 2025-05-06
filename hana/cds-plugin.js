const cds = require('@sap/cds')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/hana" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

if (cds.requires.db?.impl === '@cap-js/hana') {
  cds.env.sql.dialect = 'hana'
}
