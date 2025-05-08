const cds = require('../../../../lib')
const { DRAFT_COLUMNS_MAP } = require('../../common/constants/draft')

const _4sqlite = cds.env.i18n && Array.isArray(cds.env.i18n.for_sqlite) ? cds.env.i18n.for_sqlite : []
// compiler reserves 'localized' and raises a corresponding exception if used in models
const LOCALIZED = 'localized'
const _tableExists = table => {
  if (!cds.db || !cds.db.model) return false
  return !!cds.db.model.definitions[table]
}
const ensureUnlocalized = table => {
  if (!table.startsWith(LOCALIZED)) return table
  const _table = table.substring(LOCALIZED.length + 1)
  const languagePrefix = _4sqlite.find(lang => _table.startsWith(lang))
  // for langu-like namespace 'de' and sqlite => _table === 'de.de.Books'
  if (languagePrefix && !_tableExists(_table)) {
    return _table.substring(languagePrefix.length + 1)
  }
  return _table
}

const ensureDraftsSuffix = name =>
  name.endsWith('_drafts') || name.endsWith('.drafts') ? name : `${ensureUnlocalized(name)}_drafts`

const ensureNoDraftsSuffix = name => name.replace(/_drafts$/g, '')

const getDraftColumnsCQNForActive = target => {
  const draftName = ensureDraftsSuffix(target.name)
  const subSelect = SELECT.from(draftName).columns([1])
  for (const key in target.keys) {
    if (key !== 'IsActiveEntity') subSelect.where([{ ref: [target.name, key] }, '=', { ref: [draftName, key] }])
  }
  return [
    { val: true, as: 'IsActiveEntity', cast: { type: 'cds.Boolean' } },
    { val: false, as: 'HasActiveEntity', cast: { type: 'cds.Boolean' } },
    {
      xpr: ['case', 'when', 'exists', subSelect, 'then', 'true', 'else', 'false', 'end'],
      as: 'HasDraftEntity',
      cast: { type: 'cds.Boolean' }
    }
  ]
}

const getDraftColumnsCQNForDraft = () => {
  /*
   * NOTE: the following with xpr could be used to detect if there really is an active or not, but that breaks tests
   */
  // const activeName = ensureNoDraftsSuffix(target.name)
  // const subSelect = SELECT.from(activeName).columns([1])
  // for (const key in target.keys) {
  //   if (key !== 'IsActiveEntity') subSelect.where([{ ref: [target.name, key] }, '=', { ref: [activeName, key] }])
  // }
  // return [
  //   { val: false, as: 'IsActiveEntity', cast: { type: 'cds.Boolean' } },
  //   {
  //     xpr: ['case', 'when', 'exists', subSelect, 'then', 'true', 'else', 'false', 'end'],
  //     as: 'HasActiveEntity',
  //     cast: { type: 'cds.Boolean' }
  //   },
  //   { val: false, as: 'HasDraftEntity', cast: { type: 'cds.Boolean' } }
  // ]

  return [
    { val: false, as: 'IsActiveEntity', cast: { type: 'cds.Boolean' } },
    { ref: ['HasActiveEntity'], cast: { type: 'cds.Boolean' } },
    { val: false, as: 'HasDraftEntity', cast: { type: 'cds.Boolean' } }
  ]
}

const filterNonDraftColumns = columns =>
  columns.filter(
    col => (col.ref && !(col.ref[col.ref.length - 1] in DRAFT_COLUMNS_MAP)) || (!col.ref && !(col in DRAFT_COLUMNS_MAP))
  )

module.exports = {
  ensureUnlocalized,
  ensureDraftsSuffix,
  ensureNoDraftsSuffix,
  getDraftColumnsCQNForActive,
  getDraftColumnsCQNForDraft,
  filterNonDraftColumns
}
