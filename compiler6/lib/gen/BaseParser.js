// Base class for generated parser, for redepage v0.2.2

'use strict';

// TODO: instance method
// name → true, list of predicates which are tested for rule exit
// const ruleExitPredicates = {};

// list of predicates which are tested when continue parsing after error starts,
// i.e. there is a predicate on the first token to match after recover example
// `afterBrace` or just method which by default just sets this.conditionTokenIdx
 // and this.conditionStackLength and returns true?

class BaseParser {
  keywords;
  table;
  lexer;

  tokens = undefined;
  eofIndex = undefined;
  tokenIdx = 0;
  recoverTokenIdx = -1;
  conditionTokenIdx = -1; // TODO: can we use recoverTokenIdx ?
  errorTokenIdx = -1;
  fixKeywordTokenIdx = -1;
  conditionStackLength = -1;
  nextTokenAsId = false;

  s = null;
  errorState = null;
  stack = [];
  dynamic_ = {};                // TODO: extra class
  prec_ = null;
  $hasErrors = null;
  leanConditions = {};
  // trace:
  trace = [];

  constructor( lexer, keywords, table ) {
    this.keywords = { __proto__: null, ...keywords };
    this.table = compileTable( table );
    this.lexer = lexer;
  }

  init() {
    this.lexer.tokenize( this );
    this.eofIndex = this.tokens.length - 1;
    return this;
  }

  _saveForWalk() {
    return {
      s: this.s,
      stack: this.stack,
      dynamic_: this.dynamic_,
      prec_: this.prec_
    };
  }

  _cloneFromSaved( saved ) {    // non-deep: Object.assign
    this.s = saved.s;
    this.stack = saved.stack.map( obj => ({ ...obj }) );
    this.dynamic_ = this._cloneDynamic( saved.dynamic_ );
    this.prec_ = saved.prec_;
  }

  _cloneDynamic( dynamic_ ) {
    let chain = [];
    while (dynamic_ !== Object.prototype) {
      const obj = {};
      for (const [ prop, val ] of Object.entries( dynamic_ ))
        obj[prop] = Array.isArray( val ) ? [ ...val ] : val;
      chain.push( obj );
      dynamic_ = Object.getPrototypeOf( dynamic_ );
    }
    let copy = Object.prototype;
    let { length } = chain;
    while (--length >= 0)
      copy = { __proto__: copy, ...chain[length] };
    return copy;
  }

  // methods for actions --------------------------------------------------------

  la() {                        // lookahead: complete token
    return this.tokens[this.tokenIdx];
  }
  lb() {                        // look back: complete token
    return this.tokens[this.tokenIdx - 1];
  }
  lr() {                        // return the first token matched by current rule
    return this.tokens[this.stack[this.stack.length - 1].tokenIdx];
  }

  // lookahead, error: ----------------------------------------------------------

  l() {                         // lookahead: token type
    return this.tokens[this.tokenIdx].type;
  }

  // instead of l() if keyword (reserved and/or unreserved) is in one of the cases
  lk() {                        // keyword lookahead
    const la = this.tokens[this.tokenIdx];
    if (!this.nextTokenAsId)
      return la.keyword || la.type;
    // return la.keyword && this.table[this.s][la.keyword] && la.keyword || la.type;
    this.nextTokenAsId = false;
    return la.type;
  }

  e() {                         // error: report and recover
    const la = this.tokens[this.tokenIdx];
    this._trace( 'detect parsing error' );
    if (this.errorTokenIdx === this.tokenIdx)
      throw Error( `Already reported error for ${ tokenFullName( la ) } at ${ la.location }`);

    la.parsedAs = '';           // current token is erroneous
    this.errorTokenIdx = this.tokenIdx;
    this.conditionStackLength = null;

    let { length } = this.stack;
    while (--length && this.tokenIdx === this.stack[length].tokenIdx)
      this.stack[length].followState = null;
    if (++length === this.stack.length) // last good state in current rule
      return this._reportAndRecover();

    this.stack[length].followState = this.errorState;
    this.s = null;
    return false;
  }

  _reportAndRecover() {
    this.s = this.errorState;
    this.reportUnexpectedToken_();
    const syncSet = this._calculateTokenSet( 'Y' );
    const recoverDepth = this._findSyncToken( syncSet );
    this._trace( 'recover from error' );
    this._recoverFromError( recoverDepth );
    return false;
  }

  // instead of e() in default if lk() had been used and 'Id' is in a non-default case
  ei() {                // error (after trying to test again as identifier)
    if (!this.tokens[this.tokenIdx].keyword) // lk() had directly returned the type
      return this.e();
    this.nextTokenAsId = true;
    return false;               // do not execute action after it
  }

  // goto state: ----------------------------------------------------------------

  // go to end of the rule, in tracing parser: g(0)
  gr( follow ) {                // intersection follow set for fast exit
    if (this.stack[this.stack.length - 1].tokenIdx === this.tokenIdx)
      return this.e();  // match at least one token
    this.s = 0;
    // TODO: also have recursive flag in stack: was rule was called recursively?
    // extra val 'gr' when rule was called when it could reach the rule end
    const { type, keyword } = this.tokens[this.tokenIdx];
    if (keyword &&            // Id also for unreserved, except after condition failure
        follow?.[0] === 'Id' && !this.keywords[keyword] &&
        this.fixKeywordTokenIdx !== this.tokenIdx ||
        follow?.includes( keyword || type )) {
      this._tracePush( [ 'E', true ] );
      return true;
    }
    this._tracePush( [ 'E', 0 ] );
    const match = this._matchesInFollow( type, keyword, 'E' );
    // If the parser reaches this point with match = null, even the top-level rule
    // does not have a required token (typically `EOF`) at the end → the parser
    // must accept any token → rule exit possible (but no output '✔' in trace).
    return (match ?? true) || this.e();
  }

  // go to state; non-tracing parser: `this.s=‹state›` or `this.gr()`
  g( state, follow ) {
    if (!(state == null ? this.e() : state || this.gr( follow )))
      return false;
    this.s = state;             // is just `this.s=‹state›` in non-trace parser
    this._tracePush( this.s );
    return true;
  }

  // instead of gi() for `Id_all`
  giA( state, follow ) { // go to state (after trying to test again as identifier)
    if (!this.tokens[this.tokenIdx].keyword) // lk() had directly returned the type
      return this.g( state, follow );
    this.nextTokenAsId = true;
    return false;               // do not execute action after it
  }

  // instead of g() in default if lk() had been used and 'Id' is in a non-default case
  gi( state, follow ) { // go to state (after trying to test again as identifier)
    const lk = this.tokens[this.tokenIdx].keyword;
    // As opposed to ei(), we also check for reserved keywords here; this way, we
    // do not have to add reserved keywords from the follow-set to the `switch`.
    if (!lk || this.keywords[lk]) // TODO: consider fixKeywordTokenIdx ?
      return this.g( state, follow );
    this.nextTokenAsId = true;
    return false;               // do not execute action after it
  }

  // instead of gi() at rule end (RuleEnd_ in follow-set) for `Id_restricted`
  giR( state, follow ) { // go to state (after trying to test again as identifier)
    const { keyword } = this.tokens[this.tokenIdx];
    if (!keyword || this.keywords[keyword])
      return this.g( state, follow );
    this._tracePush( [ 'R', 0 ] );
    if (this._matchesInFollow( 'Id', keyword, 'R' ))
      return this.g( state, follow );
    this.nextTokenAsId = true;
    return false;               // do not execute action after it
  }

  // instead of g() in a non-default case if there is a LL1 conflict
  gP( state, follow ) {                // goto state with standard weak-conflict prediction
    return this.lP( follow ) && this.g( state );
  }

  // match and consume token: ---------------------------------------------------

  m( state, token ) {           // match token = compare and consume
    return (this.tokens[this.tokenIdx].type === token)
      ? this.c( state )
      : this.e();
  }

  // instead of m() for identifiers via `Id` or `Id_restricted`
  mi( state, ident = true ) {   // match identifier token
    return (this.tokens[this.tokenIdx].type === 'Id')
      ? this.ci( state, ident )
      : this.e();
  }

  // instead of mi() for `Id_all`
  miA( state, ident = true ) {  // match identifier token
    return (this.tokens[this.tokenIdx].type === 'Id')
      ? this.ciA( state, ident )
      : this.e();
  }

  // instead of m() for reserved keywords or unreserved without conflict:
  mk( state, token ) {          // match keyword token
    return (this.tokens[this.tokenIdx].keyword === token)
      ? this.ck( state )
      : this.e();
  }

  c( state, parsedAs = 'token' ) { // consume token
    const la = this.tokens[this.tokenIdx++]; // ++ now also for EOF
    la.parsedAs = parsedAs;
    this.s = state;
    this.errorState = state;
    if (this.constructor.tracingParser)
      this._trace( `consume ${ tokenFullName( la, ' as ' ) }`, la );
    return true;
  }

  // instead of c() for identifiers, used both with l() and lk()
  ci( state, ident = 'ident' ) {   // consume identifier token
    if (this.tokenIdx === this.fixKeywordTokenIdx)
      return this.e();
    const la = this.tokens[this.tokenIdx];
    // TODO: consider this like a failed condition? Will be relevant if we try
    // different error recovery possibilities.
    if (this.keywords[la.keyword])
      this.reportReservedWord_();
    // with error recovery: use that (consider this having a good score)
    return this.c( state, ident )
  }

  // instead of ci() for `Id_all`, used both with l() and lk()
  ciA( state, ident = 'ident' ) {  // consume identifier token, the "All" variant
    return this.c( state, ident )
  }

  // instead of c() for reserved or unreserved without conflict, requires lk()
  ck( state ) {                 // consume keyword token
    return this.c( state, 'keyword' )
  }

  // instead of ck() if there is a LL1 conflict
  ckP( state, first2 ) {      // consume unreserved keyword with weak conflict
    return this.lP( first2 ) && this.ck( state );
  }

  // for parser token or token set via `/`
  ckA( state ) {
    // if it really should be considered an Id, `set this.la().parsedAs` yourself
    return this.c( state, (this.l() === 'Id' ? 'keyword' : 'token') );
  }

  skipToken_() {
    ++this.tokenIdx;
  }

  // condition and precedence handling ------------------------------------------

  // state must match the goto-state of the default (there must be no default
  // action), or null for error, lP() must have been used before.  There is no
  // “or Id” behavior other than via gpP()

  // “go if user condition fails”
  gc( state, cond, arg ) {
    if (this.conditionTokenIdx === this.tokenIdx &&        // tested on same
        this.conditionStackLength == null) {               // after error recovery
      this._tracePush( [ 'C' ] );
      return true;
    }
    // TODO: let this[cond]( true ) return recovery badness in error case
    if (this.constructor.tracingParser) {
      const { traceName } = this[cond];
      this._tracePush( [ 'C', traceName?.call( this, arg ) ?? cond ] );
    }
    // calling the condition might have side effects (precendence conditions have)
    // → call tracing “name” before
    const fail = this[cond]( true, arg ); // TODO: use single-letter for run?
    if (this.constructor.tracingParser)
      this._traceSubPush( !fail );
    // The default case must not have actions. If written in grammar with action,
    // the default must have <default=fallback>


    if (fail) {                 // TODO: extra gcK() method instead of check below
      // TODO: probably remove the following (and `conditionStackLength` tests)
      // altogether, error with gr() should be enough
      // if (this.conditionTokenIdx === this.tokenIdx &&
      //     this.conditionStackLength == this.stack.length)
      //   return this.e();        // already failed on same token in same rule
      // TODO: extra method necessary for academic case
      // ( 'unreserved' 'foo' | <cond> Id 'bar' )` with input `unreserved bar`
      const { keyword } = this.la();
      if (keyword && this.table[this.s][keyword])
        this.fixKeywordTokenIdx = this.tokenIdx;
      this.conditionTokenIdx = this.tokenIdx;
      this.conditionStackLength = this.stack.length;
      this.conditionName = cond;
      // we also set the failure here, because the reporting might have a
      // different context (consider immediate exit)
      this.conditionFailure = fail;
    }
    return !fail || this.g( state ) && false;
  }

  ec( cond, arg ) {
    return this.gc( null, cond, arg );
  }

  // rule start, end and call: --------------------------------------------------

  rule_( state, followState = -1 ) { // start rule
    this.s = state;
    this._trace( [ 'call rule', state, ' at alt start' ] );
    this.stack.push( {
      ruleState: state,
      followState,
      tokenIdx: this.tokenIdx,
      prec: this.prec_,
    } );
    this.dynamic_ = Object.create( this.dynamic_ );
    this.prec_ = null;
    this.errorState ??= state;
  }

  exit_() {     // exit rule
    if (this.s)
      throw Error( `this.s === ${ this.s } // illegally set by action, or runtime/generator bug` );
    this.dynamic_ = Object.getPrototypeOf( this.dynamic_ );
    const caller = this.stack.pop();
    const immediately = this.tokenIdx === caller.tokenIdx;
    if (this.constructor.tracingParser) {
      const post = this.s == null &&
            (immediately
             ? ' immediately'
             : caller.followState == null
             ? ' unsuccessfully'
             : ' prematurely');
      const text = immediately ? '⚠ exit rule' : '⏎ exit rule';
      this.s = caller.followState; // for trace
      this._trace( [ text, caller.ruleState, post, 'back to' ] )
      if (immediately && this.stack.at(-1)?.followState != null)
        this.trace = [ this.errorState ]; // show last good state in trace
    }
    this.s = caller.followState;
    if (immediately)
      return this.s != null && this._reportAndRecover();

    this.prec_ = caller.prec;
    if (this.s)
      this._skipErrorTokens();  // TODO: re-think - directly with _reportAndRecover() ?
    else if (this.s == null)
      return true;  // attached actions are executed even with "unsuccessful exit"

    this.errorState = this.s;
    return true;
  }

  // predicate used before rule call (and called by `ckP` and `gP`) on keyword
  // branch if with weak LL(1) conflict, i.e. there is an 'Id' branch or the
  // default branch has `Id` in its first-set (TODO: or rule end, and `Id` is in
  // follow-union)
  lP( first2 ) {
    // nothing to check if not a non-reserved keyword:
    const { keyword: lk1 } = this.tokens[this.tokenIdx];
    if (!lk1 || this.keywords[lk1] !== 0 || this.fixKeywordTokenIdx === this.tokenIdx)
      return true;

    this._tracePush( [ 'K' ] );
    const { type: lt2, keyword: lk2 } = this.tokens[this.tokenIdx + 1];
    if (lt2 === 'IllegalToken')
      return true
    // Argument first2 is just a performance hint:
    if (lk2 && first2?.[0] === 'Id' && !this.keywords[lk2] ||
        first2?.includes( lk2 || lt2 )) {
      this._traceSubPush( true );
      return true;
    }
    // now check it dynamically:
    if (this._walkPred( this.table[this.s][lk1], lk1, lt2, lk2 ))
      return true;
    this._tracePush( [ 'I' ] );
    const choice = this.table[this.s];
    if (!this._walkPred( choice.Id || choice[''], null, lt2, lk2 ))
      return true;
    this.nextTokenAsId = true;
    return false;
  }

  _walkPred( cmd, lk1, lt2, lk2 ) {
    const saved = this._saveForWalk();
    const { length } = this.stack;
    if (typeof cmd[0] !== 'number') // don't skip push to state with rule call
      this.s = cmd[1];
    if (cmd[0] !== (lk1 ? 'ck' : 'ci')) { // make the std case fast
      // TODO: also not with lean condition
      let match1 = this._pred_next( 'Id', lk1, 'P' ); // TODO: really P for I?
      if (!match1) {
        if (lk1 || match1 === false) // assert for correct code generation
          throw Error( `Cannot match first prediction token in rule at state ${ saved.s }` );
        if (match1 == null) {
          this._traceSubPush( 0 );  // TODO: make _pred_next push this
          match1 = this._matchesInFollow( 'Id', lk1, 'I' ); // TODO: 'I'?
        }
        else {
          this._traceSubPush( false );
        }
        Object.assign( this, saved );
        this.stack.length = length;
        return !!match1;
      }
    }

    this._traceSubPush( '' );   // between the two tokens
    ++this.tokenIdx;            // for user lookahead fns and conditions
    let match2 = this._pred_next( lt2, lk2, (lk1 ? 'K' : 'I') );
    if (match2 == null) {
      this._traceSubPush( 0 );  // TODO: make _pred_next push this
      match2 = !!this._matchesInFollow( lt2, lk2, (lk1 ? 'K' : 'I') );
    }
    else {
      this._traceSubPush( match2 );
    }
    Object.assign( this, saved );
    this.stack.length = length;
    --this.tokenIdx;
    return match2;
  }

  // Now the helper methods =====================================================

  // Standard weak-conflict predicate -------------------------------------------

  /**
   * Return whether current token (its type and keyword are args - TODO delete?)
   * would be matched when starting at the current state:
   *  - true/false are definite answers,
   *  - null: reached end-of-rule (let caller decide what to do).
   *
   * Changes by side-effect:
   *  - this.s
   *  - with mode='P' (first step in keyword prediction) if a rule is called:
   *    this.stack, this.dynamic_, this.prec_
   *
   * Conditions are only evaluated with mode='M' (expected set in msgs) or if
   * condition is listed in `this.leanConditions`.
   */
  _pred_next( type, keyword, mode ) { // mode = P | K | I | E | R | M
    // TODO mode: really distinguish between K | I | E | R ?
    // Probably not: would not work with caching?  → P, P -> F
    const properCall = (mode === 'P');
    const lean = (mode !== 'M'); // TODO: extra method with conditions ?
    // TODO: if false, use condition in this.leanConditions
    let hasMatchedToken = null; // undecided yet → calculate on demand
    while (this.s) {
      if (lean)
        this._traceSubPush( this.s );
      else
        this._tracePush( this.s ); // TODO: push new state instead
      let cmd = this.table[this.s];
      if (!Array.isArray( cmd )) {
        const lookahead = cmd[' lookahead'];
        const c = lookahead         // TODO: call with { keyword, type } ?
          ? cmd[this[lookahead]( mode )]
          : keyword && cmd[keyword] || cmd[type];
        cmd = !(c && this._rejectCondition( c, mode, lean )) && c || cmd[''];
      }
      const state = this.s;
      this.s = cmd[1];
      switch (cmd[0]) {
        case 'c': case 'ck': case 'ckA': // TODO: re-check ckA
          return true;
        case 'ciA':             // TODO: fixKeywordTokenIdx ?
          return mode !== 'R';
          // in the R prediction for optional `Id<reserved>` at rule end, only
          // alternative keyword matches are preferred, not identifier matches
        case 'ci':
          if (!keyword ||
              !this.keywords[keyword] && this.fixKeywordTokenIdx !== this.tokenIdx)
            return mode !== 'R';
          cmd = this.table[state]['']; // is currently always 'g' or 'e'
          this.s = cmd[1];
          break;
        case 'm':
          return type === cmd[2];
        case 'mi':
          return type === 'Id' && mode !== 'R' &&
            (!keyword ||
             !this.keywords[keyword] && this.fixKeywordTokenIdx !== this.tokenIdx);
        case 'miA':
          return type === 'Id' && mode !== 'R';
        case 'mk':
          return keyword === cmd[2];
        case 'g': case 'e':
          break;
        default:
          if (typeof cmd[0] !== 'number')
            throw Error( `Unexpected command ${ cmd[0] } at state ${ state }` );
          // If the parser enters a rule, reaching the rule end (can happen with
          // option `minTokensMatched`) means "no match".
          hasMatchedToken = false;
          // If we want to support conditions before matching the first token in a
          // rule, we would have to handle `this.stack` and `this.dynamically_`.
          if (properCall) {
            // rule_() - TODO: also w/ conditions before matching first token
            this.stack.push( {
              ruleState: cmd[1],
              followState: cmd[0],
              tokenIdx: this.tokenIdx,
              prec: this.prec_,
            } );
            this.dynamic_ = Object.create( this.dynamic_ );
            this.prec_ = null;
          }
      }
      // We could optimize with rule call - only 'Id' must be further investigated
      // TODO: actually also with `g`
      // in both cases if no condition is evaluated
      // TODO <prepare=…, arg=…> for real trial run also before all returns
      // if (cmd[5])
      //   this.cmd[5]( cmd[4], mode );
    }
    // If invalid state, the second token does not match, e.g. for `VIRTUAL +`
    // or `VIRTUAL ⎀` (with IllegalToken):
    if (this.s == null)
      return false;

    // Otherwise, the parser could end the rule after having matched the keyword
    // with prediction.  TODO: as we do not look behind the current rule for the
    // prediction, the tool can normally omit the prediction (and output a
    // message), no so with `ruleStartingWithUnreserved`.  We will rather look
    // behind the current rule _after_ having decided that the token is to be
      // matched as identifier.
    return (hasMatchedToken ?? this.tokenIdx > this.stack.at( -1 ).tokenIdx)
      && null; // let caller decide how to interpret this
  }

  _rejectCondition( cmd, mode, lean ) {
    const cond = cmd[3];
    if (!cond || lean && !this.leanConditions[cond])
      return false;
    if (!this.constructor.tracingParser)
      return !!this[cond]( mode, cmd[4] );
    // TODO: let this[cond]( true ) return recovery badness in error case
    if (!lean) {
      const { traceName } = this[cond];
      this._tracePush( [ 'C', traceName?.call( this, cmd[4] ) ?? cond ] );
      // calling the condition might have side effects (precendence conditions have)
      // → call tracing “name” before
    }
    const succeed = !this[cond]( mode, cmd[4] );
    this._traceSubPush( lean ? { true: 'C✔', false: 'C✖' }[succeed] : succeed );
    return !succeed;
  }

  _matchesInFollow( type, keyword, mode ) { // mode = E | R and K | I
    // TODO: now also set stack!
    const savedState = this.s;
    // TODO: caching
    const { dynamic_ } = this;
    let match;
    let depth = this.stack.length;
    // TODO: currently assumes that lookahead does not use stack.at()
    while (match == null && --depth) {
      this.dynamic_ = Object.getPrototypeOf( this.dynamic_ );
      this.s = this.stack[depth].followState;
      // TODO: this.prec_ ?
      match = this._pred_next( type, keyword, mode );
      this._traceSubPush( match == null ? 0 : match === (mode !== 'R') );
      // successfully matching a keyword in giR() means unsuccessful match as
      // reserved identifer
    }
    this.dynamic_ = dynamic_;
    this.s = savedState;
    return match;
  }

  _confirmExpected( token, saved ) { // mode = M
    const fix = /^[_a-z]/.test( token );
    const [ type, keyword ] = (fix) ? [ 'Id', token ] : [ token ];
    Object.assign( this.la(), { type, keyword } );
    this._cloneFromSaved( saved );
    this.fixKeywordTokenIdx = fix && this.tokenIdx;
    this.trace = [];
    let match;
    while (this.stack.length) {
      match = this._pred_next( type, keyword, 'M' );
      if (match != null) {
        this._tracePush( { true: '✔', false: '✖' }[match] );
        break;
      }
      this.dynamic_ = Object.getPrototypeOf( this.dynamic_ );
      this.s = this.stack.pop().followState;
    }
    if (this.constructor.tracingParser) {
      this.stack = saved.stack; // influences indentation
      this._trace( tokenName( token ), 2 );
    }
    return match ?? true;
  }

  // Set of expected and sync tokens: for error reporting and recovery ----------

  // Calculate array of expected tokens / error sync set
  _calculateTokenSet( mode ) {  // mode = M | Y
    this._tracePush( [ mode ] );
    // TODO later (after trying different synchronization tokens), we could use
    // one set for both M and Y, the latter just adds more tokens to it
    const savedState = this.s;
    const savedDynamic = this.dynamic_;
    const savedStack = this.stack;
    this.stack = [ ...savedStack ];
    this.s = this.errorState;

    const set = Object.create(null);
    // Add follow sets of outer rules if at potential rule end
    if (mode === 'M') {         // for messages
      while (this.stack.length && this._tokenSetInRule( set, true )) {
        this.dynamic_ = Object.getPrototypeOf( this.dynamic_ );
        this.s = this.stack.pop().followState;
      }
    }
    else {                      // or always when calculating the sync-set
      let val = this.stack.length + 1;
      while (this.stack.length) {
        if (!this._tokenSetInRule( set, val ))
          val = this.stack.length;
        // TODO: use new _tracePush if `val` changes, probably also use Y‹val›(…)
        this.dynamic_ = Object.getPrototypeOf( this.dynamic_ );
        this.s = this.stack.pop().followState;
      }
      set.EOF ??= 0;
    }
    this.stack = savedStack;
    this.s = savedState;        // should be the errorState anyway - TODO: confirm
    this.dynamic_ = savedDynamic;
    return set;
  }

  // Filter after this fn for conditions via interpreter call after: consider
  //   ( <prefer, guard=fail> 'foo' | rule ) with
  //   rule : 'foo' | Id ;
  // doing it already here would list `foo` as expected token
  _tokenSetInRule( expecting, val, cmd, collectKeywordsAndIdOnly = false ) {
    const savedDynamic = this.dynamic_;
    const savedState = this.s;
    let enteredRules = 0;
    loop: while (this.s) {
      cmd ??= this.table[this.s];
      if (!Array.isArray( cmd )) {
        const lookahead = cmd[' lookahead'];
        const dict = cmd;
        for (const prop in dict) {
          if (prop && Object.hasOwn( dict, prop ) && prop !== 'Id' &&
              !Object.hasOwn( expecting, prop ) && prop.charAt(0) !== ' ')
            this.addTokenToSet_( expecting, prop, val, collectKeywordsAndIdOnly, lookahead );
        }
        cmd = dict[''];
        if (dict.Id) {
          // recursive call only if Id branch with non-error default branch
          if (cmd[0] === 'e') {
            collectKeywordsAndIdOnly = true;
            cmd = dict.Id;
          }
          else {                // Id branch never leads to rule exit:
            this._tracePush( [ '[' ] );
            this._tokenSetInRule( expecting, val, dict.Id, true );
            this._tracePush( [ ']' ] );
          }
        }
      }
      this._traceSubPush( this.s );
      switch (cmd[0]) {
        case 'm': case 'mk':
          this.addTokenToSet_( expecting, cmd[2], val, collectKeywordsAndIdOnly );
          break loop;
        case 'ci': case 'ciA': case 'mi': case 'miA':
          this.addTokenToSet_( expecting, 'Id', val, false );
          // TODO: should we do s/th special, such that a reserved word is a sync
          // token for Id<all>?  Probably not, see also comment in
           // _findSyncToken()
          break loop;
        case 'g': case 'gi': case 'e':
          break;
        default:
          if (typeof cmd[0] !== 'number')
            throw Error( `Unexpected command ${ cmd[0] } at state ${ this.s }` );
          ++enteredRules;       // conditions might use stack/dynamic_
          // core rule_():
          this.stack.push( {
            ruleState: cmd[1],
            followState: cmd[0],
            tokenIdx: this.tokenIdx,
            prec: this.prec_,
          } );
          this.dynamic_ = Object.create( this.dynamic_ );
          this.prec_ = null;
      }
      this.s = cmd[1];
      cmd = null;
    }
    const inspectOuterRules = (this.s === 0 && !enteredRules);
    this.s = savedState;
    this.dynamic_ = savedDynamic;
    this.stack.length -= enteredRules;
    return inspectOuterRules;
  }

  // Remark: when called for `Id` token, `collectKeywordsOnly` is `false`
  addTokenToSet_( set, token, val, collectKeywordsOnly, _lookahead ) {
    if (!collectKeywordsOnly || /^[_a-z]/.test( token ))
      set[token] ??= val;
  }

  // Error reporting and recovery -----------------------------------------------

  expectingArray_() {
    const token = this.la();
    const set = this._calculateTokenSet( 'M' );
    // Speed-up: delete current token
    const { keyword, type } = token;
    if (keyword && set[keyword] === true)
      delete set[keyword];
    else if (set[type] === true && !(keyword && this.keywords[keyword]))
      delete set[type];         // delete Id if Id token or non-reserved keyword

    this._trace( 'collect tokens for message' );
    const { trace } = this;
    const saved = this._saveForWalk();
    const expecting = Object.keys( set )
      .filter( tok => this._confirmExpected( tok, saved ) );
    token.type = type;          // overwritten by _confirmExpected
    token.keyword = keyword;
    Object.assign( this, saved );
    this.trace = trace;
    // TODO: also trace M(…) collection, extra line for each token, with condition
    return expecting;
  }

  _findSyncToken( syncSet ) {
    const rewindDepth = this.stack.length
    this.recoverTokenIdx = this.tokenIdx;
    while (this.recoverTokenIdx <= this.eofIndex) {
      const { keyword, type } = this.tokens[this.recoverTokenIdx];
      let recoverDepth = keyword ? syncSet[keyword] : null;
      if (recoverDepth != null)
        return recoverDepth;
      recoverDepth = syncSet[type];
      // sync to Id only if in expected set of last good state or if after ';'
      if (recoverDepth != null &&
          (type !== 'Id' || (!keyword || !this.keywords[keyword]) &&
           // reserved words do not match Id in expected-set
           (recoverDepth > rewindDepth || this.tokens[this.recoverTokenIdx - 1].type === ';')))
        // if (recoverDepth != null &&
        //     (this.recoverTokenIdx > this.tokenIdx || 
        return recoverDepth;
      ++this.recoverTokenIdx;
    }
    throw Error( 'EOF must be last in `tokens`' );
  }

  _recoverFromError( recoverDepth ) {
    this.s = null;
    let depth = this.stack.length;
    if (recoverDepth > depth) { // no rewind, no rule exit
      this.trace = [ this.errorState ]; // show last good state in trace
      this.s = this.errorState;
      if (this.s)
        this._skipErrorTokens();
    }
    while (depth > recoverDepth)
      this.stack[--depth].followState = null;
    // TODO: when the error is due to failed rule exit prediction, try to keep
    // existing followState (if that reaches RuleEnd_)
    // Continue parsing: ignore next predicate (TODO: except some specified ones?)
    this.conditionTokenIdx = this.tokenIdx;
    this.conditionStackLength = null;
    this.fixKeywordTokenIdx = -1; // was set when collecting expecting-set

    // TODO: re-check for rule calls which are at the optional rule end:
    //   x: 'x not'; b: 'b'? x {console.log('x→b')} 'b'?; a: b {console.log('b→a')} 'a'
    // with start rule `a` and input `x a`: output should be x→b + b→a
    // with start rule `a` and input `b a`: output should be b→a
    //
    // → the rule is: if a rule can continue at the specified state and has
    // matched at least one token, then its action is executed, otherwise not
  }

  _skipErrorTokens() {
    if (this.constructor.tracingParser && this.tokenIdx <= this.recoverTokenIdx) {
      this._trace( `skip ${ this.recoverTokenIdx - this.tokenIdx } tokens to recover from error`,
                   this.tokens[this.recoverTokenIdx] );
      }
    while (this.tokenIdx < this.recoverTokenIdx)
      this.skipToken_();
  }

  // small methods --------------------------------------------------------------

  log( ...args ) {
    console.log( ...args );
  }

  reportError_( location, text ) {
    this.$hasErrors = true;
    this.log( `${ location }:`, text );
  }

  reportUnexpectedToken_( msg ) {
    const token = this.la();
    msg ??= `Unexpected token ${ tokenFullName( token, ': ' ) }`;
    this.reportError_(
      token.location, msg + ' - expecting: ' +
        this.expectingArray_().map( tokenName ).sort().join( ',' ) );
  }

  reportReservedWord_() {
    this.reportUnexpectedToken_( `Unexpected reserved word ‘${ this.la().text }’` );
  }

  errorAndRecoverOutside( token, text ) { // TODO: re-check
    // TODO: TMP
    this.reportError_( token.location, text );
    while (this.l() !== ';')
      this.skipToken_();
    this.s = null;
    return false;
  }

  _tracePush( state ) {
    if (this.constructor.tracingParser)
      this.trace.push( state ?? '⚠' );
  }
  _traceSubPush( state ) {
    if (this.constructor.tracingParser)
      this.trace.at(-1).push( state );
  }
  traceAction( location ) {     // TODO: remove
    this._trace( 1, location );
  }

  _trace( msg, la = this.la() ?? this.lb() ) {
    if (!this.constructor.tracingParser)
      return;
    // indentation according to rule call depth is nice, but only if without
    // excessive spaces → truncate:
    const indent = '  '.repeat( this.stack.length % 32 );
    if (msg === 1) {
      let line = '         execute action'; // align with non-action messages
      if (this.trace.length > 1) { // i.e. with some 'g' command
        line += ', states: ' + this.trace.map( traceStep ).join( ' → ' );
        this.trace = [ this.s ?? '⚠' ];
      }
      this.log( indent, line, `(${ la })` );
      return;
    }
    else if (la === 2) {        // confirming tokens in expected set
      this.log( indent, '          ', msg + ':',
                this.trace.map( traceStep ).join( ' → ' ) );
      this.trace = [ this.s ?? '⚠' ];
      return;
    }
    const { location } = la;
    if (!this.trace.length) {
      this.log( `In ${ location.file }:` );
      this.trace = [ -1 ];
    }
    this.trace.push( this.s ?? '⚠' );
    if (Array.isArray( msg )) { // rule call and exit
      const [ intro, state, finale, exit ] = msg;
      let start = state;
      while (typeof this.table[--start] !== 'string')
        ;
      const post = (exit || start + 1 < state) && finale;
      msg = `${ intro } “${ this.table[start] }”${ post || '' } ${ exit || 'from' } stack level ${ this.stack.length }`;
    }
    // Yes, I know util.format, but do not want to have a `require` in this file
    const line = location.line < 1e5 ? `    ${ location.line }`.slice(-5) : `${ location.line }`;
    const col = location.col < 1e4 ? `:${ location.col }   `.slice(0,5) : `:${location.col }`;
    this.log( line + col + indent + msg + ', states:',
              this.trace.map( traceStep ).join( ' → ' ) );
    this.trace = [ this.s ?? '⚠' ];
  }

  inSameRule_( lowState = this.s, highState = this.stack.at(-1).followState ) {
    if (lowState > highState)
      [ lowState, highState ] = [ highState, lowState ];
    while (lowState < highState) {
      if (typeof this.table[++lowState] === 'string') // rule boundary
        return false;
    }
    return true;
  }

  // Predefined conditions with extra option names:

  hide_( mode ) {
    return mode === 'M';
  }
  precLeft_( _test, prec ) {    // <prec=…>, <…,assoc=left>, <…,prefix=once>
    const parentPrec = this.stack.at( -1 ).prec;
    if (parentPrec != null && parentPrec >= prec)
      return true;
    this.prec_ = prec;
    return false;
  }
  precRight_( _test, prec ) {   // <…,assoc=right>, <…,prefix>
    const parentPrec = this.stack.at( -1 ).prec;
    if (parentPrec != null && parentPrec >= prec)
      return true;
    this.prec_ = prec - 1;
    return false;
  }
  precNone_( _test, prec ) {    // <…,assoc=none>, <…,postfix=once>
    const parentPrec = this.stack.at( -1 ).prec;
    if (parentPrec != null && parentPrec >= prec ||
        this.prec_ != null && this.prec_ <= prec)
      return true;
    this.prec_ = prec;
    return false;
  }
  precPost_( _test, prec ) {    // <…,postfix>
    const parentPrec = this.stack.at( -1 ).prec;
    if (parentPrec != null && parentPrec >= prec ||
        this.prec_ != null && this.prec_ < prec)
      return true;
    this.prec_ = prec;
    return false;
  }
}
const members = BaseParser.prototype;
// functions below are to be called with `call` to set `this`

members.precLeft_.traceName = function( prec ) {
  const parentPrec = this.stack.at( -1 ).prec;
  return `${ parentPrec ?? '-∞' }<${ prec }`;
}
members.precRight_.traceName = function( prec ) {
  const left = this.precLeft_.traceName.call( this, prec );
  return `${ left },↓`;
}
members.precNone_.traceName = function( prec ) {
  const left = this.precLeft_.traceName.call( this, prec );
  return `${ left }<${ this.prec_ == null ? '∞' : this.prec_ }`;
}
members.precPost_.traceName = function( prec ) {
  const left = this.precLeft_.traceName.call( this, prec );
  return `${ left }≤${ this.prec_ == null ? '∞' : this.prec_ }`;
}

function traceStep( step ) {
  if (!Array.isArray( step ))
    return step;
  const result = { true: '✔', false: '✖' }[step.at( -1 )] ?? '';
  const intro = (typeof step[1] === 'number') ? '→' : '';
  const arg = step.slice( 1, result ? -1 : undefined ).join( '→' );
  return `${ step[0] }(${ intro }${ arg })${ result }`;
}

function tokenName( type ) {
  if (typeof type !== 'string')
    type = (!type.parsedAs || type.parsedAs === 'keyword') && type.keyword || type.type;
  return (/^[A-Z]+/.test( type )) ? `‹${ type }›` : `‘${ type }’`;
}

function tokenFullName( token, sep ) {
  return (token.parsedAs && token.parsedAs !== 'keyword' && token.parsedAs !== 'token' ||
          token.type !== 'Id' && token.type !== token.text && token.text)
    ? `‘${ token.text }’${ sep }${ tokenName( token ) }`
    : tokenName( token );
}

function compileTable( table ) {
  if (table.$compiled)
    return table;
  for (const line of table) {
    if (typeof line !== 'object' || Array.isArray( line ))
      continue;
    const cache = Object.create( null ); // very sparse array
    for (const prop of Object.keys( line )) {
      const alt = line[prop];
      if (!Array.isArray( alt ) && prop.charAt(0) !== ' ') // string or number
        line[prop] = (typeof alt === 'string') ? line[alt] : (cache[alt] ??= [ 'g', alt ]);
    }
    if (!line[''])
      line[''] = [ 'e' ];
  }
  table.$compiled = true;
  return table;
}

module.exports = BaseParser;
