const iterator = Symbol.iterator

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

module.exports = class InsertResult {
  /**
   * @param {import('@sap/cds/apis/cqn').INSERT} query
   * @param {unknown[]} results
   */
  constructor(query, results) {
    // Storing query as non-enumerable property to avoid polluting trace output
    Object.defineProperty(this, 'query', { value: query })
    this.results = results
  }

  /**
   * Lazy access to auto-generated keys.
   */
  get [iterator]() {
    // For INSERT.as(SELECT.from(...)) return a dummy iterator with correct length
    const { INSERT } = this.query
    if (INSERT.as) {
      return (super[iterator] = function* () {
        for (let i = 0; i < this.affectedRows; i++) yield {}
      })
    }

    const { target } = this.query
    if (!target?.keys) return (super[iterator] = this.results[iterator])
    const keys = Object.keys(target.keys),
      [k1] = keys

    // For INSERT.entries() with generated keys in there return these keys
    const { entries } = INSERT
    if (entries && k1 in entries[0]) {
      return (super[iterator] = function* () {
        for (const each of entries)
          yield keys.reduce((p, k) => {
            p[k] = each[k]
            return p
          }, {})
      })
    }

    // For INSERT.rows/values() with generated keys in there return these keys
    const { columns } = INSERT
    if (columns && columns.includes(k1)) {
      return (super[iterator] = function* () {
        const indices = keys.reduce((p, k) => {
          let i = columns.indexOf(k)
          if (i >= 0) p[k] = i
          return p
        }, {})
        for (const each of INSERT.rows || [INSERT.values])
          yield keys.reduce((p, k) => {
            p[k] = each[indices[k]]
            return p
          }, {})
      })
    }

    // If no generated keys in entries/rows/values we might have database-generated keys
    const rows = this.results.slice(0, this.affectedRows) // only up to # of root entries
    return (super[iterator] = function* () {
      for (const each of rows) yield { [k1]: this.insertedRowId4(each) } // REVISIT: sqlite only returns a single lastID per row -> how is that with others?
    })
  }

  /**
   * the number of inserted (root) entries or the number of affectedRows in case of INSERT into SELECT
   * @return {number}
   */
  get affectedRows() {
    const { INSERT: _ } = this.query
    if (_.as) return (super.affectedRows = this.affectedRows4(this.results[0] || this.results))
    else return (super.affectedRows = _.entries?.length || _.rows?.length || this.results.length || 1)
  }

  /**
   * for checks such as res > 2
   * @return {number}
   */
  valueOf() {
    return this.affectedRows
  }

  /**
   * The last id of the auto incremented key column
   * @param {unknown[]} result
   * @returns {number}
   */
  insertedRowId4(result) {
    return result.lastID
  }

  /**
   * Number of affected rows
   * @param {unknown[]} result
   * @returns {number}
   */
  affectedRows4(result) {
    return result.changes
  }
}
