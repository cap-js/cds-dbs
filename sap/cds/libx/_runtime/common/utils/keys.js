const { where2obj } = require('./cqn')
const { deepCopy } = require('./copy')
const { foreignKeyPropagations } = require('./foreignKeyPropagations')

function _mergeWhere(base, additional) {
  if (additional?.length) {
    // copy where else query will be modified
    const whereCopy = deepCopy(additional)
    if (base.length > 0) base.push('and')
    base.push(...whereCopy)
  }
  return base
}

function _modifyWhereWithNavigations(where, newWhere, entityKey, targetKey) {
  _mergeWhere(newWhere, where)
  _renameOnUp(newWhere, entityKey, targetKey)
}

function _buildWhereForNavigations(ref, newWhere, model, target) {
  const currentRef = ref[0]
  const nextRef = ref[1]

  if (nextRef) {
    const csnEntity = target || model.definitions[currentRef.id || currentRef]
    const navigationElement = csnEntity && csnEntity.elements[nextRef.id || nextRef]

    if (!navigationElement || !navigationElement.on) return

    const nextKeys = foreignKeyPropagations(navigationElement)

    // only add where once in _modifyWhereWithNavigations
    let whereAdded = false
    for (const key of nextKeys) {
      const targetKeyElement = navigationElement._target.elements[key.childElement.name]

      if (targetKeyElement && (targetKeyElement.isAssociation || targetKeyElement._foreignKey4)) {
        _modifyWhereWithNavigations(
          !whereAdded && currentRef.where,
          newWhere,
          key.childElement.name,
          key.parentElement.name
        )
        whereAdded = true
      }
    }
    _buildWhereForNavigations(ref.slice(1), newWhere, model, navigationElement._target)
  }
}

function _renameOnUp(newWhere, entityKey, targetKey) {
  let renamed = false
  newWhere.forEach(element => {
    if (element.xpr && element.xpr.length) {
      renamed = _renameOnUp(element.xpr, entityKey, targetKey) || renamed
    }
    if (element.ref && element.ref[0] === targetKey) {
      element.ref = [entityKey]
      renamed = true
    }
  })
  return renamed
}

function _getWhereFromInsert(query, model) {
  const where = []
  if (query.INSERT.into.ref && query.INSERT.into.ref.length > 1) {
    _buildWhereForNavigations(query.INSERT.into.ref, where, model)
  }
  return where
}

function _getWhereFromUpdate(query, model) {
  if (query.UPDATE.entity.ref && query.UPDATE.entity.ref.length > 1) {
    const where = []
    _buildWhereForNavigations(query.UPDATE.entity.ref, where, model)

    return where
  }

  const where = query.UPDATE.where || []
  if (query.UPDATE.entity.ref?.length === 1 && query.UPDATE.entity.ref[0].where)
    return _mergeWhere(where.length ? [...query.UPDATE.entity.ref[0].where] : query.UPDATE.entity.ref[0].where, where)
  return where
}

// params: data, req, service/tx
function enrichDataWithKeysFromWhere(data, { query, target }, { model }) {
  if (query.INSERT) {
    const where = _getWhereFromInsert(query, model)
    if (!where?.length) return
    if (!Array.isArray(data)) data = [data]
    for (const d of data) Object.assign(d, where2obj(where, target))
  } else if (query.UPDATE) {
    const where = _getWhereFromUpdate(query, model)
    if (!where?.length) return
    // REVISIT: We should not expect data to be present always!
    if (!data) data = query.UPDATE.data = {}
    where2obj(where, target, data)
  }
}

module.exports = {
  where2obj,
  enrichDataWithKeysFromWhere
}
