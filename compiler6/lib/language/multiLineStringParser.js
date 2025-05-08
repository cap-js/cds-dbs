'use strict';

const {
  isWhitespaceOrNewLineOnly,
  isWhitespaceCharacterNoNewline,
  cdlNewLineRegEx,
} = require('./textUtils');
const { CompilerAssertion } = require('../base/error');
const { Location } = require('../base/location');

/**
 * Strips and counts the indentation from the given string.
 * This function is similar to the one in docCommentParser.js, but
 * has special handling for the first and last line of the string.
 *
 * @example
 *     |        hello
 *     |          world
 *     |        foo bar
 *   becomes
 *     | hello
 *     |   world
 *     | foo bar
 *
 * @param {string} str String prior to newline-normalization and escape parsing.
 * @returns {[string, number]} The indentation-stripped string and the number
 *                             of whitespace characters removed.
 */
function stripIndentation( str ) {
  if (str === '')
    return [ '', 0 ];


  // Note: We have to check all newline characters, as the string is not normalized, yet.
  const lines = str.split(cdlNewLineRegEx);
  const n = lines.length;

  const hasTrailingLineBreak = cdlNewLineRegEx.test(str[str.length - 1]);
  if (hasTrailingLineBreak) {
    // Shortcut:
    // If there is a trailing line break, it means that ``` is on newline and
    // therefore the indentation to remove is 0.
    // Remove the last newline, which may be CRLF.
    return [ lines.slice(0, -1).join('\n'), 0 ];
  }

  const minIndent = lines.reduce((min, line, index) => {
    // Note: Last line is the line containing ```.  There, we always count the indentation,
    //       even if blank.  For all other lines, blank lines are ignored.
    if (isWhitespaceOrNewLineOnly(line) && index !== (n - 1))
      return min;

    let count = 0;
    const length = Math.min(min, line.length);
    while (count < length && isWhitespaceCharacterNoNewline(line[count]))
      count++;
    return Math.min(min, count);
  }, Number.MAX_SAFE_INTEGER);

  for (let i = 0; i < n; ++i) {
    // Note: Line may be empty and have fewer characters than `min`.
    //       In that case, slice() returns an empty string.
    lines[i] = lines[i].slice(minIndent);
  }

  // Remove trailing last line, if there was nothing else in that line.
  if (lines[n - 1] === '')
    lines.pop();

  return [ lines.join('\n'), minIndent ];
}

class MultiLineStringParser {
  constructor(antlrParser, token) {
    this.parser = antlrParser; // for message functions
    this.token = token;
    this.str = token.text; // Copy because .text is a getter

    if (this.str[0] !== '`' || this.str[this.str.length - 1] !== '`')
      // eslint-disable-next-line @stylistic/js/max-len
      throw new CompilerAssertion('Invalid multi-line string sequence: Require string to be surrounded by back-ticks!');

    this.output = [];
    this.isTextBlock = this.str.startsWith('```');
    this._indentation = 0;

    // For message locations
    this._lineInString = 0;
    this._currentLineBreakIndex = 0;

    if (this.isTextBlock) {
      this.i = 3;
      this.end = this.str.length - 3;
    }
    else {
      this.i = 1;
      this.end = this.str.length - 1;
    }
  }

  /**
   * Parse the token's text and return it.
   *
   * @return {string}
   */
  parse() {
    if (this.str.length === 2)
      return ''; // Nothing to do: ``

    if (this.isTextBlock) {
      // If there are no line breaks, emit an error as normal single-back-tick
      // strings should be used instead.  Because the first line is skipped,
      // there is no text without at least one line break.
      if (!cdlNewLineRegEx.test(this.str)) {
        const loc = this._locationForCharacters(this.end, 1);
        this.parser.error('syntax-invalid-text-block', loc);
        return '';
      }
      this._skipOptionalLanguageIdentifierLine();
      // Indentation needs to be stripped _before_ escape sequences are parsed and
      // _after_ the first line is skipped, because otherwise `\n` in the string
      // will interfere with calculating indentation and the language identifier
      // is not part of the actual string.
      // Because of message locations, we still need to keep track of indentation count
      // and need to update the cursor and end position as well as the currentLineBreakIndex.
      const [ str, indent ] = stripIndentation(this.str.slice(this.i, -3));
      this.str = str;
      this._indentation = indent;
      this.i = 0;
      this.end = this.str.length;
      // this._lineInString is > 0, but having this._currentLineBreakIndex = 0 would be incorrect,
      // as the line break isn't the first character in the indentation-stripped string
      this._currentLineBreakIndex = -1;
    }

    // Note: Index is at first character of string

    do {
      switch (this._current()) {
        case this._matchLineBreakAtCurrentChar():
          this.output.push('\n');
          break;
        case '\\':
          this._move();
          this._innerEscape();
          break;
        case '$':
          if (this._lookahead() === '{') {
            const loc = this._locationForCharacters(this.i, 2);
            this.parser.error('syntax-missing-escape', loc,
                              { '#': 'placeholder', code: '${', newcode: '\\${' });
          }
          this.output.push(this.str[this.i]);
          break;
        default:
          this.output.push(this.str[this.i]);
          break;
      }
    } while (this._move());

    return this.output.join('');
  }

  /**
   * Parse the escape sequence after the first '\'.
   *
   * @private
   */
  _innerEscape() {
    switch (this._current()) {
      case this._matchLineBreakAtCurrentChar():
        // Don't add to output -> line break is escaped
        break;
      case 'b': // backspace
        this.output.push('\b');
        break;
      case 'f': // form feed
        this.output.push('\f');
        break;
      case 'v': // vertical tabulator
        this.output.push('\v');
        break;
      case 'r': // carriage return
        this.output.push('\r');
        break;
      case 'n': // line feed
        this.output.push('\n');
        break;
      case 't': // tab
        this.output.push('\t');
        break;
      case '\\':
      case '"':
      case '\'':
      case '`':
      case '$':
        this.output.push(this._current());
        break;
      case 'x':
        this._parseHexEscape('x', 2);
        break;
      case 'u':
        if (this._lookahead() === '{')
          this._parseBracedUnicodeEscape();
        else
          this._parseHexEscape('u', 4);
        break;
      case '0': // null terminator
        if (!/^\d$/.test(this._lookahead())) {
          this.output.push('\0');
          break;
        }
        // Let the default case handle octal representation.
        // fallthrough
      default: {
        this.output.push(this._current());
        const loc = this._locationForCharacters(this.i - 1, 2);
        if (/\s/.test(this._current())) {
          this.parser.error('syntax-invalid-escape', loc, { '#': 'whitespace' });
        }
        else if (/\d/.test(this._current())) {
          this.parser.error('syntax-invalid-escape', loc, { '#': 'octal' });
        }
        else {
          const code = this._makeCode(`\\${ this._current() }`);
          this.parser.message('syntax-unknown-escape', loc, { '#': 'std', code });
        }
        break;
      }
    }
  }

  /**
   * Parse the given hexadecimal string to a unicode code-point.
   *
   * @param {string} codePoint Code-point represented as hexadecimal string, e.g. 'ABCD'.
   * @private
   */
  _parseHexCodePoint(codePoint) {
    // Notes:
    // It isn't possible to get an invalid code point with the \u0000
    // syntax variant as the first invalid code point is \u{110000}
    // and an empty `codePoint` is only possible with the braced variant.
    const reportInvalidCodePoint = () => {
      const code = this._makeCode(`\\u{${ codePoint }}`);
      const loc = this._locationForCharacters(this.i - codePoint.length, codePoint.length);
      this.parser.error('syntax-invalid-escape', loc, { '#': 'codepoint', code });
    };

    const n = Number.parseInt(codePoint, 16);
    if (Number.isNaN(n)) {
      reportInvalidCodePoint();
      return;
    }

    try {
      this.output.push(String.fromCodePoint(n));
    }
    catch {
      // RangeError is thrown if number isn't a valid code point
      reportInvalidCodePoint();
    }
  }

  /**
   * Parse a hex escape-sequence.  Useful for unicode escapes and hex escapes.
   * Cursor is at the `x`: `\x00`
   *                         ^
   * or at the `u`: `\u0000`
   *                  ^
   * @param {string} mode  Either `x` or `u`. Used for error messages.
   * @param {number} count Number of expected hexadecimal numbers
   * @private
   */
  _parseHexEscape(mode, count) {
    let codePoint = '';

    for (let j = 0; j < count; ++j) {
      if (!this._eos() && /^[\dA-Fa-f]$/.test(this._lookahead())) {
        this._move();
        codePoint += this._current();
      }
      else {
        break;
      }
    }

    if (codePoint.length === count) {
      this._parseHexCodePoint(codePoint);
    }
    else {
      const loc = this._locationForCharacters(this.i + 1, 1);
      const code = this._eos(this.i + 1) ? `\\${ mode }${ codePoint }` : `\\${ mode }${ codePoint }${ this._lookahead() }`;
      this.parser.error('syntax-invalid-escape', loc,
                        { '#': 'hex-count', count, code: this._makeCode(code) });
    }
  }

  /**
   * Parse a unicode escape-sequence with braces.
   * Cursor is at the `u`: `\u{0000}`
   *                         ^
   * @private
   */
  _parseBracedUnicodeEscape() {
    let codePoint = '';

    this._move(); // 'u'

    while (!this._eos()) {
      if (/^[\dA-Fa-f]$/.test(this._lookahead())) {
        this._move();
        codePoint += this._current();
      }
      else if (this._lookahead() === '}') {
        break;
      }
      else if (!this._eos(this.i + 1)) {
        const loc = this._locationForCharacters(this.i + 1, 1); // Point to the exact character
        const code = this._makeCode(`\\u{${ codePoint }${ this._lookahead() }…}`);
        this.parser.error('syntax-invalid-escape', loc, { '#': 'unicode-hex', code });
        return;
      }
      else {
        break;
      }
    }

    if (this._lookahead() === '}') {
      this._move();
      this._parseHexCodePoint(codePoint);
    }
    else {
      const loc = this._locationForCharacters(this.i, 1);
      this.parser.error('syntax-invalid-escape', loc, { '#': 'unicode-brace' });
    }
  }

  /**
   * This function skips the language identifier, i.e. until the next line.
   * After this function, the cursor will be at the character _after_ the newline.
   *
   * @private
   */
  _skipOptionalLanguageIdentifierLine() {
    while (!this._eos()) {
      switch (this._current()) {
        case this._matchLineBreakAtCurrentChar():
          this._move();
          return;
        case '\\': {
          // Do not allow an escape in the language identifier. If at the line's end, users
          // may expect the identifier to span more than the first line, which is _not_ the case.
          const loc = this._locationForCharacters(this.i, 1);
          this.parser.error('syntax-invalid-escape', loc, { '#': 'language-identifier' });
          this._move();
          break;
        }
        default:
          this._move();
          break;
      }
    }
  }

  /**
   * Consume a line-break Character.  Because CDS is close to JavaScript, we
   * also support LS and PS.  This function also ensures that CRLF (`\r\n`) is
   * recognized as a single character.
   * We increase the line number for LF (`\n`) for correct message locations.
   *
   * This function returns the input character, so that it can be used
   * in a switch-case.
   *
   * @returns {string|null}
   * @private
   */
  _matchLineBreakAtCurrentChar() {
    // Only increase line number for \n, because ANTLR does the same
    switch (this._current()) {
      case '\r':
        if (this._lookahead() === '\n') {
          this._move(); // \r\n is normalized
          this._lineInString++;
          this._currentLineBreakIndex = this.i;
        }
        return '\r';
      case '\n':
        this._lineInString++;
        this._currentLineBreakIndex = this.i;
      // fallthrough
      case '\u2028': // LS
      case '\u2029': // PS
        return this._current();
      default: break;
    }
    return null;
  }

  /**
   * Move the cursor to the next character _if_ we're not at the end.
   *
   * @private
   * @returns {boolean} `true` if we're not at the end
   */
  _move() {
    if (this.i < this.end) { // Don't move past last char and `
      ++this.i;
    }
    return this.i < this.end;
  }

  /**
   * Returns `true` if we're at the end of the string
   *
   * @param {Number} [i=this.i] Index to check for EOS
   * @private
   * @returns {boolean}
   */
  _eos(i = this.i) {
    // end-of-string -> char before `
    return i >= this.end;
  }

  /**
   * Get the next character without increasing the cursor.
   * @note Does not check for `eos()`
   *
   * @private
   * @returns {string}
   */
  _lookahead() {
    return this.str[this.i + 1];
  }

  /**
   * Get the current character without increasing the cursor.
   *
   * @private
   * @returns {string}
   */
  _current() {
    return this.str[this.i];
  }

  /**
   * Get the previous character without decreasing the cursor.
   *
   * @private
   * @returns {string}
   */
  _previous() {
    return this.str[this.i - 1];
  }

  /**
   * Get message location for the given cursor position inside the string.
   *
   * @param {Number} i Cursor position
   * @param {Number} width Width of the location
   * @private
   * @returns {CSN.Location}
   */
  _locationForCharacters(i, width) {
    return {
      __proto__: Location.prototype,
      file: this.parser.filename,
      line: this.token.line + this._lineInString,
      endLine: this.token.line + this._lineInString,
      col: this._lineInString > 0
        ? i - this._currentLineBreakIndex + this._indentation
        : this.token.column + i + 1,
      endCol: this._lineInString > 0
        ? i - this._currentLineBreakIndex + width + this._indentation
        : this.token.column + i + width + 1,
    };
  }

  /**
   * For text messages, escape the given string for $(CODE).
   * Escaping is required to avoid line breaks in compiler messages, e.g.
   * if \u000<LF> is the code, the line-feed must be escaped.
   *
   * @param {string} code
   * @private
   */
  _makeCode(code) {
    // For characters that may be rendered as newline,
    // see <https://www.unicode.org/reports/tr14/tr14-32.html>.
    //
    // Note: Unicode class `General_Category=Line_Separator` does not work for '\n'.
    //
    // U+000A: Line Feed (short: LF)
    // U+000B: Vertical Tab (short: VT)
    // U+000C: Form Feed (short: FF)
    // U+000D: Carriage Return (short: CR)
    // U+0085: Next Line (short: NEL)
    // U+2028: Line Separator (short: LS)
    // U+2029: Paragraph Separator (short: PS)
    //
    // For Visualization, see <https://en.wikipedia.org/wiki/Newline#Unicode>
    //   U+23CE: ⏎
    // eslint-disable-next-line no-control-regex
    const allNewLineCharacters = /[\u{000A}\u{000B}\u{000C}\u{000D}\u{0085}\u{2028}\u{2029}]/ug;
    return code.replace(allNewLineCharacters, '\u{23CE}');
  }
}

/**
 * Parse a back-tick string and return it.  This includes escape
 * sequences, newlines, etc.
 *
 * Does _not_ modify the token's text.
 *
 * @param {object} token
 */
function parseMultiLineStringLiteral( token ) {
  const p = new MultiLineStringParser(this, token);
  return p.parse();
}

module.exports = {
  parseMultiLineStringLiteral,
};
