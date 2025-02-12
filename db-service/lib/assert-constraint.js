'use strict'

function attachConstraints(_results, req) {
  if (!req.target || !this.model || req.target._unresolved) return
  const constraints = collectConstraints(req.target) // collect constraints from annotations
  if (Object.keys(constraints).length === 0) return

  // which entry shall be checked? We need the IDs of the current req
  let whereClauses = []
  if (req.event === 'INSERT' || req.event === 'CREATE') {
    const primaryKeys = Object.keys(req.target.keys)
    const dataEntries = Array.isArray(req.data) ? req.data : [req.data] // Ensure batch handling

    // construct {key:value} pairs holding information about the entry to check
    whereClauses = dataEntries
      .map(entry =>
        primaryKeys.reduce((identifier, key) => {
          const value = entry[key]
          if (value === undefined) {
            // Skip keys with undefined values, e.g. csv import
            return
          }
          if (identifier.length > 0) identifier.push('and')
          identifier.push({ ref: [key] }, '=', { val: value })
          return identifier
        }, []),
      )
      .filter(Boolean)
  } else if (req.event === 'UPDATE' || req.event === 'UPSERT') {
    const prop = req.event

    if (req.query[prop]?.where) {
      whereClauses.push(req.query[prop].where)
    } else if (req.query[prop]?.entity?.ref[0]?.where) {
      whereClauses.push(req.query[prop].entity.ref[0].where)
    }
  }

  // REVISIT: Ensure whereClauses is defined for other cases
  if (whereClauses.length === 0) {
    // Handle scenarios where no `where` clause is defined
    // E.g., aggregation assertions
    return
  }

  // each entry identifies a row to check
  // --> calculate the validation query for each entry
  //     attach information about the identity of the entry for messages
  //     validation queries are executed just before commit
  for (const where of whereClauses) {
    const validationQuery = _getValidationQuery(req, constraints, where)
    if (this.tx.assert_constraints) this.tx.assert_constraints.push({ validationQuery, constraints })
    else this.tx.assert_constraints = [{ validationQuery, constraints }]
  }
  return
  function _getValidationQuery(req, constraints, where) {
    const validationQuery = SELECT.from(req.target)
    // each column represents a constraint
    const columns = Object.keys(constraints).map(name => {
      const constraint = constraints[name]
      const { condition, element } = constraint
      const xpr = []
      // if the element is nullable, we prepend xpr with `<element> IS NULL OR …`
      if (!element.notNull) {
        if (element.on)
          // null check the whole xpr for unmanaged assocs which vanish in the result
          xpr.unshift({ xpr: condition.xpr }, 'is', 'null', 'or')
        else xpr.unshift({ ref: [element.name] }, 'is', 'null', 'or')
      }
      xpr.push({ xpr: condition.xpr })
      return {
        // case … when … needed for hana compatibility
        // REVISIT: can we move workaround to HANAService only?
        xpr: ['case', 'when', { xpr }, 'then', { val: true }, 'else', { val: false }, 'end'],
        as: name,
        cast: {
          type: 'cds.Boolean',
        },
      }
    })

    validationQuery.SELECT.columns = columns
    validationQuery.SELECT.where = where
    validationQuery.SELECT.one = true
    return validationQuery
  }

  function collectConstraints(entity) {
    const constraints = {}

    // Iterate over all elements in the entity
    for (const elementKey in entity.elements) {
      const element = entity.elements[elementKey]
      // Ensure the element has a name (if not provided, infer it from the key)
      if (!element.name) {
        element.name = elementKey
      }

      // Extract constraints from the current element
      const elementConstraints = extractConstraintsFromElement(element)

      // Merge the element constraints into the global constraints map
      for (const constraintName in elementConstraints) {
        if (!constraints[constraintName]) {
          constraints[constraintName] = elementConstraints[constraintName]
        } else {
          // Merge properties if the same constraint already exists, can that happen?
          Object.assign(constraints[constraintName], elementConstraints[constraintName])
        }
      }
    }
    return constraints

    function extractConstraintsFromElement(element) {
      const elmConstraints = {}
      const elementName = element.name // Used if no constraint name is provided

      for (const key in element) {
        if (key.startsWith('@assert.constraint')) {
          // Remove the fixed prefix
          let remainder = key.substring('@assert.constraint'.length)
          // Remove a leading dot, if any
          if (remainder.startsWith('.')) {
            remainder = remainder.substring(1)
          }

          // separate constraint name and property
          const parts = remainder.split('.')
          let constraintName, propertyName
          if (parts.length === 1) {
            // No explicit name: use the element's name as constraint name
            constraintName = elementName
            if (remainder.length === 0)
              // shorthand has no condition prop
              propertyName = 'condition'
            else propertyName = parts[0]
          } else {
            // First part is the constraint name; the rest is the property name
            constraintName = parts[0]
            propertyName = parts.slice(1).join('.')
          }

          // Initialize the constraint object if needed
          if (!elmConstraints[constraintName]) {
            elmConstraints[constraintName] = {}
          }
          // Assign the property value from the element
          elmConstraints[constraintName][propertyName] = element[key]
        }
      }
      Object.keys(elmConstraints).forEach(name => {
        elmConstraints[name].element = element
      })
      return elmConstraints
    }
  }
}

async function checkConstraints(req) {
  if (this.tx.assert_constraints) {
    for (const check of this.tx.assert_constraints) {
      const { validationQuery, constraints } = check
      const result = await this.run(validationQuery)
      if (!result) continue
      for (const name in constraints) {
        const constraintFulfilled = result[name]
        if (!constraintFulfilled) {
          const { message } = constraints[name]
          // await this.rollback()
          req.error(400, message || `@assert.constraint ”${name}” failed`)
        }
      }
    }
    // REVISIT: we can probably get rid of this
    this.tx.assert_constraints = []
  }
}

module.exports = {
  attachConstraints,
  checkConstraints,
}
