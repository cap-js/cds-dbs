const cds = require('@sap/cds/lib')

const OP = {}

module.exports = function (q) {
  const kind = q.kind || Object.keys(q)[0]
  const ret = OP[kind].call(this, q)
  return ret
}

OP.INSERT = function (q, path = [], targets = {}) {
  const name = n => n.replace(/\./g, '_')

  const kind = q.kind || Object.keys(q)[0]
  const INSERT = q[kind] || q.INSERT || q.UPSERT
  const { target } = q
  // Only INSERT.entries get deep logic
  // if (INSERT.rows) return ''
  const { compositions } = target

  let into = INSERT.into
  if (typeof into === 'string') into = { ref: [into] }

  if (path.find(c => c.name === q.target.name)) return ''
  const isRoot = path.length === 0
  path.push(q.target)
  targets[q.target.name] = targets[q.target.name] || { count: 0 }
  targets[q.target.name].count += 1

  const label = `l${path.length}`
  const extract = this.cqn2sql(q)
    .extract
    .replace('SRC.JSON', ':input')
    .trim()
  let sql = ''
  /*
  let sql = !isRoot
    ? ''
    : `
DO (IN input NCLOB => ?)
BEGIN
  DECLARE v_${label}_index INT = 0;
  DECLARE v_${label}_last_index INT = -1;

  v_${name(q.target.name)} = ${extract};
`*/

  const needDeep = {}
  for (const c in compositions) {
    const t = compositions[c].target
    if (targets[t] === undefined) {
      needDeep[t] = true
      targets[t] = { count: 0 }
    }
  }

  // Compute all compositions
  for (const c in compositions) {
    const element = compositions[c]
    const target = cds.model.definitions[element.target] // REVISIT: element._target is the actual reference

    const ins = cds.ql.INSERT([]).into({ ref: [...into.ref, c] })
    const next = needDeep[target.name] ? OP.INSERT.call(this, ins, path, targets).replace(/\n/g, '\n  ') : ''
    /* TODO: for UPDATE / UPSERT
    const del = cds.ql.DELETE.from({
      ref: [...into.ref, {
        id: c,
        where: ['not', { list: ObjectKeys(target.keys).map(k => ({ ref: [k] })) }, 'in', { list: [] }]
      }]
    })
    */
    const cqn2sql = this.cqn2sql(ins)
    let extract = cqn2sql.extract.trim()
    targets[target.name].extract = extract
    targets[target.name].columns = cqn2sql.columns

    const parentMapping = []
    for (const foreignKey of element._foreignKeys) {
      const cname = foreignKey.childElement.name
      const pname = foreignKey.parentElement.name
      const org = new RegExp(`,${cname} ([^ ]*) PATH '\\$\\.${cname}'`).exec(extract)
      extract = extract.replace(org[0], '') // TODO: properly quote column name
      parentMapping.push(`${cname} ${org[1]} PATH '$.${pname}'`)
    }

    sql = `${sql}
  WHILE record_count(:v_${name(target.name)}) > 0 DO
    INSERT INTO ${name(target.name)} (${cqn2sql.columns}) SELECT ${cqn2sql.columns} FROM :v_${name(target.name)};
    v_${name(target.name)} = 
      WITH SRC AS (SELECT _JSON_ as JSON FROM :v_${name(q.target.name)})
      ${extract.replace(`'$' COLUMNS(`, `'$$' COLUMNS(${parentMapping}, ${c} NVARCHAR(2147483647) FORMAT JSON PATH '$$.${c}', NESTED PATH '$$.${c}[*]' COLUMNS(`).replace(') ERROR ON ERROR)', ')) ERROR ON ERROR)')}
      WHERE LENGTH(${c}) > 2;
  END WHILE;
`
  }

  // Remove current target from path
  path.pop()

  if (isRoot) {
    const tableValues = Object.keys(targets)
      .map(t => `v_${name(t)} = ${targets[t].extract.replace('SRC.JSON', q.target.name === t ? ':input' : "'[]'")};`)
    const finalInserts = [] || Object.keys(targets)
      .map(t => `INSERT INTO ${name(t)} (${targets[t].columns}) SELECT ${targets[t].columns} FROM :v_${name(t)};`)

    sql = `DO (IN input NCLOB => ?)
BEGIN
  DECLARE v_changes INT = 0;
  DECLARE v_${label}_index INT = 0;
  DECLARE v_${label}_last_index INT = -1;

  ${tableValues.join('\n')}

  SELECT COUNT(*) INTO v_changes FROM :v_${name(q.target.name)};
${sql}

  --SELECT * FROM :v_${name(q.target.name)};
  ${finalInserts.join('\n')}
  SELECT v_changes as "changes" FROM DUMMY;
END;`
  } else {
    sql = `${sql}`
  }

  return sql
}

OP.UPDATE = (/*{ UPDATE, target, elements }*/) => {
  return []
}
