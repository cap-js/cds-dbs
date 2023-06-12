const { describe } = require('./test')

describe('features', () => {
  // Require all features
  // Require order is important to allow for a sorted matrix relation

  // All data types
  require('./cds.builtin.types.cds.Integer32.test')
  require('./cds.builtin.types.cds.Integer64.test')
  require('./cds.builtin.types.cds.DateTime.test')
  require('./cds.builtin.types.cds.Timestamp.test')

  // Complex tests that require other features to be tested
  require('./cds.builtin.classes.struct.test')
  require('./cds.builtin.classes.key.test')
  require('./cds.builtin.classes.association.test')
})
