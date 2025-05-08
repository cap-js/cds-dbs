'use strict';

const { forEachDefinition } = require('../../base/model');
const { applyTransformations, getResultingName, hasPersistenceSkipAnnotation } = require('../../model/csnUtils');
const { forEach, forEachKey } = require('../../utils/objectUtils');
const { CompilerAssertion } = require('../../base/error');

const COMPOSITION = 'cds.Composition';
const ASSOCIATION = 'cds.Association';
/**
 * Create referential constraints for foreign keys mentioned in on-conditions of associations and compositions.
 * The referential constraints will be attached to the csn.Artifacts.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options are used to modify the validate / enforced flag on the constraints
 */
function createReferentialConstraints( csn, options ) {
  const isTenant = options.tenantDiscriminator === true;
  let validated = true;
  let enforced = true;
  if (options.integrityNotValidated)
    validated = false;

  if (options.integrityNotEnforced)
    enforced = false;

  // prepare the functions with the compositions and associations across all entities first
  // and execute it afterwards.
  // compositions must be processed first, as the <up_> links for them must result in `ON DELETE CASCADE`
  const compositions = [];
  const associations = [];
  applyTransformations(csn, {
    elements: (art, prop, elements, path) => {
      // Step I: iterate compositions, enrich dependent keys for <up_> association in target entity of composition
      for (const elementName in elements) {
        const element = elements[elementName];
        const ePath = path.concat([ 'elements', elementName ]); // Save a copy in this scope for the late callback
        if (element.type === COMPOSITION && element.$selfOnCondition) {
          compositions.push({
            fn: () => {
              foreignKeyConstraintForUpLinkOfComposition(element, art, ePath);
            },
          });
        }
      }

      // Step II: iterate associations, enrich dependent keys (in entity containing the association)
      for (const elementName in elements) {
        const element = elements[elementName];
        const ePath = path.concat([ 'elements', elementName ]); // Save a copy in this scope for the late callback
        if (element.keys && isToOne(element) && element.type === ASSOCIATION || element.type === COMPOSITION && treatCompositionLikeAssociation(element)) {
          associations.push({
            fn: () => {
              // parent entity of assoc becomes dependent table
              foreignKeyConstraintForAssociation( element, art, ePath );
            },
          });
        }
        // for `texts` compositions, we may generate foreign key constraints even w/o `up_`
        else if (elementName === 'texts' && element.target === `${ path[path.length - 1] }.texts`) {
          const { on } = element;
          const textsEntity = csn.definitions[element.target];
          // `texts` entities have a key named "locale"
          const targetSideHasLocaleKey = textsEntity.elements.locale?.key;
          if (targetSideHasLocaleKey && !skipConstraintGeneration(art, textsEntity, { /* there is no assoc */ })) {
            // Note: a `texts` composition in `Foo` will co-modify `Foo.texts` and create the constraints over there
            const { dependentKeys, parentKeys } = extractKeys(on, textsEntity.elements, elements);

            const keysInParent = Object.values(elements).filter(e => e.key);
            if (keysInParent.length !== dependentKeys.length)
              continue;

            // `texts` entities have all the keys the original entity has
            const allElementsAreKeysAndHaveTheSameName = parentKeys.length &&
            parentKeys
              .every(
                ([ targetKey, e ]) => e.key &&
                dependentKeys.some(([ sourceKey, sourceElement ]) => sourceElement.key && targetKey === sourceKey )
              );
            if (allElementsAreKeysAndHaveTheSameName)
              attachConstraintsToDependentKeys(dependentKeys, parentKeys, path[path.length - 1], 'texts', { texts: true });
          }
        }
      }
    },
  }, [], { skipIgnore: false, skipArtifact: a => !!(a.query || a.kind !== 'entity' ) });

  // create constraints on foreign keys
  // always process unmanaged first, up_ links must be flagged
  // before they are processed
  compositions.forEach(composition => composition.fn());
  associations.forEach(association => association.fn());

  // Step III: Create the final referential constraints from all dependent key <-> parent key pairs stemming from the same $sourceAssociation
  forEachDefinition(csn, collectAndAttachReferentialConstraints);

  /**
   * Retrieve the <up_> link of an `cds.Composition` used in an on-condition like `$self = <comp>.<up_>`
   * and calculate a foreign key constraint for this association if it is constraint compliant.
   * The constraint will have an `ON DELETE CASCADE`.
   *
   * @param {CSN.Element} composition which might has the `$self = <comp>.<up_>` on-condition
   * @param {CSN.Artifact} parent artifact containing the composition
   * @param {CSN.Path} path
   */
  function foreignKeyConstraintForUpLinkOfComposition( composition, parent, path ) {
    const dependent = csn.definitions[composition.target];
    if (skipConstraintGeneration(parent, dependent, composition))
      return;

    const onCondition = composition.on;
    if (composition.$selfOnCondition && composition.$selfOnCondition.up_.length === 1) {
      const upLinkName = composition.$selfOnCondition.up_[0];
      const up_ = csn.definitions[composition.target].elements[upLinkName];
      if (up_.keys && isToOne(up_)) // no constraint for unmanaged / to-many up_ links
        foreignKeyConstraintForAssociation(up_, dependent, [ 'definitions', composition.target, 'elements', upLinkName ], path[path.length - 1] );
    }
    else if (!onCondition && composition.keys.length > 0) {
      throw new CompilerAssertion('Debug me, an on-condition was expected here, but only found keys');
    }
  }

  /**
   * Calculate referential constraints for dependent keys in the entity where the cds.Associations is defined.
   * The DELETE rule for a referential constraint stemming from a cds.Association will be 'RESTRICT'
   * If the association is used as an <up_> link in a compositions on-condition, the ON DELETE rule will be `CASCADE`
   *
   * @param {CSN.Association} association for that a constraint should be generated
   * @param {CSN.Entity} dependent the entity for which a constraint will be generated
   * @param {CSN.Path} path
   * @param {CSN.PathSegment} upLinkFor the name of the composition which used this association in a `$self = <comp>.<up_>` comparison
   */
  function foreignKeyConstraintForAssociation( association, dependent, path, upLinkFor = null ) {
    const parent = csn.definitions[association.target];
    if (skipConstraintGeneration(parent, dependent, association))
      return;
    const { elements } = dependent;
    if (association.keys) {
      // 1. cds.Association has constraint compliant on-condition
      // mark each dependent key - in the entity containing the association - referenced in the on-condition
      const parentKeys = [];
      const dependentKeys = [];
      association.keys.forEach( (k) => {
        dependentKeys.push( [ k.$generatedFieldName, elements[k.$generatedFieldName] ] );
        const parentKey = parent.elements[k.ref[0]];
        if (parentKey.key) // only keys are valid references in foreign key constraints
          parentKeys.push( [ k.ref[0], parent.elements[k.ref[0]] ] );
      });
      if (isTenant && elements.tenant && parent.elements.tenant) { // `tenant` is not part of on
        dependentKeys.push([ 'tenant', elements.tenant ]);
        parentKeys.push([ 'tenant', parent.elements.tenant ]);
      }
      const allKeysCovered = parentKeys.length === Object.values(parent.elements).filter(e => e.key).length;
      // sanity check; do not generate constraints for on-conditions like "dependent.idOne = id AND dependent.idTwo = id"
      if (allKeysCovered && dependentKeys.length === parentKeys.length)
        attachConstraintsToDependentKeys(dependentKeys, parentKeys, association.target, path[path.length - 1], upLinkFor);
    }
  }

  /**
   * Extracts dependent keys and their parent keys based on an 'on' condition.
   *
   * @param {CSN.OnCondition} on - on condition from which dependent keys and their parent keys are extracted.
   * @param {CSN.Elements} elements - The elements of the dependent entity, containing the foreign keys.
   * @param {CSN.Elements} parentElements - The elements of the parent entity, containing the referenced parent keys.
   * @returns {object} An object containing dependent keys and the parent keys which they reference.
   */
  function extractKeys( on, elements, parentElements ) {
    const dependentKeys = Array.from(elementsOfSourceSide(on, elements));
    const parentKeys = Array.from(elementsOfTargetSide(on, parentElements));
    if (isTenant && elements.tenant && parentElements.tenant) { // `tenant` is not part of on
      dependentKeys.push([ 'tenant', elements.tenant ]);
      parentKeys.push([ 'tenant', parentElements.tenant ]);
    }
    return { dependentKeys, parentKeys };
  }

  /**
   * Attach constraints to individual foreign key elements
   * The $foreignKeyConstraint property will later be collected from the foreign keys
   * and attached to the $tableConstraints property of the respective entity.
   *
   * @param {Array} dependentKeys array holding dependent keys in the format [['key1', 'value1'], [...], ...]
   * @param {Array} parentKeys array holding parent keys in the format [['key1', 'value1'], [...], ...]
   * @param {CSN.PathSegment} parentTable the sql-table where the foreign key constraints will be pointing to
   * @param {CSN.PathSegment} sourceAssociation the name of the association from which the constraint originates
   * @param {CSN.PathSegment | object} upLinkFor the name of the composition which used this association in a `$self = <comp>.<up_>` comparison
   *                                    it is used for a comment in the constraint, which is only printed out in test-mode
   */
  function attachConstraintsToDependentKeys(
    dependentKeys,
    parentKeys,
    parentTable,
    sourceAssociation,
    upLinkFor = null
  ) {
    while (dependentKeys.length > 0) {
      const dependentKeyValuePair = dependentKeys.pop();
      const dependentKey = dependentKeyValuePair[1];
      // if it already has a dependent key assigned, do not overwrite it.
      // this is the case for <up_> associations in on-conditions of compositions
      const { $foreignKeyConstraint } = dependentKey;
      // in contrast to foreign keys which stem from managed associations,
      // a tenant foreign key column may have multiple parent keys as partners
      const tenantForeignKey = isTenant && dependentKeyValuePair[0] === 'tenant';
      if ($foreignKeyConstraint && (!tenantForeignKey || $foreignKeyConstraint.upLinkFor))
        return;

      const parentKeyValuePair = parentKeys.pop();
      const parentKeyName = parentKeyValuePair[0];

      const constraint = {
        parentKey: parentKeyName,
        parentTable,
        upLinkFor,
        sourceAssociation,
        onDelete: upLinkFor ? 'CASCADE' : 'RESTRICT',
        validated,
        enforced,
      };
      if (tenantForeignKey) {
        const dontOverwriteUp = dependentKey.$foreignKeyConstraint && dependentKey.$foreignKeyConstraint.some(c => c.sourceAssociation === sourceAssociation && c.parentTable === parentTable);
        const dontOverwriteTexts = dependentKey.$foreignKeyConstraint && dependentKey.$foreignKeyConstraint.some(c => c.sourceAssociation === 'texts' && c.upLinkFor.texts);
        if (!dontOverwriteUp && !dontOverwriteTexts)
          dependentKey.$foreignKeyConstraint = dependentKey.$foreignKeyConstraint ? [ ...dependentKey.$foreignKeyConstraint, constraint ] : [ constraint ];
      }
      else {
        dependentKey.$foreignKeyConstraint = constraint;
      }
    }
  }

  /**
   *  Skip referential constraint if the parent table (association target, or artifact where composition is defined)
   *  of the relation is:
   *    - a query
   *    - annotated with '@cds.persistence.skip:true'
   *
   *  The following decision table reflects the current implementation:
   *
   *   +-----------------+--------------------+-------------------+----------+
   *   | Global Switch:  | Global Check Type:  | @assert.integrity | Generate  |
   *   |"assertIntegrity"| "assertIntegrityType"|                   | Constraint|
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | RT                 | false             | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | RT                 | true/not set      | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | RT                 | RT                | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | RT                 | DB                | yes      |
   *   +-----------------+--------------------+-------------------+----------+
   *   |                 |                    |                   |          |
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | DB                 | false             | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | DB                 | true/not set      | yes      |
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | DB                 | RT                | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   | on              | DB                 | DB                | yes      |
   *   +-----------------+--------------------+-------------------+----------+
   *   |                 |                    |                   |          |
   *   +-----------------+--------------------+-------------------+----------+
   *   | off             | don't care         | don't care        | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   |                 |                    |                   |          |
   *   +-----------------+--------------------+-------------------+----------+
   *   | individual      | RT                 | true              | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   | individual      | DB                 | true              | yes      |
   *   +-----------------+--------------------+-------------------+----------+
   *   | individual      | don't care         | RT                | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *   | individual      | don't care         | DB                | yes      |
   *   +-----------------+--------------------+-------------------+----------+
   *   | individual      | don't care         | false/not set     | no       |
   *   +-----------------+--------------------+-------------------+----------+
   *
   * @param {CSN.Definition} parent entity where the foreign key reference will point at
   * @param  {CSN.Definition} dependent entity where the constraint will be defined on
   * @param {CSN.Association} element the composition or association
   * @returns {boolean}
   */
  function skipConstraintGeneration( parent, dependent, element ) {
    // if set to 'off' don't even bother, just skip all constraints
    if (options.assertIntegrity === false || options.assertIntegrity === 'false')
      return true;

    if (parent.query)
      return true;

    // no constraint if either dependent or parent is not persisted
    if (
      hasPersistenceSkipAnnotation(parent) ||
      hasPersistenceSkipAnnotation(dependent) ||
      parent['@cds.persistence.exists'] ||
      dependent['@cds.persistence.exists']
    )
      return true;

    // some commonly used string literals
    const RT = 'RT';
    const DB = 'DB';
    const CREATE_FOR_UP = '$createReferentialConstraintForUp_';
    const SKIP_FOR_UP = '$skipReferentialConstraintForUp_';

    // if the element itself is explicitly excluded from being checked
    // skip the constraint for it (and its backlink)
    if (isAssertIntegrityAnnotationSetTo(false) ||
      isAssertIntegrityAnnotationSetTo(RT) ||
      element[SKIP_FOR_UP]
    ) {
      // for "auto-generated" associations like for the up_ of a composition of aspects,
      // the annotation on the composition influences the referential constraint for the
      // up_ association
      if (element.$selfOnCondition && element.targetAspect)
        assignPropOnBacklinkIfPossible(SKIP_FOR_UP, true);

      return true;
    }
    const runtimeChecks = options.assertIntegrityType && options.assertIntegrityType.toUpperCase() === RT;
    const compilerChecks = options.assertIntegrityType && options.assertIntegrityType.toUpperCase() === DB;

    if ((!options.assertIntegrity || options.assertIntegrity === true || options.assertIntegrity === 'true') &&
      (!options.assertIntegrityType || runtimeChecks))
      return assertForIntegrityTypeRT();

    if ((!options.assertIntegrity || options.assertIntegrity === true || options.assertIntegrity === 'true') &&
      compilerChecks)
      return assertForIntegrityTypeDB();

    if ((options.assertIntegrity === 'individual'))
      return assertForIndividual();

    // The default for the assertIntegrityType is 'RT', no constraints in that case
    if ((!options.assertIntegrity || options.assertIntegrity === true) &&
      (!options.assertIntegrityType || runtimeChecks))
      return true;

    if (!element.keys || !isToOne(element))
      return true;

    return false;

    /**
     *  if global checks are 'individual' we evaluate every association,
     *  we create db constraints if it is annotated with @assert.integrity: 'DB' (or true)
     *
     * @returns {boolean}
     */
    function assertForIndividual() {
      if (isAssertIntegrityAnnotationSetTo(DB) || element[CREATE_FOR_UP]) {
        // if this is a $self comparison, the up_ link should then result in a constraint
        assignPropOnBacklinkIfPossible(CREATE_FOR_UP, true);
        return false;
      }
      if (options.assertIntegrityType === DB && isAssertIntegrityAnnotationSetTo(true)) {
        // if this is a $self comparison, the up_ link should then result in a constraint
        assignPropOnBacklinkIfPossible(CREATE_FOR_UP, true);
        return false;
      }

      // individual and no ('DB') annotation on constraint --> skip
      return true;
    }

    /**
     * if global check type is 'RT' (or not provided) only generate DB constraint if element
     * is explicitly annotated "@assert.integrity: 'DB'"
     *
     * @returns {boolean}
     */
    function assertForIntegrityTypeRT() {
      // for "auto-generated" associations like for the up_ of a composition of aspects,
      // the annotation on the composition influences the referential constraint for the
      // up_ association
      if (isAssertIntegrityAnnotationSetTo(DB)) {
        if (element.targetAspect)
          assignPropOnBacklinkIfPossible(CREATE_FOR_UP, true);
        return false;
      }
      if (element[CREATE_FOR_UP])
        return false;
      return true;
    }

    /**
     * if global checks are on and global integrity check type is 'DB'
     * we create db constraints in any case except if annotated
     * with @assert.integrity: 'RT' (or false, but that is rejected earlier)
     *
     * @returns {boolean}
     */
    function assertForIntegrityTypeDB() {
      return isAssertIntegrityAnnotationSetTo(RT);
    }

    /**
     * Convenience to check if value of element's @assert.integrity annotation
     * is the same as a given value.  `@assert.integrity`-value checks do not use the "truthy"-semantics,
     * since string values _and_ booleans are allowed, but are treated differently.
     *
     * @param {string|boolean} value
     * @returns {boolean}
     */
    function isAssertIntegrityAnnotationSetTo( value ) {
      if (typeof element['@assert.integrity'] === 'string' && typeof value === 'string')
        return element['@assert.integrity'].toUpperCase() === value.toUpperCase();
      return element['@assert.integrity'] === value;
    }

    /**
     * Assigns a helper key-value pair on the up_ association for a $self comparison
     * for the current 'element', if applicable
     *
     * @param {string} prop
     * @param {object} val
     */
    function assignPropOnBacklinkIfPossible( prop, val ) {
      if (!element.$selfOnCondition)
        return;
      const target = csn.definitions[element.target];
      const backlink = target.elements[element.$selfOnCondition.up_[0]];
      backlink[prop] = val;
    }
  }

  /**
   * If we have a managed composition with a target cardinality of one, we will treat it like
   * a regular association when it comes to referential constraints.
   * The constraint will thus be generated for the foreign key we create in the source entity.
   *
   * @param {CSN.Composition} composition the composition which might be treated like an association
   * @returns {boolean} true if the composition should be treated as an association in regards to foreign key constraints
   */
  function treatCompositionLikeAssociation( composition ) {
    return Boolean(isToOne(composition) && composition.keys);
  }

  /**
   * returns true if the association/composition has a max target cardinality of one
   *
   * @param {CSN.Association|CSN.Composition} assocOrComposition
   * @returns {boolean}
   */
  function isToOne( assocOrComposition ) {
    const { min, max } = assocOrComposition.cardinality || {};
    return !min && !max || max === 1;
  }

  /**
   * Finds and returns elementNames and elements of target side mentioned in on-condition.
   *
   * @param {CSN.OnCondition} on
   * @param {CSN.Elements} targetElements elements of association/composition target entity
   * @returns {Map} of target elements with their name as key
   */
  function elementsOfTargetSide( on, targetElements ) {
    const elements = new Map();
    const findElements = (tokenStream) => {
      tokenStream
        .forEach((element) => {
          if (typeof element === 'object' && element.ref?.length > 1 && targetElements[element.ref[element.ref.length - 1]])
            elements.set(element.ref[element.ref.length - 1], targetElements[element.ref[element.ref.length - 1]]);
          else if (element.xpr)
            findElements(element.xpr);
        });
    };
    findElements(on);
    return elements;
  }

  /**
   * Finds and return elementNames and elements of source side mentioned in on-condition.
   *
   * @param {CSN.OnCondition} on the on-condition
   * @param {CSN.Elements} sourceElements elements of source entity where the association/composition is defined.
   * @returns {Map} of source elements with their name as key
   */
  function elementsOfSourceSide( on, sourceElements ) {
    const elements = new Map();
    const findElements = (tokenStream) => {
      tokenStream
        .forEach((element) => {
          if (typeof element === 'object' && element.ref?.length === 1 && sourceElements[element.ref[0]])
            elements.set(element.ref[0], sourceElements[element.ref[0]]);
          else if (element.xpr)
            findElements(element.xpr);
        });
    };
    findElements(on);
    return elements;
  }

  /**
   * Creates the final referential constraints from all dependent key <-> parent key pairs stemming from the same sourceAssociation
   * and attaches it to the given artifact.
   *
   * Go over all elements with $foreignKeyConstraint property:
   *  - Find all other elements in artifact with the same sourceAssociation
   *  - Create constraints with the information supplied by $parentKey, $parentTable and $onDelete
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function collectAndAttachReferentialConstraints( artifact, artifactName ) {
    const referentialConstraints = Object.create(null);

    // tenant foreign keys may have multiple parent keys
    // process tenant foreign key first
    if (isTenant && artifact.elements?.tenant) {
      const element = artifact.elements.tenant;
      if (element.$foreignKeyConstraint) {
        const tenantConstraints = element.$foreignKeyConstraint;
        delete element.$foreignKeyConstraint;
        // create (multiple) foreign key constraint(s) for the tenant column with each association in the dependent entity
        tenantConstraints.forEach((c) => {
          createReferentialConstraints(c, 'tenant');
        });
      }
    }

    for (const elementName in artifact.elements) {
      const element = artifact.elements[elementName];
      if (!element.$foreignKeyConstraint)
        continue;
      // copy constraint property, and delete it from the element
      const $foreignKeyConstraint = Object.assign({}, element.$foreignKeyConstraint);
      delete element.$foreignKeyConstraint;
      createReferentialConstraints($foreignKeyConstraint, elementName);
    }
    if (Object.keys(referentialConstraints).length) {
      if (!('$tableConstraints' in artifact))
        artifact.$tableConstraints = Object.create(null);

      artifact.$tableConstraints.referential = referentialConstraints;
    }

    /**
     * Creates referential constraints for database relationships. This function constructs constraints based on foreign key information and element names,
     * and determines deletion rules based on the existing constraints and options. It manages dependencies and names for constraints dynamically during
     * execution.
     *
     * @param {object} $foreignKeyConstraint - An object encapsulating details about the foreign key constraint
     * @param {string} elementName - The name of the dependent element or table that is linked by the foreign key.
     */
    function createReferentialConstraints($foreignKeyConstraint, elementName) {
      const { parentTable } = $foreignKeyConstraint;
      const parentKey = [ $foreignKeyConstraint.parentKey ];
      const dependentKey = [ elementName ];
      const onDeleteRules = new Set();
      onDeleteRules.add($foreignKeyConstraint.onDelete);
      forEach(artifact.elements, (foreignKeyName, foreignKey) => {
        // find all other `$foreignKeyConstraint`s with same `sourceAssociation` and same `parentTable`
        const matchingForeignKeyFound = foreignKey.$foreignKeyConstraint &&
          foreignKey.$foreignKeyConstraint.sourceAssociation === $foreignKeyConstraint.sourceAssociation &&
          foreignKey.$foreignKeyConstraint.parentTable === $foreignKeyConstraint.parentTable;
        if (!matchingForeignKeyFound)
          return;

        const $foreignKeyConstraintCopy = Object.assign({}, foreignKey.$foreignKeyConstraint);
        delete foreignKey.$foreignKeyConstraint;
        parentKey.push($foreignKeyConstraintCopy.parentKey);
        dependentKey.push(foreignKeyName);
        onDeleteRules.add($foreignKeyConstraintCopy.onDelete);
      });
      // onDelete Rule is the "weakest" rule applicable. Precedence: RESTRICT > CASCADE
      const onDelete = onDeleteRules.has('RESTRICT') ? 'RESTRICT' : 'CASCADE';
      let onDeleteRemark = null;
      // comments in sqlite files are causing the JDBC driver to throw an error on deployment
      if (options.testMode && onDelete === 'CASCADE') {
        if ($foreignKeyConstraint.upLinkFor?.texts)
          onDeleteRemark = `Constraint originates from localized composition ”${ $foreignKeyConstraint.parentTable }:texts“`;
        else
          onDeleteRemark = `Up_ link for Composition "${ $foreignKeyConstraint.upLinkFor }" implies existential dependency`;
      }
      // constraint identifier usually start with `c__` to avoid name clashes
      let identifier = options.pre2134ReferentialConstraintNames ? '' : 'c__';
      identifier += `${ getResultingName(csn, options.sqlMapping, artifactName) }_${ $foreignKeyConstraint.sourceAssociation }`;
      referentialConstraints[`${ getResultingName(csn, 'quoted', artifactName) }_${ $foreignKeyConstraint.sourceAssociation }`] = {
        identifier,
        foreignKey: dependentKey,
        parentKey,
        dependentTable: artifactName,
        parentTable,
        onDelete,
        onDeleteRemark, // explain why this particular rule is chosen
        validated: $foreignKeyConstraint.validated,
        enforced: $foreignKeyConstraint.enforced,
      };
    }
  }
}

/**
 * If the artifact has both, unique- and foreign key constraints, it is possible that the constraints have the same identifier.
 * This would end in table which can't be activated.
 *
 * @param {CSN.Artifact} artifact
 * @param {string} artifactName
 * @param {CSN.Path} path
 * @param {Function} error
 */
function assertConstraintIdentifierUniqueness( artifact, artifactName, path, error ) {
  // can only happen if referential & unique constraints are present
  if (!(artifact.$tableConstraints && artifact.$tableConstraints.referential && artifact.$tableConstraints.unique))
    return;

  forEachKey(artifact.$tableConstraints.unique, (uniqueConstraintKey) => {
    const uniqueConstraintIdentifier = `${ artifactName }_${ uniqueConstraintKey }`; // final unique constraint identifier will be generated in renderer likewise
    if (artifact.$tableConstraints.referential[uniqueConstraintIdentifier]) {
      error(null, path,
            { name: uniqueConstraintIdentifier, art: artifactName },
            'Duplicate constraint name $(NAME) in artifact $(ART)');
    }
  });
}

module.exports = { createReferentialConstraints, assertConstraintIdentifierUniqueness };
