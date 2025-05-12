'use strict';

/** RegEx identifying undelimited identifiers in CDL */
const undelimitedIdentifierRegex = /^[$_\p{ID_Start}][$\p{ID_Continue}\u200C\u200D]*$/u;

/**
 * Functions without parentheses in CDL (common standard SQL-92 functions)
 * (do not add more - make it part of the SQL renderer to remove parentheses for
 * other funny SQL functions like CURRENT_UTCTIMESTAMP).
 */
const functionsWithoutParentheses = [
  'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
  'CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER',
];

// CDL reserved keywords, used for automatic quoting in 'toCdl' renderer
// Keep in sync with reserved keywords in language.g4
const cdlKeywords = [
  'ALL',
  'ANY',
  'AS',
  'BY',
  'CASE',
  'CAST',
  'DISTINCT',
  'EXISTS',
  'EXTRACT',
  'FALSE', // boolean
  'FROM',
  'IN',
  'KEY',
  'NEW',
  'NOT',
  'NULL',
  'OF',
  'ON',
  'SELECT',
  'SOME',
  'TRIM',
  'TRUE', // boolean
  'WHEN',
  'WHERE',
  'WITH',
];

function isSimpleCdlIdentifier( id ) {
  if (undelimitedIdentifierRegex.test(id))
    return true;
  const upperId = id.toUpperCase();
  return !cdlKeywords.includes(upperId) &&
    !functionsWithoutParentheses.includes(upperId);
}

module.exports = {
  undelimitedIdentifierRegex,
  cdlKeywords,
  functionsWithoutParentheses,
  isSimpleCdlIdentifier,
};
