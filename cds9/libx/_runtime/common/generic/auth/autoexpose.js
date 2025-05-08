function check_autoexposed(req) {
  if (!req.subject) return
  const root = this.model.definitions[req.subject.ref[0].id || req.subject.ref[0]]
  if (!root) return

  /*
   * For auto-exposed Compositions all direct CRUD requests are rejected in non-draft case.
   * For other auto-exposed entities in non-draft case only C_UD are rejected. Direct READ is allowed.
   * Draft case is an exception. Direct requests are allowed.
   */
  if (!root._isDraftEnabled && root['@cds.autoexposed']) {
    if (!root['@cds.autoexpose']) return req.reject(405, 'ENTITY_IS_AUTOEXPOSED', [root.name])
    if (req.event !== 'READ') return req.reject(405, 'ENTITY_IS_AUTOEXPOSE_READONLY', [root.name])
  }
  if (req.event !== 'READ' && _isAutoexposed(req.target)) {
    return req.reject(405, 'ENTITY_IS_AUTOEXPOSE_READONLY', [req.target.name])
  }
}

const _isAutoexposed = entity => {
  if (!entity) return
  if (entity['@cds.autoexpose'] && entity['@cds.autoexposed']) return true
  if (entity.name.endsWith('.DraftAdministrativeData')) return true
}

check_autoexposed._initial = true

module.exports = check_autoexposed
