// REVISIT: remove with next major
process.env.CDS_FEATURES_STRING__DECIMALS = true

require('./CREATE.test')
require('./DELETE.test')
require('./DROP.test')
require('./INSERT.test')
require('./SELECT.test')
require('./UPDATE.test')
require('./definitions.test')
require('./functions.test')
require('./literals.test')
require('./timestamps.test')
require('./api.test')
