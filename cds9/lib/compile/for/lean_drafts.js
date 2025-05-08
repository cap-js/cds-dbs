const cds = require('../../index')

function _getBacklinkName(on) {
  const i = on.findIndex(e => e.ref && e.ref[0] === '$self')
  if (i === -1) return
  let ref
  if (on[i + 1] && on[i + 1] === '=') ref = on[i + 2].ref
  if (on[i - 1] && on[i - 1] === '=') ref = on[i - 2].ref
  return ref && ref[ref.length - 1]
}

function _isCompositionBacklink(e) {
  if (!e.isAssociation) return
  if (!e._target?.associations) return
  if (!(!e.isComposition && (e.keys || e.on))) return
  for (const anchor of Object.values(e._target.associations)) {
    if (!(anchor.isComposition && anchor.on?.length > 2)) continue
    if (_getBacklinkName(anchor.on) === e.name && anchor.target === e.parent.name) return anchor
  }
}


// NOTE: Keep outside of the function to avoid calling the parser repeatedly
const { Draft } = cds.linked(`
  entity ActiveEntity { key ID: UUID; }
  entity Draft {
    virtual IsActiveEntity            : Boolean; // REVISIT: these are calculated fields, aren't they?
    virtual HasDraftEntity            : Boolean; // REVISIT: these are calculated fields, aren't they?
    HasActiveEntity                   : Boolean; // This should be written !!!
    DraftAdministrativeData           : Association to DRAFT.DraftAdministrativeData;
    DraftAdministrativeData_DraftUUID : UUID;
    // SiblingEntity                  : Association to ActiveEntity; // REVISIT: Why didn't we use a managed assoc here?
  }
  entity DRAFT.DraftAdministrativeData {
    key DraftUUID         : UUID;
    LastChangedByUser     : String(256);  LastChangeDateTime : Timestamp;
    CreatedByUser         : String(256);  CreationDateTime   : Timestamp;
    InProcessByUser       : String(256);
    DraftIsCreatedByMe    : Boolean; // REVISIT: these are calculated fields, aren't they?
    DraftIsProcessedByMe  : Boolean; // REVISIT: these are calculated fields, aren't they?
  }
`).definitions


function DraftEntity4 (active, name = active.name+'.drafts') {

  const draft = Object.create (active, {
    name: { value: name }, // REVISIT: lots of things break if we do that!
    elements: { value: { ...active.elements, ...Draft.elements }, enumerable: true },
    actives: { value: active },
    query: { value: undefined }, // to not inherit that from active
    // drafts: { value: undefined }, // to not inherit that from active -> doesn't work yet as the coding in lean-draft.js uses .drafts to identify both active and draft entities
    isDraft: { value: true },
  })

  // for quoted names, we need to overwrite the cds.persistence.name of the derived, draft entity
  const _pname = active['@cds.persistence.name']
  if (_pname) draft['@cds.persistence.name'] = _pname + '_drafts'

  return draft
}


module.exports = function cds_compile_for_lean_drafts(csn) {
  function _redirect(assoc, target) {
    assoc.target = target.name
    assoc._target = target
  }

  function _isDraft(def) {
    // return 'DraftAdministrativeData' in def.elements
    return (
      def.associations?.DraftAdministrativeData ||
      (def.own('@odata.draft.enabled') && def.own('@Common.DraftRoot.ActivationAction'))
    )
  }

  function addDraftEntity(active, model) {
    const _draftEntity = active.name + '.drafts'
    const d = model.definitions[_draftEntity]
    if (d) return d
    // We need to construct a fake draft entity definition
    // We cannot use new cds.entity because runtime aspects would be missing
    const draft = new DraftEntity4 (active, _draftEntity)
    Object.defineProperty(model.definitions, _draftEntity, { value: draft })
    Object.defineProperty(active, 'drafts', { value: draft })

    // Positive list would be bigger (search, requires, fiori, ...)
    if (draft['@readonly']) draft['@readonly'] = undefined
    if (draft['@insertonly']) draft['@insertonly'] = undefined
    if (draft['@restrict']) {
      const restrictions = ['CREATE', 'WRITE', '*']
      draft['@restrict'] = draft['@restrict']
        .map(d => ({
          ...d,
          grant:
            d.grant && Array.isArray(d.grant)
              ? d.grant.filter(g => restrictions.includes(g))
              : typeof d.grant === 'string' && restrictions.includes(d.grant)
              ? [d.grant]
              : []
        }))
        .filter(r => r.grant.length > 0)
      if (draft['@restrict'].length > 0) {
        // Change WRITE & CREATE to NEW
        draft['@restrict'] = draft['@restrict'].map(d => {
          if (d.grant.includes('WRITE') || d.grant.includes('CREATE')) {
            return { ...d, grant: 'NEW' }
          }
          return d
        })
      } else {
        draft['@restrict'] = undefined
      }
    }
    if ('@Capabilities.DeleteRestrictions.Deletable' in draft)
      draft['@Capabilities.DeleteRestrictions.Deletable'] = undefined
    if ('@Capabilities.InsertRestrictions.Insertable' in draft)
      draft['@Capabilities.InsertRestrictions.Insertable'] = undefined
    if ('@Capabilities.UpdateRestrictions.Updatable' in draft)
      draft['@Capabilities.UpdateRestrictions.Updatable'] = undefined
    if ('@Capabilities.NavigationRestrictions.RestrictedProperties' in draft)
      draft['@Capabilities.NavigationRestrictions.RestrictedProperties'] = undefined

    // Recursively add drafts for compositions
    let _2manies
    for (const each in draft.elements) {
      const e = draft.elements[each]
      // add @odata.draft.enclosed to filtered compositions
      if (e.$enclosed) {
        e['@odata.draft.enclosed'] = true
      } else if (e.$filtered) { //> REVISIT: remove with cds^8
        _2manies ??= Object.keys(draft.elements).map(k => draft.elements[k]).filter(c => c.isComposition && c.is2many)
        if (_2manies.find(c => c.name !== e.name && c.target.replace(/\.drafts$/, '') === e.target)) e['@odata.draft.enclosed'] = true
      }
      const newEl = Object.create(e)
      if (
        e.isComposition ||
        (e.isAssociation && e['@odata.draft.enclosed']) ||
        ((!active['@Common.DraftRoot.ActivationAction'] || e._target === active) && _isCompositionBacklink(e) && _isDraft(e._target))
      ) {
        if (e._target['@odata.draft.enabled'] === false) continue // happens for texts if @fiori.draft.enabled is not set
        _redirect(newEl, addDraftEntity(e._target, model))
      }
      if (e.name === 'DraftAdministrativeData') {
        // redirect to DraftAdministrativeData service entity
        if (active._service?.entities.DraftAdministrativeData) _redirect(newEl, active._service.entities.DraftAdministrativeData)
      }
      Object.defineProperty (newEl,'parent',{value:draft,enumerable:false, configurable: true, writable: true})

      for (const key in newEl) {
        if (
          key === '@mandatory' ||
          key === '@Common.FieldControl' && newEl[key]?.['#'] === 'Mandatory' ||
          // key === '@Core.Immutable': Not allowed via UI anyway -> okay to cleanse them in PATCH
          key.startsWith('@assert') ||
          key.startsWith('@PersonalData')
        )
          newEl[key] = undefined
      }

      draft.elements[each] = newEl
    }

    return draft
  }

  for (const name in csn.definitions) {
    const def = csn.definitions[name]
    if (!_isDraft(def) || def['@cds.external']) continue
    def.elements.IsActiveEntity.virtual = true
    def.elements.HasDraftEntity.virtual = true
    def.elements.HasActiveEntity.virtual = true
    if (def.elements.DraftAdministrativeData_DraftUUID) def.elements.DraftAdministrativeData_DraftUUID.virtual = true
    def.elements.DraftAdministrativeData.virtual = true
    // will insert drafts entities, so that others can use `.drafts` even without incoming draft requests
    addDraftEntity(def, csn)
  }
}
