'use strict';

/**
 * Asserts that there is no association usage outside of the specified service.
 * We do not check in type-ofs - we resolve them, so they are not a problem.
 *
 * @param {object} parent - The parent object in the CSN (Core Schema Notation).
 * @param {string} prop - The property name of the parent object.
 * @param {object} ref - The reference object.
 * @param {Array} path - The path array indicating the location in the CSN.
 * @param {object} grandparent - The grandparent object in the CSN.
 * @param {string} parentProp - The property name of the grandparent object.
 */
function assertNoAssocUsageOutsideOfService( parent, prop, ref, path, grandparent, parentProp ) {
  const artifactName = path[1];
  if (parentProp === 'type')
    return;

  if (this.csn.definitions[this.options.effectiveServiceName]?.kind !== 'service' ||
      !artifactName.startsWith(`${ this.options.effectiveServiceName }.`))
    return;

  const { _links } = parent;
  if (_links?.length <= 1)
    return;

  for (let i = 0; i < _links.length - 1; i++) {
    const { art } = _links[i];
    if (art.target && !art.target.startsWith(`${ this.options.effectiveServiceName }.`)) {
      this.error('assoc-invalid-outside-service', path.concat('ref', i),
                 { name: this.options.effectiveServiceName, id: ref[i].id || ref[i] },
                 'Association $(ID) pointing outside of service $(NAME) must not be used');
      return;
    }
  }
}

module.exports = {
  ref: assertNoAssocUsageOutsideOfService,
};
