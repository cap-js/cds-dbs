'use strict';

const { forEachDefinition, forEachMemberRecursively,
  getServiceNames, applyAnnotationsFromExtensions,
  transformAnnotationExpression } = require('../../model/csnUtils');
const { forEach } = require('../../utils/objectUtils');
const { isArtifactInSomeService, getServiceOfArtifact } = require('../odata/utils');
const { getTransformers } = require('../transformUtils');
const { makeMessageFunction } = require('../../base/messages');
const { isBetaEnabled } = require('../../base/model');

/**
 * - Generate artificial draft fields if requested
 *
 * - Check associations for:
 *      - exposed associations do not point to non-exposed targets
 *      - structured types must not contain associations for OData V2
 * - Element must not be an 'array of' for OData V2 TODO: move to the validator
 * - Perform checks for exposed non-abstract entities and views - check media type and key-ness
 *
 * ATTENTION:  generateDrafts propagates annotations from the draft nodes to the
 *             returns element of the draft actions. Shortcut/Convenience annotations
 *             are NOT replaced/expanded (eg. @label => @Common.Label).
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {string[]|undefined} services Will be calculated JIT if not provided
 * @param {object} [messageFunctions]
 * @returns {CSN.Model} Returns the transformed input model
 * @todo should be done by the compiler - Check associations for valid foreign keys
 * @todo check if needed at all: Remove '$projection' from paths in the element's ON-condition
 */
function generateDrafts( csn, options, services, messageFunctions ) {
  // TEMP(2024-02-26): Temporary! Umbrella uses this file directly in cds/lib/compile/for/drafts.js#L1
  messageFunctions ??= makeMessageFunction(csn, options, 'odata-drafts');

  const { error, info } = messageFunctions;
  const {
    createAndAddDraftAdminDataProjection, isValidDraftAdminDataMessagesType,
    createScalarElement, createAssociationElement,
    createAssociationPathComparison, addElement,
    createAction, assignAction,
    resetAnnotation, setAnnotation,
    csnUtils,
  } = getTransformers(csn, options, messageFunctions);
  const {
    getServiceName,
    getFinalTypeInfo,
  } = csnUtils;

  if (!services)
    services = getServiceNames(csn);

  const visitedArtifacts = Object.create(null);
  // @ts-ignore
  const externalServices = services.filter(serviceName => csn.definitions[serviceName]['@cds.external']);
  // @ts-ignore
  const isExternalServiceMember = (_art, name) => externalServices.includes(getServiceName(name));
  const filterDict = Object.create(null);

  // validate the 'DRAFT.DraftAdministrativeData_DraftMessage' type if already present in the model
  if (isBetaEnabled(options, 'draftMessages')) {
    const draftAdminDataMessagesType = csn.definitions['DRAFT.DraftAdministrativeData_DraftMessage'];
    if (draftAdminDataMessagesType && !isValidDraftAdminDataMessagesType(draftAdminDataMessagesType)) {
      error(null, [ 'definitions', 'DRAFT.DraftAdministrativeData_DraftMessage' ], { name: 'DRAFT.DraftAdministrativeData_DraftMessage' },
            'Generated type $(NAME) conflicts with existing artifact');
    }
  }

  forEachDefinition(csn, (def, defName) => {
    // Generate artificial draft fields for entities/views if requested, ignore if not part of a service
    if (def.kind === 'entity' && def['@odata.draft.enabled'] && isArtifactInSomeService(defName, services))
      generateDraftForOdata(def, defName, def);
  }, { skipArtifact: isExternalServiceMember });

  applyAnnotationsFromExtensions(csn, { override: true, filter: name => filterDict[name] });
  rewriteDollarDraft();

  return csn;

  /**
   * Generate all that is required in ODATA for draft enablement of 'artifact' into the artifact,
   * into its transitively reachable composition targets, and into the model.
   * 'rootArtifact' is the root artifact where composition traversal started.
   *
   * Constraints
   * Draft Root: Exactly one PK of type UUID
   * Draft Node: One PK of type UUID + 0..1 PK of another type
   * Draft Node: Must not be reachable from multiple draft roots
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   * @param {CSN.Artifact} rootArtifact artifact where composition traversal started
   */
  function generateDraftForOdata( artifact, artifactName, rootArtifact ) {
    // Nothing to do if already draft-enabled (composition traversal may have circles)
    if ((artifact['@Common.DraftRoot.PreparationAction'] || artifact['@Common.DraftNode.PreparationAction']) &&
        artifact.actions && artifact.actions.draftPrepare)
      return;

    if(!visitedArtifacts[artifactName])
      visitedArtifacts[artifactName] = artifact;

    const draftPrepare = createAction('draftPrepare', artifactName, 'SideEffectsQualifier', 'cds.String');
    assignAction(draftPrepare, artifact);
    // Generate the actions into the draft-enabled artifact (only draft roots can be activated/edited)

    // action draftPrepare (SideEffectsQualifier: String) return <artifact>;
    if (artifact === rootArtifact) {
      // action draftActivate() return <artifact>;
      const draftActivate = createAction('draftActivate', artifactName);
      assignAction(draftActivate, artifact);

      // action draftEdit (PreserveChanges: Boolean) return <artifact>;
      const draftEdit = createAction('draftEdit', artifactName, 'PreserveChanges', 'cds.Boolean');
      assignAction(draftEdit, artifact);
    }

    // Generate the DraftAdministrativeData projection into the service, unless there is already one
    // @ts-ignore
    const draftAdminDataProjectionName = `${getServiceOfArtifact(artifactName, services)}.DraftAdministrativeData`;
    let draftAdminDataProjection = csn.definitions[draftAdminDataProjectionName];
    if (!draftAdminDataProjection) {
      // @ts-ignore
      draftAdminDataProjection = createAndAddDraftAdminDataProjection(getServiceOfArtifact(artifactName, services));
    }
    // Report an error if it is not an entity or not what we expect
    if (draftAdminDataProjection.kind !== 'entity' || !draftAdminDataProjection.elements.DraftUUID) {
      error(null, [ 'definitions', draftAdminDataProjectionName ], { name: draftAdminDataProjectionName },
            'Generated entity $(NAME) conflicts with existing artifact');
    }
    // Generate the annotations describing the draft actions (only draft roots can be activated/edited)
    if (artifact === rootArtifact) {
      resetAnnotation(artifact, '@Common.DraftRoot.ActivationAction', 'draftActivate', info, [ 'definitions', draftAdminDataProjectionName ]);
      resetAnnotation(artifact, '@Common.DraftRoot.EditAction', 'draftEdit', info, [ 'definitions', draftAdminDataProjectionName ]);
      resetAnnotation(artifact, '@Common.DraftRoot.PreparationAction', 'draftPrepare', info, [ 'definitions', draftAdminDataProjectionName ]);
      filterDict[artifactName] = true;
    }
    else {
      resetAnnotation(artifact, '@Common.DraftNode.PreparationAction', 'draftPrepare', info, [ 'definitions', draftAdminDataProjectionName ]);
      filterDict[artifactName] = true;
    }

    Object.values(artifact.elements || {}).forEach( (elem) => {
      // Make all non-key elements nullable
      if (elem.notNull && elem.key !== true)
        delete elem.notNull;
    });
    // Generate the additional elements into the draft-enabled artifact

    // key IsActiveEntity : Boolean default true
    const isActiveEntity = createScalarElement('IsActiveEntity', 'cds.Boolean', true, true, false);
    isActiveEntity.IsActiveEntity['@UI.Hidden'] = true;
    addElement(isActiveEntity, artifact, artifactName);

    // HasActiveEntity : Boolean default false
    const hasActiveEntity = createScalarElement('HasActiveEntity', 'cds.Boolean', false, false, true);
    hasActiveEntity.HasActiveEntity['@UI.Hidden'] = true;
    addElement(hasActiveEntity, artifact, artifactName);

    // HasDraftEntity : Boolean default false;
    const hasDraftEntity = createScalarElement('HasDraftEntity', 'cds.Boolean', false, false, true);
    hasDraftEntity.HasDraftEntity['@UI.Hidden'] = true;
    addElement(hasDraftEntity, artifact, artifactName);

    // @odata.contained: true
    // DraftAdministrativeData : Association to one DraftAdministrativeData;
    const draftAdministrativeData = createAssociationElement('DraftAdministrativeData', draftAdminDataProjectionName, true);
    draftAdministrativeData.DraftAdministrativeData.cardinality = { max: 1 };
    draftAdministrativeData.DraftAdministrativeData['@odata.contained'] = true;
    draftAdministrativeData.DraftAdministrativeData['@UI.Hidden'] = true;
    addElement(draftAdministrativeData, artifact, artifactName);

    // SiblingEntity : Association to one <artifact> on (... IsActiveEntity unequal, all other key fields equal ...)
    const siblingEntity = createAssociationElement('SiblingEntity', artifactName, false);
    siblingEntity.SiblingEntity.cardinality = { max: 1 };
    addElement(siblingEntity, artifact, artifactName);
    // ... on SiblingEntity.IsActiveEntity != IsActiveEntity ...
    siblingEntity.SiblingEntity.on = createAssociationPathComparison('SiblingEntity', 'IsActiveEntity', '!=', 'IsActiveEntity');

    if (isBetaEnabled(options, 'draftMessages')) {
      const draftMessages = { DraftMessages: { '@Core.Computed': true, virtual: true, items: { type: 'DRAFT.DraftAdministrativeData_DraftMessage' } } };
      addElement(draftMessages, artifact, artifactName);

      if (!artifact['@Common.SideEffects#alwaysFetchMessages'] && artifact['@Common.SideEffects#alwaysFetchMessages'] !== null) {
        setAnnotation(artifact, '@Common.SideEffects#alwaysFetchMessages.SourceEntities', ['']);
        setAnnotation(artifact, '@Common.SideEffects#alwaysFetchMessages.TargetProperties', ['DraftMessages'] );
      }
      setAnnotation(artifact, '@Common.Messages', { '=': 'DraftMessages', ref: ['DraftMessages'] });
      const service = csn.definitions[getServiceOfArtifact(artifactName, services)];
      setAnnotation(service, '@Common.AddressViaNavigationPath', true);
    }

    // Iterate elements
    // TODO: Iterative vs recursive? What is more likely: Super deep nesting or cycles via malicious CSN?
    if (artifact.elements) {
      // No need to reverse the stack, not order dependent
      const stack = [ artifact ];
      while (stack.length > 0) {
        const { elements } = stack.pop();
        forEach(elements, (elemName, elem) => {
          if (elemName !== 'IsActiveEntity' && elem.key) {
            // Amend the ON-condition above:
            // ... and SiblingEntity.<keyfield> = <keyfield> ... (for all key fields except 'IsActiveEntity')
            const cond = createAssociationPathComparison('SiblingEntity', elemName, '=', elemName);
            cond.push('and');
            cond.push(...siblingEntity.SiblingEntity.on);
            siblingEntity.SiblingEntity.on = cond;
          }

          // Draft-enable the targets of composition elements (draft nodes), too
          // TODO rewrite
          if (elem.target && elem.type && getFinalTypeInfo(elem.type)?.type === 'cds.Composition') {
            const draftNode = csn.definitions[elem.target];

            // Ignore if that is our own draft root
            if (draftNode !== rootArtifact) {
              // Report error when the draft node has @odata.draft.enabled itself
              const draftEnabled = draftNode['@odata.draft.enabled'];
              if (draftEnabled) {
                error('ref-unexpected-draft-enabled', [ 'definitions', artifactName, 'elements', elemName ], { anno: '@odata.draft.enabled' });
              }
              // Ignore composition if it's target is not part of a service or explicitly draft disabled
              // Only for explicit `false` annotation value, not for `undefined` or `null`.
              else if (!getServiceName(elem.target) || draftEnabled === false) {
                return;
              }
              else {
                // Generate draft stuff into the target
                generateDraftForOdata(draftNode, elem.target, rootArtifact);
              }
            }
          }
          else if (elem.elements) { // anonymous structure
            stack.push(elem);
          }
          else if (elem.type) { // types - possibly structured
            const typeDef = getFinalTypeInfo(elem.type);
            if (typeDef?.elements)
              stack.push(typeDef);
          }
        });
      }
    }
  }

    /*
     * After draft decoration, all visited artifacts are supposed to have the draft state elements
     * Is/HasActiveEntity, HasDraftEntity. Now, $draft.<postfix> (with postfix defined as magic variable
     * in the core compiler builtins) needs to be translated into $self.<postfix>.
     *
     * It has to be processed after the late 'applyAnnotationsFromExtensions' which could also merge in
     * some $draft path expressions.
  */
  function rewriteDollarDraft() {

    function $draft2$self(member) {
      Object.keys(member).forEach(pn => {
        if(pn[0] === '@') {
          transformAnnotationExpression(member, pn, {
              ref: (_parent, _prop, xpr, _path, _p, _ppn, ctx) => {
                if(xpr[0] === '$draft') {
                  xpr[0] = '$self';
                  if(ctx?.annoExpr?.['='])
                    ctx.annoExpr['='] = true;
                }
              }
            },
          );
        }
      });
    }

    // entity parameters are not substituted as the EDM param entity is not draft enabled
    Object.entries(visitedArtifacts).forEach(([artName, art]) => {
      $draft2$self(art);
      forEachMemberRecursively(art, $draft2$self,
        [ 'definitions', artName ],
        true, { elementsOnly: true }
      );
      if(art.actions) {
        Object.entries(art.actions).forEach(([actionName, action]) => {
          $draft2$self(action);
          forEachMemberRecursively(action, $draft2$self,
          [ 'definitions', artName, 'actions',  actionName ]);
          if(action.returns)
            $draft2$self(action.returns);
        })
      }
    })
  }
}

module.exports = generateDrafts;
