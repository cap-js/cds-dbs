const DRAFT_COLUMNS = ['IsActiveEntity', 'HasActiveEntity', 'HasDraftEntity', 'DraftAdministrativeData_DraftUUID']
const DRAFT_COLUMNS_UNION = [
  'IsActiveEntity',
  'HasActiveEntity',
  'HasDraftEntity',
  'DraftAdministrativeData_DraftUUID',
  'SiblingEntity',
  'DraftAdministrativeData'
]
const DRAFT_COLUMNS_ADMIN = [
  'DraftUUID',
  'CreatedByUser',
  'InProcessByUser',
  'CreationDateTime',
  'LastChangeDateTime',
  'LastChangedByUser',
  'DraftIsProcessedByMe',
  'DraftIsCreatedByMe'
]

const objectify = arr =>
  arr.reduce((acc, cur) => {
    acc[cur] = 1
    return acc
  }, {})

module.exports = {
  DRAFT_COLUMNS_MAP: objectify(DRAFT_COLUMNS),
  DRAFT_COLUMNS_UNION_MAP: objectify(DRAFT_COLUMNS_UNION),
  DRAFT_COLUMNS_ADMIN_MAP: objectify(DRAFT_COLUMNS_ADMIN),
  DRAFT_COLUMNS_CQN: [
    { ref: ['IsActiveEntity'], cast: { type: 'cds.Boolean' } },
    { ref: ['HasActiveEntity'], cast: { type: 'cds.Boolean' } },
    { ref: ['HasDraftEntity'], cast: { type: 'cds.Boolean' } },
    { ref: ['DraftAdministrativeData_DraftUUID'] }
  ],
  SCENARIO: {
    ACTIVE: 'ACTIVE',
    ACTIVE_WITHOUT_DRAFT: 'ACTIVE_WITHOUT_DRAFT',
    ALL_ACTIVE: 'ALL_ACTIVE',
    ALL_INACTIVE: 'ALL_INACTIVE',
    DRAFT_ADMIN: 'DRAFT_ADMIN',
    DRAFT_IN_PROCESS: 'DRAFT_IN_PROCESS',
    DRAFT_WHICH_OWNER: 'DRAFT_WHICH_OWNER',
    SIBLING_ENTITY: 'SIBLING_ENTITY',
    UNION: 'UNION'
  }
}
