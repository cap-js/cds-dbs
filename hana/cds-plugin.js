const cds = require('@sap/cds')

if (cds.requires.db?.impl === '@cap-js/hana') {
  cds.env.sql.dialect = 'hana'
}
