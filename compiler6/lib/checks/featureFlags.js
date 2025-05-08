'use strict';

const { setProp } = require('../base/model');
const { featureFlags } = require('../transform/featureFlags');
const { isSqlService, isDummyService } = require('../transform/db/processSqlServices');

/**
 *
 * @param {string} flag
 *
 * @returns {Function} Function to correctly set the given flag
 */
function setFeatureFlag( flag ) {
  return function setFlag() {
    if (!this.csn.meta)
      setProp(this.csn, 'meta', {});
    if (!this.csn.meta[featureFlags])
      this.csn.meta[featureFlags] = {};

    this.csn.meta[featureFlags][flag] = true;
  };
}

// Export a applyTransformations callback object that sets the feature flags if certain properties are present
module.exports = {
  value: setFeatureFlag('$calculatedElements'),
  expand: setFeatureFlag('$expandInline'),
  inline: setFeatureFlag('$expandInline'),
  kind: function setFeatureFlagForSqlService( artifact ) {
    if (isSqlService(artifact))
      setFeatureFlag( '$sqlService' ).call(this);

    if (isDummyService(artifact, this.options))
      setFeatureFlag( '$dummyService' ).call(this);
  },
};
