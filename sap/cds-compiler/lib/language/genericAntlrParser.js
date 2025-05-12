// Generic ANTLR parser class with AST-building functions

// To have an AST also in the case of syntax errors, produce it by adding
// sub-nodes to a parent node, not by returning sub-ASTs (the latter is fine
// for secondary attachments).

'use strict';

const antlr4 = require('antlr4');
const { ATNState } = require('antlr4/src/antlr4/atn/ATNState');
const { DEFAULT: CommonTokenFactory } = require('antlr4/src/antlr4/CommonTokenFactory');
const { dictAdd, dictAddArray } = require('../base/dictionaries');
const locUtils = require('../base/location');
const { parseDocComment } = require('./docCommentParser');
const { parseMultiLineStringLiteral } = require('./multiLineStringParser');
const {
  specialFunctions,
  quotedLiteralPatterns,
} = require('../compiler/builtins');
const { functionsWithoutParentheses } = require('../parsers/identifiers');
const { Location } = require('../base/location');
const { pathName } = require('../compiler/utils');
const { XsnArtifact, XsnName, XsnSource } = require('../compiler/xsn-model');
const { isBetaEnabled } = require('../base/model');
const { weakLocation } = require('../base/location');
const { normalizeNewLine, normalizeNumberString } = require('./textUtils');

const $location = Symbol.for('cds.$location');

// Push message `msg` with location `loc` to array of errors:
function _message( parser, severity, id, loc, ...args ) {
  const msg = parser.$messageFunctions[severity]; // set in antlrParser.js
  if (loc instanceof antlr4.CommonToken)
    loc = parser.tokenLocation(loc);
  return msg( id, loc, ...args );
}

// Class which is to be used as grammar option with
//   grammar <name> options { superclass = genericAntlrParser; }
//
// The individual AST building functions are to be used with
//   this.<function>(...)
// in the actions inside the grammar.
//
class GenericAntlrParser extends antlr4.Parser {
  constructor( ...args ) {
    // ANTLR restriction: we cannot add parameters to the constructor.
    super( ...args );
    this.buildParseTrees = false;

    // Common properties.
    // We set them here so that they are available in the prototype.
    // This improved performance by 25% for certain scenario tests.
    // Probably because there was no need to look up the prototype chain anymore.
    this.$adaptExpectedToken = null;
    this.$adaptExpectedExcludes = [ ];
    this.$nextTokensToken = null;
    this.$nextTokensContext = null;

    this.options = {};

    this.genericFunctionsStack = [];
    this.$genericKeywords = specialFunctions[''][1];
  }
}

// TODO: Use actual methods.
Object.assign(GenericAntlrParser.prototype, {
  message(...args) {
    return _message( this, 'message', ...args );
  },
  error(...args) {
    return _message( this, 'error', ...args );
  },
  warning(...args) {
    return _message( this, 'warning', ...args );
  },
  info(...args) {
    return _message( this, 'info', ...args );
  },
  isBetaEnabled,
  attachLocation,
  assignAnnotation,
  addAnnotation,
  expressionAsAnnotationValue,
  checkExtensionDict,
  handleDuplicateExtension,
  startLocation,
  tokenLocation,
  isMultiLineToken,
  fixMultiLineTokenEndLocation,
  valueWithTokenLocation,
  previousTokenAtLocation,
  combinedLocation,
  surroundByParens,
  tokensToStringRepresentation,
  secureParens,
  unaryOpForParens,
  leftAssocBinaryOp,
  classifyImplicitName,
  warnIfColonFollows,
  fragileAlias,
  identAst,
  reportPathNamedManyOrOne,
  reportVirtualAsRef,
  reportMissingSemicolon,
  pushXprToken,
  pushOpToken,
  argsExpression,
  valuePathAst,
  fixNewKeywordPlacement,
  signedExpression,
  numberLiteral,
  unsignedIntegerLiteral,
  assignAnnotationValue,
  quotedLiteral,
  pathName,
  docComment,
  addDef,
  addItem,
  addExtension,
  createSource,
  createDict,
  createArray,
  finalizeDictOrArray,
  insertSemicolon,
  setMaxCardinality,
  setNullability,
  reportDuplicateClause,
  reportUnexpectedExtension,
  reportUnexpectedSpace,
  pushIdent,
  pushItem,
  handleComposition,
  associationInSelectItem,
  reportExpandInline,
  checkTypeFacet,
  checkTypeArgs,
  csnParseOnly,
  markAsSkippedUntilEOF,
  noAssignmentInSameLine,
  noSemicolonHere,
  setLocalToken,
  setLocalTokenIfBefore,
  setLocalTokenForId,
  excludeExpected,
  isStraightBefore,
  meltKeywordToIdentifier,
  prepareGenericKeywords,
  reportErrorForGenericKeyword,
  parseMultiLineStringLiteral,
  XsnArtifact,
  XsnName,
});

// Use the following function for language constructs which we (currently)
// just being able to parse, in able to run tests from HANA CDS.  As soon as we
// create ASTs for the language construct and put it into a CSN, a
// corresponding check should actually be inside the compiler, because the same
// language construct can come from a CSN as source.
// TODO: this is not completely done this way

// Use the following function for language constructs which we (currently) do
// not really compile, just use to produce a CSN for functions parse.cql() and
// parse.expr().
// This function has a similar interface to our message functions on purpose!
// (tokens ~= location)
function csnParseOnly( msgId, tokens, textArgs ) {
  if (!msgId || this.options.parseOnly)
    return;
  const loc = this.tokenLocation( tokens[0], tokens[tokens.length - 1] );
  this.error( msgId, loc, textArgs );
}

/**
 * Do not propose a `;` or closing brace `}` at this position.
 *
 * Attention: May conflict with excludeExpected()!
 *
 * @this {object}
 * */
function noSemicolonHere() {
  const handler = this._errHandler;
  const t = this.getCurrentToken();
  this.$adaptExpectedToken = t;
  this.$adaptExpectedExcludes = [ "';'", "'}'" ];
  this.$nextTokensToken = t;
  this.$nextTokensContext = null; // match() of WITH does not reset
  this.$nextTokensState = ATNState.INVALID_STATE_NUMBER;
  if (t.text === ';' && handler && handler.reportIgnoredWith )
    handler.reportIgnoredWith( this, t );
}

/**
 * Using this function "during ATN decision making" has no effect
 * In front of an ATN decision, you might specify dedicated excludes
 * for non-LA1 tokens via a sub-array in excludes[0].
 * TODO: consider $nextTokens…, see commented use in rule `elementProperties`
 *
 * Usage Note:
 *   Must be used at all positions where sync() is called in the generated coding.
 *   ```antlr4
 *   { this.excludeExpected(['ACTIONS']); }
 *   ( WITH { this.excludeExpected(['ACTIONS']); } )?
 *   annotationAssignment_ll1[ $art ]* { this.excludeExpected(['ACTIONS']); }
 *   ACTIONS
 *   ```
 */
function excludeExpected( excludes ) {
  if (excludes) {
    // @ts-ignore
    const t = this.getCurrentToken();
    this.$adaptExpectedToken = t;
    this.$adaptExpectedExcludes = Array.isArray(excludes) ? excludes : [ excludes ];
    this.$nextTokensToken = t;
    this.$nextTokensContext = null;
  }
}

function setLocalToken( string, tokenName, notBefore, inSameLine ) {
  const ll1 = this.getCurrentToken();
  if (ll1.text.toUpperCase() === string &&
      (!inSameLine || this._input.LT(-1).line === ll1.line) &&
      (!notBefore || !notBefore.test( this._input.LT(2).text )))
    ll1.type = this.constructor[tokenName];
}

function setLocalTokenIfBefore( string, tokenName, before, inSameLine ) {
  const ll1 = this.getCurrentToken();
  if (ll1.text.toUpperCase() === string &&
      (!inSameLine || this._input.LT(-1).line === ll1.line) &&
      (!before || before && before.test( this._input.LT(2).text )))
    ll1.type = this.constructor[tokenName];
}

function setLocalTokenForId( offset, tokenNameMap ) {
  const tokenName = tokenNameMap[this._input.LT( offset ).text.toUpperCase() || ''];
  const ll1 = this.getCurrentToken();
  if (tokenName &&
      (ll1.type === this.constructor.Identifier || /^[a-zA-Z_]+$/.test( ll1.text )))
    ll1.type = this.constructor[tokenName];
  return !!tokenName;
}

// // Special function for rule `requiredSemi` before return $ctx
// function braceForSemi() {
//   if (RBRACE == null)
//     RBRACE = this.literalNames.indexOf( "'}'" );
//   console.log(RBRACE)
//   // we are called before match('}') and this.state = ...
//   let atn = this._interp.atn;
//   console.log( atn.nextTokens( atn.states[ this.state ], this._ctx ) )
//   let next = atn.states[ this.state ].transitions[0].target;
//   // if a '}' is not possible in the grammar after the fake-'}', throw error
//   if (!atn.nextTokens( next, this._ctx ).contains(RBRACE))
//     console.log( atn.nextTokens( next, this._ctx ) )
//     // throw new antlr4.error.InputMismatchException(this);
// }

function markAsSkippedUntilEOF() {
  let t = this.getCurrentToken();
  if (t.type === antlr4.Token.EOF)
    return;
  if (!t.$isSkipped && !this._errHandler.inErrorRecoveryMode( this )) {
    // If not already done, we should report an error if we do not see EOF.  We cannot
    // use match() here, because these would consume tokens without marking them.
    this._errHandler.reportUnwantedToken( this, [ '<EOF>' ] );
    t.$isSkipped = 'offending';
    this.consume();
    t = this.getCurrentToken();
  }
  while (t.type !== antlr4.Token.EOF) {
    t.$isSkipped = true;
    this.consume();
    t = this.getCurrentToken();
  }
}

function noAssignmentInSameLine() {
  const t = this.getCurrentToken();
  if (t.text === '@' && t.line <= this._input.LT(-1).line) {
    // TODO: use 'syntax-missing-newline'
    this.warning( 'syntax-missing-semicolon', t, { code: ';' },
                  // eslint-disable-next-line @stylistic/js/max-len
                  'Add a $(CODE) and/or newline before the annotation assignment to indicate that it belongs to the next statement' );
  }
}

// Use after matching ',' to allow ',' in front of the closing paren.  Be sure
// that you know what to do if successful - break/return/... = check the
// generated grammar; inside loops, you can use `break`.  This function is
// still the preferred way to express an optional ',' at the end, because it
// does not influence the error reporting.  It might also allow to match
// reserved keywords, because there is no ANTLR generated decision in front of it.
function isStraightBefore( closing ) {
  return this.getCurrentToken().text === closing;
}

function meltKeywordToIdentifier( exceptTrueFalseNull = false ) {
  const { Identifier } = this.constructor;
  const token = this.getCurrentToken() || { type: Identifier };
  if (token.type < Identifier && /^[a-z]+$/i.test( token.text ) &&
      !(exceptTrueFalseNull && /^(true|false|null)$/i.test( token.text )))
    token.type = Identifier;
}

const genericTokenTypes = {
  expr: 'GenericExpr',
  separator: 'GenericSeparator',
  intro: 'GenericIntro',
};

/**
 * @memberOf GenericAntlrParser
 *
 * @param pathItem
 * @param [expected]
 */
function prepareGenericKeywords( pathItem, expected = null ) {
  const length = pathItem?.args?.length || 0;
  const argPos = length;
  const func = pathItem?.id && specialFunctions[pathItem.id.toUpperCase()];
  const spec = func && func[argPos] || specialFunctions[''][argPos ? 1 : 0];
  this.$genericKeywords = spec;
  // @ts-ignore
  const token = this.getCurrentToken() || { text: '' };
  const text = token.text.toUpperCase();
  let generic = spec[text];
  // console.log('PGK:',token.text,generic,expected,spec,func,argPos)
  if (expected) {               // 'separator' or 'expr' (after 'separator')
    if (generic !== expected)
      return;
  }
  else if (!generic || generic === 'separator') {
    // Mismatch at beginning (or just an expression): keep token type
    // (if not expression, issue error and consider the token to be an
    // expression replacement, like ALL)
    return;
  }
  else if (generic === 'expr' && spec.intro && spec.intro.includes( text )) {
    // token is both an intro and an expression, like LEADING for TRIM
    const next = this._input.LT(2).text;
    if (!next || // followed by EOF -> consider it to be 'intro', better for CC
        next !== ',' && next !== ')' && spec[next.toUpperCase()] !== 'separator')
      generic = 'intro';        // is intro if next token is not separator, not ',', ')'
  }
  // @ts-ignore
  token.type = this.constructor[genericTokenTypes[generic]];
}
// To be called before having matched ( HideAlternatives | … )
function reportErrorForGenericKeyword() {
  this._errHandler.reportUnwantedToken( this );
  // this._errHandler.reportInputMismatch( this, { offending: this._input.LT(1) }, null );
}

// Attach location matched by current rule to node `art`.  If a location is
// already provided, only set the end location.  Use this function only
// in @after actions of parser rules, as the end position is only available
// there.
function attachLocation( art ) {
  if (!art || art.$parens)
    return art;
  if (!art.location) {
    art.location = this.tokenLocation(this._ctx.start, this._ctx.stop);
    return art;
  }
  if (!this._ctx.stop)
    return art;

  // The last token (this._ctx.stop) may be a multi-line string literal, in which
  // case we can't rely on `this._ctx.stop.line`.
  if (this.isMultiLineToken(this._ctx.stop)) {
    this.fixMultiLineTokenEndLocation(this._ctx.stop, art.location);
  }
  else {
    const { stop } = this._ctx;
    art.location.endLine = stop.line;
    // after the last char (special for EOF?)
    art.location.endCol = stop.stop - stop.start + stop.column + 2;
  }

  return art;
}

function assignAnnotation( art, anno, prefix = '' ) {
  const { name, $flatten } = anno;
  const { path } = name;
  if (path.broken || !path[path.length - 1].id)
    return;
  const pathname = pathName( path );
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

  if ($flatten) {
    for (const a of $flatten)
      this.assignAnnotation( art, a, `${ absolute }.` );
  }
  else {
    name.id = absolute;
    this.addAnnotation( art, `@${ absolute }`, anno );
  }
  if (!prefix) {                // set deprecated $annotations for cds-lsp
    if (!art.$annotations)
      art.$annotations = [];
    const location = locUtils.combinedLocation( anno.name, anno );
    art.$annotations.push( { value: anno, location } );
  }
}

function addAnnotation( art, prop, anno ) {
  const old = art[prop];
  if (old) {
    this.error( 'syntax-duplicate-anno', old.name.location, { anno: prop },
                'Assignment for $(ANNO) is overwritten by another one below' );
  }
  art[prop] = anno;
}

const extensionDicts = {
  elements: true, enum: true, params: true, returns: true,
};

function checkExtensionDict( dict ) {
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

    // We keep duplicate statements for LSP, as it needs to traverse all identifiers;
    // annotations were removed above to avoid traversing annotations twice.
  }
}

function addOneForDefinition( count, ext ) {
  return (ext.kind === 'extend') ? count : count + 1;
}

/**
 * Handle duplicate extensions.  Does not handle `annotate`.
 *
 * @param {XSN.Extension} ext
 * @param {string} name
 * @param {number} numDefines
 */
function handleDuplicateExtension( ext, name, numDefines ) {
  if (ext.kind === 'extend') {
    this.error( 'syntax-duplicate-extend', [ ext.name.location ],
                { name, '#': (numDefines ? 'define' : 'extend') } );
  }
  else if (numDefines === 1) {
    ext.$errorReported = 'syntax-duplicate-extend';
  } // a definition, but not duplicate
}


/**
 * Return start location of `token`, or the first token matched by the current
 * rule if `token` is undefined
 *
 * @returns {Location}
 */
function startLocation( token = this._ctx.start ) {
  return new Location(
    this.filename,
    token.line,
    token.column + 1
  );
}

/**
 * Return location of `token`.  If `endToken` is provided, use its end
 * location as end location in the result.
 *
 * @param {object} token
 * @param {object} endToken
 * @return {Location}
 */
function tokenLocation( token, endToken = null ) {
  if (!token)
    return undefined;
  if (!endToken)                // including null
    endToken = token;

  // Default for single line tokens
  const endLine = endToken.line;
  // after the last char (special for EOF?)
  const endCol = endToken.stop - endToken.start + endToken.column + 2;
  const loc = new Location( this.filename, token.line, token.column + 1, endLine, endCol );

  // This check is done for performance reason. No need to access a token's
  // data if we know that it spans only one single line.
  if (this.isMultiLineToken(token))
    this.fixMultiLineTokenEndLocation(token, loc);

  return loc;
}

function isMultiLineToken( token ) {
  return (
    token.type === this.constructor.DocComment ||
    token.type === this.constructor.String || // TODO: do not check every string content
    token.type === this.constructor.UnterminatedLiteral
  );
}

/**
 * Adapt end location of `location` according to `token`, assuming that `token` is a multi-line
 * token such as a multi-line string or doc comment.
 *
 * Sets `endLine`/`endCol`, respecting newline characters in the token.
 *
 * @param token
 * @param {CSN.Location} location
 */
function fixMultiLineTokenEndLocation( token, location ) {
  // Count the number of newlines in the token.
  const source = token.source[1].data;
  let newLineCount = 0;
  let lastNewlineIndex = token.start;
  for (let i = token.start; i < token.stop; i++) {
    // Note: We do NOT check for CR, LS, and PS (/[\r\u2028\u2029]/)
    //       because ANTLR only uses LF for line break detection.
    if (source[i] === 10) { // code point of '\n'
      newLineCount++;
      lastNewlineIndex = i;
    }
  }
  if (newLineCount > 0) {
    location.endLine = token.line + newLineCount;
    location.endCol = token.stop - lastNewlineIndex + 1;
  }
  else {
    location.endLine = token.line;
    // after the last char (special for EOF?)
    location.endCol = token.stop - token.start + token.column + 2;
  }
}

/**
 * Return `val` with a location; if `val` and `endToken` are not provided, use the
 * lower-cased token string of `startToken` as `val`.  As location, use the
 * location covered by `startToken` and `endToken`, or only `startToken` if no
 * `endToken` is provided.  The `startToken` defaults to the previous token.
 *
 * @param {object} startToken
 * @param {object} endToken
 * @param {any} val
 */
function valueWithTokenLocation( val = undefined, startToken = this._input.LT(-1),
                                 endToken = undefined ) {
  // if (!startToken)
  //   startToken = this._input.LT(-1);
  const loc = this.tokenLocation( startToken, endToken );
  return {
    location: loc,
    val: (endToken || val !== undefined) ? val : startToken.text.toLowerCase(),
  };
}

function previousTokenAtLocation( location ) {
  let k = -1;
  let token = this._input.LT(k);
  while (token.line > location.line ||
         token.line === location.line && token.column >= location.col)
    token = this._input.LT(--k);
  return (token.line === location.line && token.column + 1 === location.col) && token;
}

// Create a location with location properties `filename` and `start` from
// argument `start`, and location property `end` from argument `end`.
function combinedLocation( start, end ) {
  if (!start || !start.location)
    start = { location: this.startLocation() };
  return locUtils.combinedLocation( start, end );
}

// make sure that the parens of `IN (…)` do not disappear:
function secureParens( expr ) {
  const op = expr?.op?.val;
  const $parens = expr?.$parens;
  if (!$parens || expr.query || op && op !== 'call' && op !== 'cast')
    return expr;
  // ensure that references, literals and functions keep their surrounding parentheses
  // (is for expressions the case anyway)
  delete expr.$parens;
  return {
    op: { val: 'xpr', location: this.startLocation() },
    args: [ expr ],
    location: { __proto__: Location.prototype, ...expr.location },
    $parens,
  };
}

function surroundByParens( expr, open, close, asQuery = false ) {
  if (!expr)
    return expr;
  const location = this.tokenLocation( open, close );
  if (expr.$parens)
    expr.$parens.push( location );
  else
    expr.$parens = [ location ];
  if (expr.$opPrecedence)
    expr.$opPrecedence = null;
  return (asQuery) ? { query: expr, location } : expr;
}


function tokensToStringRepresentation( start, stop ) {
  const tokens = this._input.getTokens(
    start.tokenIndex,
    stop.tokenIndex + 1, null
  ).filter(tok => tok.channel === antlr4.Token.DEFAULT_CHANNEL);
  if (tokens.length === 0)
    return '';

  let result = tokens[0].text;
  for (let i = 1; i < tokens.length; ++i) {
    const str = normalizeNewLine(tokens[i].text);
    result += (tokens[i].start > tokens[i - 1].stop + 1) ? ` ${ str }` : str;
  }
  return result;
}

function unaryOpForParens( query, val, forLimit ) {
  // previously, `( SELECT … ) order by …` had a `SET: {…}` around the `SELECT: {…}`
  if (!query.orderBy) {
    if (!query.limit)
      return query;
  }
  else if (!query.limit && forLimit) {
    const orderBy = query.orderBy[0]?.location;
    const paren = query.$parens?.at( -1 );
    if (!paren || !orderBy || paren.line < orderBy.line ||
        paren.line === orderBy.line && paren.col < orderBy.col)
      return query;
  }
  this.message( 'syntax-duplicate-clause', this._input.LT(-1),
                { '#': 'orderByLimit', code: 'order by … limit' } );
  return query;
}

// ANTLR on some OS might corrupt non-ASCII chars for messages
function warnIfColonFollows( anno ) {
  const t = this.getCurrentToken();
  if (t.text === ':') {
    this.warning( 'syntax-missing-parens', anno.name.location,
                  { code: '@‹anno›', op: ':', newcode: '@(‹anno›…)' },
                  // eslint-disable-next-line @stylistic/js/max-len
                  'When $(CODE) is followed by $(OP), use $(NEWCODE) for annotation assignments at this position' );
  }
}

// If the token before the current one is a doc comment (ignoring other tokens
// on the hidden channel), put its "cleaned-up" text as value of property `doc`
// of arg `node` (which could be an array).  Complain if `doc` is already set.
//
// The doc comment token is not a non-hidden token for the following reasons:
//  - misplaced doc comments would lead to a parse error (incompatible),
//  - would influence the prediction, probably even induce adaptivePredict() calls,
//  - is only slightly "more declarative" in the grammar.
function docComment( node ) {
  const token = this._input.getHiddenTokenToLeft( this.constructor.DocComment );
  if (!token)
    return;

  // This token is actually used by / assigned to an artifact.
  token.isUsed = true;

  // With explicit docComment:false, we don't emit a warning.
  if (node.doc && this.options.docComment !== false) {
    this.warning( 'syntax-duplicate-doc-comment', node.doc.location, {},
                  'Doc comment is overwritten by another one below' );
  }

  // Either store the doc comment or a marker that there is one.
  const val = !this.options.docComment ? true : parseDocComment( token.text );
  node.doc = this.valueWithTokenLocation( val, token );
}

/**
 * Classify token (identifier category) for implicit names. To be used in the
 * empty alternative to AS <explicitName>.  If `ref` is given, uses the last
 * path segment's `tokenIndex`.  The return value can be used to reset the
 * token's category, e.g. for inline select items.
 *
 * @param {string} category
 * @param [ref]
 */
function classifyImplicitName( category, ref ) {
  if (!ref || ref.path) {
    const tokenIndex = ref?.path.at(-1)?.location.tokenIndex;
    const implicit = (tokenIndex === undefined) ? this._input.LT(-1) : this._input.get(tokenIndex);
    if (implicit.isIdentifier) {
      const previous = implicit.isIdentifier;
      implicit.isIdentifier = category;
      return { token: implicit, previous };
    }
  }
  return null;
}

function fragileAlias( ast, safe = false ) {
  if (this.getCurrentToken().text === '.')
    return ast;
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

// Return AST for identifier token `token`.  Also check that identifier is not empty.
function identAst( token, category, noTokenTypeCheck = false ) {
  if (!token) {                 // for rule identAst
    const { start, stop } = this._ctx;   // token.tokenIndex
    // - correct parsing: start = stop
    // - singleTokenDeletion(), e.g. with `| Ident`: start < stop → stop
    // - after recoverInline: start > stop (!) → stop = the previous token, if it is
    //   ident-like and the one before not in `.@#`, → start ('') otherwise
    token = stop;
    if (start.tokenIndex > stop.tokenIndex &&
        (stop.type !== this.constructor.Identifier && !/^[a-zA-Z_]+$/.test( stop.text ) ||
         [ '.', '@', '#' ].includes( this._input.LT(-2)?.text )))
      token = start;
  }
  token.isIdentifier = category;
  let id = token.text;
  if (!noTokenTypeCheck &&
      token.type !== this.constructor.Identifier && !/^[a-zA-Z_]+$/.test( id ))
    id = '';
  if (token.text[0] === '!') {
    id = id.slice( 2, -1 ).replace( /]]/g, ']' );
    if (!id)
      this.message( 'syntax-invalid-name', token, {} );

    // $delimited is used to complain about ![$self] and other magic vars usage;
    // we might complain about that already here via @arg{category}

    const ast = { id, $delimited: true, location: this.tokenLocation( token ) };
    ast.location.tokenIndex = token.tokenIndex;
    return ast;
  }
  if (token.text[0] !== '"') {
    const ast = { id, location: this.tokenLocation(token) };
    ast.location.tokenIndex = token.tokenIndex;
    return ast;
  }
  // delimited:
  id = id.slice( 1, -1 ).replace( /""/g, '"' );
  if (!id) {
    this.message( 'syntax-invalid-name', token, {} );
  }
  else {
    this.message( 'syntax-deprecated-ident', token, { delimited: id },
                  // eslint-disable-next-line @stylistic/js/max-len
                  'Deprecated delimited identifier syntax, use $(DELIMITED) - strings are delimited by single quotes' );
  }
  const ast = { id, $delimited: true, location: this.tokenLocation( token ) };
  ast.location.tokenIndex = token.tokenIndex;
  return ast;
}

function reportPathNamedManyOrOne( { path } ) {
  if (path.length === 1 && !path[0].$delimited &&
      [ 'many', 'one' ].includes( path[0].id.toLowerCase() )) {
    this.message( 'syntax-unexpected-many-one', path[0].location,
                  { code: path[0].id, delimited: path[0].id } );
  }
}

function reportVirtualAsRef() {
  const { type, text } = this._input.LT(2);
  if (this.constructor.Number < type && type <= this.constructor.Identifier ||
      [ '+', '-', '(' ].includes( text )) {
    // remark: we do not need to include 'not', as condition operators are only
    // allowed inside parentheses in the old parser
    const token = this._input.LT(1);
    this.message( 'syntax-deprecated-ref-virtual', token, {
      '#': (text === '(' ? 'func' : 'ref'),
      name: token.text,
      delimited: token.text,
    } );
  }
}

function reportMissingSemicolon() {
  const next = this._input.LT(1);
  if (next.text !== ';' && next.text !== '' && // ';' by insertSemicolon()
      next.text !== '}' && next.type !== antlr4.Token.EOF &&
      this._input.LT(-1).text !== '}') {
    const offending = this.literalNames[next.type] || this.symbolicNames[next.type];
    const loc = this.tokenLocation( this._input.LT(-1) );
    // better location after the previous token:
    const location = new Location( loc.file, loc.endLine, loc.endCol );
    // it would be nicer to mention the doc comment if present, but not worth the
    // effort; 'syntax-missing-semicolon' already used
    this.warning( 'syntax-missing-proj-semicolon', location,
                  { expecting: [ "';'" ], offending },
                  'Missing $(EXPECTING) before $(OFFENDING)');
  }
}

function pushXprToken( args ) {
  const token = this._input.LT(-1);
  args.push( {
    location: this.tokenLocation( token ),
    val: token.text.toLowerCase(), // TODO: remove toLowerCase() ?
    literal: 'token',
  } );
}

function valuePathAst( ref ) {
  // TODO: XSN representation of functions is a bit strange - rework
  const { path } = ref;
  if (!path || path.broken)
    return ref;
  if (path.length === 1) {
    const { args, id, location } = path[0];
    if (args
      ? path[0].$syntax === ':'
      : path[0].$delimited || !functionsWithoutParentheses.includes( id.toUpperCase() ))
      return ref;

    const implicit = this.previousTokenAtLocation( location );
    if (implicit && implicit.isIdentifier)
      implicit.isIdentifier = 'func';

    const filter = path[0].cardinality || path[0].where;
    if (filter)
      this.message( 'syntax-unexpected-filter', filter.location, {} );
    const op = { location, val: 'call' };
    return (args)
      ? {
        op, func: ref, location: ref.location, args,
      }
      : { op, func: ref, location: ref.location };
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
    if (path[i].args && path[i].$syntax === ':') {
      // Error for `a(P => 1).b.c(P: 1)`: no ref after function.
      this.$messageFunctions.error('syntax-invalid-ref', path[i].args[$location], {
        code: '=>',
      }, 'References after function calls can\'t be resolved. Use $(CODE) in function arguments');
      break;
    }
    const filter = path[i].cardinality || path[i].where;
    if (filter)
      this.message( 'syntax-unexpected-filter', filter.location, {} );
  }

  const args = [];
  if (firstFunc > 0) {
    args.push({
      path: path.slice(0, firstFunc),
      location: locUtils.combinedLocation(path[0].location, path[path.length - 1].location),
    });
  }

  const pathRest = path.slice(firstFunc);
  for (const method of pathRest) {
    if (method !== pathRest[0] || firstFunc > 0) {
      args.push({
        // TODO: Update parser to have proper location for `.`?
        location: weakLocation(method.location),
        val: '.',
        literal: 'token',
      });
    }
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
    op: {
      val: 'ixpr',
      location: this.startLocation(),
    },
    args,
    location: ref.location,
  };
}


/**
 * Adds the first argument of `args` ('new' keyword) to the second argument, if it's a method-ixpr.
 *
 * @todo Cleanup, remove.
 * @param args
 */
function fixNewKeywordPlacement( args ) {
  // TODO: Currently, the parser creates an args-array with `new` and an `ixpr` for
  //      `new P().abc()`.  That is, "new" is separate from the methods.
  //      This function tries to work around it, but its more of a hack.
  if (args.length !== 2 || !args[1].args || args[1].op?.val !== 'ixpr')
    return;
  const ixpr = args[1];
  ixpr.args.unshift(args[0]);
  args.length = 0;
  args.push(ixpr);
}

function expressionAsAnnotationValue( assignment, cond, start, stop ) {
  if (!cond) // parse error
    return;
  Object.assign(assignment, cond);
  assignment.$tokenTexts = this.tokensToStringRepresentation( start, stop );
}

// If a '-' is directly before an unsigned number, consider it part of the number;
// otherwise (including for '+'), represent it as extra unary prefix operator.
function signedExpression( args, expr ) {
  // if (args.length !== 1) throw new CompilerAssertion()
  const sign = args[0];
  const nval
        = (sign.val === '-' &&
        expr && // expr may be null if `-` rule can't be parsed
        expr.literal === 'number' &&
        sign.location.endLine === expr.location.line &&
        sign.location.endCol === expr.location.col &&
        (typeof expr.val === 'number'
          ? expr.val >= 0 && -expr.val
          : !expr.val.startsWith('-') && `-${ expr.val }`)) || false;
  if (nval === false) {
    args.push( expr );
  }
  else {
    expr.val = nval;
    --expr.location.col;
    args[0] = expr;
  }
}

/**
 * Return number literal (XSN) for number token `token` with optional token `sign`.
 * Represent the number as a JS number in property `val` if the number can safely be
 * represented as one.  Represent the number by a string, the token lexeme, if the
 * stringified version of the number does not match the token lexeme.
 *
 * TODO: Always use text !== `${ num }`
 */
function numberLiteral( sign, text = this._input.LT(-1).text ) {
  const token = this._input.LT(-1);
  let location = this.tokenLocation( token );
  const nextToken = this._input.LT(1);
  if (token.type === this.constructor.Number &&
      token.stop + 1 === nextToken.start &&
      (nextToken.type === this.constructor.Identifier ||
       nextToken.type < this.constructor.Identifier && /^[a-z]+$/i.test( nextToken.text ))) {
    this.message('syntax-expecting-space', nextToken, {},
                 'Expecting a space between a number and a keyword/identifier');
  }

  if (sign) {
    const { endLine, endCol } = location;
    location = this.startLocation( sign );
    location.endLine = endLine;
    location.endCol = endCol;
    text = sign.text + text;
    this.reportUnexpectedSpace( sign, this.tokenLocation( token ) );
  }

  const num = Number.parseFloat( text || '0' ); // not Number.parseInt() !
  const normalized = normalizeNumberString(text);
  if (normalized !== `${ num }` && normalized !== `${ sign.text }${ num }`)
    return { literal: 'number', val: normalized, location };
  return { literal: 'number', val: num, location };
}

/**
 * Given `token`, return a number literal (XSN).  If the number is not an unsigned integer
 * or it can't be represented in JS, emit an error.
 */
function unsignedIntegerLiteral() {
  const token = this._input.LT(-1);
  const location = this.tokenLocation( token );
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

// Make the annotation `anno` have `value` as value.  This function is basically
// just `Object.assign`, but we really try to represent the provided CDL number as
// JSON number.  We give a warning if this is not possible or leads to a precision
// loss.
function assignAnnotationValue( anno, value ) {
  const { val } = value;
  if (value.literal === 'number' && typeof val !== 'number') {
    // a number in CDL, but stored as string in `val` - due to rounding or scientific notation
    let num = Number.parseFloat( val || '0' );
    const inf = !Number.isFinite( num );
    if (inf)
      num = val;
    if (inf || relevantDigits( val ) !== relevantDigits( num.toString() )) {
      this.warning( 'syntax-invalid-anno-number', value.location,
                    { '#': (inf ? 'infinite' : 'rounded' ), rawvalue: val, value: num },
                    {
                      std: 'Annotation number $(RAWVALUE) is put as $(VALUE) into the CSN',
                      rounded: 'Annotation number $(RAWVALUE) is rounded to $(VALUE)',
                      // eslint-disable-next-line @stylistic/js/max-len
                      infinite: 'Annotation value $(RAWVALUE) is infinite as number and put as string into the CSN',
                    } );
    }
    value.val = num;
  }
  Object.assign( anno, value );
}

function relevantDigits( val ) {
  // We know the value does not contain newlines, hence the RegEx is safe.
  // eslint-disable-next-line sonarjs/slow-regex
  val = val.replace( /e.+$/i, '' );

  // To avoid the super-linear RegEx `0+$`, use the non-backtracking version and
  // simply check if we're at the end.
  const trailingZeroes = /0+/g;
  let re;
  while ((re = trailingZeroes.exec(val)) !== null) {
    if (trailingZeroes.lastIndex === val.length) {
      val = val.slice(0, re.index);
      break;
    }
  }

  return val
    .replace( /\./, '' )
    .replace( /^[-+0]+/, '' );
}

// Create AST node for quoted literals like string and e.g. date'2017-02-22'.
// This function might issue a message and might change the `literal` and
// `val` property according to `quotedLiteralPatterns` above.
function quotedLiteral( token, literal ) {
  /** @type {CSN.Location} */
  const location = this.tokenLocation( token );
  let pos;
  let val;

  if (token.text.startsWith('`')) {
    val = this.parseMultiLineStringLiteral(token);
    literal = 'string';
  }
  else {
    pos = token.text.search( '\'' ) + 1; // pos of char after quote
    val = token.text.slice( pos, -1 ).replace( /''/g, '\'' );
  }

  if (!literal)
    literal = token.text.slice( 0, pos - 1 ).toLowerCase();
  const p = quotedLiteralPatterns[literal] || {};

  if (p.test_fn && !p.test_fn(val) && !this.options.parseOnly)
    this.warning( 'syntax-invalid-literal', location, { '#': p.test_variant } );

  if (p.unexpected_char) {
    const idx = val.search(p.unexpected_char);
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
  return {
    literal: p.literal || literal,
    val: p.normalize && p.normalize(val) || val,
    location,
  };

  function atChar( i ) {
    // Is only used with single-line strings.
    return location.col + pos + i;
  }
}

function pushIdent( path, ident, prefix ) {
  if (!ident) {
    path.broken = true;
  }
  else if (!prefix) {
    path.push( ident );
  }
  else {
    const { location } = ident;
    const prefixLoc = this.reportUnexpectedSpace( prefix, location );
    location.line = prefixLoc.line;
    location.col = prefixLoc.col;
    ident.id = prefix.text + ident.id;
    path.push( ident );
  }
}

function pushItem( array, val ) {
  if (!array)
    return;

  if (val != null)
    array.push(val);
  else
    array.broken = true;
}

// For :param, #variant, #symbol, @(…) and @Begin and `@` inside annotation paths
function reportUnexpectedSpace( prefix = this._input.LT(-1),
                                location = this.tokenLocation( this._input.LT(1) ),
                                isError = false ) {
  const prefixLoc = this.tokenLocation( prefix );
  if (prefixLoc.endLine !== location.line ||
      prefixLoc.endCol !== location.col) {
    const wsLocation = {
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

// Add new definition `art` to dictionary property `env` of node `parent`.
// Return `art`.
//
// If argument `kind` is provided, set `art.kind` to that value.
// If argument `name` is provided, set `art.name`:
//  - if `name` is an array, `name.id` consist of the ID of the last array item
//    (for elements via columns, foreign keys, table aliases)
//  - if `name` is an object, `name.id` is either set, or the (local) name is calculated
//    from the IDs of all items in `name.path` (for main artifact definitions).
function addDef( art, parent, env, kind, name ) {
  if (Array.isArray(name)) {
    const last = name.length && name[name.length - 1];
    art.name = { // A.B.C -> 'C'
      id: last?.id || '', location: last.location, $inferred: 'as',
    };
  }
  else if (name) {
    art.name = name;
    if (!name.id && kind === null) // namedValue, fortunately no `variant` there
      art.name.id = pathName( art.name?.path );
  }
  else {
    art.name = { id: '' };
  }
  if (kind)
    art.kind = kind;

  const id = art.name?.id || pathName( art.name?.path ); // returns '' for corrupted name

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

// Add new definition `art` to array property `env` of node `parent`.
// Also set `kind`.  Returns `art`.
function addItem( art, parent, env, kind ) {
  art.kind = kind;
  parent[env].push( art );
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
function addExtension( ext, parent, kind, artName, elemPath ) {
  const { location } = ext;
  if (!Array.isArray( elemPath ) || !elemPath.length || elemPath.broken) {
    ext.name = artName;
    this.addItem( ext, parent, 'extensions', kind );
    return;
  }
  // Note: the element extensions share a common `location`, also with the
  // extension of the main artifact; its end location will usually set later
  parent = this.addItem( { name: artName, location }, parent, 'extensions', kind );

  const last = elemPath[elemPath.length - 1];
  for (const seg of elemPath) {
    parent.elements = Object.create(null); // no dict location → no createDict()
    parent = this.addDef( (seg === last ? ext : { location }),
                          parent, 'elements', kind, seg );
  }
}

// must be in action directly after having parsed '{', '(`, or a keyword before
function createDict() {
  const dict = Object.create(null);
  dict[$location] = this.startLocation( this._input.LT(-1) );
  return dict;
}

// must be in action directly after having parsed '[' or '(` or `{`
function createArray() {
  const array = [];
  array[$location] = this.startLocation( this._input.LT(-1) );
  return array;
}

// must be in action directly after having parsed '}' or ')`
function finalizeDictOrArray( dict ) {
  const loc = dict[$location];
  if (!loc)
    return;
  const stop = this._input.LT(-1);
  loc.endLine = stop.line;
  loc.endCol = stop.stop - stop.start + stop.column + 2;
}

function insertSemicolon() {
  const currentToken = this._input.tokens[this._input.index];
  const requireSemicolon = this.topLevelKeywords.includes(currentToken.type);

  if (requireSemicolon) {
    this.noAssignmentInSameLine();
    const prev = this._input.LT(-1);
    const t = CommonTokenFactory.create(
      currentToken.source,
      this.literalNames.indexOf( "';'" ),
      '', antlr4.Token.DEFAULT_CHANNEL,
      prev.stop, prev.stop,
      prev.line, prev.column
    );

    t.tokenIndex = prev.tokenIndex + 1;

    this._input.tokens.splice(t.tokenIndex, 0, t);

    // Update tokenIndex: There could have been comments between two non-hidden tokens.
    for (let tokenIndex = t.tokenIndex + 1; tokenIndex < this._input.tokens.length; tokenIndex++)
      this._input.tokens[tokenIndex].tokenIndex += 1;

    this._input.index = t.tokenIndex;
  }
}

function createSource() {
  return new XsnSource();
}

const operatorPrecedences = {
  // query:
  union: 1,
  except: 1,
  minus: 1,
  intersect: 2,
};

// Create AST node for binary operator `op` and arguments `args`
function leftAssocBinaryOp( expr, right, opToken, eToken, extraProp ) {
  if (!right)
    return expr;
  const op = this.valueWithTokenLocation( opToken.text.toLowerCase(), opToken );
  const extra = eToken
    ? this.valueWithTokenLocation( eToken.text.toLowerCase(), eToken )
    : undefined;
  if (!expr.$parens && expr.op?.val === op.val && expr[extraProp]?.val === extra?.val) {
    expr.args.push( right );
    return expr;
  }
  const opPrec = operatorPrecedences[op.val] || 0;
  let left = expr;
  let args;
  while (opPrec > nodePrecedence( left )) {
    args = left.args;
    left = args[args.length - 1];
  }
  // TODO: location correct?
  const node = (extra)          // eslint-disable-next-line
    ? { op, [extraProp]: extra, args: [ left, right ], location: left.location }
    : { op, args: [ left, right ], location: left.location };
  if (!args)
    return node;
  args[args.length - 1] = node;
  return expr;
}

function nodePrecedence( node ) {
  const { op } = node;
  return op && !node.$parens && operatorPrecedences[op.val] || Infinity;
}

function pushOpToken( args, precedence ) { // for nary only; uses LT(-1) as operator token
  let node = null;
  let left = args;
  while (left?.$opPrecedence && left.$opPrecedence < precedence) {
    args = left;
    node = args[args.length - 1]; // last sub node of left side
    left = node.args;
  }

  if (left?.$opPrecedence === precedence ) { // nary
    args = left;
  }
  else if (node) {
    const sub = this.argsExpression( [ node, null ], true );
    args[args.length - 1] = sub;
    args = sub.args;
    args.length = 1;
  }
  else if (args.length > 1) {   // new top-level op & op on left
    args[0] = this.argsExpression( [ ...args ], args.$opPrecedence != null ); // finish expresion
    args.length = 1;
  }
  args.$opPrecedence = precedence;
  // TODO (if necessary): `location` for sub expessions, top-level is be properly set
  this.pushXprToken( args );
  return args;
}

// only to be used in @after or via pushOpToken
function argsExpression( args, nary ) {
  if (args.length === 1)        // args.length === 0 is ok (for OVER…)
    return args[0];
  const $parens = args[0]?.$parens;
  const loc = ($parens) ? $parens[$parens.length - 1] : args[0]?.location;
  const location = loc ? { __proto__: Location.prototype, ...loc } : this.startLocation();
  // console.log('AE:',args);
  const op = {
    // eslint-disable-next-line no-nested-ternary
    val: nary === '?:' ? nary : nary ? 'nary' : 'ixpr',
    location,
  };
  return this.attachLocation( { op, args, location } );
}

const maxCardinalityKeywords = { 1: 'one', '*': 'many' };

function setMaxCardinality( art, targetMax, token ) {  // - val
  if (token)
    targetMax.location = this.tokenLocation( token );
  if (art.cardinality) {
    this.reportDuplicateClause( 'cardinality', targetMax, art.cardinality.targetMax,
                                maxCardinalityKeywords );
  }
  else {
    art.cardinality = { targetMax, location: targetMax.location };
  }
}

const notNullKeywords = { false: 'null', true: 'not null' };

function setNullability( art, token1, token2 ) {
  const notNull = this.valueWithTokenLocation( !!token2, token1, token2 );
  if (art.notNull)
    this.reportDuplicateClause( 'notNull', art.notNull, notNull, notNullKeywords );
  art.notNull = notNull;
}

function reportDuplicateClause( prop, erroneous, chosen, keywords ) {
  // probably easier for message linters not to use (?:) for the message id...?
  const args = {
    '#': prop,
    code: keywords[chosen.val] || chosen.val,
    line: chosen.location.line,
    col: chosen.location.col,
  };
  if (erroneous.val === chosen.val)
    this.message( 'syntax-duplicate-equal-clause', erroneous.location, args );
  else
    this.message( 'syntax-duplicate-clause', erroneous.location, args );
}

const extensionsCode = {
  definitions: 'extend … with definitions',
  context: 'extend context',
  service: 'extend service',
};

function reportUnexpectedExtension( defOnly, token ) {
  if (defOnly) {
    this.error( 'syntax-unexpected-extension', token,
                { keyword: token.text, code: extensionsCode[defOnly] } );
  }
}

function handleComposition( cardinality, isComposition ) {
  if (isComposition && !cardinality) {
    const lt1 = this._input.LT(1).type;
    const la2 = this._input.LT(2);
    if (la2.text === '{' && (lt1 === this.constructor.MANY || lt1 === this.constructor.ONE))
      la2.type = this.constructor.COMPOSITIONofBRACE;
  }
  const brace1 = (isComposition) ? 'COMPOSITIONofBRACE' : "'{'";
  const manyOne = (cardinality) ? [ 'MANY', 'ONE' ] : [];
  this.excludeExpected( [ [ "'}'", 'COMPOSITIONofBRACE' ], brace1, ...manyOne ] );
}

function associationInSelectItem( art ) {
  const { value } = art;
  const path = value?.path;
  // we cannot compare "just one token before `:`" because there might be annos
  if (path && path.length === 1 && !art.name && !art.expand && !art.inline) {
    const name = value.path[0];
    if (path.length === 1 && !name.args && !name.cardinality && !name.where) {
      art.name = name;
      delete art.value;
      return art;
    }
  }
  this.error( 'syntax-unexpected-assoc', this.getCurrentToken(), {},
              'Unexpected association definition in select item' );
  return {};         // result of the association rules are written into /dev/null
}

function reportExpandInline( column, isInline ) {
  const { name } = column;
  if (column.value && !column.value.path) {
    let token = this.getCurrentToken();
    // improve error location when using "inline" `.{…}` after ref (arguments and
    // filters not covered, not worth the effort); after an expression where
    // the last token is an identifier, not the `.` is wrong, but the `{`:
    if (isInline && !name && this._input.LT(-1).type >= this.constructor.Identifier)
      token = this._input.LT(2);
    this.error( 'syntax-unexpected-nested-proj', token,
                { code: isInline ? '.{ ‹inline› }' : '{ ‹expand› }' },
                'Unexpected $(CODE); nested projections can only be used after a reference' );
    // continuation semantics:
    // - add elements anyway (could lead to duplicate errors as usual)
    // - no errors for refs inside expand/inline, but for refs in sibling expr
    // - think about: reference to these (sub) elements from other view
  }
  if (isInline && name) {
    const location = this.tokenLocation( isInline, this._input.LT(-1) );
    this.error( 'syntax-unexpected-alias', location, { code: '.{ ‹inline› }' },
                'Unexpected alias name before $(CODE)' );
    // continuation semantics: ignore AS
  }
}

function checkTypeFacet( art, argIdent ) {
  // TODO: use dictAddArray or dictAdd?
  const { id } = argIdent;
  if (id === 'length' || id === 'scale' || id === 'precision' || id === 'srid') {
    if (art[id] !== undefined) {
      this.error( 'syntax-duplicate-argument', art[id].location,
                  { '#': 'type', name: id } );
      // continuation semantics: use last
    }
    return true;
  }
  this.error( 'syntax-undefined-param', argIdent.location, { name: id },
              'There is no type parameter called $(NAME)');
  return false;
}

function checkTypeArgs( art ) {
  const args = art.$typeArgs;
  // One or two arguments are interpreted as either length or precision/scale.
  if (args.length > 2) {
    const loc = args[2].location;
    this.error( 'syntax-unexpected-argument', loc, {}, 'Too many type arguments' );
    art.$typeArgs = undefined;
  }
}

module.exports = GenericAntlrParser;
