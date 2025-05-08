// cds-compiler Inspect Module
// Used by `cdsc inspect` to gather details about the model such as statistics, etc.

'use strict';

const { inspectModelStatistics } = require('./inspectModelStatistics');
const { inspectPropagation } = require('./inspectPropagation');
const { stringRefToPath } = require('./inspectUtils');

module.exports = {
  inspectModelStatistics,
  inspectPropagation,
  stringRefToPath,
};
