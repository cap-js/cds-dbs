const cds = require('@sap/cds/lib')

cds.requires.kinds.sqlite = {
  credentials: { url: ':memory:' },
  impl: '@cap-js/sqlite',
  kind: 'sqlite',
}

if (cds.requires.db?.impl === '@cap-js/sqlite') {
  cds.env.fiori.lean_draft = true
}
