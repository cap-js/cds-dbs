'use strict';

/** Whitespace characters without line-breaks. */
// eslint-disable-next-line no-control-regex
const whitespaceRegEx = /[\t\u{000B}\u{000C} \u{00A0}\u{FEFF}\p{Zs}]/u;
const cdlNewLineRegEx = /\r\n?|\n|\u2028|\u2029/u;

/**
 * Returns true if the given string only contains whitespace characters.
 * In contrast to `whitespaceRegEx`, it also matches newlines.
 *
 * @param {string} str
 * @returns {boolean}
 */
function isWhitespaceOrNewLineOnly( str ) {
  return /^\s*$/.test(str);
}

/**
 * Check whether the given character is a white-space character as
 * defined by §11.2 of the ECMAScript 2020 specification.
 * See <https://262.ecma-international.org/11.0/#sec-white-space>.
 *
 * | Code Point          | Name                                           | Abbreviation |
 * |:--------------------|:-----------------------------------------------|--------------|
 * | U+0009              | CHARACTER TABULATION                           | `<TAB>`      |
 * | U+000B              | LINE TABULATION                                | `<VT>`       |
 * | U+000C              | FORM FEED (FF)                                 | `<FF>`       |
 * | U+0020              | SPACE                                          | `<SP>`       |
 * | U+00A0              | NO-BREAK SPACE                                 | `<NBSP>`     |
 * | U+FEFF              | ZERO WIDTH NO-BREAK SPACE                      | `<ZWNBSP>`   |
 * | Other category “Zs” | Any other Unicode “Space_Separator” code point | `<USP>`      |
 *
 * @param char
 * @returns {boolean}
 */
function isWhitespaceCharacterNoNewline( char ) {
  return whitespaceRegEx.test(char);
}

/**
 * Normalized CDL newlines to LF (\n).  CDL newlines also contain PS and other
 * characters, see cdlNewLineRegEx.
 *
 * @param {string} str
 * @return {string}
 */
function normalizeNewLine( str ) {
  // Note: cdlNewLineRegEx does not have `g`.
  return str.replace(new RegExp(cdlNewLineRegEx, 'ug'), '\n');
}

/**
 * Normalizes the given number (as a string):
 *
 *  - removes leading zeroes (`0`) to avoid accidental octal-conversion
 *
 * @param {string} str
 * @return {string}
 */
function normalizeNumberString( str ) {
  const num = str.replace(/^([+-]?)0+(\d)/, '$1$2');
  if (!num.includes('.'))
    return num;
  return num.replace(/([.]\d)0+$/, '$1');
}

module.exports = {
  isWhitespaceOrNewLineOnly,
  isWhitespaceCharacterNoNewline,
  cdlNewLineRegEx,
  normalizeNewLine,
  normalizeNumberString,
};
