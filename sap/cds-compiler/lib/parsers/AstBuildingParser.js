'use strict';

const BaseParser = require( '../gen/BaseParser' );

const { Location } = require( '../base/location' );
const { dictAdd, dictAddArray } = require('../base/dictionaries');
const { functionsWithoutParentheses } = require('./identifiers');

const { pathName } = require('../compiler/utils');
const { quotedLiteralPatterns, specialFunctions } = require('../compiler/builtins');
const parserTokens = { // TODO: precompile into specialFunction
  __proto__: null,
  GenericIntro: 'intro',
  GenericExpr: 'expr',
  GenericSeparator: 'separator',
};

const { parseMultiLineStringLiteral } = require('../language/multiLineStringParser');
const { normalizeNewLine, normalizeNumberString } = require('../language/textUtils');
const { parseDocComment } = require('../language/docCommentParser');

const $location = Symbol.for('cds.$location');

const extensionDicts = {
  elements: true, enum: true, params: true, returns: true,
};

const keywordTypeNames = {
  association: 'cds.Association', composition: 'cds.Composition',
};

const queryOps = {
  SELECT: 'query',
  union: 'query',
  intersect: 'query',
  except: 'query',
  minus: 'query',
};

const extensionsCode = {
  __proto__: null,
  definitions: 'extend … with definitions',
  context: 'extend context',
  service: 'extend service',
};

const PRECEDENCE_OF_EQUAL = 10;

class AstBuildingParser extends BaseParser {
  leanConditions = { afterBrace: true, atRightParen: true, fail: true };

  constructor( lexer, keywords, table, options, messageFunctions ) {
    super( lexer, keywords, table ); // lexer has file
    this.options = options;
    this.$messageFunctions = messageFunctions;
    this.docComments = [];
    this.docCommentIndex = 0;
    this.comments = [];

    this.afterBrace$ = -1;
    this.topLevel$ = -1;
  }

  // messages, conditions and other parsing-specific things ---------------------
  error( id, location, args = {}, text = null ) {
    // eslint-disable-next-line cds-compiler/message-call-format
    return this.$messageFunctions.error( id, location?.location || location, args, text );
  }
  message( id, location, args = {}, text = null ) {
    // eslint-disable-next-line cds-compiler/message-call-format
    return this.$messageFunctions.message( id, location?.location || location, args, text );
  }
  warning( id, location, args = {}, text = null ) {
    // eslint-disable-next-line cds-compiler/message-call-format
    return this.$messageFunctions.warning( id, location?.location || location, args, text );
  }
  info( id, location, args = {}, text = null ) {
    // eslint-disable-next-line cds-compiler/message-call-format
    return this.$messageFunctions.info( id, location?.location || location, args, text );
  }

  expectingArray() {
    const savedState = this.s;
    this.s = this.errorState;
    let array = this.expectingArray_();
    this.s = savedState;
    // compatibility: replace true+false by Boolean - TODO: delete
    if (array.includes( 'true' ))
      array = [ 'Boolean', ...array.filter( n => n !== 'true' && n !== 'false' ) ];
    return array.map( tok => this.antlrName( tok ) )
      .sort( (a, b) => (tokenPrecedence(a) < tokenPrecedence(b) ? -1 : 1) );
  }

  reportUnexpectedToken_() {
    const token = this.la();
    const args = { offending: this.antlrName( token ), expecting: this.expectingArray() };
    const errorMethod = this.conditionTokenIdx === this.tokenIdx &&
          this[`${ this.conditionName }Error`];
    let err = errorMethod && errorMethod.call( this, args, token );
    // TODO: should we set the msg variant always?  (→ no nestedExpandError necessary)
    if (errorMethod && !err)
      args['#'] ??= this.conditionName;
    err ||= this.error( 'syntax-unexpected-token', token, args );
    // No 'unwanted' variant, no 'syntax-missing-token'
    err.expectedTokens = args.expecting;
  }

  reportReservedWord_() {
    const token = this.la();
    const err = this.message( 'syntax-unexpected-reserved-word', token,
                              { code: token.text, delimited: token.text } );
    // TODO: at least if one expected keyword is similar, mention expected set
    err.expectedTokens = this.expectingArray();
  }

  tableWithoutAs() {            // not used in <guard=…>, only called by other guard
    // TODO TOOL: if the tool properly creates `default: this.giR()`, this
    // condition method is most likely not necessary
    const { keyword } = this.la();
    // TODO: if necessary, we could allow some keywords, and just make sure that
    // all JOIN variants are still possible
    return keyword && this.keywords[keyword] != null;
  }

  /**
   * Handle allowed mixes of expression categories.
   *
   * - <prepare=queryOnLeft>: define a new parentheses context if not direct
   *   recursive call, it can finally turn to be both a query or expr/table
   * - <prepare=queryOnLeft, arg=‹SomeVal›>: make the current parentheses
   *   context to be not a query anymore
   * - <guard=queryOnLeft> tests whether the expression on the left is a query
   * - <guard=queryOnLeft, arg=‹SomeVal›>: tests whether the expression on the
   *   left is a query, then make the current context to be not a query anymore
   * - <guard=queryOnLeft, arg=tableWithoutAs>: …after having checked
   *   whether the next token is no (reserved or unreserved) keyword
   */
  queryOnLeft( test, arg ) {
    if (arg === 'tableWithoutAs') {
      if (this.tableWithoutAs())
        return true;
    }
    else if (!arg && !test) {
      // provide new dynamic parentheses context, except with direct
      // recursive call:
      if (this.inSameRule_( this.s, this.stack.at( -1 ).followState ))
        return false;
      this.dynamic_.parenthesesCtx = [ null ];
      this._tracePush( 'Parentheses()' );
    }
    const { parenthesesCtx } = this.dynamic_;
    const noQuery = parenthesesCtx?.[0];
    if (arg && parenthesesCtx)
      parenthesesCtx[0] = arg;
    return noQuery;
  }

  prepareSpecialFunction() {
    const func = this.tokens[this.tokenIdx - 2].keyword?.toUpperCase();
    // TODO: use lower-case in specialFunctions
    const spec = specialFunctions[func];
    this.dynamic_.call = { func, argPos: 0 };
    this.dynamic_.generic = spec ? spec[0] : specialFunctions[''][0];
  }

  nextFunctionArgument() {
    const { call } = this.dynamic_;
    const spec = specialFunctions[call.func];
    ++call.argPos;
    this.dynamic_.generic = spec ? spec[call.argPos] : specialFunctions[''][1];
  }

  lGenericIntroOrExpr( _mode, tryGenericIntro = true ) {
    const { keyword, type } = this.la();
    // TODO: use lower-case in specialFunctions
    const text = typeof keyword === 'string' ? keyword.toUpperCase() : type;
    const generic = this.dynamic_.generic?.[text];
    if (tryGenericIntro) {
      if (generic !== 'expr')
        return (generic === 'intro') ? 'GenericIntro' : type;
      // if both intro and expr: specialFunctions[fn][argPos][token] = 'expr'
      const next = this.tokens[this.tokenIdx + 1];
      if (next && next.type !== ',' && next.type !== ')' &&
          this.dynamic_.generic[next.keyword?.toUpperCase?.()] !== 'separator')
        return 'GenericIntro';
    }
    return (generic === 'expr') ? 'GenericExpr' : type;
  }

  lGenericExpr() {
    return this.lGenericIntroOrExpr( null, false );
  }

  lGenericSeparator() {
    const { keyword, type } = this.la();
    // TODO: use lower-case in specialFunctions
    const text = typeof keyword === 'string' ? keyword.toUpperCase() : type;
    const generic = this.dynamic_.generic?.[text];
    return (generic === 'separator') ? 'GenericSeparator' : type;
  }

  addTokenToSet_( set, tokenName, val, collectKeywordsOnly ) {
    const token = parserTokens[tokenName];
    // TODO: use lower-case in specialFunctions
    const realTokens = token && this.dynamic_.generic?.[token];
    if (realTokens) {
      for (const t of realTokens)
        super.addTokenToSet_( set, t.toLowerCase(), val, collectKeywordsOnly );
    }
    else if (tokenName === 'DeleteStarFromSet') { // in rule `argumentsAndFilter`
      // TODO: workaround for (`GenericExpr : Id_all | '*'`), see #13485.
      // Works, since `DeleteStarFromSet` comes after `*` (length-sorted):
      delete set['*'];
    }
    else {
      super.addTokenToSet_( set, tokenName, val, collectKeywordsOnly );
    }
  }

  inSelectItem( _test, arg ) {  // only as action
    this.dynamic_.inSelectItem = arg ||
      (this.tokens[this.tokenIdx - 2].type === '.' ? 'inline' : 'expand');
  }

  /**
   * `virtual` and `key` cannot be used inside expand/inline
   * (also inside sub queries in those, which will be rejected later anyway)
   */
  modifierRestriction() {
    const { inSelectItem } = this.dynamic_;
    // TODO: really reject for top-level "inline"?
    return inSelectItem === 'expand' || inSelectItem === 'inline';
  }
  modifierRestrictionError( args, offending ) {
    return this.error( 'syntax-unexpected-modifier', offending, args,
                       // TODO: we would have text variant for expand or inline,
                       // but we probably allow `key` in nested top-level inline
                       'Unexpected $(OFFENDING) in nested expand/inline, expecting $(EXPECTING)' );
  }

  isDotForPath() {              // see also inSelectItem
    // TODO: also consider whether we are in the <prefer>ed `valuePath` branch
    if (this.dynamic_.inSelectItem == null)
      return false;
    // TODO: it would be best to set this.dynamic_.inSelectItem to null in filters
    // (as <prepare>)
    const next = this.tokens[this.tokenIdx + 1]?.type;
    return next === '*' || next === '{';
  }

  notAfterEntityArgOrFilter( mode ) { // TODO: for <hide>
    if (mode !== 'M')
      return false;
    const { type } = this.lb();
    if (type !== ')' && type !== ']')
      return false;
    const { followState } = this.stack.at( -1 );
    return this.table[followState][':'];
  }

  // <prec=10, postfix=once> + test that the next token is not `null`; TODO: code
  // completion for `… default 3 not ~;` → currently just `null` but hey
  isNegatedRelation( _test, prec ) {
    return this.tokens[this.tokenIdx + 1]?.keyword === 'null' ||
      this.precNone_( _test, prec );
  }

  // TODO: as leanCondition ?  `order` should probably appear in the message for
  // test3/Compiler/GrammarRobustness/InvalidSelectInWhere.err.cds
  orderByLimitRestriction( mode ) {
    if (mode && (!this.$allowOrderByLimit || this.precPost_( mode, 0 )))
      return true;
    this.$allowOrderByLimit = !mode;
    return false;
  }

  isNamedArg() {
    const type = this.tokens[this.tokenIdx + 1]?.type;
    return type !== ':' && type !== '=>';
  }

  /**
   * `namespace` is forbidden after a definitions/extend or after previous
   * `namespace`
   */
  namespaceRestriction() {
    return ++this.topLevel$ > 0;
  }

  /**
   * `extend`/`annotate` is forbidden inside `extend … with definitions` and
   * variants.  TODO: combine with `vocabularyRestriction`.
   */
  extensionRestriction() {
    // 'syntax-unexpected-extension': 'Unexpected $(KEYWORD) inside $(CODE) block',
    const r = this.dynamic_.inExtension;
    this.dynamic_.inExtension = this.tokenIdx + 1;
    return r;
  }
  extensionRestrictionError( args, token ) {
    const extendIdx = this.conditionFailure;
    const variant = this.tokens[extendIdx + 1]?.type === 'Id' &&
          this.tokens[extendIdx].keyword;
    args.code = extensionsCode[variant] || extensionsCode.definitions;
    args['#'] = 'new-parser';
    return this.error( 'syntax-unexpected-extension', token, args );
  }

  /**
   * `annotation` def is only allowed top-level. TODO: combine with `extensionRestriction`
   */
  vocabularyRestriction( test ) {
    if (!test)
      this.dynamic_.inBlock = this.tokenIdx;
    return this.dynamic_.inBlock ?? this.dynamic_.inExtension;
  }
  vocabularyRestrictionError( args, token ) {
    const extendIdx = this.conditionFailure;
    args['#'] = `${ this.tokens[extendIdx - 1].keyword }-new`;
    return this.error( 'syntax-unexpected-vocabulary', token, args );
  }

  /**
   * Restrictions according to the expression of a select column.
   * Currently only to restrict it to a single `Id` for published associations.
   * No extra syntax-unexpected-assoc for failure.
   */
  columnExpr( mode, arg ) {
    if (mode)
      return !this.columnExpr$;
    if (arg)
      this.columnExpr$ = this.tokenIdx;
    else if (this.columnExpr$ !== this.tokenIdx - 1 ||
             this.lb().type !== 'Id' ||
             [ 'true', 'false', 'null' ].includes( this.lb().keyword ) )
      this.columnExpr$ = null;
    return true;
  }

  nestedExpand( mode ) {
    if (!mode)
      this.nestedExpand$ = this.tokenIdx;
    return this.nestedExpand$ !== this.tokenIdx;
  }
  nestedExpandError() {
    // This is intentionally left empty
  }

  /**
   * Prepare element restrictions and check validity of final anno assignments.
   *
   * Called as <prepare=…>:
   *
   * - <…,arg=elem> in `elementDef` (before calling `typeExpression`):
   *   allow `default`/`= calcExpr` with final annotation assignments,
   *   delay final doc comment
   * - <…, arg=default> in `returnsSpec`: after `returns`
   *   disallow `default` in `typeExpression`
   * - <…, arg=calc> in `typeExpression` (with associations, etc)
   *   now disallow `= calcExpr` in `elementDef`,
   *   do not delay final doc comments anymore
   * - <…, arg=anno> in `typeExpression` after enums:
   *   now disallow annotation assignments after `= calcExpr`,
   *   ignore doc comment after having called `typeExpression`
   *
   * Called as <guard=…>:
   *
   * - <…, arg=default> in `typeExpression` and `typeProperties`
   *   is `default` allowed?  If used, disallow calc and further DEFAULT
   * - <…, arg=notNull> in `typeExpression` and `typeProperties`
   *   is `null`/`not null` allowed? ensures that it is only used once
   * - <…, arg=calc> in `elementDef`:
   *   is `= calcExpr` allowed? not with struct, assoc or MANY…
   * - <…, arg=anno> in `elementDef`:
   *   are annotation assignments after `= calcExpr` allowed? not with ENUM…
   *
   * The value of the dynamic var `elementCtx` looks like [REJECTED, DEFAULT,
   * NOTNULL] where
   *
   * - REJECTED is the string containing a to-be-rejected test `arg`
   * - DEFAULT: true if `default` had been provided
   * - NOTNULL: true if `null` or `not null` had been provided
   */
  elementRestriction( test, arg ) {
    let { elementCtx } = this.dynamic_;
    if (test) {
      if (elementCtx?.[0] === arg)
        return arg;
      if (!elementCtx) { // with type, param, or annotation defs
        // eslint-disable-next-line no-multi-assign
        elementCtx = this.dynamic_.elementCtx = [ null, false, false ];
      }
      if (arg === 'default') {
        if (elementCtx[1])
          return true;
        elementCtx[1] = true;
        elementCtx[0] = 'calc';
        this.prec_ = PRECEDENCE_OF_EQUAL; // only expressions for DEFAULT expr
      }
      else if (arg === 'notNull') {
        if (elementCtx[2]) {
          if (this.la().keyword !== elementCtx[2] || test === 'M') // TODO v6: always error
            return true;        // error if different nullibility specification
        }
        elementCtx[2] = this.la().keyword;
      }
    }
    else if (arg === 'elem' || arg === 'default') {
      this.dynamic_.elementCtx = [ arg, false, false ];
    }
    else if (elementCtx) {
      elementCtx[0] = arg;
    }
    return false;
  }
  elementRestrictionError( args, token ) {
    if (this.conditionFailure !== 'calc')
      return null;
    args.keyword = 'default';
    // TODO: investigate why 'null', '@' are not in the expected-set
    // TODO: simplified version for predictions, such that ops are in expected-set ?
    // TODO: also test `default 3 null = 4`
    return this.error( 'syntax-unexpected-calc', token, args,
                       'Unexpected $(OFFENDING) after $(KEYWORD) clause, expecting $(EXPECTING)' );
  }

  noRepeatedCardinality( mode ) {
    if (this.tokens[this.tokenIdx - 2]?.type !== ']')
      return false;
    if (mode === 'M')
      return true;
    // currently just warning if same cardinality provided twice
    const same = { one: '1', many: '*' }[this.la().keyword];
    return this.tokens[this.tokenIdx - 3]?.text !== same;
  }
  noRepeatedCardinalityError( args ) {
    let openIdx = this.tokenIdx - 2;
    while (this.tokens[--openIdx].type !== '[')
      ;
    args.location = this.tokens[openIdx].location;
    args.code = '[…]';
  }

  /**
   * `;` between statements is optional only after a `}` (ex braces of structure
   * values for annotations and foreign key specifications).
   *
   * Unfortunate exception: always optional after `entity … as projection on`.
   *
   * Beware: mentioned in leanConditions, i.e. executed in predictions!
   */
  afterBrace( test, arg ) {
    if (!test) {
      if (arg === 'normal' && this.lb().type !== '}') {
        const { type, keyword } = this.la();
        if (type !== ';' && type !== '}' && type !== 'EOF' && keyword !== 'actions') {
          const prev = this.lb().location;
          const loc = new Location( prev.file, prev.endLine, prev.endCol );
          this.warning( 'syntax-missing-proj-semicolon', loc,
                        { expecting: [ "';'" ], offending: this.antlrName( this.la() ) },
                        'Missing $(EXPECTING) before $(OFFENDING)');
        }
      }
      // with arg 'init' (used in rule `start`/`artifactsBlock`), and arg 'sloppy'
      // or 'normal' (used in rule `entityDef`), set marker in dynamic context:
      if (!arg)
        this.afterBrace$ = this.tokenIdx;
      else if (arg === 'init')
        this.dynamic_.sloppySemicolon$ = [ false ];
      else if (arg === 'sloppy' || this.la().keyword === 'actions')
        this.dynamic_.sloppySemicolon$[0] = (arg === 'sloppy');
      return null;
    }
    // TODO TOOL: the following test belongs to the BaseParser.js:
    if (this.conditionTokenIdx === this.tokenIdx &&        // tested on same
        this.conditionStackLength == null && // after error recover
        test !== 'M')
      return false;
    const { sloppySemicolon$ } = this.dynamic_;
    if (!sloppySemicolon$?.[0])
      return this.afterBrace$ !== this.tokenIdx;
    if (test === true && sloppySemicolon$) // TODO: single-let mode for running parser
      sloppySemicolon$[0] = false;
    return this.afterBrace$ !== this.tokenIdx && test === 'M';
    // TODO: should we always fail for expected set (test === 'M'), at least if
    // token is not on a new line?
  }

  atRightParen() {
    return this.l() !== ')';
  }

  /**
   * For annotations at the beginning of columns outside parentheses
   */
  annoInSameLine( test ) {
    if (!test)
      this.dynamic_.safeAnno = true;
    return !this.dynamic_.safeAnno &&
      this.lb().location.line !== this.la().location.line;
  }

  /**
   * - `{}` can only appears inside array-valued annotations
   * - `...` can appear in the top-level array value only and not after `...`
   *   without `up to`.
   */
  arrayAnno( test, arg ) {
    if (!test) {
      this.dynamic_.arrayAnno = [ !this.dynamic_.arrayAnno ];
    }
    else if (arg === 'ellipsis') { // on '...'
      const { arrayAnno } = this.dynamic_;
      if (!arrayAnno[0])
        return arrayAnno[0] == null ? 'duplicate' : arg;
      arrayAnno[0] = this.tokens[this.tokenIdx + 1]?.keyword;
    }
    else if (arg === 'bracket') { // syntax-invalid-ellipsis
      // closing bracket not allowed if last `...` in array is with `up to
      return typeof this.dynamic_.arrayAnno[0] === 'string' && arg;
    }
    else {                      // orNotEmpty -> anno value must not be empty struct
      return !this.dynamic_.arrayAnno && this.lb().type === '{' && 'empty';
    }
    return false;
  }
  arrayAnnoError( args, token ) {
    if (this.conditionFailure === 'duplicate') {
      args['#'] = 'std';      // normal syntax-unexpected-token
      return null;
    }
    args.code = '...';
    args['#'] = this.conditionFailure;
    return this.error( 'syntax-invalid-anno', token, args );
  }

  beforeColon() {
    return this.tokens[this.tokenIdx + 1]?.text !== ':';
  }

  fail( mode ) {
    // TODO TOOL: the following test belongs to the BaseParser.js:
    if (this.conditionTokenIdx === this.tokenIdx &&        // tested on same
        this.conditionStackLength == null && // after error recover
        mode !== 'M')
      return false;
    return true; //  mode !== 'Y';
  }

  // Space handling etc, locations ----------------------------------------------

  // Use the following method for language constructs which we (currently) do
  // not really compile, just use to produce a CSN for functions parse.cql() and
  // parse.expr().
  // This function has a similar interface to our message functions on purpose!
  // (tokenAhead ~= location)
  csnParseOnly( msgId, tokenAhead, textArgs ) {
    if (this.options.parseOnly)
      return;
    // assumes no value < -1:
    const location = (tokenAhead > 0)
      ? this.combineLocation( this.la(), this.tokens[this.tokenIdx + tokenAhead] )
      : this.tokens[this.tokenIdx + tokenAhead].location;
    this.error( msgId, location, textArgs );
  }

  warnIfColonFollows( name ) {
    if (this.l() === ':') {
      this.warning( 'syntax-missing-parens', name,
                    { code: '@‹anno›', op: ':', newcode: '@(‹anno›…)' },
                    // eslint-disable-next-line @stylistic/js/max-len
                    'When $(CODE) is followed by $(OP), use $(NEWCODE) for annotation assignments at this position' );
    }
  }

  noAssignmentInSameLine() {
    const next = this.la();
    if (next.text === '@' && next.line <= this.lb().endLine) {
      this.warning( 'syntax-missing-semicolon', next, { code: ';' },
                    // eslint-disable-next-line @stylistic/js/max-len
                    'Add a $(CODE) and/or newline before the annotation assignment to indicate that it belongs to the next statement' );
    }
  }

  reportDubiousAnnoSpacing() {
    const at = this.lb();
    const before = this.tokens[this.tokenIdx - 2];
    if (before?.type === 'Id' && before.location.endLine === at.location.line &&
        before.location.endCol === at.location.col) {
      this.warning( 'syntax-expecting-anno-space', at.location, { code: '@' },
                    'Expecting a space before the $(CODE) starting an annotation assignment' );
    }
    this.reportUnexpectedSpace( at );
  }

  // For :param, #variant, #symbol, @(…) and @Begin and `@` inside annotation paths,
  // inside `.*` and `.{`
  reportUnexpectedSpace( prefix = this.lb(),
                         location = this.la().location,
                         isError = false ) {
    const prefixLoc = prefix.location;
    if (prefixLoc.endLine !== location.line ||
        prefixLoc.endCol !== location.col) {
      const wsLocation = {
        __proto__: Location.prototype,
        file: location.file,
        line: prefixLoc.endLine,           // !
        col: prefixLoc.endCol,             // !
        endLine: location.line,
        endCol: location.col,
      };
      if (isError) {
        this.message( 'syntax-invalid-space', wsLocation, { op: prefix.text },
                      'Delete the whitespace after $(OP)' );
      }
      else {
        this.warning( 'syntax-unexpected-space', wsLocation, { op: prefix.text },
                      'Delete the whitespace after $(OP)' );
      }
    }
    return prefixLoc;
  }

  startLocation( { location } = this.lr() ) {
    return {
      __proto__: Location.prototype,
      file: location.file,
      line: location.line,
      col: location.col,
      endLine: undefined,
      endCol: undefined,
    };
  }

  attachLocation( art ) {
    if (!art)
      return art;
    art.location ??= this.startLocation();
    if (this.s == null)         // do not set end location if error
      return art;
    const { location } = this.lb();
    art.location.endLine = location.endLine;
    art.location.endCol = location.endCol;
    return art;
  }

  ruleTokensText() {
    let tokenIdx = this.stack.at(-1).tokenIdx + 1;
    const stop = this.tokenIdx - 1;

    let { text: result, location: prev } = this.tokens[tokenIdx];
    while (++tokenIdx < stop) {
      const { text, location } = this.tokens[tokenIdx];
      if (location.line > prev.endLine ||
          location.line === prev.endLine && location.col > prev.endCol)
        result += ' ';
      result += normalizeNewLine( text );
      prev = location;
    }
    return result;
  }

  // AST building ---------------------------------------------------------------

  assignAnnotation( art, val, name, prefix = '' ) {
    const { path } = name;
    const pathname = pathName( path );
    if (!pathname)
      return;
    let absolute = '';
    if (name.variant) {
      const variant = pathName( name.variant.path );
      absolute = `${ prefix }${ pathname }#${ variant }`;
      // We do not care anymore whether we get a second '#' with flattening.  This
      // can be produced via CSN and with delimited ids anyway.  If backends care,
      // they need to have their own check.
    }
    else if (!prefix || pathname !== '$value') {
      absolute = `${ prefix }${ pathname }`;
    }
    else {
      absolute = prefix.slice( 0, -1 ); // remove final dot
    }

    val.name = name;
    if (val.$flatten) {
      for (const a of val.$flatten)
        this.assignAnnotation( art, a, a.name, `${ absolute }.` );
    }
    else {
      name.id = absolute;
      this.addAnnotation( art, `@${ absolute }`, val );
    }
    if (!prefix) {                // set deprecated $annotations for cds-lsp
      const { line, col } = name.location;
      // prefer value end-location if it exists
      const endLoc = val.location || val.name.location;
      const location = {
        __proto__: Location.prototype,
        ...endLoc,
        line,
        col,
      };
      art.$annotations ??= [];
      art.$annotations.push( { value: val, location } );
    }
  }

  addAnnotation( art, prop, anno ) {
    const old = art[prop];
    if (old) {
      this.error( 'syntax-duplicate-anno', old.name, { anno: prop },
                  'Assignment for $(ANNO) is overwritten by another one below' );
    }
    art[prop] = anno;
  }

  identAst( token = this.lb() ) {
    const { text, keyword, location } = token;
    if (keyword)          // no delimited id, see Lexer.js
      return { id: text, location };
    const close = keyword === 0 ? Infinity : -1;
    const id = (text.charAt(0) === '!')
      ? text.slice( 2, close ).replace( /]]/g, ']' )
      : text.slice( 1, close ).replace( /""/g, '"' );

    if (keyword !== 0) {
      if (!id) {
        this.message( 'syntax-invalid-name', location, {} );
      }
      else if (text.charAt(0) !== '!') {
        this.message( 'syntax-deprecated-ident', location, { delimited: id },
                      // eslint-disable-next-line @stylistic/js/max-len
                      'Deprecated delimited identifier syntax, use $(DELIMITED) - strings are delimited by single quotes' );
      }
    }
    // $delimited is used to complain about ![$self] and other magic vars usage;
    // we might complain about that already here via @arg{category}
    return { id, location, $delimited: true };
  }

  fragileAlias( safe = false ) {
    const ast = this.identAst();
    if (safe || ast.$delimited || !/^[a-zA-Z][a-zA-Z_]+$/.test( ast.id )) {
      this.warning( 'syntax-deprecated-auto-as', ast.location, { keyword: 'as' },
                    'Add keyword $(KEYWORD) in front of the alias name' );
    }
    else {                         // configurable error
      this.message( 'syntax-missing-as', ast.location, { keyword: 'as' },
                    'Add keyword $(KEYWORD) in front of the alias name' );
    }
    return ast;
  }

  identAstWithPrefix( prefix, token = this.lb() ) {
    const ast = this.identAst( token );
    const { line, col } = prefix.location;
    // TODO main: location method `withEndLocation`
    ast.location = {
      __proto__: Location.prototype,
      ...token.location,
      line,
      col,
    };
    ast.id = prefix.text + ast.id;
    return ast;
  }

  virtualOrImplicit( art ) {
    const token = this.lb();
    const ref = art.value.func || art.value;
    if (!art.virtual ||
        ref.path[0].location.tokenIndex < token.location.tokenIndex ||
        this.la().text === '{') {
      this.classifyImplicitName( 'ItemImplicit', ref );
    }
    else {
      token.parsedAs = 'ItemAlias';
      art.name = ref.path[0];
      art.value = undefined;
    }
  }

  classifyImplicitName( category, ref ) {
    if (!ref || ref.path) {     // TODO: func
      const tokenIndex = ref?.path.at(-1)?.location.tokenIndex;
      const token = this.prevTokenWithIndex( tokenIndex ) ?? this.tokens[this.tokenIdx - 1];
      const { parsedAs } = token;
      if (parsedAs && parsedAs !== 'token' && parsedAs !== 'keyword')
        token.parsedAs = category;
    }
  }

  taggedIfQuery( query ) {
    // attached actions are run even if rules ends prematurely → query can be
    // undefined
    return (query?.op && queryOps[query.op.val])
      ? { query, location: query.$parens?.at( -1 ) ?? query.location }
      : query;
  }

  addNamedArg( pathItem, idToken, expr ) {
    this.addDef( expr, pathItem, 'args', 0, this.identAst( idToken ) );
  }

  ixprAst( args ) {
    if (args.length === 1)
      return args[0];
    return this.attachLocation( { op: { val: 'ixpr', location: this.lr().location }, args } );
  }

  // Create AST node for quoted literals like string and e.g. date'2017-02-22'.
  // This function might issue a message and might change the `literal` and
  // `val` property according to `quotedLiteralPatterns` above.
  quotedLiteral( token = this.lb() ) {
    const { location, text } = token;
    let literal = 'string';
    let pos;
    let val;

    if (text.startsWith( '`' )) {
      val = token.keyword !== 0 && // 0 -> unterminated literal
        parseMultiLineStringLiteral.call( this, token ); // TODO: remove `call()` syntax
    }
    else {
      pos = text.search( '\'' ) + 1; // pos of char after quote
      val = text.slice( pos, -1 ).replace( /''/g, '\'' );
    }

    if (pos > 1)
      literal = text.slice( 0, pos - 1 ).toLowerCase();
    const p = quotedLiteralPatterns[literal] || {};

    if (p.test_fn && !p.test_fn( val ) && !this.options.parseOnly)
      this.warning( 'syntax-invalid-literal', location, { '#': p.test_variant } );

    if (p.unexpected_char) {
      const idx = val.search( p.unexpected_char );
      if (idx > -1) {
        this.warning( 'syntax-invalid-literal', {
          file: location.file,
          line: location.line,
          endLine: location.line,
          col: atChar(idx),
          endCol: atChar( idx + (val[idx] === '\'' ? 2 : 1) ),
        }, { '#': p.unexpected_variant } );
      }
    }
    return { literal, val: p.normalize?.(val) || val, location };

    function atChar( i ) {
      // Is only used with single-line strings.
      return location.col + pos + i;
    }
  }

  // If a '-' is directly before an unsigned number, consider it part of the number;
  // otherwise (including for '+'), represent it as extra unary prefix operator.
  signedExpression( ixpr, expr ) {
    // if (args.length !== 1) throw new CompilerAssertion()
    const sign = ixpr.args[0];
    const nval
          = (sign.val === '-' &&
             expr && // expr may be null if `-` rule can't be parsed
             expr.literal === 'number' &&
             sign.location.endLine === expr.location.line &&
             sign.location.endCol === expr.location.col &&
             ( typeof expr.val === 'number'
               ? expr.val >= 0 && -expr.val
               : !expr.val.startsWith('-') && `-${ expr.val }`)) || false;
    if (nval === false) {
      ixpr.args.push( expr );
      return this.attachLocation( ixpr );
    }
    expr.val = nval;
    --expr.location.col;
    return expr;
  }

  /**
   * Given `token`, return a number literal (XSN).  If the number is not an unsigned integer
   * or it can't be represented in JS, emit an error.
   */
  unsignedIntegerLiteral() {
    const token = this.lb();
    const { location } = token;
    const text = token.text || '0';
    const num = Number.parseFloat( text ); // not Number.parseInt() !
    if (!Number.isSafeInteger(num)) {
      this.error( 'syntax-expecting-unsigned-int', token,
                  { '#': !text.match(/^\d*$/) ? 'normal' : 'unsafe' } );
    }
    else if (text.match(/^\d+[.]\d+$/)) {
      // More restrictive check: 10.0 emits a message, because we don't expect
      // any decimal places.
      const dotLoc = { ...location };
      dotLoc.col += text.indexOf('.');
      dotLoc.endCol = dotLoc.col + 1;
      this.info( 'syntax-ignoring-decimal', dotLoc );
    }
    return { literal: 'number', val: num, location };
  }

  numberLiteral( sign = null ) {
    const token = this.lb();
    let { location } = token;
    const { keyword, location: nextLoc } = this.la();
    if (keyword &&             // is only set with keyword and/or non-delimited Id
        nextLoc.line === location.endLine && nextLoc.col === location.endCol) {
      this.message( 'syntax-expecting-space', nextLoc, {},
                    'Expecting a space between a number and a keyword/identifier' );
    }

    const text = (sign) ? sign.text + token.text : token.text;
    if (sign) {
      this.reportUnexpectedSpace( sign, location );
      location = {
        __proto__: Location.prototype,
        ...sign.location,
        endLine: location.endLine,
        endCol: location.endCol,
      };
    }
    const val = Number.parseFloat( text || '0' ); // not Number.parseInt() !
    const normalized = normalizeNumberString( text );
    if (normalized === `${ val }` || sign && normalized === `${ sign.text }${ val }`)
      return { literal: 'number', val, location };
    return { literal: 'number', val: normalized, location };
  }

  adjustAnnoNumber( value ) {
    const { val } = value;
    if (value.literal !== 'number' || typeof val === 'number')
      return;
    // a number in CDL, but stored as string in `val` - due to rounding or scientific notation
    const num = Number.parseFloat( val || '0' );
    const infinite = !Number.isFinite( num );
    if (infinite || relevantDigits( val ) !== relevantDigits( num.toString() )) {
      this.warning( 'syntax-invalid-anno-number', value,
                    { '#': (infinite ? 'infinite' : 'rounded' ), rawvalue: val, value: num },
                    {
                      std: 'Annotation number $(RAWVALUE) is put as $(VALUE) into the CSN',
                      rounded: 'Annotation number $(RAWVALUE) is rounded to $(VALUE)',
                      // eslint-disable-next-line @stylistic/js/max-len
                      infinite: 'Annotation value $(RAWVALUE) is infinite as number and put as string into the CSN',
                    } );
    }
    if (!infinite)
      value.val = num;
  }

  /**
   * Store doc comment between previous and current token as `art.doc`.  If `art`
   * is not provided (with EOF), just complain about remaining doc comment tokens.
   *
   * The doc comment token is not a “standard” token for the following reasons:
   *  - misplaced doc comments would lead to a parse error (incompatible),
   *  - would influence the prediction and error recovery,
   *  - is only slightly "more declarative" in the grammar.
   */
  docComment( art ) {
    const { line: prevLine, col: prevCol } = this.lb()?.location ?? { line: 0, col: 0 };
    const { line: currLine, col: currCol } = (this.la() ?? this.lb()).location;
    let token;
    for (;;) {
      token = this.docComments[this.docCommentIndex];
      if (!token)
        return;                 // no further doc comment
      // TODO: we could use location.tokenIndex
      const { line, col } = token.location;
      if (art && (line > currLine || line === currLine && col > currCol))
        return;               // next doc comment after current token

      ++this.docCommentIndex;
      if (!art || line < prevLine || line === prevLine && col < prevCol) {
        if (this.options.docComment !== false) {
          this.info( 'syntax-ignoring-doc-comment', token.location, {},
                     'Ignoring doc comment as it is not written at a defined position' );
        }
      }
      else { // next doc comment between previous & current token
        // With explicit docComment:false, we don't emit a warning.
        if (art.doc && this.options.docComment !== false) {
          this.warning( 'syntax-duplicate-doc-comment', art.doc, {},
                        'Doc comment is overwritten by another one below' );
        }
        token.parsedAs = 'doc';
        const val = !this.options.docComment || parseDocComment( token.text );
        art.doc = { val, location: token.location };
      }
    }
  }

  // TODO: can we remove `;`/EOF from the expected-set for `annotate Foo with ⎀`?
  checkWith( keyword ) {
    if (this.lb() !== keyword)
      return;
    const tok = this.la();
    const docTokenIndex = this.docCommentIndex &&
          this.docComments[this.docCommentIndex - 1].location.tokenIndex;
    if (docTokenIndex < tok.location.tokenIndex &&
        docTokenIndex > this.lb().location.tokenIndex)
      return;
    // filter out what comes after current rule (no generic way necessary):
    const expecting = this.expectingArray().filter( t => t !== '<EOF>' && t !== '\'}\'' );
    const msg = this.warning( 'syntax-unexpected-semicolon', tok,
                              { offending: this.antlrName( tok ), expecting, keyword: 'with' },
                              // eslint-disable-next-line @stylistic/js/max-len
                              'Unexpected $(OFFENDING), expecting $(EXPECTING) - ignored previous $(KEYWORD)' );
    msg.expectedTokens = expecting;
  }

  setNullability( art, val, location = this.lb().location ) {
    const notNull = { val, location };
    if (art.notNull) {
      // complain about the second
      this.reportDuplicateClause( 'notNull', notNull, art.notNull,
                                  (val ? 'not null' : 'null') );
    }
    else {
      art.notNull = notNull;
    }
  }

  setAssocAndComposition( art, assoc, card, target = {} ) {
    const { location } = assoc;
    art.type = {
      path: [ { id: keywordTypeNames[assoc.keyword], location } ],
      scope: 'global',
      location,
    };
    art.target = target;
    if (!card)
      return target;

    const targetMax = (card.keyword === 'one')
      ? { val: 1, literal: 'number', location: card.location }
      : { val: '*', literal: 'string', location: card.location };
    // TODO: `literal` needed?
    if (art.cardinality) {
      this.reportDuplicateClause( 'cardinality', targetMax, art.cardinality.targetMax,
                                  card.keyword );
    }
    else {
      art.cardinality = { targetMax, location: targetMax.location };
    }
    return target;
  }

  // see also <guard=nestedExpand>
  reportExpandInline( column, isInline ) {
    // called before matching `{`
    if (column.value && !column.value.path) {
      // improve error location when using "inline" `.{…}` after ref (arguments and
      // filters not covered, not worth the effort); after an expression where
      // the last token is an identifier, not the `.` is wrong, but the `{`:
      const token = (isInline && this.tokens[this.tokenIdx - 2].type !== 'Id')
        ? this.lb()
        : this.la();
      this.error( 'syntax-unexpected-nested-proj', token,
                  { code: isInline ? '.{ ‹inline› }' : '{ ‹expand› }' },
                  'Unexpected $(CODE); nested projections can only be used after a reference' );
      // continuation semantics:
      // - add elements anyway (could lead to duplicate errors as usual)
      // - no errors for refs inside expand/inline, but for refs in sibling expr
      // - think about: reference to these (sub) elements from other view
    }
  }

  reportDuplicateClause( prop, erroneous, chosen, code ) {
    // probably easier for message linters not to use (?:) for the message id...?
    const args = {
      '#': prop,
      code,
      line: chosen.location.line,
      col: chosen.location.col,
    };
    if (erroneous.val === chosen.val)
      this.message( 'syntax-duplicate-equal-clause', erroneous.location, args );
    // TODO extra msg text 'syntax-duplicate-clause' for noRepeatedCardinality()
  }

  setTypeFacet( art, name, value ) {
    const { text } = name;
    if (text !== 'length' && text !== 'scale' && text !== 'precision' && text !== 'srid') {
      this.error( 'syntax-undefined-param', name.location, { name: text },
                  'There is no type parameter called $(NAME)');
    }
    else {
      if (art[text] !== undefined)
        this.error( 'syntax-duplicate-argument', art[text].location, { '#': 'type', name: text } );
      // continuation semantics: use last
      art[text] = value;
    }
  }

  // TODO: remove the check from the parser; move it to shared.js
  checkTypeArgs( art ) {
    const args = art.$typeArgs;
    // One or two arguments are interpreted as either length or precision/scale.
    if (args.length > 2) {
      const loc = args[2].location;
      this.error( 'syntax-unexpected-argument', loc, {}, 'Too many type arguments' );
      art.$typeArgs.length = 0;
    }
  }

  locationOfPrevTokens( offset ) {
    // TODO: use combined location of lb() and la() and move actions accordingly
    // (for error recovery)
    const { file, line, col } = this.tokens[this.tokenIdx - offset].location;
    const { endLine, endCol } = this.lb().location;
    return {
      file,
      line,
      col,
      endLine,
      endCol,
    };
  }

  // TODO: also define method `combineWith` in Location
  combineLocation( { location: start }, { location: end } = this.lb() ) {
    const { file, line, col } = start;

    return {
      file, line, col, endLine: end.endLine, endCol: end.endCol,
    };
  }

  // `tokenIndex` is index in “combined” token array (parsing-relevant, doc
  // comments, comments) → cannot be used directly
  prevTokenWithIndex( tokenIndex ) {
    if (tokenIndex != null) {
      let { tokenIdx } = this;
      while (--tokenIdx >= 0) {
        const token = this.tokens[tokenIdx];
        if (token.location.tokenIndex === tokenIndex)
          return token;
      }
    }
    return null;
  }

  // TODO: rename to `valAst`
  valueWithLocation( val = undefined, token = this.lb() ) {
    if (val === undefined)
      val = token.keyword ?? token.text;
    return { val, location: token.location };
  }

  surroundByParens( expr, open = this.lr(), close = this.lb() ) {
    expr.$parens ??= [];
    expr.$parens.push( this.combineLocation( open, close ) );
    return expr;
  }

  // make sure that the parens of `IN (…)` do not disappear:
  secureParens( expr ) {
    const op = expr?.op?.val;
    const $parens = expr?.$parens;
    if (!$parens || expr.query || op && op !== 'call' && op !== 'cast')
      return expr;
    // ensure that references, literals and functions keep their surrounding parentheses
    // (is for expressions the case anyway)
    const location = $parens.pop();
    if (!$parens.length)
      delete expr.$parens;
    return {
      op: { val: 'xpr', location: this.startLocation() },
      args: [ expr ],
      location,
    };
  }

  pushXprToken( expr ) {
    const token = this.lb();
    (expr.args ?? expr).push?.( {
      val: token.keyword ?? token.type,
      location: token.location,
      literal: 'token',
    } );
  }

  applyOpToken( expr, nary = null ) {
    const token = this.lb();
    const op = { val: token.keyword ?? token.type, location: token.location, literal: 'token' };
    if (nary === 'nary' && expr && !expr.$parens) {
      const { args } = expr;
      const prev = args?.[1];
      if (prev?.val === op.val && prev?.literal === 'token') {
        args.push( op );
        return expr;
      }
    }
    return {
      op: { val: nary ?? 'ixpr', location: token.location },
      args: (expr ? [ expr, op ] : [ op ] ),
    };
  }

  valuePathAstWithNew( expr, path ) {
    path = this.valuePathAst( path );
    if (path.op?.val !== 'ixpr') {
      expr.args.push( path );
    }
    else {
      const ref = path.args[0];
      const op = { val: 'ixpr', location: expr.args[0].location };
      const location = this.combineLocation( expr.args[0], ref );
      path.args[0] = { op, args: [ expr.args[0], ref ], location };
      expr.args = path.args;
    }
    this.attachLocation( expr );
  }

  valuePathAst( ref ) {
    // TODO: XSN representation of functions is a bit strange - rework
    // TODO: rework this function
    const { path } = ref;
    if (path?.length === 1) {
      const { args, id, location } = path[0];
      if (args
          ? path[0].$syntax === ':'
          : path[0].$delimited || !functionsWithoutParentheses.includes( id.toUpperCase() ))
        return this.attachLocation( ref );

      const funcToken = this.prevTokenWithIndex( location.tokenIndex );
      // TODO: we could have an opt(?) parameter funcToken for speed-up (passing this.lr())
      if (funcToken)
        funcToken.parsedAs = 'func';

      const filter = path[0].cardinality || path[0].where; // XSN TODO: filter$location
      if (filter) // TODO v7: make this be reported via guard, as error
        this.message( 'syntax-unexpected-filter', filter.location, {} );
      // TODO: XSN representation of functions is a bit strange - rework
      return this.attachLocation( {
        op: { location, val: 'call' },
        func: ref,
        args,
        location: ref.location,
      } );
    }

    // $syntax === ':' => path(P: 1)
    // $syntax !== ':' => path(P => 1) or path(1) or path()
    const firstFunc = path.findIndex( i => i.args && i.$syntax !== ':' );
    if (firstFunc === -1) // also covers empty paths
      return ref;

    // Method Call ---------------------------
    // Transform the path into `.`-operators.
    // Everything after the first function is also a function, and not a reference.

    for (let i = firstFunc; i < path.length; ++i) {
      const item = path[i];
      if (item.args && item.$syntax === ':') {
        // Error for `a(P => 1).b.c(P: 1)`: no ref after function.
        // TODO v6: make this be reported via guard
        this.error( 'syntax-invalid-ref', item.args[$location], {
          // TODO: msg text - huh? → syntax-invalid-named-arg ?
          code: '=>',
        }, 'References after function calls can\'t be resolved. Use $(CODE) in function arguments');
      }
      const filter = item.cardinality || item.where; // XSN TODO: filter$location
      if (filter) // TODO v7: make this be reported via guard, as error
        this.message( 'syntax-unexpected-filter', filter.location, {} );
    }

    const args = [];
    if (firstFunc > 0) {
      args.push({
        path: path.slice(0, firstFunc),
        location: this.combineLocation( path[0], path[path.length - 1] ),
      });
    }

    const pathRest = path.slice(firstFunc);
    for (const method of pathRest) {
      if (method !== pathRest[0] || firstFunc > 0) {
        args.push({
          // TODO: Update parser to have proper location for `.`?
          location: this.startLocation( method ),
          val: '.',
          literal: 'token',
        });
      }
      // this.prevTokenWithIndex( method.location.tokenIndex ).parsedAs = 'func';
      const func = {
        op: { location: method.location, val: 'call' },
        func: { path: [ method ] },
        location: method.location,
      };
      if (method.args)
        func.args = method.args;
      args.push(func);
    }

    return {
      op: { val: 'ixpr', location: this.startLocation() },
      args,
      location: ref.location,
    };
  }

  // no extra message syntax-unexpected-assoc for guard failure
  associationInSelectItem( art ) {
    if (art.name)
      return;
    this.classifyImplicitName( 'ItemAssoc', art.value );
    const path = art.value?.path;
    if (path?.length) {
      art.name = path.at( -1 ); // usually length 1, but make it also work during error recovery
      delete art.value;
    }
  }

  // must be in action directly after having parsed '{', '(`, or a keyword before
  createDict( start ) {
    const dict = Object.create(null);
    dict[$location] = this.startLocation( start || this.lb() );
    return dict;
  }

  // must be in action directly after having parsed '[' or '(` or `{`
  createArray( start ) {
    const array = [];
    array[$location] = this.startLocation( start || this.lb() );
    return array;
  }

  // must be in action directly after having parsed '}' or ')`
  finalizeDictOrArray( dict ) {
    const loc = dict[$location];
    if (!loc)
      return;
    const stop = this.lb().location;
    loc.endLine = stop.endLine;
    loc.endCol = stop.endCol;
  }

  finalizeExtensionsDict( dict ) {
    this.finalizeDictOrArray( dict );
    for (const name in dict) {
      const def = dict[name];
      if (!def.$duplicates)
        continue;

      if (def.kind !== 'annotate') {
        const numDefines
              = def.$duplicates.reduce( addOneForDefinition, addOneForDefinition( 0, def ) );
        this.handleDuplicateExtension( def, name, numDefines );
        for (const dup of def.$duplicates)
          this.handleDuplicateExtension( dup, name, numDefines );
        continue;
      }
      // move annotations, 'doc' and 'elements' etc to main member
      for (const dup of def.$duplicates) {
        for (const prop of Object.keys( dup )) {
          if (prop.charAt(0) === '@') {
            this.addAnnotation( def, prop, dup[prop] );
            delete dup[prop]; // we want to keep $duplicates, but not have duplicate props
          }
          else if (prop === 'doc') {
            // With explicit docComment:false, we don't emit a warning.
            if (def.doc && this.options.docComment !== false) {
              this.warning( 'syntax-duplicate-doc-comment', def.doc.location, {},
                            'Doc comment is overwritten by another one below' );
            }
            def.doc = dup.doc;
            delete dup[prop]; // we want to keep $duplicates for LSP, but not have duplicate props
          }
          else if (extensionDicts[prop]) {
            if (def[prop])
              this.message( 'syntax-duplicate-annotate', [ def.name.location ], { name, prop } );
            def[prop] = dup[prop]; // continuation semantics: last wins
            delete dup[prop]; // we want to keep $duplicates for LSP, but not have duplicate props
          }
        }
        if (dup.$annotations) {   // update deprecated $annotations for cds-lsp / annotation modeler
          if (def.$annotations)
            def.$annotations.push( ...dup.$annotations );
          else
            def.$annotations = dup.$annotations;
        }
      }
      // We keep duplicate statements for LSP, as it needs to traverse all
      // identifiers; annotations were removed above to avoid traversing
      // annotations twice.
    }
  }

  /**
   * Handle duplicate extensions.  Does not handle `annotate`.
   *
   * @param {XSN.Extension} ext
   * @param {string} name
   * @param {number} numDefines
   */
  handleDuplicateExtension( ext, name, numDefines ) {
    if (ext.kind === 'extend') {
      this.error( 'syntax-duplicate-extend', [ ext.name.location ],
                  { name, '#': (numDefines ? 'define' : 'extend') } );
    }
    else if (numDefines === 1) {
      ext.$errorReported = 'syntax-duplicate-extend';
    } // a definition, but not duplicate
  }

  // Add new definition `art` to dictionary property `env` of node `parent`.
  // Return `art`.
  //
  // If argument `kind` is provided, set `art.kind` to that value.
  // If argument `name` is provided, set `art.name`:
  //  - if `name` is an array, `name.id` consist of the ID of the last array item
  //    (for elements via columns, foreign keys, table aliases)
  //  - if `name` is an object, `name.id` is either set, or the (local) name is calculated
  //    from the IDs of all items in `name.path` (for main artifact definitions).
  addDef( art, parent, env, kind, name ) {
    if (!art)
      return art; // parser error

    if (Array.isArray(name)) {
      const last = name.length && name[name.length - 1];
      art.name = { // A.B.C -> 'C'
        id: last?.id || '', location: last.location, $inferred: 'as',
      };
    }
    else if (name) {
      art.name = name;
      if (!name.id && kind === null) {
        name.id = name.variant
          ? `${ pathName( name.path ) }#${ pathName( name.variant.path ) }`
          : pathName( name.path );
      }
    }
    else {
      art.name = { id: '' };
    }
    if (kind)
      art.kind = kind;

    const id = art.name?.id || pathName( art.name?.path ); // returns '' for corrupted name

    parent[env] ??= Object.create(null);
    if (env === 'artifacts' || env === 'vocabularies') {
      dictAddArray( parent[env], id, art );
    }
    else if (kind || this.options.parseOnly) { // TODO: do not check parseOnly
      dictAdd( parent[env], id, art );
    }
    else {
      dictAdd( parent[env], id, art, ( duplicateName, loc ) => {
        // do not use function(), otherwise `this` is wrong:
        if (kind === 0) {
          this.error( 'syntax-duplicate-argument', loc, { name: duplicateName },
                      'Duplicate value for parameter $(NAME)' );
        }
        else if (kind === '') {
          this.error( 'syntax-duplicate-excluding', loc,
                      { name: duplicateName, keyword: 'excluding' } );
        }
        else {
          this.error( 'syntax-duplicate-property', loc, { name: duplicateName },
                      'Duplicate value for structure property $(NAME)' );
        }
      } );
    }
    return art;
  }

  /**
   * Add `annotate/extend Main.Artifact:elem.sub` to `‹xsn›.extensions`:
   * - the array item is an extend/annotate for `Main.Artifact`,
   * - for each path item in `elem.sub`, we add an `elements` property containing
   *   one extend/annotate for the corresponding element
   * - The deepest extend/annotate is the object which is to be extended
   *
   * @param {object} ext The object containing the location and annotations for the extension.
   * @param {object} parent The parent containing the `extensions` property, i.e. the source.
   * @param {string} kind Either `annotate` or `extend`.
   * @param {object} artName The "name object" for `Main.Artifact`.
   * @param {XSN.Path} elemPath Path as returned by `simplePath` rule.
   */
  addExtension( ext, parent, kind, artName, elemPath ) {
    const { location } = ext;
    if (!Array.isArray( elemPath ) || !elemPath.length) {
      ext.kind = kind;
      ext.name = artName;
      parent.extensions.push( ext );
      return;
    }
    // Note: the element extensions share a common `location`, also with the
    // extension of the main artifact; its end location will usually set later
    const main = { kind, name: artName, location };
    parent.extensions.push( main );
    parent = main;

    const last = elemPath[elemPath.length - 1];
    for (const seg of elemPath) {
      parent.elements = Object.create(null); // no dict location → no createDict()
      parent = this.addDef( (seg === last ? ext : { location }),
                            parent, 'elements', kind, seg );
    }
  }

  // For compatibility with ANTLR-based parser:
  antlrName( type ) {
    if (typeof type !== 'string') {
      type = (!type.parsedAs && this.keywords[type.keyword ?? ''] != null ||
              type.parsedAs === 'keyword') && type.keyword || type.type;
    }
    if (/^[A-Z]+/.test( type ))// eslint-disable-next-line no-nested-ternary
      return (type === 'Id') ? 'Identifier' : (type === 'EOF') ? '<EOF>' : type;
    return (/^[a-z]+/.test( type )) ? type.toUpperCase() : `'${ type }'`;
  }
}

function addOneForDefinition( count, ext ) {
  return (ext.kind === 'extend') ? count : count + 1;
}

// Significant digits (before exponent) without leading and trailing zeros
function relevantDigits( val ) {
  // eslint-disable-next-line sonarjs/slow-regex
  val = val.replace( /e.+$/i, '' ); // this regex has no newlines -> is not slow

  const init = /^[-+0.]+/g;     // global flag to have lastIndex
  const zeros = /[0.]+/g;
  if (init.test( val ))         // sets init.lastIndex
    zeros.lastIndex = init.lastIndex;

  let r;
  while ((r = zeros.exec( val )) != null && zeros.lastIndex < val.length)
    ;
  return val.slice( init.lastIndex, r?.index ).replace( /\./, '' );
}


// Used for sorting in messages (TODO: make it part of messages.js?)
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

module.exports = AstBuildingParser;
