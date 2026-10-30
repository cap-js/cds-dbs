'use strict'

// Own the planning state for one query and its relationship to enclosing scopes.
// Resolve source names and track projections, aliases and reusable association paths.

const { getImplicitAlias } = require('../utils')

class Scope {
  constructor(compiler, syntax, parent) {
    this.compiler = compiler
    this.model = compiler.model
    this.syntax = syntax
    this.parent = parent
    this.kind = ['SELECT', 'INSERT', 'UPSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP'].find(k => syntax[k])
    if (!this.kind) throw new Error(syntax.SET ? '”UNION” based queries are not supported' : 'Unknown query kind')
    this.clause = syntax[this.kind]
    this.semanticOnly = !!compiler.options.metadataOnly || !!parent?.semanticOnly || !!this.clause.from?.args
    this.custom = !!this.clause.from?.args
    this.columnMetadata = new Map()
    this.subqueries = new Map()
    this.localized = !!((this.clause.localized ?? parent?.localized) && !this.clause.forUpdate && !this.clause.forShareLock)
    this.sources = new Map()
    this.sourceNames = new Map()
    this.aliases = new Set()
    this.suffixes = new Map()
    this.joins = []
    this.elements = {}
    this.projections = []
    this.byName = new Map()
    this.dependencies = new Map()
    this.phase = 'binding'
  }

  alias(name, outer = true) {
    const upper = name.toUpperCase()
    const used = candidate => this.aliases.has(candidate) || (outer && this.parent?.hasAlias(candidate))
    let alias = name
    if (used(upper)) {
      let suffix = this.suffixes.get(upper) || 2
      while (used(upper + suffix)) suffix++
      this.suffixes.set(upper, suffix + 1)
      alias += suffix
    }
    this.aliases.add(alias.toUpperCase())
    return alias
  }

  hasAlias(upper) { return this.aliases.has(upper) || this.parent?.hasAlias(upper) }
  implicit(name) { return getImplicitAlias(name, this.compiler.options.technicalAliases && !this.custom) }
  definition(name) { return this.model.definition(name, this.localized) }

  source(alias) { return this.sourceNames.get(alias) || this.parent?.source(alias) }

  lookup(name) {
    const candidates = []
    for (const source of this.sources.values()) if (name in source.definition.elements) candidates.push(source)
    if (candidates.length > 1) throw new Error('ambiguous reference to "' + name + '", write ' +
      candidates.map(s => '"' + s.alias + '.' + name + '"').join(', ') + ' instead')
    if (candidates.length) return candidates[0]
    throw new Error('"' + name + '" not found in the elements of ' +
      [...this.sources.values()].map(s => '"' + (s.definition.name || s.alias) + '"').join(', '))
  }

  join(parent, association, prefix, step, preferred) {
    if (this.phase !== 'binding') throw new Error('Join discovered after planning')
    const signature = value => value ? this.model.memo(value, 'signature', () => JSON.stringify(value)) : ''
    const key = prefix + signature(step?.where) + signature(step?.args)
    const children = parent.children || (parent.children = new Map())
    let join = children.get(key)
    if (!join) {
      join = { scope: this, parent, association, prefix, step, preferred: preferred || step?.id || step || association.name,
        definition: this.model.target(association, this.localized), required: false, children: new Map() }
      children.set(key, join)
      this.joins.push(join)
    }
    return join
  }

  require(join) {
    if (!join?.association || join.required) return
    this.require(join.parent)
    join.required = true
    join.order ??= this.joinOrder = (this.joinOrder || 0) + 1
    join.alias = this.alias(join.preferred)
  }
}

module.exports = Scope
