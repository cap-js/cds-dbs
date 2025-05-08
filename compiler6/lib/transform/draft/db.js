'use strict';

const {
  getServiceNames, forEachDefinition,
  getResultingName, forEachMemberRecursively, applyAnnotationsFromExtensions,
} = require('../../model/csnUtils');
const { setProp, isBetaEnabled } = require('../../base/model');
const { getTransformers } = require('../transformUtils');
const { ModelError } = require('../../base/error');
const { forEach } = require('../../utils/objectUtils');
const draftAnnotation = '@odata.draft.enabled';
const booleanBuiltin = 'cds.Boolean';

/**
 * Generate all the different entities/views/fields required for DRAFT.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {string} pathDelimiter
 * @param {object} messageFunctions
 */
function generateDrafts( csn, options, pathDelimiter, messageFunctions ) {
  const draftSuffix = '.drafts';
  // All services of the model - needed for drafts
  const allServices = getServiceNames(csn);
  const draftRoots = new WeakMap();
  const {
    createAndAddDraftAdminDataProjection, createScalarElement,
    createAssociationElement, addElement, copyAndAddElement, createAssociationPathComparison, csnUtils,
  } = getTransformers(csn, options, messageFunctions, pathDelimiter);
  const { getCsnDef, isComposition } = csnUtils;
  const { error, warning } = messageFunctions;
  const generatedArtifacts = Object.create(null);

  forEachDefinition(csn, generateDraft);

  applyAnnotationsFromExtensions(csn, { filter: name => generatedArtifacts[name], applyToElements: false });

  /**
   * Generate the draft stuff for a given artifact
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function generateDraft( artifact, artifactName ) {
    if ((artifact.kind === 'entity') &&
        artifact[draftAnnotation] &&
        isPartOfService(artifactName)) {
      // Determine the set of target draft nodes belonging to this draft root (the draft root
      // itself plus all its transitively composition-reachable targets)
      const draftNodes = Object.create(null);
      collectDraftNodesInto(artifact, artifactName, artifact, draftNodes);
      // Draft-enable all of them
      for (const name in draftNodes)
        generateDraftForHana(draftNodes[name], name, artifactName);

      // Redirect associations/compositions between draft shadow nodes
      for (const name in draftNodes) {
        const shadowNode = csn.definitions[`${name}${draftSuffix}`];
        // Might not exist because of previous errors
        if (shadowNode)
          redirectDraftTargets(csn.definitions[`${name}${draftSuffix}`], draftNodes);
      }
    }
  }

  /**
   * Collect all artifacts that are transitively reachable via compositions from 'artifact' into 'draftNodes'.
   * Check that no artifact other than the root node has '@odata.draft.enabled'
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   * @param {CSN.Artifact} rootArtifact root artifact where composition traversal started.
   * @param {object} draftNodes Dictionary of artifacts
   */
  function collectDraftNodesInto( artifact, artifactName, rootArtifact, draftNodes ) {
    // Collect the artifact itself
    draftNodes[artifactName] = artifact;
    // Follow all composition targets in elements of 'artifact'
    for (const elemName in artifact.elements) {
      const elem = artifact.elements[elemName];
      if (elem.target && isComposition(elem)) {
        const draftNode = getCsnDef(elem.target);
        const draftNodeName = elem.target;
        // Sanity check
        if (!draftNode)
          throw new ModelError(`Expecting target to be resolved: ${JSON.stringify(elem, null, 2)}`);

        // Ignore composition if not part of a service
        if (!isPartOfService(draftNodeName)) {
          warning(null, [ 'definitions', artifactName, 'elements', elemName ], { target: draftNodeName },
                  'Ignoring draft node for composition target $(TARGET) because it is not part of a service');
          continue;
        }
        // Barf if a draft node other than the root has @odata.draft.enabled itself
        if (draftNode !== rootArtifact && draftNode[draftAnnotation]) {
          error('ref-unexpected-draft-enabled', [ 'definitions', artifactName, 'elements', elemName ], { anno: '@odata.draft.enabled' });
          delete draftNodes[draftNodeName];
          continue;
        }
        // Recurse unless already known. Check for explicit `false` on purpose.
        if (draftNode[draftAnnotation] !== false && !draftNodes[draftNodeName])
          collectDraftNodesInto(draftNode, draftNodeName, rootArtifact, draftNodes);
      }
    }
  }

  /**
   * Generate all that is required in HANA CDS for draft enablement of 'artifact'.
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   * @param {string} draftRootName
   */
  function generateDraftForHana( artifact, artifactName, draftRootName ) {
    // Sanity check
    if (!isPartOfService(artifactName))
      throw new ModelError(`Expecting artifact to be part of a service: ${JSON.stringify(artifact)}`);


    // The name of the draft shadow entity we should generate
    const draftsArtifactName = `${artifactName}${draftSuffix}`;

    generatedArtifacts[draftsArtifactName] = true;

    // TODO: Do we really need this? Is this possibly done by a validator earlier?
    forEachMemberRecursively(artifact, (elt, name, prop, path) => {
      if (!elt.elements && !elt.type && !elt.virtual) // only check leafs
        error(null, path, 'Expecting element to have a type when used in a draft-enabled artifact');
    }, [ 'definitions', artifactName ], false, { elementsOnly: true });

    // Ignore boolean return value. We know that we're inside a service or else we wouldn't have reached this code.
    const matchingService = getMatchingService(artifactName) || '';
    // Generate the DraftAdministrativeData projection into the service, unless there is already one
    const draftAdminDataProjectionName = `${matchingService}.DraftAdministrativeData`;
    let draftAdminDataProjection = csn.definitions[draftAdminDataProjectionName];
    if (!draftAdminDataProjection) {
      generatedArtifacts[draftAdminDataProjectionName] = true;
      draftAdminDataProjection = createAndAddDraftAdminDataProjection(matchingService, true);

      if (!draftAdminDataProjection.projection.columns && draftAdminDataProjection.elements.DraftUUID)
        draftAdminDataProjection.projection.columns = Object.keys(draftAdminDataProjection.elements).map(e => (e === 'DraftUUID' ? { key: true, ref: [ 'DraftAdministrativeData', e ] } : { ref: [ 'DraftAdministrativeData', e ] }));

      if (options.transformation === 'effective' && draftAdminDataProjection.projection) {
        draftAdminDataProjection.query = { SELECT: draftAdminDataProjection.projection };
        delete draftAdminDataProjection.projection;
      }
    }

    // Barf if it is not an entity or not what we expect
    if (draftAdminDataProjection.kind !== 'entity' || !draftAdminDataProjection.elements.DraftUUID) {
      // See draftAdminDataProjection which is defined in `csn.definitions`.
      const path = [ 'definitions', draftAdminDataProjectionName ];
      error(null, path, { name: draftAdminDataProjectionName },
            'Generated entity $(NAME) conflicts with existing artifact');
    }

    const persistenceName = getResultingName(csn, options.sqlMapping, draftsArtifactName);
    // Duplicate the artifact as a draft shadow entity
    if (csn.definitions[persistenceName] && !(options.transformation === 'effective' && csn.definitions[persistenceName].kind === 'entity' && csn.definitions[persistenceName].elements.DraftAdministrativeData_DraftUUID)) {
      const definingDraftRoot = draftRoots.get(csn.definitions[persistenceName]);
      if (!definingDraftRoot) {
        error(null, [ 'definitions', artifactName ], { name: persistenceName },
              'Generated entity name $(NAME) conflicts with existing entity');
      }

      else {
        error(null, [ 'definitions', draftRootName ], { name: persistenceName, alias: definingDraftRoot },
              'Entity $(NAME) already generated by draft root $(ALIAS)');
      }

      return;
    }
    const draftsArtifact = {
      kind: 'entity',
      elements: Object.create(null),
    };

    // Add draft shadow entity to the csn
    csn.definitions[draftsArtifactName] = draftsArtifact;

    draftRoots.set(draftsArtifact, draftRootName);
    if (artifact.$location)
      setProp(draftsArtifact, '$location', artifact.$location);

    const calcOnWriteElements = [];

    // Copy all elements
    for (const elemName in artifact.elements) {
      const origElem = artifact.elements[elemName];
      if (origElem.value?.stored) {
        calcOnWriteElements.push(elemName);
      }
      else {
        let elem;
        if (!origElem.virtual)
          elem = copyAndAddElement(origElem, draftsArtifact, draftsArtifactName, elemName)[elemName];
        if (elem) {
          // Remove "virtual" - cap/issues 4956
          if (elem.virtual)
            delete elem.virtual;

          // explicitly set nullable if not key and not unmanaged association
          if (!elem.key && !elem.on)
            elem.notNull = false;
        }
      }
    }

    // Generate the additional elements into the draft-enabled artifact

    // key IsActiveEntity : Boolean default true
    const isActiveEntity = createScalarElement('IsActiveEntity', booleanBuiltin, false);
    // Use artifactName and not draftsArtifactName because otherwise we may point to the generated
    // entity in CSN and won't get a proper location (draftsArtifact has inherited all
    // elements from the original artifact).
    addElement(isActiveEntity, draftsArtifact, artifactName);

    // HasActiveEntity : Boolean default false
    const hasActiveEntity = createScalarElement('HasActiveEntity', booleanBuiltin, false);
    addElement(hasActiveEntity, draftsArtifact, artifactName);

    // HasDraftEntity : Boolean default false;
    const hasDraftEntity = createScalarElement('HasDraftEntity', booleanBuiltin, false);
    addElement(hasDraftEntity, draftsArtifact, artifactName);

    // DraftAdministrativeData : Association to one DraftAdministrativeData not null;
    const draftAdministrativeData = createAssociationElement('DraftAdministrativeData', draftAdminDataProjectionName, true);
    draftAdministrativeData.DraftAdministrativeData.cardinality = {
      max: 1,
    };
    draftAdministrativeData.DraftAdministrativeData.notNull = true;
    addElement(draftAdministrativeData, draftsArtifact, artifactName);

    if (isBetaEnabled(options, 'draftMessages')) {
      const draftMessages = { DraftMessages: { '@Core.Computed': true, virtual: true, items: { type: 'DRAFT.DraftAdministrativeData_DraftMessage' } } };
      addElement(draftMessages, draftsArtifact, artifactName);
    }
    // Note that we may need to do the HANA transformation steps for managed associations
    // (foreign key field generation, generatedFieldName, creating ON-condition) by hand,
    // because the corresponding transformation steps have already been done on all artifacts
    // when we come here). Only for to.hdbcds with hdbcds names this is not required.
    /**
     * The given association has a key named DraftUUID
     *
     * @param {CSN.Association} association Assoc to check
     * @returns {object}
     */
    function getDraftUUIDKey( association ) {
      if (association.keys) {
        const filtered = association.keys.filter(o => (o.ref && !o.as && o.ref.length === 1 && o.ref[0] === 'DraftUUID') || (o.as && o.as === 'DraftUUID'));
        if (filtered.length === 1)
          return filtered[0];

        else if (filtered.length > 1)
          return filtered.filter(o => o.as && o.as === 'DraftUUID');
      }

      return undefined;
    }

    /**
     * Get the resulting name for an obj - explicit or implicit alias
     *
     * @param {object} obj Any object with at least "ref"
     * @returns {string}
     */
    function getNameForRef( obj ) {
      if (obj.as)
        return obj.as;

      return obj.ref[obj.ref.length - 1];
    }

    const draftUUIDKey = getDraftUUIDKey(draftAdministrativeData.DraftAdministrativeData);
    if (!(options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds') && draftUUIDKey) {
      const source = csn.definitions[draftAdministrativeData.DraftAdministrativeData.target];
      const sourceElement = source.elements[draftUUIDKey.ref[0]];
      const targetElement = {};
      forEach(sourceElement, (key, value) => {
        if(!key.startsWith('@') && key !== 'key')
          targetElement[key] = value;
      })

      if(sourceElement.key) targetElement.notNull = true;

      draftsArtifact.elements['DraftAdministrativeData' + (options.sqlMapping === 'hdbcds' ? '.' : '_') + draftUUIDKey.ref[0]] =  targetElement;

      draftAdministrativeData.DraftAdministrativeData.on = createAssociationPathComparison('DraftAdministrativeData',
                                                                                           getNameForRef(draftUUIDKey),
                                                                                           '=',
                                                                                           `DraftAdministrativeData${pathDelimiter}DraftUUID`);
      // The notNull has been transferred to the foreign key field and must be removed on the association
      delete draftAdministrativeData.DraftAdministrativeData.notNull;

      // The association is now unmanaged, i.e. actually it should no longer have foreign keys
      // at all. But the processing of backlink associations below expects to have them, so
      // we don't delete them (but mark them as implicit so that toCdl does not render them)
      // draftAdministrativeData.DraftAdministrativeData.implicitForeignKeys = true;
    }

    calcOnWriteElements.forEach(elemName => copyAndAddElement(artifact.elements[elemName], draftsArtifact, draftsArtifactName, elemName)[elemName]);
  }

  /**
   * Redirect all association/composition targets in 'artifact' that point to targets in
   * the dictionary 'draftNodes' to their corresponding draft shadow artifacts.
   *
   * @param {CSN.Artifact} artifact
   * @param {CSN.Artifact[]} draftNodes
   */
  function redirectDraftTargets( artifact, draftNodes ) {
    for (const elemName in artifact.elements) {
      const elem = artifact.elements[elemName];
      if (elem.target) {
        const targetArt = getCsnDef(elem.target);
        // Nothing to do if target is not a draft node
        if (!draftNodes[elem.target])
          continue;

        // Redirect the composition/association in this draft shadow entity to the target draft shadow entity
        // console.error(`Redirecting target of ${elemName} in ${artifact.name.absolute} to ${target.name.absolute + '_drafts'}`);
        const { shadowTarget, shadowTargetName } = getDraftShadowEntityFor(targetArt, elem.target);
        // Might not exist because of previous errors
        if (shadowTarget)
          elem.target = shadowTargetName;
      }
    }

    /**
     * Returns the corresponding draft shadow artifact for draft node 'draftNode'.
     *
     * @param {CSN.Artifact} draftNode
     * @param {string} draftNodeName
     * @returns {object} Object with shadowTarget: definition and shadowTargetName: Name of the definition
     */
    function getDraftShadowEntityFor( draftNode, draftNodeName ) {
      // Sanity check
      if (!draftNodes[draftNodeName])
        throw new ModelError(`Not a draft node: ${draftNodeName}`);

      return { shadowTarget: csn.definitions[`${draftNodeName}${draftSuffix}`], shadowTargetName: `${draftNodeName}${draftSuffix}` };
    }
  }

  /**
   * Check if the given artifact is part of a service.
   *
   * @param {string} artifactName Absolute name of the artifact
   * @returns {boolean}
   */
  function isPartOfService( artifactName ) {
    for (const serviceName of allServices) {
      if (artifactName.startsWith(`${serviceName}.`))
        return true;
    }

    return false;
  }

  /**
   * Get the "upper-most" service name containing the artifact.
   * If there are two services `S` and `S.S`, for `S.S.A`, then `S` is returned.
   *
   * @param {string} artifactName Absolute name of the artifact
   * @returns {false|string} Name of the service or false if no match is found.
   */
  function getMatchingService( artifactName ) {
    /** @type {false|string} */
    let match = false;
    for (const serviceName of allServices) {
      if (artifactName.startsWith(`${serviceName}.`) && (!match || serviceName.length < match.length))
        match = serviceName;
    }
    return match;
  }
}


module.exports = generateDrafts;
