'use strict';

const {
  isWhitespaceOrNewLineOnly,
  isWhitespaceCharacterNoNewline,
  cdlNewLineRegEx,
} = require('./textUtils');

const fencedCommentRegEx = /^\s*[*]/;
const hasContentOnFirstLineRegEx = /\/\*+\s*\S/;

/**
 * Get the content of a JSDoc-like comment and remove all surrounding asterisks, etc.
 * If the comment only contains whitespace it is seen as empty and `null` is returned
 * which also stops doc comment propagation.
 *
 * Notes on escape sequences:
 *  - For `*\/`, the `\` is removed.
 *  - Nothing else is escaped, meaning `\n` will be `\` and `n` and not a newline character.
 *  - _If requested_, we could parse the doc comment similar to multiline string literals, but
 *    via an option.
 *
 * @param {string} comment Raw comment, e.g. '/** comment ... '.
 *                         Must be a valid doc comment.
 * @returns {string|null} Parsed contents or if the comment has an invalid format or
 *                        does not have any content, null is returned.
 */
function parseDocComment( comment ) {
  // Also return "null" for empty doc comments so that doc comment propagation
  // can be stopped.
  if (comment.length <= 5) // at least "/***/"
    return null;

  let lines = comment.split(cdlNewLineRegEx);

  if (lines.length === 1) {
    // Special case for one-liners.
    // Remove "/***/" and trim white space and asterisks.
    let content = lines[0].replace(/^\/[*]{2,}/, '');
    content = removeFooterFence(content) // for `/*****/`, only `/` remains
      .replace('*\\/', '*/') // escape sequence
      .trim();
    return isWhitespaceOrNewLineOnly(content) ? null : content;
  }

  // If the comment already has content on the first line, i.e. after `/**`,
  // its leading whitespace is ignored for whitespace trimming.
  const hasContentOnFirstLine = hasContentOnFirstLineRegEx.test(lines[0]);

  // First line, i.e. header, is always trimmed from left.
  lines[0] = removeHeaderFence(lines[0]).trimStart();
  lines[lines.length - 1] = removeFooterFence(lines[lines.length - 1]);

  if (lines.length === 2) {
    // Comment that is essentially just a header + footer.
    // If the second line starts with an asterisk then remove it.
    // Otherwise, trim all left whitespace.
    if ((/^\s*[*]/.test(lines[1])))
      lines[1] = removeFence(lines[1]);
    else
      lines[1] = lines[1].trimStart();
  }
  else if (isFencedComment(lines)) {
    lines = lines.map((line, index) => ((index === 0) ? line : removeFence(line)));
  }
  else {
    stripCommentIndentation(lines, hasContentOnFirstLine);
  }

  // Remove empty header and footer.
  const startIndex = (lines[0] === '') ? 1 : 0;
  const endIndex = (lines[lines.length - 1] === '') ? lines.length - 1 : lines.length;

  const content = lines
    .slice(startIndex, endIndex)
    .join('\n')
    .replace('*\\/', '*/'); // escape sequence
  return isWhitespaceOrNewLineOnly(content) ? null : content;
}

/**
 * Strips and counts the indentation from the given comment string.
 * This function is similar to the one in multiLineStringParser.js, but does not
 * have special handling for the first and last line of the string.
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
 * @param {string[]} lines String split into lines.
 * @param {boolean} ignoreFirstLine Whether to ignore the first line for indentation counting.
 */
function stripCommentIndentation( lines, ignoreFirstLine ) {
  const n = lines.length;

  const minIndent = lines.reduce((min, line, index) => {
    // Blank lines are ignored.
    if (isWhitespaceOrNewLineOnly(line) || (index === 0 && ignoreFirstLine))
      return min;

    let count = 0;
    const length = Math.min(min, line.length);
    while (count < length && isWhitespaceCharacterNoNewline(line[count]))
      count++;
    return Math.min(min, count);
  }, Number.MAX_SAFE_INTEGER);

  for (let i = (ignoreFirstLine ? 1 : 0); i < n; ++i) {
    // Note: Line may be empty and have fewer characters than `min`.
    //       In that case, slice() returns an empty string.
    lines[i] = lines[i].slice(minIndent);
  }
}

/**
 * Remove the "fence" around a single comment line.
 * A fence consists of one asterisks ('*') at the beginning with optional spaces
 * before the first '*' and one optional space after that. Spaces at the end of
 * the line are never removed.
 *
 * @param {string} line
 * @returns {string} line without fence
 */
function removeFence( line ) {
  return line.replace(/^\s*[*]\s?/, '');
}

/**
 * Removes a header fence, i.e. '/**'.
 * May remove more than two asterisks e.g. '/*******'
 *
 * @param {string} line
 * @returns {string} Header without fence.
 */
function removeHeaderFence( line ) {
  return line.replace(/^\/[*]{2,}\s?/, '');
}

/**
 * Remove trailing '*\/'. The following cases can happen:
 *   ' * end comment *\/'    => ' * end comment'
 *   '   end *********\/'    => 'end'
 *   '   *************\/'    => removed
 *
 * @param {string} line
 * @returns {string} header without fence
 */
function removeFooterFence( line ) {
  let trimAt = line.length - 1;
  // '-1': remove trailing `/`
  for (let i = trimAt - 1; i >= 0 && line[i] === '*'; --i)
    trimAt = i;
  // We know that trimAt is at a '*', regardless of whether the previous loop ran.
  for (let i = trimAt - 1; i >= 0 && /^\s$/.test(line[i]); --i)
    trimAt = i;
  // Either trimAt is a ' ' or '*', regardless of whether any loop ran.
  return line.slice(0, trimAt);
}

/**
 * Returns true if the source lines all start with an asterisk.
 * Header (i.e. first entry in "lines" array) is ignored.
 *
 * @param {string[]} lines
 */
function isFencedComment( lines ) {
  const index = lines.findIndex((line, i) => {
    const exclude = (i === 0 || i === lines.length - 1);
    return !exclude && !(fencedCommentRegEx.test(line));
  });
  return index === -1 && lines.length > 2;
}

module.exports = {
  parseDocComment,
};
