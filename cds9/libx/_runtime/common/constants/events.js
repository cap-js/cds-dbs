exports.MOD_EVENTS = { UPDATE: 1, DELETE: 1, EDIT: 1 }
exports.WRITE_EVENTS = { CREATE: 1, NEW: 1, PATCH: 1, CANCEL: 1, ...exports.MOD_EVENTS }
exports.CRUD_EVENTS = { READ: 1, ...exports.WRITE_EVENTS }
exports.DRAFT_EVENTS = { PATCH: 1, CANCEL: 1, draftActivate: 1, draftPrepare: 1 }
exports.CDS_EVENTS = { ...exports.CRUD_EVENTS, ...exports.DRAFT_EVENTS }
