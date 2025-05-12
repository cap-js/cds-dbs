const cds = require('../../cds')
const { SELECT } = cds.ql
const { setEntityContained } = require('./csn')

const getEntityNameFromDeleteCQN = cqn => {
  let from
  if (cqn && cqn.DELETE && cqn.DELETE.from) {
    if (typeof cqn.DELETE.from === 'string') {
      from = cqn.DELETE.from
    } else if (cqn.DELETE.from.name) {
      from = cqn.DELETE.from.name
    } else if (cqn.DELETE.from.ref && cqn.DELETE.from.ref.length === 1) {
      from = cqn.DELETE.from.ref[0]
    }
  }
  return from
}

const getEntityNameFromUpdateCQN = cqn => {
  return (
    (cqn.UPDATE.entity.ref && cqn.UPDATE.entity.ref[0] && (cqn.UPDATE.entity.ref[0].id || cqn.UPDATE.entity.ref[0])) ||
    cqn.UPDATE.entity.name ||
    cqn.UPDATE.entity
  )
}

// scope: simple wheres à la "[{ ref: ['foo'] }, '=', { val: 'bar' }, 'and', ... ]"
function where2obj(where, target = null, data = {}) {
  for (let i = 0; i < where.length; ) {
    const a = where[i++]
    if (a.xpr) {
      where2obj(a.xpr, target, data)
      continue
    }
    if (!a.ref) continue

    const el = a.ref.at(-1)
    if (target && el in target.keys === false) continue

    const op = where[i++]
    if (op !== '=') continue

    const b = where[i++]
    if (!b || 'val' in b === false) continue
    else data[el] = b.val
  }
  return data
}

function targetFromPath(from, model) {
  if (from.SELECT) {
    return targetFromPath(from.SELECT.from, model)
  }
  const fromRef = from ? from.ref || [from] : []
  let last = fromRef.length ? model.definitions : {}
  const path = []
  let target
  let isContained
  for (let r of fromRef) {
    isContained = undefined
    path.push(r.operation || r)
    r = (r.id && r.id.replace(/_drafts$/, '')) || r
    if (r.operation) {
      if (last && last.actions) last = last.actions[r.operation]
      else last = last[r.operation]
    } else if (last.elements) {
      last = last.elements[r]
      if (last.isAssociation) {
        isContained = last._isContained && last.target !== last.parent.name
        last = model.definitions[last.target]
      }
    } else {
      last = last[r]
    }
    if (last.kind === 'entity') {
      target = last
      setEntityContained(target, model, isContained)
    } else if (last.kind === 'service') {
      target = last
    }
  }
  return { last, path, target, isTargetComposition: isContained }
}

const resolveFromSelect = query => {
  if (!(query instanceof SELECT.class)) Object.setPrototypeOf(query, SELECT.class.prototype)
  const { from } = query.SELECT
  return from.SELECT ? resolveFromSelect(from) : from
}

module.exports = {
  getEntityNameFromDeleteCQN,
  getEntityNameFromUpdateCQN,
  where2obj,
  targetFromPath,
  resolveFromSelect
}
