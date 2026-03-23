process.env.cds_features_ieee754compatible = false

require('./ieee.js')('false', 'numbers', [
  { integer64: 1, float: 1.1, decimal: 1.1 },
  { integer64: 2, float: 2.1, decimal: 2.1 }
])
