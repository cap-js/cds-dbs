// Entry point to parsers

'use strict';

const lazyload = require('../base/lazyload')( module );
const { CompilerAssertion } = require( '../base/error' );
const { createMessageFunctions } = require( '../base/messages' );
const { XsnSource } = require('../compiler/xsn-model');

const parseWithAntlr = lazyload('../language/antlrParser');
const CdlLexer = require( './Lexer' );
const gen = lazyload( '../gen/CdlParser' );

const rules = {
  cdl: { func: 'start', returns: 'source', $frontend: 'cdl' },
  query: { func: 'queryEOF', returns: 'query' },
  expr: { func: 'conditionEOF', returns: 'cond' }, // yes, condition
};

function parseCdl( source, filename = '<undefined>.cds',
                   options = {}, messageFunctions = null,
                   rule = 'cdl' ) {
  const rulespec = rules[rule];
  if (options.newParser === false || options.newparser === false)
    return parseWithAntlr( source, filename, options, messageFunctions, rulespec );
  const { CdlParser } = gen;
  if (CdlParser.tracingParser)  // tracing → direct console output of message
    messageFunctions = createMessageFunctions( {}, 'parse', {} );

  const lexer = new CdlLexer( filename, source );
  const parser = new CdlParser( lexer, options, messageFunctions ).init();
  parser.filename = filename;   // LSP compatibility

  // For LSP:
  const { parseListener, attachTokens } = options;
  if (parseListener || attachTokens)
    setTokenStream( parser, lexer );
  if (parseListener)
    setParseListener( parser, parseListener );

  const result = {};
  try {
    parser[rulespec.func]( result );
  }
  catch (e) {
    if (!(e instanceof RangeError && /Maximum.*exceeded$/i.test( e.message )))
      throw e;
    messageFunctions.error( 'syntax-invalid-source', { file: filename },
                            { '#': 'cdl-stackoverflow' } );
    result[rulespec.returns] = undefined;
  }
  const ast = result[rulespec?.returns] || (rule === 'cdl' ? new XsnSource( 'cdl' ) : {} );
  ast.options = options;
  if (attachTokens === true || attachTokens === filename)
    ast.tokenStream = parser._input;
  return ast;
}

function setTokenStream( parser, lexer ) {
  const combined = [];
  const { tokens, comments, docComments } = parser;
  const length = tokens.length + comments.length + docComments.length;
  let tokenIdx = 0;
  let commentIdx = 0;
  let docCommentIdx = 0;
  for (let index = 0; index < length; ++index) {
    if (tokens[tokenIdx].location.tokenIndex === index) // EOF has largest tokenIndex
      combined.push( tokens[tokenIdx++] );
    else if (comments[commentIdx]?.location.tokenIndex === index)
      combined.push( comments[commentIdx++] );
    else
      combined.push( docComments[docCommentIdx++] );
  }
  if (!combined.at( -1 ))
    throw new CompilerAssertion( 'Invalid values for `tokenIndex`' );
  for (const tok of combined)
    tok.start = lexer.characterPos( tok.location.line, tok.location.col );

  parser._input = { tokens: combined, lexer }; // lexer for characterPos() in cdshi.js
  parser.getTokenStream = function getTokenStream() {
    return this._input;
  };
}

function setParseListener( parser, parseListener ) {
  const { CdlParser } = gen;
  parser.rule_ = function rule_( ...args ) {
    // TODO: can we use `super` here?
    CdlParser.prototype.rule_.apply( this, args );
    let state = this.s;
    while (typeof this.table[--state] !== 'string')
      ;
    const $ctx = {    // ANTLR-like context, TODO LSP: more to add?
      parser: this,   // set in generated ANTLR parser for each rule context
      ruleName: this.table[state], // instead of ruleIndex
      start: this.la(),       // set in Parser#enterRule
      stop: null,
    };
    parser.stack.at( -1 ).$ctx = $ctx;
    parseListener.enterEveryRule( $ctx );
  };
  parser.exit_ = function exit_( ...args ) {
    const { $ctx } = parser.stack.at( -1 );
    // TODO: what should we do in case of errors?
    $ctx.stop = this.lb();
    parseListener.exitEveryRule( $ctx );
    return CdlParser.prototype.exit_.apply( this, args );
  };
  parser.c = function c( ...args ) { // consume
    const symbol = this.la();
    const result = CdlParser.prototype.c.apply( this, args );
    if (result)
      parseListener.visitTerminal( { symbol } );
    return result;
  };
  parser.skipToken_ = function skipToken_( ...args ) { // skip token in error recovery
    const symbol = this.la();
    CdlParser.prototype.skipToken_.apply( this, args ); // = `++this.tokenIdx`
    parseListener.visitErrorNode( { symbol } );
  };
}

module.exports = { parseCdl };
