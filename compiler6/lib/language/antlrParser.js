// @ts-nocheck : Issues with Tokens on `this`, e.g. `this.DOT`.

// Wrapper around generated ANTLR parser

// To test the parser in the REPL
//   var parser = require( './lib/language/antlrParser' );
//   var ast    = parser.parse( 'FileContent', 'FileName' );

'use strict';

const antlr4 = require('antlr4');

const { CompileMessage } = require('../base/messages');
const errorStrategy = require('./errorStrategy');
const { XsnSource } = require('../compiler/xsn-model');

const Parser = require('../gen/languageParser').default;
const Lexer = require('../gen/languageLexer').default;

// Error listener used for ANTLR4-generated parser
class ErrorListener extends antlr4.error.ErrorListener {
  // method which is called by generated parser with --trace-parser[-amg]:
  syntaxError( recognizer, offendingSymbol, line, column, msg, e ) {
    if (!(e instanceof CompileMessage)) // not already reported
      // Ignore warning, because only relevant for --trace-parser
      // eslint-disable-next-line cds-compiler/message-call-format
      recognizer.error( null, offendingSymbol, {}, msg );
  }
}

class RewriteTypeTokenStream extends antlr4.CommonTokenStream {
  LT( k ) {
    const t = super.LT(k);
    if (!t || !t.type)
      return t;
    if (t.type === this.DOT) {
      const n = super.LT(k + 1) || { type: this.Identifier };
      // after a '.', there is no keyword -> no word is reserved:
      if (n.type < this.Identifier && /^[a-z]+$/i.test( n.text ))
        n.type = this.Identifier;
      else if (n.type === this.BRACE || n.type === this.ASTERISK)
        t.type = this.DOTbeforeBRACE || t.type;
    }
    else if (t.type === this.AT) {
      const n = super.LT(k + 1) || { type: this.Identifier };
      // after a '@', there is no keyword -> no word is reserved:
      if (n.type < this.Identifier && /^[a-z]+$/i.test( n.text ))
        n.type = this.Identifier;
    }
    else if (t.type === this.NEW) {
      const n = super.LT(k + 1);
      // TODO: rewrite token in grammar via `this.setLocalToken`
      if (n?.type === this.Identifier) {
        const o = super.LT(k + 2);
        if (o?.type === this.PAREN)
          return t;
      }
      t.type = this.Identifier;
    }
    return t;
  }

  getHiddenTokenToLeft( type ) {
    this.lazyInit();
    let i = this.index;
    while (--i >= 0) {
      const t = this.tokens[i];
      if (t.channel === antlr4.Token.DEFAULT_CHANNEL)
        return null;
      else if (t.type === type)
        return t;
    }
    return null;
  }
}

function initTokenRewrite( recognizer, ts ) { // ts = tokenStream
  ts.DOTbeforeBRACE = Parser.DOTbeforeBRACE;
  ts.BRACE = tokenTypeOf( recognizer, "'{'" );
  ts.BRACE_CLOSE = tokenTypeOf( recognizer, "'}'" );
  ts.DOT = tokenTypeOf( recognizer, "'.'" );
  ts.ASTERISK = tokenTypeOf( recognizer, "'*'" );
  ts.AT = tokenTypeOf( recognizer, "'@'" );
  ts.SEMICOLON = tokenTypeOf( recognizer, "';'" );
  ts.NEW = Parser.NEW;
  ts.RETURNS = Parser.RETURNS;
  ts.Identifier = Parser.Identifier;
  ts.PAREN = tokenTypeOf( recognizer, "'('" );

  recognizer.tokenRewrite = [];
  if (Parser.Identifier) {
    if (ts.DOT && ts.DOTbeforeBRACE)
      recognizer.tokenRewrite[ts.DOTbeforeBRACE - Parser.Identifier] = ts.DOT;
  }
}

function initCodeCompletionTokenArrays( parser ) {
  // Set of top-level keywords used for code completion after token '}'
  // belonging to a top-level definition
  const startRuleIndex = parser.ruleNames.indexOf('start');
  const startState = parser.atn.ruleToStartState[startRuleIndex].stateNumber;
  const tokens = parser.atn.nextTokens(parser.atn.states[startState]);
  tokens.removeOne(parser.symbolicNames.indexOf('NAMESPACE'));
  tokens.removeOne(parser.symbolicNames.indexOf('HideAlternatives'));

  parser.topLevelKeywords = [];
  for (const interval of tokens.intervals) {
    for (let i = interval.start; i < interval.stop; i++)
      parser.topLevelKeywords.push(i);
  }
}

function tokenTypeOf( recognizer, literalName ) {
  const r = recognizer.literalNames.indexOf( literalName );
  return (r > 0) ? r : 0;
}

// Parse string `source` and return the AST (empty if serious parse error) with
// a property `messages` for the syntax errors.  Argument `filename` is used in
// the AST locations and error messages.  If provided, `options` are compile
// options.

function parse( source, filename, options, messageFunctions, rulespec ) {
  const lexer = new Lexer( new antlr4.InputStream(source) );
  const tokenStream = new RewriteTypeTokenStream(lexer);
  /** @type {object} */
  const parser = new Parser( tokenStream );
  const errorListener = new ErrorListener();

  parser.filename = filename;
  parser.options = options;
  parser.$messageFunctions = messageFunctions;

  if (options.newParser === false || options.newparser === false)
    reportOldParserUsage(parser);

  initTokenRewrite( parser, tokenStream );
  initCodeCompletionTokenArrays(parser);
  // comment the following 2 lines if you want to output the parser errors directly:
  parser.messageErrorListener = errorListener;
  parser._errHandler = new errorStrategy.KeywordErrorStrategy();
  parser._interp.predictionMode = antlr4.atn.PredictionMode.SLL;
  // parser._interp.predictionMode = antlr4.atn.PredictionMode.LL_EXACT_AMBIG_DETECTION;

  if (options.traceParser) {
    parser.setTrace(true);
    // parser._interp.debug = true; // output too long
    parser._interp.debug_list_atn_decisions = true;
    parser._interp.dfa_debug = true;
    parser._interp.retry_debug = true;
    parser._interp.debug_add = true;
  }
  else if (options.traceParserAmb) {
    const listener = new antlr4.error.DiagnosticErrorListener();
    // listener.exactOnly = false;
    parser.addErrorListener( listener );
    parser._interp.predictionMode = antlr4.atn.PredictionMode.LL_EXACT_AMBIG_DETECTION;
  }
  else {
    parser.removeErrorListeners();
    parser.avoidErrorListeners = true;
  }
  parser.addErrorListener( errorListener );

  if (options.parseListener)
    parser.addParseListener(options.parseListener);


  let tree;
  try {
    tree = parser[rulespec.func]();
  }
  catch (e) {
    if (e instanceof RangeError && e.message.match(/Maximum.*exceeded$/i)) {
      messageFunctions.error('syntax-invalid-source', { file: filename },
                             { '#': 'cdl-stackoverflow' } );
    }
    else {
      throw e;
    }
  }
  const ast = tree && tree[rulespec.returns] || new XsnSource();
  ast.options = options;
  if (rulespec.$frontend)
    ast.$frontend = rulespec.$frontend;

  // Do not warn if docComments are explicitly disabled.
  if (options.docComment !== false) {
    for (const token of tokenStream.tokens) {
      if (token.type === parser.constructor.DocComment && !token.isUsed) {
        messageFunctions.info('syntax-ignoring-doc-comment', parser.tokenLocation(token), {},
                              'Ignoring doc comment as it is not written at a defined position');
      }
    }
  }

  // TODO: clarify with LSP colleagues: still necessary?
  if (parser.messages) {
    Object.defineProperty( ast, 'messages',
                           { value: parser.messages, configurable: true, writable: true } );
  }
  if (options.attachTokens === true || options.attachTokens === filename)
    ast.tokenStream = tokenStream;
  // if (filename === '<condition>.cds') console.log(ast)
  return ast;
}

function reportOldParserUsage( parser ) {
  // This check incurs some overhead, of course. But because we want to get rid of
  // the old parser anyway, we accept it.
  const alreadyReported = parser.$messageFunctions.messages
    .some(message => message.messageId === 'api-deprecated-parser');

  if (!alreadyReported) {
    parser.$messageFunctions.warning(
      'api-deprecated-parser', null, null,
      'The ANTLR based CDS parser will be removed in future minor releases of @sap/cds-compiler'
    );
  }
}


module.exports = parse;
