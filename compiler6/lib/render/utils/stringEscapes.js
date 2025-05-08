'use strict';

// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u{0000}-\u{001F}]/u;
const highSurrogate = /[\u{D800}-\u{DBFF}]/u;
const lowSurrogate = /[\u{DC00}-\u{DFFF}]/u;
// Either a high surrogate that is NOT followed by a low one or
// a low surrogate not preceded by a high one.
const unpairedSurrogate = /[^\u{D800}-\u{DBFF}][\u{DC00}-\u{DFFF}]|[\u{D800}-\u{DBFF}][^\u{DC00}-\u{DFFF}]/u;

/**
 * Returns true if the string contains an unpaired unicode surrogate.
 * See <https://en.wikipedia.org/wiki/UTF-16#U+D800_to_U+DFFF>.
 * As a surrogate pair MUST consist of a high one followed by a low surrogate,
 * an unpaired surrogate MUST be escaped.
 *
 * @param {string} str
 * @return {boolean}
 */
function hasUnpairedUnicodeSurrogate( str ) {
  return unpairedSurrogate.test(str);
}

/**
 * Returns true if the string contains control characters such as LF or NUL.
 *
 * @param {string} str
 * @return {boolean}
 */
function hasControlCharacters( str ) {
  return controlCharacters.test(str);
}

/**
 * Escape the given string according to the given specification in `escapes`.
 *
 * `escapes` is an object where the entries are either:
 *   - a mapping from character to string, e.g. `{ '"': '&quot;' }`
 *   - `control: (codePoint) => str`
 *     A function that returns an escape sequence for the given control character.
 *   - `unpairedSurrogate: (codePoint) => str`
 *     A function that returns an escape sequence for the given unpaired unicode surrogate.
 *
 * Multi-character keys are not allowed.
 *
 * Character escapes take precedence over `control` and `unpairedSurrogate` escapes,
 * i.e. if you do not want to encode LF (`\n`), add an explicit mapping for it, e.g.
 * `{ '\n': '\n' }`.
 *
 * @example
 *   You can use `escapeString()` like this:
 *   ```js
 *   let escaped = escapeString(str, {
 *     '"': '\\"',
 *     control: (c) => `\\u{${c.toString(16)}}`;
 *     unpairedSurrogate: (c) => `\\u{${c.toString(16)}}`;
 *   });
 *   ```
 *
 * @param {string} str
 * @param {object} escapes
 * @returns {string}
 */
function escapeString( str, escapes ) {
  const output = [];

  for (let i = 0; i < str.length; ++i) {
    const char = str[i];

    if (char in escapes) {
      output.push(escapes[char]);
      continue;
    }

    // Control Characters: C0
    // See <https://en.wikipedia.org/wiki/C0_and_C1_control_codes#Basic_ASCII_control_codes>
    if (controlCharacters.test(char)) {
      output.push(escapes.control ? escapes.control(char.codePointAt(0)) : char);
      continue;
    }

    // Unicode Surrogates
    // These characters appear in _pairs_.  A high surrogate must be followed by a low surrogate.
    // If this is not the case, either needs to be encoded.  This is also done by JSON.
    // See also <https://docs.microsoft.com/en-us/globalization/encoding/surrogate-pairs>
    if (highSurrogate.test(char)) {
      if (i + 1 >= str.length || !lowSurrogate.test(str[i + 1])) {
        output.push(escapes.unpairedSurrogate ? escapes.unpairedSurrogate(char.codePointAt(0)) : char);
      }
      else {
        output.push(char);
        ++i;
        output.push(str[i]);
      }
    }
    else if (lowSurrogate.test(char)) {
      output.push(escapes.unpairedSurrogate ? escapes.unpairedSurrogate(char.codePointAt(0)) : char);
    }
    else {
      // unhandled / non-special character
      output.push(char);
    }
  }

  return output.join('');
}

module.exports = {
  escapeString,
  hasUnpairedUnicodeSurrogate,
  hasControlCharacters,
};
