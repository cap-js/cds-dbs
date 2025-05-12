'use strict';

/**
 * Check that primary keys are not explicitly nullable
 *
 * @param {CSN.Element} element The element to check
 */
function checkExplicitlyNullableKeys( element ) {
  if (element.key && element.notNull === false)
    this.error(null, element.$path, {}, 'Expecting primary key element to be not nullable');
}

module.exports = checkExplicitlyNullableKeys;
