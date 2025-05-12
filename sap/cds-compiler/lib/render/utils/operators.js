'use strict';

// Utilities to transform operators in expressions for SQL rendering.

const operatorsPerDialect = {
  __proto__: null,
  plain: {
    __proto__: null,
    '==': function equals(xpr) {
      const lhs = xpr[0];
      const rhs = xpr[2];
      xpr.length = 0;
      if (lhs?.val === null) // shorthand
        xpr.push(rhs, 'is', 'null');
      else if (rhs?.val === null)
        xpr.push(lhs, 'is', 'null');
      else
        xpr.push(lhs, 'is', 'not', 'distinct', 'from', rhs);
    },
    '!=': function unequal(xpr) {
      const lhs = xpr[0];
      const rhs = xpr[2];
      xpr.length = 0;
      if (lhs?.val === null) // shorthand
        xpr.push(rhs, 'is', 'not', 'null');
      else if (rhs?.val === null)
        xpr.push(lhs, 'is', 'not', 'null');
      else
        xpr.push(lhs, 'is', 'distinct', 'from', rhs);
    },
  },
  hana: {
    __proto__: null,
    '==': function equals(xpr) {
      const lhs = xpr[0];
      const rhs = xpr[2];
      xpr.length = 0;
      if (lhs?.val === null) { // shorthand
        xpr.push(rhs, 'is', 'null');
      }
      else if (rhs?.val === null) {
        xpr.push(lhs, 'is', 'null');
      }
      else {
        // (a IS NOT NULL AND b IS NOT NULL AND a = b) OR (a IS NULL AND b IS NULL)
        xpr.push({
          xpr: [
            {
              xpr: [ [ lhs, 'is', 'not', 'null' ], 'and', [ rhs, 'is', 'not', 'null' ], 'and', [ lhs, '=', rhs ] ],
            },
            'or',
            {
              xpr: [ [ lhs, 'is', 'null' ], 'and', [ rhs, 'is', 'null' ] ],
            },
          ],
        });
      }
    },
    '!=': function unequal(xpr) {
      const lhs = xpr[0];
      const rhs = xpr[2];
      xpr.length = 0;

      if (lhs?.val === null) { // shorthand
        xpr.push(rhs, 'is', 'not', 'null');
      }
      else if (rhs?.val === null) {
        xpr.push(lhs, 'is', 'not', 'null');
      }
      else {
        // `(a IS NULL OR b IS NULL OR a <> b) AND (a IS NOT NULL OR b IS NOT NULL)`
        xpr.push({
          xpr: [
            {
              xpr: [ [ lhs, 'is', 'null' ], 'or', [ rhs, 'is', 'null' ], 'or', [ lhs, '<>', rhs ] ],
            },
            'and',
            {
              xpr: [ [ lhs, 'is', 'not', 'null' ], 'or', [ rhs, 'is', 'not', 'null' ] ],
            },
          ],
        });
      }
    },
  },
  sqlite: {
    __proto__: null,
    '==': function equals(xpr) {
      const rhs = xpr[2];
      xpr.length = 1;
      xpr.push('is', rhs);
    },
    '!=': function unequal(xpr) {
      const rhs = xpr[2];
      xpr.length = 1;
      xpr.push('is', 'not', rhs);
    },
  },
};

operatorsPerDialect.postgres = operatorsPerDialect.plain;
operatorsPerDialect.h2 = operatorsPerDialect.plain;

/**
 * Transform non-SQL operators to ones known by SQL.  This includes `==` and `!=`.
 * Expects structurized CSN! See xprAsTree.js
 *
 * @param {object[]|object} xpr
 * @param {SqlOptions} options
 * @param {object} messageFunctions
 * @param {object} env
 * @returns {object[]}
 */
function transformExprOperators( xpr, options, messageFunctions, env ) {
  // TODO: Reduce number of function arguments
  const sqlDialect = options.sqlDialect || 'plain';
  const operators = Object.assign(Object.create(null), operatorsPerDialect[sqlDialect] || operatorsPerDialect.plain);

  if (options.booleanEquality === false) {
    // don't translate `!=` if the option is set to false (for backward compatibility with v5)
    delete operators['!='];
  }

  transformBinary(xpr);
  return xpr;

  function transformBinary( x ) {
    if (!x || typeof x !== 'object')
      return;

    if (Array.isArray(x)) {
      const op = x[1];
      if (x.length === 3 && op in operators) {
        transformBinary(x[0]); // left-hand-side
        transformBinary(x[2]); // right-hand-side
        operators[op](x);
      }
      else {
        x.forEach(transformBinary);
      }

      if (x.length > 3 && op in operators) {
        const keyword = typeof x[2] === 'string' && x[2].toLowerCase();
        // e.g. `ref != SOME (SELECT num from Base)`
        // Since semantics are unclear, reject it.
        if (keyword === 'all' || keyword === 'some' || keyword === 'any') {
          messageFunctions.error('expr-unsupported-equality', env.path, { op, keyword },
                                 'Operator $(OP) can\'t be used in combination with $(KEYWORD)');
        }
      }
    }
    else if (x.xpr) {
      transformBinary(x.xpr);
    }
  }
}

module.exports = {
  transformExprOperators,
};
