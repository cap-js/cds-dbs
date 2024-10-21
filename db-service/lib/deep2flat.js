const cds = require('@sap/cds/lib')

const OP = {}

module.exports = function (q) {
  const kind = q.kind || Object.keys(q)[0]
  const ret = OP[kind].call(this, q)
  if (ret?.length > 1) {
    const func = new Function(['Readable', 'children'], ret)
    return func
  }
}

OP.INSERT = function (q, path = [], targets = {}) {
  const kind = q.kind || Object.keys(q)[0]
  const INSERT = q[kind] || q.INSERT || q.UPSERT
  const { target } = q
  // Only INSERT.entries get deep logic
  if (INSERT.rows) return ''
  const { compositions } = target

  let into = INSERT.into
  if (typeof into === 'string') into = { ref: [into] }

  if (path.find(c => c.name === q.target.name)) return ''
  const isRoot = path.length === 0
  path.push(q.target)
  targets[q.target.name] = (targets[q.target.name] || 0) + 1

  const label = `l${path.length}`
  let js = `{
  ${isRoot ? `toStream = entries => {
  const stream = Readable.from(this.class.CQN2SQL.prototype.INSERT_entries_stream(entries))
  stream.type = 'json'
  return stream
}` : ''}
  ${isRoot ? 'const entries = {}' : ''}
  ${isRoot ? `entries[${JSON.stringify(target.name)}] = children` : ''}
  const parents = children`

  const needDeep = {}
  for (const c in compositions) {
    const t = compositions[c].target
    if (targets[t] === undefined) {
      needDeep[t] = true
      targets[t] = 0
    }
  }

  // Compute all compositions
  for (const c in compositions) {
    const element = compositions[c]
    const target = cds.model.definitions[element.target] // REVISIT: element._target is the actual reference

    const ins = cds.ql.UPSERT.into({ ref: [...into.ref, c] })
    const next = needDeep[target.name] ? OP.INSERT.call(this, ins, path, targets).replace(/\n/g, '\n  ') : ''
    /* TODO: for UPDATE / UPSERT
    const del = cds.ql.DELETE.from({
      ref: [...into.ref, {
        id: c,
        where: ['not', { list: ObjectKeys(target.keys).map(k => ({ ref: [k] })) }, 'in', { list: [] }]
      }]
    })
    */
    js = `${js}
  ${label}:{
    const children = entries[${JSON.stringify(target.name)}] ??= []
    for(const p of parents) {
      const child = p[${JSON.stringify(c)}]
      if(!child) continue // TODO: throw clear error when child is not the correct type
      ${element.is2one ? 'c = child' : 'for(const c of child) {'}
        ${element._foreignKeys.map(l => `c[${JSON.stringify(l.childElement.name)}] = p[${JSON.stringify(l.parentElement.name)}]`).join('      \n')}
        children.push(c)
      ${element.is2one ? '' : '}'}
    }
    ${next ? `if(!children.length) break ${label}` : ''}
    ${next}
  }
`
  }

  // Remove current target from path
  path.pop()

  if (isRoot) {
    const queries = Object.keys(targets).map(t => {
      const { sql } = this.cqn2sql(cds.ql.INSERT([]).into(t))
      return `this._insert({
  sql: ${JSON.stringify(sql)},
  entries: [[toStream(entries[${JSON.stringify(t)}])]],
  cqn: {INSERT:{into:{ref:[${JSON.stringify(t)}]}}}
})`
    })
    js = `${js}
  return Promise.all([
  ${queries.join(',\n')}
  ])
}`
  } else {
    js = `${js}
}`
  }

  return js
}

OP.UPDATE = (/*{ UPDATE, target, elements }*/) => {
  return []
}
