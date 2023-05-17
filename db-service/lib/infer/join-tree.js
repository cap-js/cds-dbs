'use strict'

class Node {
  constructor($refLink, parent, where = null) {
    this.$refLink = $refLink
    this.parent = parent
    this.where = where
    this.children = new Map()
  }
}

class Root {
  constructor(querySource) {
    const [alias, queryArtifact] = querySource
    this.queryArtifact = queryArtifact
    this.alias = alias
    this.parent = null
    this.children = new Map()
  }
}

class JoinTree {
  constructor(sources) {
    this._roots = new Map()
    this.isInitial = true
    /**
     * A map that holds query aliases which are used during the
     * association to join translation. It is also considered during the
     * where exists expansion.
     *
     * The table aliases are treated case insensitive. The index of each
     * table alias entry, is the capitalized version of the alias.
     */
    this._queryAliases = new Map()
    Object.entries(sources).forEach(entry => {
      const alias = this.addNextAvailableTableAlias(entry[0])
      this._roots.set(alias, new Root(entry))
      if (entry[1].sources)
        // respect outer aliases
        this.addAliasesOfSubqueryInFrom(entry[1].sources)
    })
  }

  /**
   * Recursively drills into subqueries in a query source and
   * adds the aliases of those subqueries to the alias map.
   *
   * @param {object} sources of inferred subquery in from
   */
  addAliasesOfSubqueryInFrom(sources) {
    Object.entries(sources).forEach(e => {
      this.addNextAvailableTableAlias(e[0])
      if (e[1].sources)
        // recurse
        this.addAliasesOfSubqueryInFrom(e[1].sources)
    })
  }

  /**
   * Calculate the next available table alias and add it to
   * the alias map. Returns the alias in original case, appended
   * by an integer if necessary.
   *
   * @param {string} alias
   * @returns the next un-ambigous table alias
   */
  addNextAvailableTableAlias(alias) {
    const upperAlias = alias.toUpperCase()
    if (this._queryAliases.get(upperAlias)) {
      let j = 2
      while (this._queryAliases.get(upperAlias + j)) j += 1
      alias += j
    }
    this._queryAliases.set(alias.toUpperCase(), alias)
    return alias
  }

  /**
   * Merge a column into the join tree.
   *
   * First, the source of the column is inferred, i.e. the table alias in which the `col` is resolvable.
   * The table alias is the root of this column. Each of the following steps represents a `node` in the join tree.
   * If a `node` is already present in the tree, the current step is replaced by the already merged `node`.
   * This makes sure all references which follow the same path will have the same table alias in the end.
   *
   * @param {object} col the column which shall be merged into the existing join tree
   * @returns {true}
   */
  mergeColumn(col) {
    if (this.isInitial) this.isInitial = false
    const head = col.$refLinks[0]
    let node = this._roots.get(head.alias)
    let i = 0
    if (!node) {
      this._roots.forEach(r => {
        // find the correct query source
        if (
          r.queryArtifact === head.target ||
          r.queryArtifact === head.target.target /** might as well be a query for order by */
        )
          node = r
      })
    } else {
      i += 1 // skip first step which is table alias
    }

    while (i < col.ref.length) {
      const step = col.ref[i]
      const { where } = step
      const id = where ? step.id + JSON.stringify(where) : step
      const next = node.children.get(id)
      const $refLink = col.$refLinks[i]
      if (next) {
        // step already seen before
        node = next
        col.$refLinks[i] = node.$refLink // re-set $refLink to point to already merged $refLink
      } else {
        if (col.expand && !col.ref[i + 1]) {
          node.$refLink.onlyForeignKeyAccess = false
          return true
        }
        const child = new Node($refLink, node, where)
        if (child.$refLink.definition.isAssociation) {
          if (child.where) {
            // always join relevant
            child.$refLink.onlyForeignKeyAccess = false
          } else {
            child.$refLink.onlyForeignKeyAccess = true
          }
          child.$refLink.alias = this.addNextAvailableTableAlias($refLink.alias)
        }

        const foreignKeys = node.$refLink?.definition.foreignKeys
        if (node.$refLink && (!foreignKeys || !(child.$refLink.alias in foreignKeys)))
          // foreign key access
          node.$refLink.onlyForeignKeyAccess = false

        node.children.set(id, child)
        node = child
      }
      i += 1
    }
    return true
  }

  /**
   * Search depth-first for the next association in the children's of the given `node` which
   * does not only access foreign keys.
   *
   * @param {Node} node the node from which to search for the next association
   * @returns {Node|null} the node which represents an association. Or null if none was found.
   */
  findNextAssoc(node) {
    if (node.$refLink.definition.isAssociation && !node.$refLink.onlyForeignKeyAccess) return node
    // recurse on each child node
    for (const child of node.children.values()) {
      const grandChild = this.findNextAssoc(child)
      if (grandChild) return grandChild
    }

    return null
  }
}

module.exports = JoinTree
