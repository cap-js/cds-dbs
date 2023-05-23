const cds = require('@sap/cds/lib')

if (cds.requires.db?.impl === '@cap-js/sqlite') {
  cds.env.fiori.lean_draft = true
}
