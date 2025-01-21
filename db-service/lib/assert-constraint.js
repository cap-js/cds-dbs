const cds = require('@sap/cds')

// returns all properties which start with '@assert.constraint#…' from the given entity
// everything after the qualifier '#' and up to the first dot is considered as constraint name
// everything after the dot e.g. '…#foo.value' should result in:
// constraints = { foo: { value: … } }
function getConstraints(entity) {
  const constraints = {};

  for (const key in entity) {
      if (key.startsWith('@assert.constraint#')) {
          // Extract the part after '#'
          const constraintPart = key.split('#')[1];

          // Extract the constraint name and path
          const [name, ...pathParts] = constraintPart.split('.');

          // Initialize the constraint object if not already present
          if (!constraints[name]) {
              constraints[name] = {};
          }

          // Use the path parts to set the nested property
          let current = constraints[name];
          for (let i = 0; i < pathParts.length - 1; i++) {
              const part = pathParts[i];
              if (!current[part]) {
                  current[part] = {};
              }
              current = current[part];
          }

          // Set the final value
          const finalKey = pathParts[pathParts.length - 1];
          current[finalKey] = entity[key];
      }
  }

  return constraints;
}

module.exports = async function assert_constraint(results, req) {
  if (!req.target || !this.model || req.target._unresolved) return
  
  let where
  if (req.event === 'UPDATE' || req.event === 'UPSERT') {
    const prop = req.event
    if(req.query[prop].where) {
      where = req.query[prop].where
    } else if (req.query[prop].entity.ref[0].where) {
      where = req.query[prop].entity.ref[0].where
    }
  }

  const constraints = getConstraints(req.target)
  // if constraints is an empty object return next()
  if (Object.keys(constraints).length === 0) return
  // now we send a select query with a columns clause that contains all the constraints
  const validation = SELECT.from(req.target)
  const columns = Object.keys(constraints).map(name => {
      const constraint = constraints[name];
      const { condition: { xpr } } = constraint
      return {
        xpr,
        as: name,
        cast: {
          type: 'cds.Boolean'
        }
      }
  })
  validation.SELECT.columns = columns
  validation.where = where
  validation.SELECT.one = true
  const validationResult = await validation

  for (const name in constraints) {
    const result = validationResult[name]
    if (!result) {
      const { message } = constraints[name]
      req.reject(400, message || `Constraint ${name} failed`)
      await this.rollback()
    }
  }
  return
}
