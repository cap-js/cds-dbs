class WithContext {
  constructor(originalQuery) {
    this.withClauses = {}

    if (originalQuery._with) this.add(originalQuery._with)
  }

  add(_with) {
    _with.forEach(clause => { this.withClauses[clause.as] ??= clause })
  }

  hasWith(alias) {
    return this.withClauses[alias]
  }

  getWithClauses() {
    return Object.values(this.withClauses)
  }
}

module.exports = WithContext