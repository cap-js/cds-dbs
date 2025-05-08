// Error strategy with special handling for (non-reserved) keywords

// If a language has non-reserved keywords, any such keyword can be used at
// places where just a identifier is expected.  For doing so, we define a rule
//   ident : Identifier | NONRESERVED_1 | ... NONRESERVED_n ;
//
// Now consider another rule:
//   expected : RESERVED_j | NONRESERVED_k | ident ;
// If parsing fails at this place, you expect to see an message like
//   Mismatched input '?', expecting RESERVED_j, NONRESERVED_k, or Identifier
// With ANTLR's default error strategy, you unfortunately also see all other
// n-1 non-reserved keyword after "expecting"...
//
// The error strategy provided by this file gives you the expected message.
// The example above shows that it is not enough to just remove all
// non-reserved keywords from the expected-set.  The error strategy also allows
// you to match reserved keywords as identifiers at certain places (when there
// are no alternatives).

// For using this error strategy, the grammar for the parser/lexer must have a
// lexer rule `Number`, then rules for unreserved keywords, and finally a rule
// `Identifier`.  No tokens (which are used in parser rules) must be defined
// after that, no other rules must be defined in between those rules.

// This file is actually very ANTLR4 specific and should be checked against
// future versions of the ANTLR4-js runtime.  There is no need to look at this
// file if you just want to understand the rest of this compiler project.

'use strict';

const antlr4 = require('antlr4');
const Antlr4LL1Analyzer = require('antlr4/src/antlr4/LL1Analyzer');
const { DefaultErrorStrategy } = require('antlr4/src/antlr4/error/ErrorStrategy');
const { InputMismatchException } = require('antlr4/src/antlr4/error/Errors');
const {
  predictionContextFromRuleContext: predictionContext,
} = require('antlr4/src/antlr4/PredictionContext');
const { ATNState } = require('antlr4/src/antlr4/atn/ATNState');
const { IntervalSet, Interval } = require('antlr4/src/antlr4/IntervalSet');
const { CompilerAssertion } = require('../base/error');

const keywordRegexp = /^[a-zA-Z]+$/; // we don't have keywords with underscore

let SEMI = null;
let RBRACE = null;

// Class which adapts ANTLR4s standard error strategy: do something special
// with (non-reserved) keywords.
//
// An instance of this class should be set as property `_errHandler` to the
// parser (prototype).
class KeywordErrorStrategy extends DefaultErrorStrategy {
  constructor( ...args ) {
    super( ...args );

    this._super = {
      recoverInline: super.recoverInline,
      getExpectedTokens: super.getExpectedTokens,
    };
  }
}

// TODO: Use actual methods
Object.assign( KeywordErrorStrategy.prototype, {
  sync,
  singleTokenDeletion,
  reportNoViableAlternative,
  reportInputMismatch,
  reportUnwantedToken,
  reportMissingToken,
  reportIgnoredWith,
  // getErrorRecoverySet,
  consumeUntil,
  consumeAndMarkUntil,
  recoverInline,
  getMissingSymbol,
  getExpectedTokensForMessage,
  getTokenDisplay,
});

// Attempt to recover from problems in subrules, except if rule has defined a
// local variable `_sync` with value 'nop'
// TODO: consider performance - see #8800
// See DefaultErrorStrategy#sync
function sync( recognizer ) {
  // If already recovering, don't try to sync
  if (this.inErrorRecoveryMode(recognizer))
    return;

  const token = recognizer.getCurrentToken();
  if (!token)
    return;

  const s = recognizer._interp.atn.states[recognizer.state];
  // try cheaper subset first; might get lucky. seems to shave a wee bit off
  const nextTokens = recognizer.atn.nextTokens(s);
  // console.log('SYNC:', recognizer._ctx._sync, s.stateType, token.text,
  // intervalSetToArray( recognizer, nextTokens ))

  if (nextTokens.contains(token.type)) { // we are sure the token matches
    if (token.text === '}' && recognizer.$nextTokensToken !== token &&
        nextTokens.contains(SEMI)) {
      // if the '}' could be matched alternative to ';', we had an opt ';' (rule requiredSemi)
      recognizer.$nextTokensToken = token;
      recognizer.$nextTokensState = recognizer.state;
      recognizer.$nextTokensContext = recognizer._ctx;
    }
    return;
  }

  if (nextTokens.contains(antlr4.Token.EPSILON)) {
    // when exiting a (innermost) rule, remember the state to make
    // getExpectedTokensForMessage() calculate the full "expected set"
    if (recognizer.$nextTokensToken !== token) {
      // console.log('SET:',token.type,recognizer.state,recognizer.$nextTokensToken &&
      // recognizer.$nextTokensToken.type)
      recognizer.$nextTokensToken = token;
      recognizer.$nextTokensState = recognizer.state;
      recognizer.$nextTokensContext = recognizer._ctx;
    }
    return;
  }

  // Expected token is identifier, current is (reserved) KEYWORD:
  // TODO: do not use this if "close enough" (1 char diff or prefix)
  // to a keyword in nextTokens
  //
  // NOTE: it is important to do this only if EPSILON is not in `nextTokens`,
  // which means that we cannot bring the better special syntax-unexpected-reserved
  // in all cases.  Reason: high performance impact of the alternative,
  // i.e. calling method Parser#isExpectedToken() = invoking the ATN
  // interpreter to see behind EPSILON.
  const identType = recognizer.constructor.Identifier;
  if (keywordRegexp.test( token.text ) && nextTokens.contains( identType )) {
    recognizer.message( 'syntax-unexpected-reserved-word', token,
                        { code: token.text, delimited: token.text } );
    // TODO: attach tokens like for 'syntax-unexpected-token'
    token.type = identType;     // make next ANTLR decision assume identifier
    return;
  }

  if (recognizer._ctx._sync === 'nop')
    return;
  switch (s.stateType) {
    case ATNState.BLOCK_START:  // 3
    case ATNState.STAR_BLOCK_START: // 5
    case ATNState.PLUS_BLOCK_START: // 4
    case ATNState.STAR_LOOP_ENTRY:  // 10
      // report error and recover if possible
      if ( token.text !== '}' &&                          // do not just delete a '}'
          this.singleTokenDeletion(recognizer) !== null) { // also calls reportUnwantedToken
        return;
      }
      else if (recognizer._ctx._sync === 'recover') {
        this.reportInputMismatch( recognizer, new InputMismatchException(recognizer) );
        this.consumeUntil( recognizer, nextTokens );
        return;
      }
      // TODO: at least with STAR_LOOP_ENTRY, we might want to do s/th similar as
      // with LOOP_BACK (syncing to “expected tokens” -> the separator)
      throw new InputMismatchException(recognizer);

    case ATNState.PLUS_LOOP_BACK: // 11
    case ATNState.STAR_LOOP_BACK: { // 9
      // TODO: do not delete a '}', ')', ',', ';'
      this.reportUnwantedToken(recognizer);
      const expecting = new IntervalSet();
      expecting.addSet(recognizer.getExpectedTokens());

      // First try some ',' insertion (TODO does not work yet):
      if (trySeparatorInsertion( recognizer, expecting, "','" ))
        return;

      // We then try syncing only to the loop-cont (`,`) / loop-end (`}`) token set,
      // but only for the current or next line (and not consuming `;`s):
      const prevToken = recognizer.getTokenStream().LT(-1);
      if (token.line <= prevToken.line + 1 && // in same or next line
          this.consumeAndMarkUntil( recognizer, expecting, true ))
        break;
      // console.log(token.text,JSON.stringify(intervalSetToArray(recognizer,expecting)))

      // If that fails, we also sync to all tokens which are in the follow set of
      // the current rule and all outer rules
      const whatFollowsLoopIterationOrRule = expecting.addSet(this.getErrorRecoverySet(recognizer));
      this.consumeUntil(recognizer, whatFollowsLoopIterationOrRule);
      // console.log(JSON.stringify(intervalSetToArray(recognizer,expecting)))
      if (recognizer._ctx._sync === 'recover' || // in start rule: no exception
          nextTokens.contains( recognizer.getTokenStream().LA(1) ))
        return;
      throw new InputMismatchException(recognizer);
    }
    default:
    // do nothing if we can't identify the exact kind of ATN state
  }
}


function trySeparatorInsertion( recognizer, expecting, separatorName ) {
  // Remark: this function does not really work, because it is based on
  // singleTokenInsertion, which also does not really work… (see below).
  // But we might improve it in the future…
  const separator = recognizer.literalNames.indexOf( separatorName );
  if (!expecting.contains( separator ))
    return false;

  const currentSymbolType = recognizer.getTokenStream().LA(1);
  // if current token is consistent with what could come after current
  // ATN state, then we know we're missing a token; error recovery
  // is free to conjure up and insert the missing token
  const { atn } = recognizer._interp;
  const currentState = atn.states[recognizer.state];
  const next = separatorTransition( currentState.transitions, separator ).target;
  // While this is an improvement to the default ANTLR code for
  // singleTokenInsertion(), it still does not help, as we navigate along an
  // epsilon transition, i.e. we still see ',', etc
  const expectingAtLL2 = atn.nextTokens(next, recognizer._ctx);
  if (!expectingAtLL2.contains(currentSymbolType))
    return false;

  this.reportMissingToken(recognizer);
  return getMissingSymbol( recognizer, separator );
}

function separatorTransition( transitions, separator ) {
  for (const tr of transitions) {
    if (tr.matches( separator ))
      return tr;
  }
  return transitions[0];
}

function singleTokenDeletion( recognizer ) {
  const token = recognizer.getCurrentToken();
  if (!token || token.text === '}')
    return null;

  const nextTokenType = recognizer.getTokenStream().LA(2);
  const { Number: num } = recognizer.constructor;
  if (nextTokenType > num && // next token is Id|Unreserved|IllegalToken
      token.type <= num)     // current token is not
    return null;

  const expecting = this.getExpectedTokens(recognizer);
  if (!expecting.contains(nextTokenType))
    return null;

  this.reportUnwantedToken(recognizer);
  recognizer.consume(); // simply delete extra token
  // we want to return the token we're actually matching
  const matchedSymbol = recognizer.getCurrentToken();
  this.reportMatch( recognizer ); // we know current token is correct
  return matchedSymbol;
}


// singleTokenInsertion called by recoverInline (called by match / in else),
// calls reportMissingToken

// Report `NoViableAltException e` signalled by parser `recognizer`
function reportNoViableAlternative( recognizer, e ) {
  // console.log('NOV:',this.getTokenErrorDisplay(e.startToken),
  // this.getTokenErrorDisplay(e.offendingToken))
  if (e.startToken === e.offendingToken) { // mismatch at LA(1)
    this.reportInputMismatch( recognizer, e );
  }
  else {
    this.reportInputMismatch( recognizer, e, !e.deadEndConfigs || e.deadEndConfigs.configs );
    do {
      // console.log('CONSUME-NOVIA:',this.getTokenErrorDisplay(recognizer.getCurrentToken()));
      recognizer.consume();
    } while (recognizer.getCurrentToken() !== e.offendingToken);
    // this.lastErrorIndex = e.startToken.tokenIndex; // avoid another consume()
  }
}

// Report `InputMismatchException e` signalled by parser `recognizer``
function reportInputMismatch( recognizer, e, deadEnds ) {
  const expecting = deadEnds !== true && // true: cannot compute expecting
                  this.getExpectedTokensForMessage( recognizer, e.offendingToken, deadEnds );
  const offending = this.getTokenDisplay( e.offendingToken, recognizer );
  e.offendingToken.$isSkipped = 'offending';
  let err;
  if (expecting && expecting.length) {
    err = recognizer.error( 'syntax-unexpected-token', e.offendingToken,
                            { offending, expecting } );
    err.expectedTokens = expecting;
  }
  else {                        // should not really happen anymore... -> no messageId !
    err = recognizer.error( null, e.offendingToken, { offending },
                            'Mismatched $(OFFENDING)' );
  }
  if (!recognizer.avoidErrorListeners) // with --trace-parser or --trace-parser-ambig
    recognizer.notifyErrorListeners( err.message, e.offendingToken, err );
}

// Report unwanted token when the parser `recognizer` tries to recover/sync
function reportUnwantedToken( recognizer, expecting ) {
  if (this.inErrorRecoveryMode(recognizer))
    return;
  this.beginErrorCondition(recognizer);

  const token = recognizer.getCurrentToken();
  token.$isSkipped = 'offending';
  expecting ??= this.getExpectedTokensForMessage( recognizer, token );
  const offending = this.getTokenDisplay( token, recognizer );
  // Just text variant, no other message id!  Would depend on ANTLR-internals
  const err = recognizer.error( 'syntax-unexpected-token', token,
                                { '#': 'unwanted', offending, expecting } );
  err.expectedTokens = expecting; // TODO: remove next token?
  if (!recognizer.avoidErrorListeners) // with --trace-parser or --trace-parser-ambig
    recognizer.notifyErrorListeners( err.message, token, err );
}

// Report missing token when the parser `recognizer` tries to recover/sync
function reportMissingToken( recognizer ) {
  if ( this.inErrorRecoveryMode(recognizer))
    return;
  this.beginErrorCondition(recognizer);

  const token = recognizer.getCurrentToken();
  token.$isSkipped = 'offending';
  const expecting = this.getExpectedTokensForMessage( recognizer, token );
  const offending = this.getTokenDisplay( token, recognizer );
  // TODO: if non-reserved keyword will not been parsed as keyword, use Identifier for offending
  // Hopefully not too ANTLR-specific, so extra message id is ok:
  const err = recognizer.error( 'syntax-missing-token', token,
                                { offending, expecting },
                                'Missing $(EXPECTING) before $(OFFENDING)' );
  err.expectedTokens = expecting;
  if (!recognizer.avoidErrorListeners) // with --trace-parser or --trace-parser-ambig
    recognizer.notifyErrorListeners( err.message, token, err );
}

function reportIgnoredWith( recognizer, t ) {
  const next = recognizer._interp.atn.states[recognizer.state].transitions[0].target;
  recognizer.state = next.stateNumber; // previous match() does not set the state
  const expecting = this.getExpectedTokensForMessage( recognizer, t );
  const m = recognizer.warning( 'syntax-unexpected-semicolon', t,
                                { offending: "';'", expecting, keyword: 'with' },
    // eslint-disable-next-line @stylistic/js/max-len
                                'Unexpected $(OFFENDING), expecting $(EXPECTING) - ignored previous $(KEYWORD)' );
  m.expectedTokens = expecting;
}

function consumeUntil( recognizer, set ) {
  // TODO: add trace
  if (SEMI == null)
    SEMI = recognizer.literalNames.indexOf( "';'" );
  if (RBRACE == null)
    RBRACE = recognizer.literalNames.indexOf( "'}'" );

  // let s=this.getTokenDisplay( recognizer.getCurrentToken(), recognizer );
  if (SEMI < 1 || RBRACE < 1) {
    this.consumeAndMarkUntil( recognizer, set );
  }
  else if (set.contains(SEMI)) { // do not check for RBRACE here!
    this.consumeAndMarkUntil( recognizer, set );
    // console.log('CONSUMED-ORIG:',s,this.getTokenDisplay( recognizer.getCurrentToken(),
    // recognizer ),recognizer.getCurrentToken().line,intervalSetToArray( recognizer, set ));
  }
  else {
    // DO NOT modify input param `set`, as the set might be cached in the ATN
    const stop = new IntervalSet();
    stop.addSet( set );
    stop.removeOne( recognizer.constructor.Identifier );
    stop.addOne( SEMI );
    // I am not that sure whether to add RBRACE...
    stop.addOne( RBRACE );
    this.consumeAndMarkUntil( recognizer, stop );
    const ttype = recognizer.getTokenStream().LA(1);
    if (ttype === SEMI || ttype === RBRACE && !set.contains(RBRACE)) {
      recognizer.consume();
      this.reportMatch(recognizer); // we know current token is correct
    }
    // if matched '}', also try to match next ';' (also matches double ';')
    if (recognizer.getTokenStream().LA(1) === SEMI) {
      recognizer.consume();
      this.reportMatch(recognizer); // we know current token is correct
    }
    // console.log('CONSUMED:',s,this.getTokenDisplay( recognizer.getCurrentToken(),
    // recognizer ),recognizer.getCurrentToken().line);
    // throw new CompilerAssertion('Sync')
  }
}

function consumeAndMarkUntil( recognizer, set, onlyInSameLine ) {
  const stream = recognizer.getTokenStream();
  let t = stream.LT(1);
  const { line } = t;
  while (t.type !== antlr4.Token.EOF && !set.contains( t.type )) {
    if (onlyInSameLine && (t.line !== line || t.text === ';' || t.text === '}' ))
      return false;              // early exit
    if (!t.$isSkipped)
      t.$isSkipped = true;
    recognizer.consume();
    t = stream.LT(1);
  }
  return true;
}

// As the `match` function of the parser `recognizer` does not allow to check
// against a set of token types, the generated parser code checks against that
// set itself and calls this function if not successful.
// We now also allow keywords if the Identifier is expected.
// Called by match() and in generated parser in "else part" before consume()
// for ( TOKEN1 | TOKEN2 )
function recoverInline( recognizer ) {
  const identType = recognizer.constructor.Identifier;
  if (!identType || !recognizer.isExpectedToken( identType ))
    return this._super.recoverInline.call( this, recognizer );

  const token = recognizer.getCurrentToken();
  // TODO: do not delete `)`, `}`,

  // TODO: overwrite singleTokenDeletion do not delete parens etc for identifier
  // or non-reserved keywords
  if (!keywordRegexp.test( token.text ))
    return this._super.recoverInline.call( this, recognizer );

  // TODO: attach `Identifier` as valid name to message?
  recognizer.message( 'syntax-unexpected-reserved-word', token,
                      { code: token.text, delimited: token.text } );
  this.reportMatch(recognizer); // we know current token is correct
  recognizer.consume();
  return token;
}

// Conjure up a missing token during error recovery in parser `recognizer`.  If
// an identifier is expected, create one.
// Think about: we might want to prefer one of '}]);,'.
function getMissingSymbol( recognizer, expectedTokenType ) {
  expectedTokenType ??= this.getExpectedTokens(recognizer).first(); // get any element
  const current = recognizer.getCurrentToken();
  return recognizer.getTokenFactory().create(
    current.source,             // do s/th special if EOF like in DefaultErrorStrategy ?
    expectedTokenType, '', antlr4.Token.DEFAULT_CHANNEL, // empty string as token text
    -1, -1, current.line, current.column
  );
}

function intervalSetToArray( recognizer, expected, excludesForNextToken ) {
  // similar to `IntervalSet#toTokenString`
  let names = [];
  const pc = recognizer.constructor;
  for (const v of expected.intervals) {
    for (let j = v.start; j < v.stop; j++) {
      // a generic keyword as such does not appear in messages, only its replacements,
      // which are function name and argument position dependent:
      if (j === pc.GenericExpr) {
        names.push( ...recognizer.$genericKeywords.expr );
      }
      else if (j === pc.GenericSeparator) {
        names.push( ...recognizer.$genericKeywords.separator );
      }
      else if (j === pc.GenericIntro) {
        names.push( ...recognizer.$genericKeywords.introMsg );
      }
      else if (j === pc.SemicolonTopLevel) {
        // We only insert a semikolon (i.e. make it optional) after a closing brace.
        // If the previous token is not `}`, don't propose these keywords, as ';' is required.
        if (recognizer._input.LA(-1) === recognizer._input.BRACE_CLOSE) {
          const name = recognizer.topLevelKeywords.map(i => expected
            .elementName(recognizer.literalNames, recognizer.symbolicNames, i));
          names.push(...name);
          if (recognizer._ctx.outer?.kind !== 'source') {
            if (names.includes('<EOF>'))
              names.splice(names.indexOf('<EOF>'), 1);
          }
        }
      }
      // other expected tokens usually appear in messages, except the helper tokens
      // which are used to solve ambiguities via the parser method setLocalToken():
      else if (j !== pc.HelperToken1 && j !== pc.HelperToken2) {
        names.push( expected.elementName(recognizer.literalNames, recognizer.symbolicNames, j ) );
      }
    }
  }
  // The parser method excludeExpected() additionally removes some tokens from the message:
  if (recognizer.$adaptExpectedToken &&
      recognizer.$nextTokensToken === recognizer.$adaptExpectedToken) {
    const excludes = (excludesForNextToken && Array.isArray(recognizer.$adaptExpectedExcludes[0]))
      ? recognizer.$adaptExpectedExcludes[0]
      : recognizer.$adaptExpectedExcludes;
    names = names.filter( n => !excludes.includes( n ) );
  }
  else if (names.includes("';'")) {
    names = names.filter( n => n !== "'}'" );
  }
  else if (names.includes("'?'")) {
    names = names.filter( n => n !== "'?'" );
  }
  names.sort( (a, b) => (tokenPrecedence(a) < tokenPrecedence(b) ? -1 : 1) );
  return names;
}

// Used for sorting in messages
const token1sort = {
  // 0: Identifier, Number, ...
  // 1: separators:
  ',': 1,
  '.': 1,
  ':': 1,
  ';': 1,
  // 2: parentheses:
  '(': 2,
  ')': 2,
  '[': 2,
  ']': 2,
  '{': 2,
  '}': 2,
  // 3: special:
  '!': 3,
  '#': 3,
  $: 3,
  '?': 3,
  '@': 3,
  // 4: operators:
  '*': 4,
  '+': 4,
  '-': 4,
  '/': 4,
  '<': 4,
  '=': 4,
  '>': 4,
  '|': 4,
  // 8: KEYWORD
  // 9: <EOF>
};

function tokenPrecedence( name ) {
  if (name.length < 2 || name === '<EOF>')
    return `9${ name }`;
  const prec = token1sort[name.charAt(1)];
  if (prec)
    return `${ prec }${ name }`;
  return (name.charAt(1) < 'a' ? '8' : '0') + name;
}

function getTokenDisplay( token, recognizer ) {
  if (!token)
    return '<EOF>';
  const t = token.type;
  if (t === antlr4.Token.EOF || t === antlr4.Token.EPSILON ) {
    return '<EOF>';
  }
  else if (t === recognizer.constructor.DOTbeforeBRACE) {
    if (recognizer.getTokenStream().LT(2).text === '{')
      return "'.{'";
    return "'.*'";
  }
  return recognizer.literalNames[t] || recognizer.symbolicNames[t];
}

// Return an IntervalSet of token types which the parser had expected.  Do not
// include non-reserved keywords if not mentioned explicitly (i.e. other than
// from rule `ident`).
//
// We actually define something like a corrected version of function
// `LL1Analyzer.prototype.getDecisionLookahead`.  We cannot just redefine
// `getExpectedTokens`, because that function is also used to decide whether
// to consume in `DefaultErrorStrategy#singleTokenDeletion`.
function getExpectedTokensForMessage( recognizer, offendingToken, deadEnds ) {
  const { atn } = recognizer._interp;
  if (recognizer.state < 0)
    return [];
  if (recognizer.state >= atn.states.length) {
    throw new CompilerAssertion( `Invalid state number ${ recognizer.state } for ${
      this.getTokenErrorDisplay( offendingToken ) }`);
  }

  const identType = recognizer.constructor.Identifier;
  const hideAltsType = recognizer.constructor.HideAlternatives;
  const beforeUnreserved = recognizer.constructor.Number;
  if (!identType || !beforeUnreserved || beforeUnreserved + 2 > identType)
    return intervalSetToArray( recognizer, this._super.getExpectedTokens.call( this, recognizer ) );

  const ll1 = new Antlr4LL1Analyzer(atn);
  const expected = new IntervalSet();
  const origAddInterval = expected.addInterval;
  const origAddSet = expected.addSet;
  expected.addInterval = addInterval;
  expected.addSet = addSet;
  const lookBusy = new antlr4.Utils.Set();
  const calledRules = new antlr4.Utils.BitSet();

  if (deadEnds) {
    // "No viable alternative" by adaptivePredict() not on first token
    for (const trans of deadEnds) {
      ll1._LOOK( trans.state, null, predictionContext( atn, recognizer._ctx ),
                 expected, lookBusy, calledRules, true, true );
    }
    return intervalSetToArray( recognizer, expected, true );
  }
  else if (offendingToken && recognizer.$nextTokensContext &&
           offendingToken === recognizer.$nextTokensToken) {
    // Before exiting a rule, we had a state (via sync()) with a bigger
    // "expecting set" for the same token
    ll1._LOOK( atn.states[recognizer.$nextTokensState], null,
               predictionContext( atn, recognizer.$nextTokensContext ),
               expected, lookBusy, calledRules, true, true );
  }
  else {
    // Use current state to compute "expecting"
    ll1._LOOK( atn.states[recognizer.state], null,
               predictionContext( atn, recognizer._ctx ),
               expected, lookBusy, calledRules, true, true );
  }
  // console.log(state, recognizer.$nextTokensState,
  // expected.toString(recognizer.literalNames, recognizer.symbolicNames));
  return intervalSetToArray( recognizer, expected );

  function addSet( other ) {
    if (!other.contains( hideAltsType ))
      origAddSet.call( this, other );
  }

  // Add an interval `v` to the IntervalSet `this`.  If `v` contains the token
  // type `Identifier`, do not add non-reserved keywords in `v`.
  function addInterval( v ) {
    if (v.stop <= identType) {
      origAddInterval.call(this, v);
    }
    else if (v.start >= identType) {
      if (v.stop === identType + 1 || !recognizer.tokenRewrite) {
        origAddInterval.call(this, v);
      }
      else {
        for (let j = v.start; j < v.stop; j++)
          addRange( this, recognizer.tokenRewrite[j - identType] || j );
      }
    }
    else {
      if (v.start <= beforeUnreserved)
        addRange( this, v.start, beforeUnreserved + 1 );
      addRange( this, identType );
    }
  }

  function addRange( interval, start, stop ) {
    origAddInterval.call( interval, new Interval( start, stop || start + 1 ) );
  }
}

module.exports = {
  KeywordErrorStrategy,
};
