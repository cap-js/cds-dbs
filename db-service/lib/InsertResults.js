
// eslint-disable-next-line no-unused-vars
const USAGE_SAMPLE = async () => {
  // from https://cap.cloud.sap/docs/node.js/services?q=Emily#srv-run
  const { Authors, Books } = {}
  const [Emily, Charlotte] = await INSERT.into(Authors, [{ name: 'Emily Brontëe' }, { name: 'Charlotte Brontëe' }])
  await INSERT.into(Books, [
    { title: 'Wuthering Heights', author: Emily },
    { title: 'Jane Eyre', author: Charlotte },
  ])
}

module.exports = class InsertResult extends Array {

  /**
   * @param {import('@sap/cds/apis/cqn').INSERT} query
   * @param {unknown[]} results
   */
  constructor (query, results) {
    Object.defineProperties (super(), { // using non-enumerable properties to avoid polluting trace output
      results: { value: results },
      query: { value: query },
    })
  }

  /** Legacy alias for compatibility */
  get affectedRows() { return this.affected }

  /** The number of affected rows is determined as follows:
   * - For INSERTs with entries/rows/values the number of these entries/rows/values is returned
   * - For other INSERTs the number of affected rows as returned by the database is returned
   * - For other statements the number of affected rows as returned by the database is returned
   */
  get affected() {
    const { INSERT } = this.query
    if (INSERT.from || INSERT.as) return super.affected = this.affectedRows4 (this.results[0] || this.results)
    else return super.affected = INSERT.entries?.length || INSERT.rows?.length || this.results.length || 1
  }

  [Symbol.iterator]() {
    if (!this.length) this.#materialize() // materialize on first access, e.g. for [...results]
    return super[Symbol.iterator]()
  }

  toJSON(){
    if (!this.length) this.#materialize() // ensure materialized keys for JSON.stringify
    return this
  }

  /**
   * Lazy materialization of auto-generated keys.
   */
  #materialize() {

    const target = this.query._target
    const keys = target?.keys && Object.keys(target.keys).filter(k => !target.keys[k].virtual && !target.keys[k].value && !target.keys[k].isAssociation)
    if (!keys?.length) {
      return this
    }

    const { INSERT } = this.query
    const k0 = keys[0]

    // For INSERT.entries() with generated keys in there return these keys
    if (INSERT.entries && k0 in INSERT.entries[0]) {
      for (const d of INSERT.entries) {
        this.push (keys.reduce((p,k) => (p[k] = d[k], p), {}))
      }
    }

    // For INSERT.rows/values() with generated keys in there return these keys
    else if (INSERT.columns && INSERT.columns.includes(k0)) {
      const indices = keys.reduce((p, k) => {
        let i = INSERT.columns.indexOf(k)
        if (i >= 0) p[k] = i
        return p
      }, {})
      for (const d of INSERT.rows || [INSERT.values]) {
        this.push (keys.reduce((p,k) => (p[k] = d[indices[k]], p), {}))
      }
    }

    // If no generated keys in entries/rows/values we might have database-generated keys
    else for (const row of this.results) {
      const affectedRows = this.affectedRows4(row) - 1
      const lastInsertRowid = this.insertedRowId4(row)
      for (let i = lastInsertRowid - affectedRows; i<=lastInsertRowid;i++) {
        this.push ({ [k0]: i })
      }
    }

    return this
  }

  /**
   * Number of affected rows
   * @param {unknown[]} result
   * @returns {number}
   */
  affectedRows4(result) {
    return result.changes
  }

  /**
   * The last id of auto-incremented key columns
   */
  insertedRowId4(result) {
    return result.lastInsertRowid
  }

  /**
   * for checks such as res > 2
   * @return {number}
   */
  valueOf() {
    return this.affected
  }
}
