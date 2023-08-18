const cds = require('@sap/cds/lib')

if (cds.requires.db?.impl === '@cap-js/hana') {
  cds.env.sql.dialect = 'hana'
  cds.env.fiori.lean_draft = true
}
