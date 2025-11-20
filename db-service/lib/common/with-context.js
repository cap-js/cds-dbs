class WithContext {
  constructor(originalQuery) {
    this.withClauses = new Map()

    // Initialize with existing clauses
    if (originalQuery._with) {
      originalQuery._with.forEach(clause => {
        this.withClauses.set(clause.as, clause)
      })
    }
  }

  add(_with) {
    _with.forEach(element => {
      if (!this.withClauses.has(element.as)) {
        this.withClauses.set(element.as, element)
      }
    })
  }

  hasWith(alias) {
    return this.withClauses.has(alias)
  }

  getWithClauses() {
    return Array.from(this.withClauses.values())
  }
}

module.exports = WithContext