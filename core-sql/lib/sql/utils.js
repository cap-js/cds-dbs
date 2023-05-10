const cds = require('@sap/cds/lib')

const target_name4 = q => {
    const target = (
      q.SELECT?.from ||
      q.INSERT?.into ||
      q.UPSERT?.into ||
      q.UPDATE?.entity ||
      q.DELETE?.from ||
      q.CREATE?.entity ||
      q.DROP?.entity ||
      undefined
    )
    if (target?.SET?.op === "union") throw new cds.error('”UNION” based queries are not supported');
    if (!target?.ref) return target
    const [first] = target.ref
    return first.id || first
  }

  module.exports = {
    target_name4
  }