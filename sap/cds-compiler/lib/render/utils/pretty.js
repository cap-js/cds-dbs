'use strict';

// Pretty Printer
//
// Based on https://homepages.inf.ed.ac.uk/wadler/papers/prettier/prettier.pdf
// by Philip Wadler.  Implemented up to section 3, which includes some
// efficiency improvements.
//
// A similar algorithm is also used by the cds-lsp package, though more advanced
// and based on a formatting stream instead of these nested structures.
//
// The basic idea is that you can define the maximum width and the document
// is formatted best to fill that space.
// Groups should appear on a single line if possible.
//
// All function names come directly from the above paper and its
// Haskell implementation.  Variable names have been changed to improve
// readability, e.g. `x` -> `doc`, etc.

/** Base document class. */
class Doc {}

const LINE_OR_SPACE = ' ';
const LINE_OR_EMPTY = '';

/**
 * This class represents a newline which may or may not be inserted into
 * the document, depending on the width.
 * If no newline is to be inserted, `kind` stores whether we insert
 * a space or no space instead.  It is used by `flatten()`.
 * If a newline is to be inserted, nesting is added, which may have been
 * applied by `best()`/`be()`.
 */
class Line extends Doc {
  /**
   * @param {string} kind LINE_OR_SPACE or LINE_OR_EMPTY
   */
  constructor(kind = LINE_OR_SPACE) {
    super();
    this.kind = kind;
    this._indent = 0;
  }
  applyNest(n) {
    this._indent = n;
  }
  toString() {
    return `\n${ ' '.repeat(this._indent) }`;
  }
}

/**
 * Adds nesting to the given document.  Nesting is applied to the underlying
 * lines in `flatten()`.  But when creating a document, Nest is useful
 * to easily indent blocks.
 */
class Nest extends Doc {
  /**
   * @param {number} indent
   * @param {Doc|Doc[]|string} x
   */
  constructor(indent, x) {
    super();
    this.indent = indent;
    this.x = x;
  }
}

/**
 * Represents a union of two documents. One flattened and the other structured.
 * A Union is created by `group()`.
 */
class Union extends Doc {
  /**
   * @param {Doc|Doc[]|string} x Flattened document.
   * @param {Doc|Doc[]|string} y Structured document.
   */
  constructor(x, y) {
    super();
    this.x = x;
    this.y = y;
  }
}

/**
 * A newline if no space is available or a single space if enough space is available.
 *
 * @return {Line}
 */
function line() {
  return new Line(LINE_OR_SPACE);
}
/**
 * A newline if no space is available or an empty string if enough space is available.
 *
 * @return {Line}
 */
function lineOrEmpty() {
  return new Line(LINE_OR_EMPTY);
}

/**
 * Group the given document.
 *
 * @param {Doc|Doc[]|string} x
 * @returns {Union}
 */
function group( x ) {
  return new Union(flatten(x), x);
}

/**
 * Flatten the given document, with no regard to line width.
 *
 * @param {Doc|Doc[]|string} doc
 * @returns {Doc|Doc[]|string}
 */
function flatten( doc ) {
  if (!doc)
    return doc;
  else if (Array.isArray(doc))
    return doc.map(flatten).flat(Infinity);
  else if (doc instanceof Line)
    return doc.kind;
  else if (doc instanceof Nest)
    return flatten(doc.x);
  else if (doc instanceof Union)
    return doc.x;
  else if (typeof doc === 'string')
    return doc;
  throw new Error(`unhandled case: ${ typeof doc }`);
}

/**
 * Nest the given document by `n` spaces.
 *
 * @param {number} n
 * @param {Doc|Doc[]|string} doc
 * @returns {Doc|string}
 */
function nestBy( n, doc ) {
  if (Array.isArray(doc) || doc instanceof Line) {
    return new Nest(n, doc);
  }
  else if (doc instanceof Union) {
    doc.y = nestBy(n, doc.y);
    return doc;
  }
  else if (typeof doc === 'string') {
    return doc; // nesting absorbed by string
  }
  else if (typeof doc === 'number' || typeof doc === 'boolean' || doc === null) {
    return String(doc); // nesting absorbed by string
  }

  throw new Error(`unhandled case: ${ typeof doc }`);
}

/**
 * Convenience function which nests the given lines while making the last
 * line not indented.  Consider e.g. `[ 1, 2, 3 ]`, where each number should
 * be on a separate line:
 *
 * ```
 * [
 *   1,
 *   2,
 *   3
 * ]
 * ```
 *
 * The last inserted Line must not be indented.
 *
 * @param {number} indent
 * @param {string} open
 * @param {Doc|Doc[]|string} content
 * @param {string} close
 * @return {Union}
 */
function bracketBlock( indent, open, content, close ) {
  return group([
    open,
    group([ nestBy(indent, [ line(), content ]), line() ] ),
    close,
  ]);
}

/**
 * Returns the document that better fits the desired width and current column.
 *
 * @param {number} width The desired width of the document.
 * @param {number} k Current with of the line. (width-k) is the remaining width.
 * @param {Doc|Doc[]|string} x
 * @param {Doc|Doc[]|string} y
 * @returns {Doc|Doc[]|string}
 */
function better( width, k, x, y ) {
  if (fits(width - k, x))
    return x;
  return y;
}

/**
 * Find the best version of the given document that fits the given
 * width.  This function returns a document that has no Union or Nest
 * anymore, only strings and Line.
 *
 * @param {number} width The desired width of the document.
 * @param {number} k Current with of the line. (width-k) is the remaining width.
 * @param {Doc|Doc[]|string} doc
 * @returns {Doc|Doc[]|string}
 */
function best( width, k, doc ) {
  return be(width, k, 0, doc);
}

/**
 * Same as `best()`, but keeps track of the current nesting `i`.
 *
 * @param {number} width The desired width of the document.
 * @param {number} k Current with of the line. (width-k) is the remaining width.
 * @param {number} i Current nesting.
 * @param {Doc|Doc[]|string} doc
 * @returns {Doc|Doc[]|string|string|Line|*|*[]}
 */
function be( width, k, i, doc ) {
  if (!doc || typeof doc === 'string')
    return doc;
  if (doc instanceof Line) {
    doc.applyNest(i);
    return doc;
  }
  if (doc instanceof Nest)
    return be(width, k, i + doc.indent, doc.x);
  if (doc instanceof Union)
    return better(width, k, be(width, k, i, doc.x), be(width, k, i, doc.y));
  if (Array.isArray(doc)) {
    const result = [];
    for (const entry of doc) {
      const b = be(width, k, i, entry);
      if (typeof b === 'string')
        k += b.length;
      result.push(b);
    }
    return result;
  }
  throw new Error(`unhandled case: ${ typeof doc }`);
}

/**
 * Determines if the document fits into the line.
 *
 * @param {number} width The desired width of the document.
 * @param {Doc|Doc[]|string} doc
 * @returns {boolean}
 */
function fits( width, doc ) {
  const list = Array.isArray(doc) ? doc : [ doc ];
  for (const entry of list) {
    if (!entry || entry instanceof Line)
      return true;
    else if (entry instanceof Union)
      throw new Error('fits() must only be called via best() which resolves Unions already');
    else if (entry instanceof Nest)
      throw new Error('fits() must only be called via best() which resolves Nest already');
    else if (typeof entry === 'string')
      width -= entry.length;

    if (width < 0)
      return false;
  }
  return true;
}

/**
 * Layouts the given document without trying to use as few lines as possible,
 * i.e. each Line is rendered as a newline.
 * Requires Nest nodes to be resolved, i.e. pretty() was applied.
 *
 * @param {Doc[]|Doc} doc
 * @return {string}
 */
function layout( doc ) {
  if (!doc)
    return '';
  else if (Array.isArray(doc))
    return doc.map(layout).join('');
  else if (doc instanceof Line)
    return doc.toString();
  else if (typeof doc === 'string')
    return doc;
  throw new Error(`unhandled case: ${ typeof doc }`);
}

/**
 * Layouts the given document is a "pretty way", that is: it tries
 * to fill up the space of maxWidth characters while keeping it pretty.
 * Adds a final newline character.
 *
 * @param {Doc[]|Doc} doc
 * @param {Number} [maxWidth]
 * @return {string}
 */
function pretty( doc, maxWidth = 80 ) {
  const b = best(maxWidth, 0, doc);
  return layout(b);
}

/**
 * Join the given list of documents by adding tokens between them.
 * Example:
 *   joinDocuments([ 'foo', 'bar', 'foobar' ], [ ',', line() ])
 * returns:
 *   [ 'foo', ',', line(), 'bar', ',', line(), 'foobar' ]
 *
 * @param {Doc[]} values
 * @param {Doc[]} tokens
 * @returns {Doc[]}
 */
function joinDocuments( values, tokens ) {
  const result = [];
  for (let i = 0; i < values.length; i++) {
    result.push(values[i]);
    if (i !== values.length - 1)
      result.push(...tokens);
  }
  return result;
}

module.exports = {
  pretty,
  nestBy,
  line,
  lineOrEmpty,
  group,
  bracketBlock,
  joinDocuments,
};
