'use strict';

// Only to be used with validator.js - a correct this value needs to be provided!

const { ModelError } = require('../base/error');
const { setProp } = require('../base/model');

/**
 * Assert that targets of associations and compositions are entities.
 *
 * @param {object} member Member
 */
function invalidTarget( member ) {
  // Declared as arrow-function to keep scope the same (this value)
  const handleStructured = (mem) => {
    for (const elementName of Object.keys(mem.elements)) {
      const element = mem.elements[elementName];
      // eslint-disable-next-line no-use-before-define
      checkForInvalidTarget(element);
    }
  };

  // Declared as arrow-function to keep scope the same (this value)
  const checkForInvalidTarget = (mem) => {
    if (mem.target) {
      const target = this.csn.definitions[mem.target];
      if (!target)              // `[object Object]` → anonymous target aspect
        throw new ModelError(`Expected target ${ mem.target }`);
      if (target.kind !== 'entity') {
        const isAssoc = this.csnUtils.getFinalTypeInfo(member.type)?.type !== 'cds.Composition';
        this.error(
          null,
          member.$path,
          { '#': isAssoc ? 'std' : 'comp', meta: target.kind },
          {
            std: 'Association target must be an entity but found: $(META)',
            comp: 'Composition target must be an entity but found: $(META)',
          }
        );
      }
    }
    // elements have precedence over type
    else if (mem.elements) {
      handleStructured(mem);
    }
    else if (mem.type) {
      const type = mem.type.ref ? this.artifactRef(mem.type) : this.csn.definitions[mem.type];
      if (type && !type.$visited) {
        setProp(type, '$visited', true);
        checkForInvalidTarget(type);
        delete type.$visited;
      }
    }
  };

  if (
    this.artifact &&
    this.artifact.kind === 'entity' &&
    member.$path[2] === 'elements'
  )
    checkForInvalidTarget(member);
}

module.exports = invalidTarget;
