// @ts-nocheck

'use strict'

/**
 * parseExpr() accepts any JSON object and tries to convert a token stream expression
 * array into an AST like expression with CDL operator precedence.
 *
 * The following operators are supported:
 *
 * Unary:                      +/-
 * Multiplication/Division:    '*', '/'
 * Addition/Subtraction:       '+', '-'
 * Concatenation:              '||'
 * Relational:                 '=', '<>', '>', '>=', '<', '<=', '==', '!=', 'like', 'in', 'exists', 'between and'
 * Unary:                      'is [not] null', 'not'
 * Conditional:                'case [when then]+ [else]? end', 'and', 'or'
 *
 * stand-alone token:          'new'
 *
 * This is not an optimized LL(1) parser but a token 'sniffer'. A stream is
 * cracked up in sub streams and passed down to the next higher function.
 *
 * Complex aggregates like case/when/else/end and between are parsed first to pass down the
 * resulting sub expressions and avoiding 'and' ambiguities.
 *
 * Sub expressions are grouped as arrays, the final AST is an array of nested arrays.
 * Alternatively, an object like AST can be produced by setting argument 'array' to false.
 *
 * This parser intentionally does no error handling. If a clause is malformed, it is accepted as is.
 *
 * @param {any} xpr A JSON object.
 * @param {Object} state Object
 *  anno: Don't eliminate arrays with single entry in expressions (TODO?) as they are collections
 *  array: Bias AST representation.
 *  nary: return n-ary or binary tree
 */

function parseExpr(xpr, state = { array: true, nary: false }) {
  state.anno = 0;
  // Notes:
  //  - Variables `s` and `e` are used as index variables into `xpr`s for start and end.
  //  - xpr's are our CSN expressions, see <https://cap.cloud.sap/docs/cds/cxn>

  return parseExprInt(xpr, state);

  function parseExprInt(xpr, state) {
    return conditionOR(...CaseWhen(Cast(xpr, state)), state);
  }

  function Cast(xpr, state) {
    if(xpr != null && !state.array) {
      if(Array.isArray(xpr))
        return xpr.map(x => Cast(x, state));
      if(typeof xpr === 'object') {
        const castKeys = Object.keys(xpr).filter(k => k !== 'cast');
        if(xpr.cast != null && castKeys.length === 1) {
          return { 'cast': [ xpr.cast, { [castKeys[0]]: xpr[castKeys[0]] } ] };
        }
        else {
          for(const n in xpr) {
            // xpr could be an array with polluted prototype
            if (Object.hasOwnProperty.call(xpr, n))
              xpr[n] = Cast(xpr[n], state)
          }
        }
      }
    }
    return xpr;
  }

  function CaseWhen(xpr) {
    if(Array.isArray(xpr)) {
      recurseIntoCases();
    }
    return [xpr, 0, Array.isArray(xpr) ? xpr.length : 1];

    function recurseIntoCases(casePos=-1, lvl=-1) {
      for(let c = casePos+1; c < xpr.length; c++) {
        if(xpr[c] === 'case') {
          recurseIntoCases(c, lvl+1)
        }
      }
      if(lvl > -1) {
        let endPos = casePos;
        while(xpr[endPos] !== 'end' && endPos < xpr.length) endPos++;
        if(xpr[endPos] === 'end') {
          const caseTree = rewriteCaseBlock(casePos, endPos);
          if(casePos === 0 && endPos === xpr.length-1)
            xpr = caseTree;
          else
            xpr.splice(casePos, endPos-casePos+1, caseTree);
        }
      }
    }

    /**
     * @param {number} casePos
     * @param {number} endPos
     * @return {Array|object}
     */
    function rewriteCaseBlock(casePos, endPos) {
      const caseTree = state.array ? [ 'case' ] : { 'case': [] };

      let elsePos = endPos;
      let whenPos = casePos;

      while(xpr[elsePos] !== 'else' && elsePos > casePos) elsePos--;
      let elseCond = undefined;
      if(xpr[elsePos] === 'else') {
        elseCond = xpr.slice(elsePos+1, endPos);
        endPos = elsePos;
      }

      while(xpr[whenPos] !== 'when' && whenPos < endPos) whenPos++;
      if(xpr[whenPos] === 'when' && whenPos - (casePos+1) >= 1) {
        const caseExpr = xpr.slice(casePos+1, whenPos)
        if(state.array)
          caseTree.push(caseExpr);
        else
          caseTree.case.push(caseExpr.length === 1 ? caseExpr[0] : caseExpr);
      }

      while(xpr[whenPos] === 'when') {
        const when = { 'when': [] };
        if(state.array)
          caseTree.push('when');
        else
          caseTree.case.push(when);

        let thenPos = whenPos+1;
        while(xpr[thenPos] !== 'then' && thenPos < endPos) thenPos++;
        if(xpr[thenPos] === 'then') {
          const whenExpr = xpr.slice(whenPos+1, thenPos);
          if(state.array)
            caseTree.push(whenExpr);
          else
            when.when.push(whenExpr.length === 1 ? whenExpr[0] : whenExpr);
        }

        whenPos = thenPos+1;
        while(xpr[whenPos] !== 'when' && whenPos < endPos) whenPos++;
        if(xpr[whenPos] === 'when' || whenPos === endPos) {
          const then = xpr.slice(thenPos+1, whenPos);
          if(state.array)
            caseTree.push('then', then);
          else
            when.when.push(then.length === 1 ? then[0] : then);
        }
      }
      if(elseCond) {
        if(state.array)
          caseTree.push('else', elseCond);
        else
            caseTree.case.push(elseCond.length === 1 ? elseCond[0] : elseCond);
      }
      if(state.array)
        caseTree.push('end');
      return caseTree;
    }
  }

  function conditionOR(xpr, s, e, state) {
    return binaryExpr(xpr, ['or'], conditionAnd, s, e, state);
  }

  function conditionAnd(xpr, s, e, state) {
    return binaryExpr(xpr, (xpr, s, e) => {
      let a = s-1;
      let b;
      do {
        b = false;
        for(a++; xpr[a] !== 'and' && a < e; a++) {
          if(xpr[a] === 'between')
            b = true;
        }
      } while(b && a < e)

      if(!b && a < e)
        return [1, a]
      else
        return [1, -1];
    }, conditionTerm, s, e, state);
  }

  function conditionTerm(xpr, s, e, state) {
    if(Array.isArray(xpr)) {
      if(xpr.length >= 3 && xpr[s+1] === 'is') {
        const isnull = conditionOR(xpr[s], 0, 0, state);
        if(xpr[s+2] === 'null')
          return state.array ? [ isnull, 'is', 'null' ] :  { 'isNull': isnull };
        else if(xpr[s+2] === 'not' && xpr[s+3] === 'null')
          return state.array ? [ isnull, 'is', 'not', 'null' ] : { 'isNotNull': isnull };
      }
      if(xpr[s] === 'not') {
        const  not = conditionTerm(xpr, s+1, e, state)
        return state.array ? [ 'not',  not ] : { 'not':  not };
      }
      if(xpr[s] === 'exists') {
        const exists = conditionTerm(xpr, s+1, e, state)
        return state.array ? [ 'exists', exists ] : { 'exists': exists };
      }
    }
    return compareTerm(xpr, s, e, state);
  }

  function compareTerm(xpr, s, e, state) {
    if(Array.isArray(xpr)) {
      let i = s;
      let not = false;
      let between;
      while(i < e && xpr[i] !== 'between') i++;
      const b = i < e ? i : -1;
      while(i < e && xpr[i] !== 'and') i++;
      const a = i < e ? i : -1;
      if(b >= 0) {
        const token = [ 'between' ];
        not = (xpr[b-1] === 'not');
        if(not)
          token.splice(0,0, 'not');
        const expr = expression(xpr, s, not ? b-1 : b, state);
        between = state.array
          ? [ expr, ...token ]
          : { 'between': [ expr ] };
        if(a >= 0) {
          const lower = expression(xpr, b+1, a, state);
          const upper = expression(xpr, a+1, e, state);
          if(state.array)
            between.push(lower, 'and', upper);
          else {
            between.between.push(lower, upper);
          }
        }
        else {
          const unspec = expression(xpr, b+1, e, state);
          if(state.array)
            between.push(unspec);
          else
            between.between.push(unspec);
        }
        if(not && !state.array) {
          between = { 'not': between }
        }
        return between;
      }
    }
    return binaryExpr(xpr, (xpr, s, e) => {
      const token = ['=', '<>', '>', '>=', '<', '<=', '==', '!=', 'like', 'in'];
      while(s < e && !token.includes(xpr[s])) s++;
      if(s < e) {
        if(xpr[s-1] === 'not' && (xpr[s] === 'in' || xpr[s] === 'like'))
          return [2, s-1];
        else
          return [1, s];
      }
      return [1, -1];
    }, expression, s, e, state);
  }

  function expression(xpr, s, e, state) {
    return binaryExpr(xpr, ['||'], exprAddSub, s, e, state);
  }

  function exprAddSub(xpr, s, e, state) {
    return binaryExpr(xpr, (xpr, s, e) => {
      const skips = [ '+', '-', '*', '/' ];
      let found = false;
      let p=s;
      while(!found && p < e) {
        found = ((xpr[p] === '+' || xpr[p] === '-') && p > s && !skips.includes(xpr[p-1]) && p < e);
        if(!found) p++;
      }
      if(found)
        return [1, p];
      return [1, -1];
    }, exprMulDiv, s, e, state);
  }

  function exprMulDiv(xpr, s, e, state) {
    return binaryExpr(xpr, ['*', '/'], (state.array ? unary : dot), s, e, state);
  }

  function dot(xpr, s, e, state) {
    return binaryExpr(xpr, ['.'], unary, s, e, state);
  }

  function unary(xpr, s, e, state) {
    if(Array.isArray(xpr)) {
      if(xpr[s] === '+' || xpr[s] === '-' || (!state.array && xpr[s] === 'new')) {
        if(state.array)
          return [ xpr[s], unary(xpr, s+1, e, state) ];
        else
          return { [xpr[s]]: unary(xpr, s+1, e, state) };
      }
    }
    return terminal(xpr, s, e, state);
  }
  function terminal(xpr, s, e, state) {
    const csnarray = [
      'ref', 'args', 'columns', 'keys', 'expand', 'inline',
      'requires', 'extensions', 'includes', 'excluding'
    ];
    const xprarray = [
      'xpr', 'on', 'where', 'orderBy', 'groupBy', 'having' ];

    if(Array.isArray(xpr) && xpr.length > 0) {
      if(e-s <= 1 && state.anno === 0  && typeof xpr[e-1] !== 'string')
        return parseExprInt(xpr[e-1], state);
      else
        return xpr.slice(s, e).map(ix => parseExprInt(ix, state));
    }
    if (typeof xpr === 'object') {
      // if(xpr?.func && funkyfuncs.includes(xpr?.func))
      //   return xpr;
      for(const n in xpr) {
        // xpr could be an array with polluted prototype
        if (!Object.hasOwnProperty.call(xpr, n))
          continue;
        const x = xpr[n];
        const isAnno = n[0] === '@' && isSimpleAnnoValue(x);
        if(isAnno)
          state.anno++;
        if(Array.isArray(x)) {
          if(csnarray.includes(n) || state.anno !== 0)
            xpr[n] = x.map(ix => parseExprInt(ix, state));
          else if(xprarray.includes(n) && x.length === 1)
            xpr[n] = x.map(ix => parseExprInt(ix, state));
          else
            xpr[n] = parseExprInt(x, state);
        }
        else
          xpr[n] = parseExprInt(x, state);
        if(isAnno)
          state.anno--;
      }
    }
    return xpr;
  }

  function binaryExpr(xpr, token, next, s, e, state) {
    const naryExpr = [];
    let not = false;
    if (Array.isArray(xpr)) {
      let [tl, p] = findToken(s, e);
      if (p >= 0) {
        let lhs = next(xpr, s, p, state);
        naryExpr.push(lhs);
        let op = xpr.slice(p, p+tl);
        s = p+tl;
        [tl, p] = findToken(s, e);
        while(p >= 0) {
          const rhs = next(xpr, s, p, state);
          naryExpr.push(...op, rhs);
          if(state.array)
            lhs = [ lhs, ...op, rhs ];
          else {
            not = op.length > 1 && op[0] === 'not';
            if(not)
              op = op.slice(1);
            lhs = (not
                ? { 'not': { [op.join('')]: [lhs, rhs] } }
                : { [op.join('')]: [lhs, rhs] });
          }
          op = xpr.slice(p, p+tl);
          s = p+tl;
          [tl, p] = findToken(s, e);
        }

        let rhs = next(xpr, s, e, state);
        if(Array.isArray(rhs) && rhs.length === 0)
          rhs = undefined;
        naryExpr.push(...op, rhs);

        if (state.array)
          return (state.nary ? naryExpr : [ lhs, ...op, rhs ])
        else {
          not = op.length > 1 && op[0] === 'not';
          if(not)
            op = op.slice(1);
          return (not
            ? { 'not': { [op.join('')]: [ lhs, rhs ] } }
            : { [op.join('')]: [ lhs, rhs ] });

        }
      }
    }
    return next(xpr, s, e, state);

    function findToken(s, e) {
      if(typeof token === 'function')
        return token(xpr, s, e);
      else {
        while(s < e && !token.includes(xpr[s])) s++;
        if(s < e)
          return [1, s];
      }
      return [1, -1];
    }
  }

}

function isSimpleAnnoValue(val) {
  // Expressions as annotation values always have a `=` and another property.
  // TODO: There must be at least one known expression property, otherwise
  //       it could be `type: 'unchecked'`.
  return !val?.['='] || Object.keys(val) < 2;
}

module.exports = {
  parseExpr,
};
