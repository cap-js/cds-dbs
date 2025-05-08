'use strict';

const { makeMessageFunction } = require('../base/messages');
const { setProp } = require('../base/model');
const {
  forEachDefinition,
  forEachMember,
  isPersistedAsTable,
  isPersistedAsView,
} = require('../model/csnUtils');
const { forEachKey, forEach } = require('../utils/objectUtils');

// used to mark a view as changed so we know to drop-create it
const isChanged = Symbol('Marks a view as changed');

const relevantProperties = {
  doc: true,
  '@sql.prepend': true,
  '@sql.append': true,
};

/**
 * Compares two models, in HANA-transformed CSN format, to each other.
 *
 * @param beforeModel the before-model
 * @param afterModel the after-model
 * @param {HdiOptions|false} options
 * @returns {ModelDiff} the sets of deletions, extensions, and migrations of entities necessary to transform the before-model
 * to the after-model, together with all the definitions of the after-model
 */
function compareModels(beforeModel, afterModel, options) {
  // @ts-ignore
  if (!(options && options.testMode)) // no $version with testMode
    validateCsnVersions(beforeModel, afterModel, options);

  const returnObj = Object.create(null);
  returnObj.definitions = afterModel.definitions;
  returnObj.deletions = Object.create(null);
  returnObj.extensions = [];
  returnObj.migrations = []; // element changes/removals or changes of entity properties
  returnObj.unchangedConstraints = new Set();
  returnObj.changedPrimaryKeys = [];

  // There is currently no use in knowing the added entities only. If this changes, hand in `addedEntities` to `getArtifactComparator` below.
  forEachDefinition(afterModel, getExtensionAndMigrations(beforeModel, options, returnObj));
  forEachDefinition(beforeModel, getDeletions(afterModel, options, returnObj));


  return returnObj;
}

function validateCsnVersions(beforeModel, afterModel, options) {
  const beforeVersion = beforeModel.$version;
  const afterVersion = afterModel.$version;
  const beforeVersionParts = beforeVersion && beforeVersion.split('.');
  const afterVersionParts = afterVersion && afterVersion.split('.');

  if (!beforeVersionParts || beforeVersionParts.length < 2) {
    const { error, throwWithAnyError } = makeMessageFunction(beforeModel, options, 'modelCompare');
    error(null, null, { version: beforeVersion || 'undefined' }, 'Invalid CSN version: $(VERSION)');
    throwWithAnyError();
  }
  if (!afterVersionParts || afterVersionParts.length < 2) {
    const { error, throwWithAnyError } = makeMessageFunction(afterModel, options, 'modelCompare');
    error(null, null, { version: afterVersion || 'undefined' }, 'Invalid CSN version: $(VERSION)');
    throwWithAnyError();
  }
  if (beforeVersionParts[0] > afterVersionParts[0] && !(options && options.allowCsnDowngrade)) {
    const { error, throwWithAnyError } = makeMessageFunction(afterModel, options, 'modelCompare');

    const { version } = require('../../package.json');
    error(null, null, { value: afterVersion, othervalue: beforeVersion, version },
          'Incompatible CSN versions: $(VALUE) is a major downgrade from $(OTHERVALUE). Is @sap/cds-compiler version $(VERSION) outdated?');
    throwWithAnyError();
  }
}

/**
 * Calculate extensions, migrations and unchangedConstraints
 *
 * @param {CSN.Model} beforeModel
 * @param {CSN.Options} options
 * @param {object} returnObj
 * @returns {function}
 */
function getExtensionAndMigrations(beforeModel, options, {
  extensions, migrations, unchangedConstraints, changedPrimaryKeys,
}) {
  return function compareArtifacts(artifact, name) {
    let hasPrimaryKeyChange = false;
    const otherArtifact = beforeModel.definitions[name];
    const isPersisted = isPersistedAsTable(artifact);
    const isPersistedOther = otherArtifact && isPersistedAsTable(otherArtifact);

    // to make it easier to know which views to drop-create
    if (isPersistedAsView(artifact) && isPersistedAsView(otherArtifact)) {
      // TODO: Check only on artifact.query/projection BUT: Need to manually check for sql-snippets then!
      artifact[isChanged] = JSON.stringify(artifact) !== JSON.stringify(otherArtifact);
    }

    // Looking for added entities and added/deleted/changed elements.
    // Parameters: `artifact` from afterModel and `otherArtifact` from beforeModel.

    if (!isPersisted) // Artifact not persisted in afterModel.
      return;

    if (!isPersistedOther) {
      extensions[name] = artifact;
      return;
    }

    // Artifact changed?

    addElements();
    changePropsOrRemoveOrChangeElements();
    if (hasPrimaryKeyChange)
      changedPrimaryKeys.push(name);

    function addElements() {
      const elements = {};
      const keysNow = [];
      forEachMember(artifact, (element, eName) => {
        getElementComparator(otherArtifact, elements)(element, eName);
        if (element.key)
          keysNow.push(eName);
      }, [ 'definitions', name ], true, { elementsOnly: true });

      // Only do this check for to.hdi.migration - the order only "bites" us when doing .hdbmigrationtable as the end-check against the intended
      // create-table will fail. TODO: Does a mismatched order of the primary key hurt us for postgres and others?
      if (!hasPrimaryKeyChange && options.sqlDialect === 'hana' && options.src === 'hdi') {
        const keysOther = [];
        forEachMember(otherArtifact, (element, eName) => {
          if (element.key)
            keysOther.push(eName);
        }, [ 'definitions', name ], true, { elementsOnly: true });

        if (keysNow.join(',') !== keysOther.join(','))
          hasPrimaryKeyChange = true;
      }

      if (Object.keys(elements).length > 0) {
        const added = addedElements(name, elements);
        if (!hasPrimaryKeyChange) {
          forEach(added.elements, (_name, element) => {
            if (element.key && !element.target)
              hasPrimaryKeyChange = true;
          });
        }
        extensions.push(added);
      }
    }
    function changePropsOrRemoveOrChangeElements() {
      const changedProperties = {};

      const removedElements = {};
      const changedElements = {};

      const migration = { migrate: name };

      Object.keys(relevantProperties).forEach((prop) => {
        if (artifact[prop] !== otherArtifact[prop])
          changedProperties[prop] = changedElement(artifact[prop], otherArtifact[prop] || null);
      });

      const removedConstraints = {};

      // HDI (src === 'hdi) does handle table constraints via separate files and therefore no delta handling needed
      if (options.src === 'sql' && (artifact.$tableConstraints || otherArtifact.$tableConstraints)) {
        const current = artifact.$tableConstraints || {};
        const old = otherArtifact.$tableConstraints || {};
        let changes = false;
        const constraintTypes = [ 'unique', 'referential' ];
        constraintTypes.forEach((constraintType) => {
          // We only render/handle referential constraints for specific cases
          if (hasReferentialConstraints(options) || constraintType !== 'referential') {
            if (current[constraintType] || old[constraintType]) {
              removedConstraints[constraintType] = Object.create(null);

              const cnew = current[constraintType] || Object.create(null);
              const cold = old[constraintType] || Object.create(null);
              forEachKey(cnew, (constraintName) => {
                if (cold[constraintName]) {
                // constraint changed - add it to "removedConstraints" to drop-create it.
                // Quick-and-dirty compare with JSON.stringify - false-positive will just be a drop-create
                  if (JSON.stringify(cold[constraintName]) !== JSON.stringify(cnew[constraintName])) {
                    changes = true;
                    removedConstraints[constraintType][constraintName] = cold[constraintName];
                    if (options.constraintsInCreateTable || constraintType !== 'referential') // schedule an "ADD"
                      extensions.push(addedConstraint(name, cnew[constraintName], constraintName, constraintType));
                  }
                  else {
                    unchangedConstraints.add(constraintName);
                  }
                }
                else if (options.constraintsInCreateTable || constraintType !== 'referential') {
                // Sometimes referential constraints are anyway added via ALTER - no need to add them as explicit extensions then
                  extensions.push(addedConstraint(name, cnew[constraintName], constraintName, constraintType));
                }
              });

              forEachKey(cold, (constraintName) => {
                if (!cnew[constraintName]) {
                  changes = true;
                  removedConstraints[constraintType][constraintName] = cold[constraintName];
                }
              });
            }
          }
        });

        if (changes)
          migration.removeConstraints = removedConstraints;
      }

      if (Object.keys(changedProperties).length > 0)
        migration.properties = changedProperties;


      forEachMember(otherArtifact, getElementComparator(artifact, removedElements), [ 'definitions', name ], true, { elementsOnly: true });
      if (Object.keys(removedElements).length > 0) {
        migration.remove = removedElements;
        if (!hasPrimaryKeyChange) {
          forEach(removedElements, (_name, change) => {
            if (change.key && !change.target)
              hasPrimaryKeyChange = true;
          });
        }
      }

      forEachMember(artifact, getElementComparator(otherArtifact, null, changedElements), [ 'definitions', name ], true, { elementsOnly: true });
      if (Object.keys(changedElements).length > 0) {
        migration.change = changedElements;
        if (!hasPrimaryKeyChange) {
          forEach(changedElements, (_name, change) => {
            if (!change.onlyDoc && (change.old.key || change.new.key) && !change.new.target && !change.old.target) {
            // For to.hdi.migration: Just drop-create (commented out), for to.sql.migration: Handle case where we add/remove "key" keyword, no drop-create otherwise
              if (options.sqlDialect === 'hana' && options.src === 'hdi' || (!change.old.key || !change.new.key))
                hasPrimaryKeyChange = true;
            }
          });
        }
      }

      if (migration.properties || migration.remove || migration.change || migration.removeConstraints)
        migrations.push(migration);
    }
  };
}
/**
 * Calculate all deleted entities.
 *
 * @param {CSN.Model} afterModel
 * @param {CSN.Options} options
 * @param {object} returnObj
 * @returns {function}
 */
function getDeletions(afterModel, options, { deletions }) {
  return function compareArtifacts(artifact, name) {
    const otherArtifact = afterModel.definitions[name];
    const isPersistedTable = isPersistedAsTable(artifact);
    const isPersistedView = isPersistedAsView(artifact);
    const isPersistedTableOther = otherArtifact && isPersistedAsTable(otherArtifact);
    const isPersistedViewOther = otherArtifact && isPersistedAsView(otherArtifact);

    // Looking for deleted entities or table -> view / view -> table
    if (
      (isPersistedTable && isPersistedViewOther) || // table -> view
      (isPersistedView && isPersistedTableOther) || // view -> table
      ((isPersistedTable || isPersistedView) && // deleted
        !(isPersistedTableOther || isPersistedViewOther))
    ) // view turned into table - need to render a drop for the view
      deletions[name] = artifact;
  };
}

function getElementComparator(otherArtifact, addedElementsDict = null, changedElementsDict = null) {
  return function compareElements(element, name) {
    if (element.$ignore)
      return;


    const otherElement = otherArtifact.elements[name];
    if (otherElement && !otherElement.$ignore) {
      // Element type changed?
      if (!changedElementsDict)
        return;

      if (relevantTypeChange(element.type, otherElement.type) || typeParametersChanged(element, otherElement)) {
        // Type or parameters, e.g. association target, changed.
        if (otherElement.notNull && element.notNull === undefined && !element.key || otherElement.key && !element.key && !element.notNull)
          setProp(element, '$notNull', false); // Explicitly set notNull to the implicit default so we render the correct ALTER

        if (otherElement.default && element.default === undefined)
          setProp(element, '$default', { val: null }); // Explicitly set default to the implicit default "null" so we render the correct ALTER

        changedElementsDict[name] = changedElement(element, otherElement);
      }
      else if (docCommentChanged(element, otherElement)) {
        changedElementsDict[name] = { ...changedElement(element, otherElement), onlyDoc: true };
      }

      return;
    }

    if (addedElementsDict)
      addedElementsDict[name] = element;
  };
}

function relevantTypeChange(type, otherType) {
  return otherType !== type && !isSuperflousHanaTypeChange(otherType, type) && ![ type, otherType ].every(t => [ 'cds.Association', 'cds.Composition' ].includes(t));
}

const superflousTypeChanges = {
  // turn it into a real dict
  __proto__: null,
  // We used to put these types into the CSN, although they are just internal
  // so we need to be robust against them now.
  'cds.UTCDateTime': 'cds.DateTime',
  'cds.UTCTimestamp': 'cds.Timestamp',
  'cds.LocalDate': 'cds.Date',
  'cds.LocalTime': 'cds.Time',
};

/**
 * We removed some old SAP HANA types from the CSN and we now need to not
 * detect them as changes.
 *
 * @param {string} before Type before
 * @param {string} after Type after
 * @returns {boolean}
 */
function isSuperflousHanaTypeChange( before, after ) {
  return superflousTypeChanges[before] ? superflousTypeChanges[before] === after : false;
}

/**
 * If the element has one of the superflous types, do the change so we don't accidentally
 * pass such an old type into the SQL renderer.
 * @param {CSN.Element} element
 * @returns {CSN.Element}
 */
function remapType( element ) {
  if (element?.type && superflousTypeChanges[element.type])
    element.type = superflousTypeChanges[element.type];
  return element;
}

/**
 * Returns whether two things are deeply equal.
 * Function-type things are compared in terms of identity,
 * object-type things in terms of deep equality of all of their properties,
 * all other things in terms of strict equality (===).
 *
 * @param a {any} first thing
 * @param b {any} second thing
 * @param include {function} function of a key and a depth, returning true if and only if the given key at the given depth is to be included in comparison
 * @param depth {number} the current depth in property hierarchy below each of the original arguments (positive, counting from 0; don't set)
 * @returns {boolean}
 */
function deepEqual(a, b, include = () => true, depth = 0) {
  function isObject(x) {
    return x !== null && typeof x === 'object';
  }
  function samePropertyCount() {
    return Object.keys(a).length === Object.keys(b).length;
  }
  function allPropertiesEqual() {
    return Object.keys(a).reduce((prev, key) => prev && (!include(key, depth) || deepEqual(a[key], b[key], include, depth + 1)), true);
  }

  if (isObject(a)) {
    return isObject(b)
      ? samePropertyCount() && allPropertiesEqual()
      : false;
  }
  return a === b;
}

function docCommentChanged(element, otherElement) {
  return element.doc && !otherElement.doc || otherElement.doc && !element.doc || element.doc && element.doc !== otherElement.doc;
}

/**
 * Returns whether any type parameters differ between two given elements. Ignores whether types themselves differ (`type` property) and ignores
 * diff in doc comments.
 * @param element {object} an element
 * @param otherElement {object} another element
 * @returns {boolean}
 */
function typeParametersChanged(element, otherElement) {
  const checked = new Set();
  for (const key in element) {
    if (Object.prototype.hasOwnProperty.call(element, key)) {
      if ((!key.startsWith('@') || relevantProperties[key]) && key !== 'type' && key !== 'doc') {
        checked.add(key);
        if (!deepEqual(element[key], otherElement[key]))
          return true;
      }
    }
  }

  for (const key in otherElement) {
    if (Object.prototype.hasOwnProperty.call(otherElement, key)) {
      if ((!key.startsWith('@') || relevantProperties[key]) && key !== 'type' && key !== 'doc' && !checked.has(key))
        return true;
    }
  }

  return false;
}

function addedElements(entity, elements) {
  return {
    extend: entity,
    elements,
  };
}

function addedConstraint(entity, constraint, constraintName, constraintType) {
  return {
    extend: entity,
    constraint,
    constraintName,
    constraintType,
  };
}

function changedElement(element, otherElement) {
  return {
    old: remapType(otherElement),
    new: element,
  };
}

function hasReferentialConstraints(options) {
  return options.src === 'sql' && (options.sqlDialect === 'postgres' || options.sqlDialect === 'hana' || options.sqlDialect === 'sqlite');
}

module.exports = {
  compareModels,
  deepEqual,
  isChanged,
};

/**
 * A ModelDiff encapsulates the changes between two models ("before" and "after"). It contains information
 * about changes to .elements and removed artifacts.
 *
 * @typedef {object} ModelDiff
 * @property {CSN.Definitions} definitions The artifacts present in the "after" model
 * @property {CSN.Definitions} deletions The artifacts present in the "before", but not in the "after"
 * @property {extension[]} extensions The elements added to artifacts
 * @property {migration[]} migrations Altered or removed elements
 */

/**
 * @typedef {object} extension
 * @property {CSN.Elements} elements The elements that where added
 * @property {string} extend Name of the artifact that the .elements need to be added to
 */

/**
 * @typedef {object} migration
 * @property {Object.<string, ChangeSet>} change An object of changes - the key being the name of the changed element, the value being the change.
 * @property {string} migrate Name of the artifact that the .change and .remove apply to
 * @property {CSN.Elements} remove An object of removed elements
 */

/**
 * @typedef {object} ChangeSet Describes the change of one element
 * @property {CSN.Element} old The old element definition
 * @property {CSN.Element} new The new element definition
 */
