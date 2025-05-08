// Create a hierarchical expression tree from an `xpr` array
//
// Replace `xpr` arrays and conditions by precedence-aware tree representations.
// The transformation is deep and destructive.
//
// Queries in expressions are _not_ traversed.
//
// Function/assoc arguments and filter conditions are
//  - traversed with expressionAsTree() and conditionAsTree(),
//  - not traversed with exprAsTree() and condAsTree(), you might need to call
//    splitClauses() to cover `order by` in the last function argument

'use strict';

const { csnAsTree, splitClauses } = require( '../parsers/XprTree' );

function conditionAsTree( args ) {
  args.forEach( expressionAsTree );
  return asTree( args );
}
function condAsTree( args ) {
  args.forEach( exprAsTree );
  return asTree( args );
}

function asTree( args ) {
  return (args.length === 2 && args[0] === 'over' && args[1]?.xpr && !args[1].func)
    ? [ 'over', { xpr: splitClauses( args[1].xpr, true ) } ]
    : csnAsTree( args );
}

function expressionAsTree( expr ) {
  if (!expr || typeof expr !== 'object')
    return expr;
  if (Array.isArray( expr )) {  // hierarchical input
    // expr.forEach( expressionAsTree );  // do it again?
    return expr;
  }
  if (expr.list)                // expression, ref
    expr.list.forEach( expressionAsTree );
  const { args } = expr;
  if (args) {               // expression, ref
    if (!Array.isArray( args )) {
      Object.values( args ).forEach( expressionAsTree );
    }
    else if (args.length) {
      args.forEach( expressionAsTree );
      const last = args.at( -1 );
      if (last?.xpr && last.xpr.length > 4) // order by in last argument
        last.xpr = splitClauses( last.xpr, true );
    }
  }
  if (expr.ref)                 // expression
    expr.ref.forEach( expressionAsTree );

  // conditions: change properties
  if (expr.xpr)                 // expression
    expr.xpr = conditionAsTree( expr.xpr );
  if (expr.where)               // ref or query
    expr.where = conditionAsTree( expr.where );

  return expr;
}
function exprAsTree( expr ) {
  if (!expr || typeof expr !== 'object')
    return expr;
  if (Array.isArray( expr )) {  // hierarchical input
    // expr.forEach( exprAsTree );  // do it again?
    return expr;
  }
  if (expr.list)                // expression, ref
    expr.list.forEach( exprAsTree );
  // conditions: change properties
  if (expr.xpr)                 // expression
    expr.xpr = condAsTree( expr.xpr );
  return expr;
}

module.exports = {
  conditionAsTree,
  condAsTree,
  expressionAsTree,
  exprAsTree,
  splitClauses: nodes => splitClauses( nodes, true ),
};
