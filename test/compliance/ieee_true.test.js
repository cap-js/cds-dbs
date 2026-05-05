process.env.cds_features_ieee754compatible = true

require('./ieee.js')('true', 'strings', [
  { integer64: '1', float: '1.1', decimal: '1.1000' },
  { integer64: '2', float: '2.1', decimal: '2.1000' }
])
