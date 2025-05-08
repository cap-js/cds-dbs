// Lexer for CDL grammar

// The lexer only cares about potential keywords, not the exact list.  That is, it
// sets the `keyword` property for all non-delimited `Id` tokens.

// General remarks about regular expressions in node.js (or in general):
//
// - Alternatives in regexps are searched left to right, not longest as in scanner
//   generator!
// - Beware if a regular expression fails (or matches just one char) after having
//   tested k characters in an input.  A regexp having a non-optional match or
//   assertion after a loop (Kleene star) could lead to lexer execution time of
//   O(n*n).  Therefore, regexps for strings etc only cover the opening delimiter.

'use strict';

const { Location } = require('../base/location'); // TODO main: add tokenIndex

const rules = [                     // must not contain capturing groups!
  { type: comment, re: '/[*/]' },
  // token type = token text (`type: null`):
  { type: null, re: '[-+*?()\\[\\]{},;:/@#]|\\.(?:\\.\\.?)?|<[=>]?|>=?|=[=>]?|!=|\\|\\|' },
  { type: ident, re: '[$_\\p{ID_Start}][$\\p{ID_Continue}\u200C\u200D]*|!\\[|"' },
  { type: string, re: '[\'"]|`(?:``)?' }, // strings, template literal without …${}
  { type: 'Number', re: '\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?' },
  { type: 'IllegalToken', re: '\\S' }, // must be last
];

const rulesRegexp = new RegExp( `(${ rules.map( r => r.re ).join( ')|(' ) })`, 'iugm' );
if (rulesRegexp.exec( '§' )[rules.length] !== '§')
  throw Error( 'Invalid capturing group in rules regexp' );
const newlineRegexp = /\n/g;       // TODO: \r?, PS, LS

const commentRegexps = { '//': /$/gm, '/*': /\*\//g };
const stringRegexps = { "'": /'|$/gm, '`': /[`\\]/g, '```': /```|\\/g };
const identRegexps = { '![': /\]|$/gm, '"': /"|$/gm };

const quotedLiterals = [ 'date', 'time', 'timestamp', 'x' ];

class Token {
  type;
  text;
  keyword;
  location;
  parsedAs;
  get isIdentifier() {          // compatibility method
    return this.parsedAs !== 'keyword' && this.parsedAs !== 'token' && this.parsedAs;
  }
  get tokenIndex() {
    return this.location.tokenIndex;
  }
}

class Lexer {
  constructor( file, input ) {
    this.file = file;
    this.input = input;       // string
    this.linePositions = undefined;
    this.location = undefined;
  }

  characterPos( line, col ) {
    return this.linePositions[line - 1] + col - 1;
  }

  tokenize( parser ) {
    this.linePositions = [ 0 ];
    parser.tokens = [];
    parser.docComments = [];
    newlineRegexp.lastIndex = 0;
    while (newlineRegexp.test( this.input ))
      this.linePositions.push( newlineRegexp.lastIndex );

    const { file } = this;
    let line = 1;
    rulesRegexp.lastIndex = 0;
    let match;
    // eslint-disable-next-line no-cond-assign
    while (match = rulesRegexp.exec( this.input )) {
      let text = match[0];
      const group = match.indexOf( text, 1 ) - 1;
      let type = rules[group].type || text;
      const pos = match.index;
      while (pos >= this.linePositions[line])
        ++line;
      const col = pos - this.linePositions[line - 1] + 1;
      this.location = {
        __proto__: Location.prototype,
        file,
        line,
        col,
        endLine: line,
        endCol: col + text.length,
        // remark: end positions of multi-line tokens must be set by function
        tokenIndex: parser.tokens.length + parser.docComments.length + parser.comments.length,
      };
      let keyword;
      if (typeof type !== 'function' || // eslint-disable-next-line sonarjs/no-nested-assignment
          ([ type, text, keyword ] = type( text, this, parser, pos )) && type) {
        parser.tokens.push( {
          __proto__: Token.prototype,
          type,
          text,
          keyword,
          location: this.location,
          parsedAs: undefined,
        } );
      }
    }
    line = this.linePositions.length;
    const endCol = this.input.length - this.linePositions[line - 1] + 1;
    const location = {
      __proto__: Location.prototype,
      file,
      line,
      col: endCol,
      endLine: line,
      endCol,
      tokenIndex: parser.tokens.length + parser.docComments.length + parser.comments.length,
    };
    parser.tokens.push( {
      __proto__: Token.prototype,
      type: 'EOF',
      text: '',
      keyword: false,
      location,
      parsedAs: undefined,
    } );
  }
}

function comment( text, lexer, parser, beg ) {
  const re = commentRegexps[text];
  re.lastIndex = rulesRegexp.lastIndex;
  if (!re.test( lexer.input )) {
    // eslint-disable-next-line cds-compiler/message-texts
    parser.error( 'syntax-missing-token-end', lexer.location,
                  { '#': 'comment', code: '/*', newCode: '*/' }, {
                    comment: 'Comments starting with $(CODE) must end with $(NEWCODE)',
                  } );
  }
  else if (text === '/*' && lexer.input.charAt( rulesRegexp.lastIndex ) === '*' &&
           rulesRegexp.lastIndex + 2 < re.lastIndex) { // not just `/**/`
    parser.docComments.push( {
      __proto__: Token.prototype,
      type: 'DocComment',
      text: lexer.input.substring( beg, re.lastIndex ),
      keyword: false,
      location: lexer.location,
      parsedAs: undefined,
    } );
    adaptEndLocation( lexer, re.lastIndex ); // also works after push ?
  }
  else {                        // TODO: only attach with option `attachTokens` ?
    parser.comments.push( {
      __proto__: Token.prototype,
      type: 'Comment',
      text: lexer.input.substring( beg, re.lastIndex ),
      keyword: false,
      location: lexer.location,
      parsedAs: undefined,
    } );
    adaptEndLocation( lexer, re.lastIndex ); // also works after push ?
  }
  rulesRegexp.lastIndex = re.lastIndex || lexer.input.length;
  return [];
}

function string( text, lexer, parser, beg ) {
  let prefix = null;
  const re = stringRegexps[text];
  re.lastIndex = rulesRegexp.lastIndex;
  let esc = 0;
  if (text !== "'") {           // single or triple back-quote
    while (re.test( lexer.input ) && lexer.input[re.lastIndex - 1] === '\\')
      esc = ++re.lastIndex;
  }
  else {                        // try with previous date/time/timestamp/x
    prefix = parser.tokens[parser.tokens.length - 1];
    if (prefix && (prefix.location.endLine !== lexer.location.line ||
        prefix.location.endCol !== lexer.location.col ||
        !quotedLiterals.includes( prefix.keyword )))
      prefix = null;
    while (re.test( lexer.input ) && lexer.input[re.lastIndex] === "'")
      esc = ++re.lastIndex;
  }

  let keyword;
  const { lastIndex } = re;
  if (!lastIndex ||             // reached EOF with template literal
      lexer.input[lastIndex - 1] !== lexer.input[beg] || esc === lastIndex) {
    const before = (lastIndex) ? 'string' : 'multi';
    // eslint-disable-next-line cds-compiler/message-texts
    parser.error( 'syntax-missing-token-end', lexer.location,
                  { '#': before, newcode: text }, {
                    string: 'The string literal must end with $(NEWCODE) before the end of line',
                    multi: 'The multi-line string literal must end with $(NEWCODE)',
                  } );
    keyword = 0;
    // TODO: set parsedAs to 0 → no further error if string is not expected?
    prefix = null;           // no combination with date/time/…
  }
  rulesRegexp.lastIndex = lastIndex || lexer.input.length;
  adaptEndLocation( lexer, rulesRegexp.lastIndex );

  if (!prefix)
    return [ 'String', lexer.input.substring( beg, rulesRegexp.lastIndex ), keyword ];
  prefix.type = 'QuotedLiteral';
  prefix.text += lexer.input.substring( beg, rulesRegexp.lastIndex );
  prefix.keyword = undefined;
  prefix.location.endLine = lexer.location.endLine;
  prefix.location.endCol = lexer.location.endCol;
  return [];
}

function ident( text, lexer, parser, beg ) {
  if (!Object.hasOwn( identRegexps, text ))
    return [ 'Id', text, text.toLowerCase() ];
  const re = identRegexps[text];
  const close = (text === '"') ? '"' : ']';
  re.lastIndex = rulesRegexp.lastIndex;
  let esc = 0;
  while (re.test( lexer.input ) && lexer.input[re.lastIndex] === close)
    esc = ++re.lastIndex;

  let keyword;
  const { lastIndex } = re;
  if (lexer.input[lastIndex - 1] !== close || esc === lastIndex) {
    // eslint-disable-next-line cds-compiler/message-texts
    parser.error( 'syntax-missing-token-end', lexer.location,
                  { '#': 'ident', newcode: close }, {
                    ident: 'The delimited id must end with $(NEWCODE) before the end of line',
                  } );
    keyword = 0;
    // TODO: set parsedAs to 0 → no further error if string is not expected?
  }
  rulesRegexp.lastIndex = lastIndex || lexer.input.length;
  adaptEndLocation( lexer, rulesRegexp.lastIndex );
  return [ 'Id', lexer.input.substring( beg, rulesRegexp.lastIndex ), keyword ];
}

function adaptEndLocation( lexer, pos ) {
  let { line } = lexer.location;
  while (pos >= lexer.linePositions[line])
    ++line;
  lexer.location.endLine = line;
  lexer.location.endCol = pos - lexer.linePositions[line - 1] + 1;
}

Lexer.Token = Token;
module.exports = Lexer;
