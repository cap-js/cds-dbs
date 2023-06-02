const cds = require('@sap/cds/lib')

cds.once('bootstrap', () => {
  if (cds.requires.db?.impl === '@cap-js/postgres') {
    cds.requires.db.vcap = { label: 'postgresql-db', tag: 'postgresql-db' }
  }
})
