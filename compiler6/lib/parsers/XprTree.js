// Create a hierarchical expression tree from an `xpr` array

// See ./CdlGrammar.js for the operator precedences.

// CSN representation of window functions: unfortunately not Option 4 in #7632

'use strict';


const prefixOperators = {     // see <prec=…,prefix> in `expression` of CdlGrammar
  __proto__: null,
  new: 39,                  // special in CDL (only before ref)
  exists: 33,               // special in CDL
  '+': 30,                  // note: binary `.` and `over` have higher precedence!
  '-': 30,
  not: 8,
};

const binaryOperators = {
  __proto__: null,
  '.': 37,                      // nary
  over: 35,                     // TODO: only after ref with arg?
  '*': 24,                      // nary
  '/': 24,
  '+': 22,
  '-': 22,
  '||': 20,
  '=': 10,                      // with ANY/SOME/ALL
  '<>': 10,
  '>': 10,
  '>=': 10,
  '<': 10,
  '<=': 10,
  '!=': 10,
  '==': 10,
  and: 4,
  or: 2,
  // with second token or ternary (in the grammar, these ops have prec=10, but
  // also assoc=none, i.e. could not be used without parens together):
  is: 11,                       // is binary op here, not postfix
  in: 13,
  between: 13,
  like: 13,
  not: 15,                      // specially handled
};

const secondTokens = {
  // the value is the precedence of the first token listed in `binaryOperators`
  __proto__: null,
  any: 10,                      // for `=` etc
  some: 10,
  all: 10,
  not: 11,                      // for `is`
  between: 15,                  // for `not`
  in: 15,
  like: 15,
};

const naryOperators = {
  // all strings on the right must not have a precedence mentioned in secondTokens
  // true must not be used for operator (precedence) with secondTokens
  __proto__: null,
  '.': true,                    // CSN-tree not as left-assoc binary?
  '*': true,
  '/': true,
  '+': true,
  '-': true,
  '||': true,
  and: true,
  or: true,
  between: 'and',
  like: 'escape',
};


class XprTree {
  nodes;                        // array value of CSN property `xpr`/`where`/…
  nodeIdx = 0;
  args;        // corresponding XSN array, with already tree-like sub expressions
  location;    // true → CSN input: direct array, no n-ary

  constructor( nodes, args, location ) {
    this.nodes = nodes;
    this.args = args;
    this.location = location;
  }

  splitClauses() {
    const { length } = this.args;
    if (length < 3)
      return this.args;
    const args = [];
    let idx = 0;
    while (idx < length) {
      if (this.isToken( idx + 1, 'by' ) &&
          this.isToken( idx, 'partition' ) || this.isToken( idx, 'order' )) {
        this.pushSection( args, idx );
        args.push( this.args[idx++] );
        args.push( this.args[idx++] );
        this.nodeIdx = idx;
      }
      else if (this.isToken( idx, 'rows' )) {
        this.pushSection( args, idx );
        args.push( this.args[idx++] );
        this.nodeIdx = idx;
      }
      else {
        ++idx;
      }
    }
    if (!args.length)
      return this.args;
    this.pushSection( args, idx );
    return args;
  }

  isToken( idx, keyword ) {
    const tok = this.args[idx];
    return tok && (this.location === true)
      ? keyword === tok
      : keyword === tok?.val && tok.literal === 'token';
  }

  pushSection( args, idx ) {
    if (idx > this.nodeIdx) {
      args.push( (idx > this.nodeIdx + 1)
        ? this.create( this.args.slice( this.nodeIdx, idx ) )
        : this.args[this.nodeIdx] );
      this.nodeIdx = idx;
    }
  }

  tree() {
    const args = [];
    const { length } = this.args;
    while (this.nodeIdx < length) {
      const expr = this.expression( -1 );
      if (expr)
        args.push( expr );
    }
    if (args.length === 1) {
      // For CSN, keep xpr arrays as arrays
      return (this.location === true) ? args : args[0];
    }
    return this.create( args );
  }

  expression( parentPrec ) {
    // console.log('B:',this.nodeIdx,parentPrec)
    let append;
    let naryOp;
    let args;

    // Term = ref/val or unary operator with expression as operand
    let expr = this.args[this.nodeIdx];
    if (!expr)
      return expr;
    let node = this.nodes[this.nodeIdx++];
    if (typeof node === 'string') {
      const prec = prefixOperators[node]; // <prec=…,prefix> in CdlGrammar
      if (prec) {
        const right = this.expression( prec - 1 );
        if (!right)
          return expr;
        expr = this.create( [ expr, right ] );
      }
      else if (node === 'case') {
        expr = this.caseWhen( [ expr ] );
      }
      else {             // unknown token (keyword in CDL):
        return expr;            // …from fns with irregular syntax?
        // also handles `null` as right side of `is` in `is null`
        // TODO: `(` from CSN v0.x ?
        // It is important not to handle binary ops after this, because otherwise
        // we would not properly parse functions with irregular syntax
      }
    }

    node = this.nodes[this.nodeIdx];
    while (typeof node === 'string') {
      const prec = binaryOperators[node]; // <prec=…> in CdlGrammar
      if (!prec || parentPrec >= prec)
        return expr;

      // handle n-ary extensions of binary operators
      if (node === append && this.location !== true) { // not for CSN input
        args.push( this.args[this.nodeIdx++] );
      }
      else {
        naryOp = naryOperators[node];
        append = naryOp === true && node;
        args = [ expr, this.args[this.nodeIdx++] ];
        expr = this.create( args, naryOp === true );
      }

      // handle second token of operator (there must be none for naryOp=true):
      const second = this.nodes[this.nodeIdx];
      if (typeof second === 'string' && secondTokens[second] === prec) {
        args.push( this.args[this.nodeIdx++] );
        if (node === 'not')
          naryOp = naryOperators[second];
      }

      // the right side
      const right = this.expression( prec );
      if (!right)                   // incomplete
        return expr;
      args.push( right );
      node = this.nodes[this.nodeIdx];
      if (node === naryOp && typeof node === 'string')
        node = this.pushTokenAndExpression( args, prec );
    }
    // console.log('E:',this.nodeIdx)
    return expr;
  }

  caseWhen( args ) {
    const expr = this.create( args );
    let node = this.nodes[this.nodeIdx];
    if (node !== 'when') {
      const value = this.expression( -1 );
      if (value)
        args.push( value );
      node = this.nodes[this.nodeIdx];
    }
    while (node === 'when') {
      node = this.pushTokenAndExpression( args );
      if (node === 'then')
        node = this.pushTokenAndExpression( args );
    }
    if (node === 'else')
      node = this.pushTokenAndExpression( args );
    if (node === 'end')
      args.push( this.args[this.nodeIdx++] );
    return expr;
  }

  pushTokenAndExpression( args, prec = -1 ) {
    args.push( this.args[this.nodeIdx++] );
    const value = this.expression( prec );
    if (value)
      args.push( value );
    return this.nodes[this.nodeIdx];
  }

  create( args, isNary = false ) {
    if (this.location === true) // for CSN
      return args;
    return {
      op: { val: (isNary ? 'nary' : 'ixpr'), location: this.location },
      location: this.location,
      args,
    };
  }
}

function xprAsTree( nodes, args, location ) {
  return (new XprTree( nodes, args, location )).tree();
}

function splitClauses( tree, isCsn ) {
  return (new XprTree( null, tree, !!isCsn || tree.location )).splitClauses();
}

module.exports = {
  xsnAsTree: xprAsTree,
  csnAsTree: nodes => xprAsTree( nodes, nodes, true ),
  splitClauses,
};
