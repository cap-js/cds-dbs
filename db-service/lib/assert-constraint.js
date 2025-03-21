'use strict'

const cds = require('@sap/cds')

function attachConstraints(_results, req) {
  if (!req.target || !this.model || req.target._unresolved) return
  const constraints = collectConstraints(req.target) // collect constraints from annotations
  if (Object.keys(constraints).length === 0) return

  // which entry shall be checked? We need the IDs / condition of the current req
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
  const validationQuery = _getValidationQuery(req, constraints)
  for (const where of whereClauses) {
    if (validationQuery.SELECT.where.length > 0) validationQuery.SELECT.where.push('or', ...where)
    else validationQuery.SELECT.where.push(...where)
  }

  if (this.tx.assert_constraints) this.tx.assert_constraints.push({ validationQuery, constraints })
  else this.tx.assert_constraints = [{ validationQuery, constraints }]
  return
  function _getValidationQuery(req, constraints) {
    const validationQuery = SELECT.from(req.target)
    // each column represents a constraint
    const columns = Object.keys(constraints).flatMap(name => {
      const constraint = constraints[name]
      const { condition, element, parameters } = constraint
      const xpr = []
      // if the element is nullable, we prepend xpr with `<element> IS NULL OR …`
      if (!element.notNull && !element.on) {
        // if(element.on) // --> REVISIT: HANA doesnt like this, what can we do to ensure nullability?
        //   xpr.unshift({ ...coalesce(condition.xpr) }, 'or')
        // else
        xpr.unshift({ ref: [element.name] }, 'is', 'null', 'or')
      }
      xpr.push({ xpr: condition.xpr })
      const colsForConstraint = [{
        xpr: wrapInCaseWhen(xpr),
        // avoid naming ambiguities for anonymous constraints,
        // where the element itself is part of the msg params
        as: name + '_constraint',
        cast: {
          type: 'cds.Boolean',
        },
      }]
      if(parameters) {
        if(parameters.list)
          parameters.list.forEach(p => colsForConstraint.push(p))
        else if (parameters.ref)
          colsForConstraint.push(parameters.ref)
        else if (parameters.length)
          parameters.forEach(p => colsForConstraint.push({ref: [p['=']]}))
      }
      return colsForConstraint
    })

    validationQuery.SELECT.columns = columns
    validationQuery.SELECT.where = []
    return validationQuery
  }

  function collectConstraints(entity) {
    let constraints = {}
    for (const elementKey in entity.elements) {
      const element = entity.elements[elementKey]
      // Extract constraints from the current element
      const elementConstraints = extractConstraintsFromElement(element)
      constraints = { ...constraints, ...elementConstraints }
    }
    return constraints

    function extractConstraintsFromElement(element) {
      const elmConstraints = {}

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
            constraintName = element.name
            if (remainder.length === 0) {
              // no xpr => no constraint
              if (!element['@assert.constraint'].xpr) continue

              // shorthand has no condition prop, e.g. `@assert.constraint: ( children.name in ( … ) )`
              propertyName = 'condition'
            } else propertyName = parts[0]
          } else {
            // First part is the constraint name; the rest is the property name
            constraintName = parts[0]
            propertyName = parts.slice(1).join('.')
          }

          if (!elmConstraints[constraintName]) {
            elmConstraints[constraintName] = {}
          }
          elmConstraints[constraintName][propertyName] = element[key]
        }
      }
      Object.keys(elmConstraints).forEach(name => {
        elmConstraints[name].element = element
      })
      return elmConstraints
    }
  }

  function wrapInCaseWhen(xpr) {
    return ['case', 'when', { xpr }, 'then', { val: true }, 'else', { val: false }, 'end']
  }
  function coalesce(xpr) {
    return { func: 'coalesce', args: [{ xpr }, { val: true }] }
  }
}

async function checkConstraints(req) {
  if (this.tx.assert_constraints) {
    for (const check of this.tx.assert_constraints) {
      const { validationQuery, constraints } = check
      const result = await this.run(validationQuery)
      if (!result) continue
      for (const key in constraints) {
        const constraintCol = key + '_constraint'
        for (const row of result) {
          if (!row[constraintCol]) {
            const { message, parameters } = constraints[key]
            const msgParams = {}
            if (parameters) {
              Object.keys(row).filter(alias => alias !== constraintCol).forEach(alias => msgParams[alias] = row[alias])
            }
            req.error(400, message ? (cds.i18n.messages.at(message, msgParams) || message) : `@assert.constraint ”${key}” failed`)
          }
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
