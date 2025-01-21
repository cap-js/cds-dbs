const cds = require('@sap/cds')

// returns all properties which start with '@assert.constraint#…' from the given entity
// everything after the qualifier '#' and up to the first dot is considered as constraint name
// everything after the dot e.g. '…#foo.value' should result in:
// constraints = { foo: { value: … } }
function getConstraints(entity) {
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

module.exports = async function assert_constraint(results, req) {
  if (!req.target || !this.model || req.target._unresolved) return
  const constraints = getConstraints(req.target)
  if (Object.keys(constraints).length === 0) return

  let whereClauses = [];

if (req.event === 'INSERT' || req.event === 'CREATE') {
  const primaryKeys = Object.keys(req.target.keys);
  const dataEntries = Array.isArray(req.data) ? req.data : [req.data]; // Ensure batch handling
  
  // Construct where clauses for each data entry
  whereClauses = dataEntries.map(entry =>
    primaryKeys.reduce((where, key) => {
      const propertyValue = entry[key];
      if (propertyValue === undefined) {
        // Skip keys with undefined values, e.g. csv import
        return where;
      }
      if (where.length) where.push('and');
      where.push({ ref: [key] }, '=', { val: propertyValue });
      return where;
    }, [])
  );

} else if (req.event === 'UPDATE' || req.event === 'UPSERT') {
  const prop = req.event;
  
  if (req.query[prop]?.where) {
    whereClauses.push(req.query[prop].where);
  } else if (req.query[prop]?.entity?.ref[0]?.where) {
    whereClauses.push(req.query[prop].entity.ref[0].where);
  }
}

// REVISIT: Ensure whereClauses is defined for other cases
if (!whereClauses.length) {
  // Handle scenarios where no `where` clause is defined
  // E.g., aggregation assertions
  return;
}

// Process each where clause
await Promise.all(
  whereClauses.map(async where => {
    await validateConstraints.call(this, req, constraints, where);
  })
);

return;
}
async function validateConstraints(req, constraints, where) {
  const validation = SELECT.from(req.target).where(...where)
  const columns = Object.keys(constraints).map(name => {
    const constraint = constraints[name]
    const {
      condition: { xpr },
    } = constraint
    return {
      xpr,
      as: name,
      cast: {
        type: 'cds.Boolean',
      },
    }
  })
  let foo = SELECT.from(req.target).where('ID = 43')
  foo.SELECT.columns = ['*', ...columns]
  const bar = await foo
  validation.SELECT.columns = columns
  // validation.SELECT.where = where
  validation.SELECT.one = true
  const validationResult = await validation

  for (const name in constraints) {
    const result = validationResult[name]
    if (!result) {
      const { message } = constraints[name]
      await this.rollback()
      req.reject(400, message || `Constraint ${name} failed`)
    }
  }
}
