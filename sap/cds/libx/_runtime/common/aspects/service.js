const cds = require('../../cds')

module.exports = cds.env.effective.odata.containment
  ? class {
      get _containedEntities() {
        return this.own('__containedEntities', () => {
          const containees = new Set()

          for (const e in this.entities) {
            const entity = this.entities[e]
            if (entity.compositions) {
              for (const c in entity.compositions) {
                const comp = entity.compositions[c]
                if (comp.parent.name !== comp.target) {
                  containees.add(comp.target)
                }
              }
            }
          }

          return containees
        })
      }
    }
  : class {}
