'use strict'

const cds = require('@sap/cds')

function attachConstraints(_results, req) {
  if (!req.target || !this.model || req.target._unresolved) return
  const { data } = req
  if (Array.isArray(data[0])) return // REVISIT: what about csv inserts?
  const constraintsPerTarget = {}
  for (const [cName, c] of Object.entries(collectConstraints(req.target, req.data))) {
    if (c.target.name in constraintsPerTarget) {
      constraintsPerTarget[c.target.name][cName] = c
    } else {
      constraintsPerTarget[c.target.name] = { [cName]: c }
    }
  }
  if (Object.keys(constraintsPerTarget).length === 0) return

  // for UPDATE/UPSERT there is probably an additional where clause
  let where = []
  if (req.event === 'UPDATE' || req.event === 'UPSERT') {
    const prop = req.event
    if (req.query[prop]?.where) {
      where = req.query[prop].where
    } else if (req.query[prop]?.entity?.ref[0]?.where) {
      where = req.query[prop].entity.ref[0].where
    }
  }

  const validationQueries = []
  for (const [targetName, constraints] of Object.entries(constraintsPerTarget)) {
    const validationQuery = _getValidationQuery(targetName, constraints)
    if (where.length > 0) {
      if (validationQuery.SELECT.where.length > 0) validationQuery.SELECT.where.push('or', { xpr: where })
      else validationQuery.SELECT.where.push(...where)
    }
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
    validationQuery.SELECT.where = keyMatchingConditions.flatMap((matchKey, i) =>
      i > 0 ? ['or', ...matchKey] : matchKey,
    )
    Object.defineProperty(validationQuery, '$constraints', { value: constraints })
    return validationQuery
  }

/**
 * Collects constraints for a request target and its elements.
 * 
 *
 * @param {CSN.entity} entity the target of the request (or a recursive child)
 * @param {object} data the payload
 * @returns {object} constraints
 */
function collectConstraints(entity, data) {
  // Collect constraints defined on the entity itself.
  let constraints = { ...getConstraintsFrom(entity) };

  // Merge constraints from each element of the entity.
  for (const element of Object.values(entity.elements)) {
    const elementConstraints = getConstraintsFrom(element, entity);
    Object.assign(constraints, elementConstraints);
  }

  // attach IDs derived from the payload.
  const matchKeyConditions = matchKeys(entity, data);
  for (const constraint of Object.values(constraints)) {
    if (constraint.matchKeys) {
      constraint.matchKeys.push(...matchKeyConditions);
    } else {
      // copying the array to avoid potential mutation issues.
      constraint.matchKeys = [...matchKeyConditions];
    }
  }

  // process compositions defined in the entity, if they are part of the payload.
  const compositions = entity.compositions || {};
  for (const compKey of Object.keys(compositions)) {
    if (data[compKey]) {
      const composition = compositions[compKey];
      const compositionTarget = cds.model.definitions[composition.target];
      const childrenData = data[compKey];

      // Process array children separately.
      if (Array.isArray(childrenData)) {
        for (const childData of childrenData) {
          const childConstraints = collectConstraints(compositionTarget, childData);
          mergeConstraints(constraints, childConstraints);
        }
      } else {
        const childConstraints = collectConstraints(compositionTarget, childrenData);
        mergeConstraints(constraints, childConstraints);
      }
    }
  }
  return constraints;

  function mergeConstraints(baseConstraints, newConstraints) {
    if (!newConstraints) return baseConstraints;
    for (const key in newConstraints) {
      const newConstraint = newConstraints[key];
      // if the same element has constrains already, merge the match keys.
      if (baseConstraints[key]?.element === newConstraint.element) {
        baseConstraints[key].matchKeys.push(...newConstraint.matchKeys);
      } else {
        baseConstraints[key] = newConstraint;
      }
    }
    return baseConstraints;
  }

  // Retrieve constraints from an entity or element.
  function getConstraintsFrom(obj, target = null) {
    const elmConstraints = {};

    for (const key in obj) {
      if (key.startsWith('@assert.constraint')) {
        // Remove the fixed prefix.
        let remainder = key.slice('@assert.constraint'.length);
        // Remove a leading dot, if any.
        if (remainder.startsWith('.')) {
          remainder = remainder.slice(1);
        }

        // Split into constraint name and property parts.
        const parts = remainder.split('.');
        let constraintName, propertyName;
        if (parts.length === 1) {
          // No explicit name: use the object's name as the constraint name.
          constraintName = obj.name;
          if (!remainder.length) {
            // When no extra information is given, check if an 'xpr' exists.
            if (!obj['@assert.constraint'].xpr) continue;
            // Otherwise, use the shorthand property 'condition'.
            propertyName = 'condition';
          } else {
            propertyName = parts[0];
          }
        } else {
          // First part is the constraint name; the rest form the property name.
          constraintName = parts[0];
          propertyName = parts.slice(1).join('.');
        }

        // Create or extend the constraint entry.
        if (!elmConstraints[constraintName]) {
          elmConstraints[constraintName] = {};
        }
        elmConstraints[constraintName][propertyName] = obj[key];
      }
    }

    // Attach additional metadata to each constraint.
    Object.keys(elmConstraints).forEach(name => {
      elmConstraints[name].element = obj;
      // The constraint target defaults to the current object unless overridden.
      elmConstraints[name].target = target || obj;
    });
    return elmConstraints;
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
        primaryKeys.reduce((identifier, key, i) => {
          const value = entry?.[key]
          if (identifier.length > 0) identifier.push('and')
          else if (value !== undefined) identifier.push({ ref: [key] }, '=', { val: value })
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
      for (const q of validationQueries) {
        const constraints = q.$constraints
        const result = await this.run(q)
        if (!result?.length) continue
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
