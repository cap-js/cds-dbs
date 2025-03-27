'use strict'

const { prettyPrintRef } = require('../utils')

// REVISIT: define following unknown types

/**
 * @typedef {unknown} $refLink
 */

/**
 * @typedef {unknown} parent
 */

/**
 * @typedef {unknown} where
 */

/**
 * @typedef {unknown} children
 */

/**
 * @typedef {unknown} queryArtifact
 */

/**
 * @typedef {string} alias
 */

/**
 * @typedef {Map<alias,Root>} _roots
 */

/**
 * @typedef {Object.<string, unknown>} sources
 */

/**
 * A class representing a Node in the join tree.
 */
class Node {
  /**
   * @param {$refLink} $refLink
   * @param {parent} parent
   * @param {where} where
   */
  constructor($refLink, parent, where = null, args = null) {
    /** @type {$refLink} - A reference link to this node. */
    this.$refLink = $refLink
    /** @type {parent} - The parent Node of this node. */
    this.parent = parent
    /** @type {where} - An optional condition to be applied to this node. */
    this.where = where
    /** @type {args} - optional parameter object to be applied to this node. */
    const targetHasParams = $refLink.definition._target?.params || $refLink.definition._target?.['@cds.persistence.udf']
    if (!args && targetHasParams) args = {} // if no args are provided, provide empty argument list
    this.args = args
    /** @type {children} - A Map of children nodes belonging to this node. */
    this.children = new Map()
  }
}

/**
 * A class representing the root of the join tree.
 */
class Root {
  /**
   * @param {[alias, queryArtifact]} querySource
   */
  constructor(querySource) {
    let [alias, { definition, args }] = querySource
    /** @type {queryArtifact} - The artifact used to make the query. */
    this.queryArtifact = definition
    /** @type {args} - optional parameter object to be applied to this node. */
    const definitionHasParams = definition.params || definition['@cds.persistence.udf']
    if (!args && definitionHasParams) args = {} // if no args are provided, provide empty argument list
    this.args = args
    /** @type {alias} - The alias of the artifact. */
    this.alias = alias
    /** @type {parent} - The parent Node of this root, null for the root Node. */
    this.parent = null
    /** @type {children} - A Map of children nodes belonging to this root. */
    this.children = new Map()
  }
}

/**
 * A class representing a Join Tree.
 */
class JoinTree {
  /**
   *
   * @param {sources} sources
   */
  constructor(sources) {
    /** @type {_roots} - A Map of root nodes. */
    this._roots = new Map()
    /** @type {boolean} - A boolean indicating if the join tree is in its initial state. */
    this.isInitial = true
    /**
     * A map that holds query aliases which are used during the
     * association to join translation. It is also considered during the
     * where exists expansion.
     *
     * The table aliases are treated case insensitive. The index of each
     * table alias entry, is the capitalized version of the alias.
     * @type {Map<string, string>}
     */
    this._queryAliases = new Map()
    Object.entries(sources).forEach(entry => {
      const alias = this.addNextAvailableTableAlias(entry[0])
      this._roots.set(alias, new Root(entry))
    })
  }

  /**
   * Recursively adds aliases of subqueries from a given query source to the alias map.
   *
   * @param {object} sources - The sources of the inferred subquery in a FROM clause.
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
   * Calculates and adds the next available table alias to the alias map.
   *
   * @param {string} alias - The original alias name.
   * @param {unknown[]} outerQueries - An array of outer queries.
   * @returns {string} - The next unambiguous table alias.
   */
  addNextAvailableTableAlias(alias, outerQueries) {
    const upperAlias = alias.toUpperCase()
    if (this._queryAliases.get(upperAlias) || outerQueries?.some(outer => outerHasAlias(outer))) {
      let j = 2
      while (this._queryAliases.get(upperAlias + j) || outerQueries?.some(outer => outerHasAlias(outer, j))) j += 1
      alias += j
    }
    this._queryAliases.set(alias.toUpperCase(), alias)
    return alias

    function outerHasAlias(outer, number) {
      return outer.joinTree._queryAliases.get(number ? upperAlias + number : upperAlias)
    }
  }

  /**
   * Merges a column into the join tree.
   *
   * It begins by inferring the source of the given column, which is the table alias where the column is resolvable.
   * Each step during this process represents a node in the join tree. If a node already exists in the tree, the current step is replaced by the already merged node.
   * If not, it creates a new Node and ensures proper aliasing and foreign key access.
   *
   * @param {object} col - The column object to be merged into the existing join tree. This object should have the properties $refLinks and ref.
   * @returns {boolean} - Always returns true, indicating the column has been successfully merged into the join tree.
   */
  mergeColumn(col, outerQueries = null) {
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

    // if no root node was found, the column is selected from a subquery
    if (!node) return
    while (i < col.ref.length) {
      if(col.join === 'inner') node.join = 'inner'
      const step = col.ref[i]
      const { where, args } = step
      const id = joinId(step, args, where)
      const next = node.children.get(id)
      const $refLink = col.$refLinks[i]
      // sanity check: error out if we can't produce a join
      if ($refLink.definition.keys && $refLink.definition.keys.length === 0) {
        const path = prettyPrintRef(col.ref)
        throw new Error(`Path step “${$refLink.alias}” of “${path}” has no foreign keys`)
      }

      if (next) {
        // step already seen before
        node = next
        // re-set $refLink to equal the one which got already merged
        col.$refLinks[i].alias = node.$refLink.alias
        col.$refLinks[i].definition = node.$refLink.definition
        col.$refLinks[i].target = node.$refLink.target
        col.$refLinks[i].onlyForeignKeyAccess = node.$refLink.onlyForeignKeyAccess
      } else {
        if (col.expand && !col.ref[i + 1]) {
          node.$refLink.onlyForeignKeyAccess = false
          return true
        }
        const child = new Node($refLink, node, where, args)
        if (child.$refLink.definition.isAssociation) {
          if (child.where || child.$refLink.definition.on || col.inline) {
            // filter is always join relevant
            // if the column ends up in an `inline` -> each assoc step is join relevant
            child.$refLink.onlyForeignKeyAccess = false
          } else {
            child.$refLink.onlyForeignKeyAccess = true
          }
          child.$refLink.alias = this.addNextAvailableTableAlias($refLink.alias, outerQueries)
        }
        const elements =
          node.$refLink?.definition.isAssociation &&
          (node.$refLink.definition.elements || node.$refLink.definition.foreignKeys)
        if (node.$refLink && (!elements || !(child.$refLink.definition.name in elements))) {
          // no foreign key access
          node.$refLink.onlyForeignKeyAccess = false
          col.$refLinks[i - 1] = node.$refLink
        }

        node.children.set(id, child)
        node = child
      }
      i += 1
    }
    return true

    function joinId(step, args, where) {
      let appendix
      if (where && args) appendix = JSON.stringify(where) + JSON.stringify(args)
      else if (where) appendix = JSON.stringify(where)
      else if (args) appendix = JSON.stringify(args)
      return appendix ? step.id + appendix : step
    }
  }

  /**
   * Performs a depth-first search for the next association in the children of the given node which does not only access foreign keys.
   *
   * @param {Node} node - The node from which to search for the next association.
   * @returns {Node|null} - Returns the node which represents an association or null if none was found.
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
