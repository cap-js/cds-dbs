'use strict'

const cds = require('@sap/cds')

function attachConstraints(_results, req) {
  if (!req.target || !this.model || req.target._unresolved) return
  const { data } = req
  if (Array.isArray(data[0])) return // REVISIT: what about csv inserts?
  const constraintsPerTarget = {}
  for(const [cName, c] of Object.entries(collectConstraints(req.target, req.data))) {
    if(c.target.name in constraintsPerTarget) {
      constraintsPerTarget[c.target.name][cName] = c
    }
    else {
      constraintsPerTarget[c.target.name] = { [cName]: c }
    }
  }
  if (Object.keys(constraintsPerTarget).length === 0) return

  // which entry shall be checked? We need the IDs / condition of the current req
  let whereClauses = []
  if (req.event === 'UPDATE' || req.event === 'UPSERT') {
    const prop = req.event

    if (req.query[prop]?.where) {
      whereClauses.push(req.query[prop].where)
    } else if (req.query[prop]?.entity?.ref[0]?.where) {
      whereClauses.push(req.query[prop].entity.ref[0].where)
    }
  }

  const validationQueries = []
  for(const [targetName, constraints] of Object.entries(constraintsPerTarget)) {
    const validationQuery = _getValidationQuery(targetName, constraints)
    validationQueries.push(validationQuery)
  }
  // for (const where of whereClauses) {
  //   if (validationQuery.SELECT.where.length > 0) validationQuery.SELECT.where.push('or', ...where)
  //   else validationQuery.SELECT.where.push(...where)
  // }

  if (this.tx.assert_constraints) this.tx.assert_constraints.push(validationQueries)
  else this.tx.assert_constraints = [validationQueries]
  return
  function _getValidationQuery(target, constraints) {
    const validationQuery = SELECT.from(target)
    // each column represents a constraint
    const columns = Object.keys(constraints).flatMap(name => {
      const constraint = constraints[name]
      const { condition, parameters } = constraint
      const xpr = []
      xpr.push({ xpr: condition.xpr })
      const colsForConstraint = [
        {
          xpr: wrapInCaseWhen(xpr),
          // avoid naming ambiguities for anonymous constraints,
          // where the element itself is part of the msg params
          as: name + '_constraint',
          cast: {
            type: 'cds.Boolean',
          },
        },
      ]
      if (parameters) {
        if (parameters.list) parameters.list.forEach(p => colsForConstraint.push(p))
        else if (parameters.ref) colsForConstraint.push(parameters.ref)
        else if (parameters.length) parameters.forEach(p => colsForConstraint.push({ ref: [p['=']] }))
      }
      return colsForConstraint
    })

    validationQuery.SELECT.columns = columns
    // REVISIT: matchKeys for one entity should be the same for all constraints
    //          it should be more like { 'bookshop.Books' : { c1 : { ... }, c2: { ... } }, …, $matchKeys: [ ... ] }
    const keyMatchingConditions = Object.values(constraints)[0].matchKeys
    validationQuery.SELECT.where = keyMatchingConditions.flatMap((matchKey, i) => i>0 ? ['or', ...matchKey] : matchKey)
    Object.defineProperty(validationQuery, '$constraints', { value: constraints }) 
    return validationQuery
  }

  /**
   * Collects constraints for a request target and
   *
   * @param {CSN.entity} entity the target of the request (or a recursive child)
   * @param {object} data the payload
   * @returns
   */
  function collectConstraints(entity, data) {
    let constraints = getConstraintsFrom(entity)
    for (const elementKey in entity.elements) {
      const element = entity.elements[elementKey]
      // Extract constraints from the current element
      const elementConstraints = getConstraintsFrom(element, entity)
      constraints = { ...constraints, ...elementConstraints }
    }
    // attach IDs derived from the payload
    const matchKeyConditions = matchKeys(entity, data)
    // add the where clause to the constraints
    for (const key in constraints) {
      const constraint = constraints[key]
      if (constraint.matchKeys) {
        // add the where clause to the constraint
        constraint.matchKeys.push(...matchKeyConditions)
      } else {
        constraint.matchKeys = matchKeyConditions
      }
    }
    const compositions = entity.compositions || {}
    for (const k of Object.keys(compositions)) {
      if (k in data) {
        const c = compositions[k]
        const compositionTarget = cds.model.definitions[c.target]
        const childrenData = data[k]
        let childConstraints
        if (!Array.isArray(childrenData)) {
          childConstraints = collectConstraints(compositionTarget, data[k])
        } else {
          for (const childData of childrenData) {
            constraints = mergeConstraints(constraints, collectConstraints(compositionTarget, childData))
          }
        }
        // merge all constraints
        constraints = mergeConstraints(constraints, childConstraints)
      }
    }
    return constraints

    function mergeConstraints(constraints, childConstraints) {
      // merge all constraints
      for (const key in childConstraints) {
        const childConstraint = childConstraints[key]
        if (constraints[key]?.element === childConstraint.element) { // element may be an entity
          // merge the primary key conditions
          constraints[key].matchKeys.push(...childConstraint.matchKeys)
        } else {
          // add the child constraint
          constraints[key] = childConstraint
        }
      }
      return constraints
    }

    function getConstraintsFrom(object, target = null) {
      const elmConstraints = {}

      for (const key in object) {
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
            constraintName = object.name
            if (remainder.length === 0) {
              // no xpr => no constraint
              if (!object['@assert.constraint'].xpr) continue

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
          elmConstraints[constraintName][propertyName] = object[key]
        }
      }
      Object.keys(elmConstraints).forEach(name => {
        elmConstraints[name].element = object
        // the constraint target is always an entity
        // if the constraint has been collected from an entity the `target` is null
        elmConstraints[name].target = target || object
      })
      return elmConstraints
    }
  }

  /**
   * Constructs a condition which matches the primary keys of the entity for the given data.
   *
   * @param {CSN.entity} entity
   * @param {object} data
   * @returns {Array} conditions
   */
  function matchKeys(entity, data) {
    const primaryKeys = Object.keys(entity.keys)
    const dataEntries = Array.isArray(data) ? data : [data] // Ensure batch handling

    // construct {key:value} pairs holding information about the entry to check
    return dataEntries
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
  }

  function wrapInCaseWhen(xpr) {
    return ['case', 'when', 'not', { xpr }, 'then', { val: false }, 'else', { val: true }, 'end']
  }
}

async function checkConstraints(req) {
  if (this.tx.assert_constraints) {
    for (const check of this.tx.assert_constraints) {
      const validationQueries = check
      for(const q of validationQueries) {
        const constraints = q.$constraints
        const result = await this.run(q)
        if (!result) continue
        for (const key in constraints) {
          const constraintCol = key + '_constraint'
          for (const row of result) {
            if (!row[constraintCol]) {
              const { message, parameters } = constraints[key]
              const msgParams = {}
              if (parameters) {
                Object.keys(row)
                  .filter(alias => alias !== constraintCol)
                  .forEach(alias => (msgParams[alias] = row[alias]))
              }
              const constraintValidationMessage = message
                ? cds.i18n.messages.for(message, msgParams) || message
                : `@assert.constraint ”${key}” failed`
              req.error(400, constraintValidationMessage)
            }
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
