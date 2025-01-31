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
    whereClauses = dataEntries.map(entry =>
      primaryKeys.reduce((identifier, key) => {
        const value = entry[key]
        if (value === undefined) {
          // Skip keys with undefined values, e.g. csv import
          return
        }
        if(identifier.length > 0) identifier.push('and')
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
      const {
        condition: { xpr },
        aggregation,
      } = constraint
      if (aggregation) {
        const subquery = SELECT.from(req.target).columns({ xpr, as: name })
        return {
          ...subquery,
          as: name,
          cast: {
            type: 'cds.Boolean',
          },
        }
      }
      return {
        xpr,
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

  // returns all properties which start with '@assert.constraint#…' from the given entity
  // everything after the qualifier '#' and up to the first dot is considered as constraint name
  // everything after the dot e.g. '…#foo.value' should result in:
  // constraints = { foo: { value: … } }
  function collectConstraints(entity) {
    const constraints = {}

    for (const key in entity) {
      if (key.startsWith('@assert.constraint#')) {
        // Extract the part after '#'
        const constraintPart = key.split('#')[1]

        // Extract the constraint name and path
        const [name, ...pathParts] = constraintPart.split('.')

        // Initialize the constraint object if not already present
        if (!constraints[name]) {
          constraints[name] = {}
        }

        // Use the path parts to set the nested property
        let current = constraints[name]
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i]
          if (!current[part]) {
            current[part] = {}
          }
          current = current[part]
        }

        // Set the final value
        const finalKey = pathParts[pathParts.length - 1]
        current[finalKey] = entity[key]
      }
    }

    return constraints
  }
}

async function checkConstraints(req) {
  if (this.tx.assert_constraints) {
    for (const check of this.tx.assert_constraints) {
      const { validationQuery, constraints } = check
      const result = await this.run(validationQuery)
      if(!result) continue
      for (const name in constraints) {
        const constraintFulfilled = result[name]
        if (!constraintFulfilled) {
          const { message } = constraints[name]
          // await this.rollback()
          req.error(400, message || `Constraint ${name} failed`)
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
