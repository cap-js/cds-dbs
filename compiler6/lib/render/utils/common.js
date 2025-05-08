// Common render functions for toCdl.js, toHdbcds.js and toSql.js

'use strict';

const { ModelError } = require('../../base/error');
const { standardDatabaseFunctions } = require('./standardDatabaseFunctions');

const functionsWithoutParams = {
  hana: {
    CURRENT_CONNECTION: {},
    CURRENT_SCHEMA: {},
    CURRENT_TRANSACTION_ISOLATION_LEVEL: {},
    CURRENT_UTCDATE: {},
    CURRENT_UTCTIME: {},
    CURRENT_UTCTIMESTAMP: {},
    SYSUUID: {},
  },
};

const {
  hasValidSkipOrExists, forEachDefinition, getNamespace, getUnderscoredName,
} = require('../../model/csnUtils');

const { implicitAs } = require('../../model/csnRefs');

/**
 * Render the given function
 *
 * @param {string} funcName Name of the function
 * @param {object} node Content of the function
 * @param {(a: string) => string} renderArgs Function to render function arguments
 * @param {object} utils Utility object containing options, path, and message functions
 * @returns {string} Function string
 */
function renderFunc( funcName, node, renderArgs, utils ) {
  const { options, path, messageFunctions } = utils || {};
  const { sqlDialect } = options;
  if (funcWithoutParen( node, sqlDialect ))
    return funcName;
  const rewriteStandardFunctions = options.transformation !== 'hdbcds' && sqlDialect !== 'plain' && options.standardDatabaseFunctions !== false;
  if (rewriteStandardFunctions) {
    // we check function arguments for correctness
    const { error } = messageFunctions;
    const that = { renderArgs, error, path };
    if (standardDatabaseFunctions[sqlDialect]?.[funcName])
      return standardDatabaseFunctions[sqlDialect][funcName].call(that, node);
    else if (standardDatabaseFunctions.common[funcName])
      return standardDatabaseFunctions.common[funcName].call(that, node);
  }
  return `${ funcName }(${ renderArgs( node ) })`;
}

/**
 * Checks whether the given function is to be rendered without parentheses
 *
 * @param {object} node Content of the function
 * @param {string} dialect One of 'hana', 'cap' or 'sqlite' - only 'hana' is relevant atm
 * @returns {boolean} True if without
 */
function funcWithoutParen( node, dialect ) {
  if (!node.args)
    return true;
  if (!Array.isArray( node.args ) || node.args.length)
    return false;
  const specials = functionsWithoutParams[dialect];
  return specials && specials[node.func.toUpperCase()];
}

/**
 * Process already rendered expression parts by joining them nicely.
 * For example, it adds spaces around operators such as `+`, but not around `.`.
 *
 * @param {any[]} tokens Array of expression tokens
 * @returns {string} The rendered xpr
 */
function beautifyExprArray( tokens ) {
  // Simply concatenate array parts with spaces (with a tiny bit of beautification)
  let result = '';
  for (let i = 0; i < tokens.length; i++) {
    result += tokens[i];
    // No space after last token, after opening parentheses, before closing parentheses, before comma, before and after dot
    if (i !== tokens.length - 1 &&
        // current token
        tokens[i] !== '.' &&
        // next token
        tokens[i + 1] !== '.' && tokens[i + 1] !== ',')
      result += ' ';
  }
  return result;
}

/**
 * Get the part that is really the name of this artifact and not just prefix caused by a context/service
 *
 * @param {CSN.Model} csn CSN model
 * @param {string} artifactName Artifact name to use
 * @returns {string} non-prefix part of the artifact name
 */
function getRealName( csn, artifactName ) {
  const parts = artifactName.split('.');
  // Length of 1 -> There can be no prefix
  if (parts.length === 1)
    return artifactName;

  const namespace = getNamespace(csn, artifactName);
  const startIndex = namespace ? namespace.split('.').length : 0;
  let indexOfLastParent = startIndex;
  const realParts = getUnderscoredName(startIndex, parts, csn);
  if (realParts)
    return realParts[realParts.length - 1];
  // With this loop, we find the name if the art is part of a context
  for (let i = startIndex; i < parts.length; i++) {
    const possibleParentName = parts.slice(0, i).join('.');
    const art = csn.definitions[possibleParentName];

    if (art && art.kind !== 'context' && art.kind !== 'service')
      return parts.slice(i).join('_');
    else if (art && (art.kind === 'context' || art.kind === 'service'))
      indexOfLastParent = i;
  }

  // With this, we find the name if it is shadowed by another definition or similar
  return parts.slice(indexOfLastParent, parts.length).join('.');
}

/**
   * For given artifact, return the name of the topmost context it is contained in (if any).
   *
   * Given context A and artifact A.B.C (with no context A.B) -> return A.
   *
   * Given context Namespace.A and artifact Namespace.A.B.C -> return Namespace.A.
   *
   * Given entity A and artifact
   *
   * @param {string} artifactName Name of the artifact to check for
   * @returns {string | null} Name of the topmost context or null
   */
function getParentContextName( csn, artifactName ) {
  const parts = artifactName.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(0, i).join('.');
    const art = csn.definitions[name];

    if (art && (art.kind === 'context' || art.kind === 'service'))
      return name;
  }
  return null;
}

/**
 * If there is a namespace A.B.C, create context A and a context A.B.C.
 *
 * Context A.B will be created by addIntermediateContexts
 *
 * @param {CSN.Model} csn
 * @param {Function[]} killList Array to add cleanup functions to
 */
function addContextMarkers( csn, killList ) {
  const contextsToCreate = Object.create(null);
  forEachDefinition(csn, (art, artifactName) => {
    const namespace = getNamespace(csn, artifactName);
    if (namespace && !(art.$ignore || hasValidSkipOrExists(art))) {
      const parts = namespace.split('.');
      contextsToCreate[parts[0]] = true;

      if (parts.length > 1)
        contextsToCreate[namespace] = true;
    }
  });

  Object.keys(contextsToCreate).forEach((contextName) => {
    if (!csn.definitions[contextName]) {
      csn.definitions[contextName] = {
        kind: 'context',
      };
      killList.push(() => delete csn.definitions[contextName]);
    }
  });
}


/**
  * For the given parent context and the current context, calculate all missing intermediate context names.
  * I.e. all the artifact names inbetween, that do not have a csn.definition.
  *
  * A and A.B.C.D -> A.B and A.B.C are possible candidates
  *
  * @param {CSN.Model} csn
  * @param {string} parentName Name of the parent context
  * @param {string} artifactName Name of the current context
  * @returns {string[]} All possible context names inbetween
  */
function getIntermediateContextNames( csn, parentName, artifactName ) {
  const parentLength = parentName.split('.').length;
  const parts = artifactName.split('.');
  const names = [];
  for (let i = parentLength + 1; i < parts.length; i++) {
    const name = parts.slice(0, i).join('.');
    const art = csn.definitions[name];

    if (!art)
      names.push(name);
  }

  return names;
}

/**
 * For context A and entity A.B.C, create context A.B
 *
 * @param {CSN.Model} csn
 * @param {string} artifactName
 * @param {Function[]} killList Array to add cleanup functions to
 */
function addMissingChildContexts( csn, artifactName, killList ) {
  // Get all other definitions sharing the same prefix, sorted by shortest first
  const possibleNames = Object.keys(csn.definitions).filter(name => name.startsWith(`${ artifactName }.`)).sort((a, b) => a.length - b.length);
  for (const name of possibleNames) {
    const artifact = csn.definitions[name];
    if (!artifact.$ignore && !hasValidSkipOrExists(artifact))
      addPossibleGaps(name.slice(artifactName.length + 1).split('.'), artifactName);
  }

  function addPossibleGaps( possibleGaps, gapArtifactName ) {
    for (const gap of possibleGaps) {
      gapArtifactName += `.${ gap }`;
      if (!csn.definitions[gapArtifactName]) {
        const contextName = gapArtifactName;
        csn.definitions[contextName] = {
          kind: 'context',
        };
        killList.push(() => delete csn.definitions[contextName]);
      }
      else {
        return;
      }
    }
  }
}

// Type mapping from cds type names to DB type names:
// (in the future, we would introduce an option for the mapping table)
const cdsToSqlTypes = {
  standard: {
    // characters and binaries
    'cds.String': 'NVARCHAR',
    'cds.hana.NCHAR': 'NCHAR',
    'cds.LargeString': 'NCLOB',
    'cds.hana.VARCHAR': 'VARCHAR',
    'cds.hana.CHAR': 'CHAR',
    'cds.hana.CLOB': 'CLOB',
    'cds.Binary': 'VARBINARY',  // not a Standard SQL type, but HANA and MS SQL Server
    'cds.hana.BINARY': 'BINARY',
    'cds.LargeBinary': 'BLOB',
    // numbers: exact and approximate
    'cds.Decimal': 'DECIMAL',
    'cds.DecimalFloat': 'DECIMAL',
    'cds.Integer64': 'BIGINT',
    'cds.Integer': 'INTEGER',
    'cds.Int64': 'BIGINT',
    'cds.Int32': 'INTEGER',
    'cds.Int16': 'SMALLINT',
    'cds.UInt8': 'TINYINT',
    'cds.hana.SMALLINT': 'SMALLINT',
    'cds.hana.TINYINT': 'TINYINT', // not a Standard SQL type
    'cds.Double': 'DOUBLE',
    'cds.hana.REAL': 'REAL',
    // other: date/time, boolean
    'cds.Date': 'DATE',
    'cds.Time': 'TIME',
    'cds.DateTime': 'TIMESTAMP', // cds-compiler#2758
    'cds.Timestamp': 'TIMESTAMP',
    'cds.Boolean': 'BOOLEAN',
    // (TODO: do it later; TODO: why not CHAR or at least VARCHAR?)
    'cds.UUID': 'NVARCHAR',  // changed to cds.String earlier
    'cds.hana.ST_POINT': 'CHAR', // CHAR is implicit fallback used in toSql - make it explicit here
    'cds.hana.ST_GEOMETRY': 'CHAR', // CHAR is implicit fallback used in toSql - make it explicit here
    'cds.Vector': 'NVARCHAR', // Not supported; see #11725
    'cds.Map': 'NCLOB', // Not supported; see #13149
  },
  hana: {
    'cds.hana.SMALLDECIMAL': 'SMALLDECIMAL',
    'cds.DateTime': 'SECONDDATE',
    'cds.hana.ST_POINT': 'ST_POINT',
    'cds.hana.ST_GEOMETRY': 'ST_GEOMETRY',
    'cds.Vector': 'REAL_VECTOR', // FIXME: test me
    'cds.Map': 'NCLOB',
  },
  sqlite: {
    'cds.Date': 'DATE_TEXT',
    'cds.Time': 'TIME_TEXT',
    'cds.Timestamp': 'TIMESTAMP_TEXT',
    'cds.DateTime': 'DATETIME_TEXT',
    'cds.Binary': 'BINARY_BLOB',
    'cds.hana.BINARY': 'BINARY_BLOB',
    'cds.hana.SMALLDECIMAL': 'SMALLDECIMAL',
    'cds.Vector': 'BINARY_BLOB', // Not supported; see #11725
    'cds.Map': 'JSON_TEXT', // '_TEXT' suffix required for text affinity
  },
  plain: {
    'cds.Binary': 'VARBINARY',
    'cds.hana.BINARY': 'BINARY',
    'cds.hana.SMALLDECIMAL': 'DECIMAL',
  },
  h2: {
    'cds.Binary': 'VARBINARY', // same as for plain
    'cds.LargeBinary': 'BINARY LARGE OBJECT', // BLOB would require a length!
    'cds.DecimalFloat': 'DECFLOAT', // Decimal and Decimal(p) is mapped to cds.DecimalFloat
    'cds.DateTime': 'TIMESTAMP(0)',
    'cds.Timestamp': 'TIMESTAMP(7)',
    'cds.Map': 'JSON',
  },
  postgres: {
    // See <https://www.postgresql.org/docs/current/datatype.html>
    'cds.String': 'VARCHAR',
    'cds.LargeString': 'TEXT',
    'cds.LargeBinary': 'BYTEA',
    'cds.Binary': 'BYTEA',
    'cds.Double': 'FLOAT8',
    'cds.UInt8': 'INTEGER', // Not equivalent
    'cds.Vector': 'VARCHAR', // Not supported; see #11725
    'cds.Map': 'JSONB',
  },
};

// Type mapping from cds type names to HDBCDS type names:
// Only those types, that need mapping, are listed.
const cdsToHdbcdsTypes = {
  'cds.UInt8': 'cds.hana.TINYINT',
  'cds.Int16': 'cds.hana.SMALLINT',
  'cds.Int32': 'cds.Integer',
  'cds.Int64': 'cds.Integer64',
  'cds.Timestamp': 'cds.UTCTimestamp',
  'cds.DateTime': 'cds.UTCDateTime',
  'cds.Date': 'cds.LocalDate',
  'cds.Time': 'cds.LocalTime',
};

/**
 * Default lengths for CDS types.
 */
const sqlDefaultLengths = {
  hana: {
    'cds.String': 5000,
  },
  default: {
    'cds.String': 255,
    'cds.Binary': 5000,
  },
};

function getDefaultTypeLengths( sqlDialect ) {
  if (!sqlDefaultLengths[sqlDialect])
    return sqlDefaultLengths.default;
  return { ...sqlDefaultLengths.default, ...sqlDefaultLengths[sqlDialect] };
}

/**
 * Maps $-variables per SQL dialect to a renderable expression.
 * Callers can use `.fallback` in case the wanted dialect is not found.
 *
 * IMPORTANT: There is no sqlDialect better-sqlite. This "fake" dialect is
 *            set in variableForDialect() below.
 *
 * @type {object}
 */
const variablesToSql = {
  fallback: {
    // no fallback for $user.id and $tenant -> warning in call-site
    '$user.locale': '\'en\'',
    // $at.*/$now are handled in all dialects -> there is no need for a fallback
  },
  hana: {
    '$user.id': "SESSION_CONTEXT('APPLICATIONUSER')",
    '$user.locale': "SESSION_CONTEXT('LOCALE')",
    $tenant: "SESSION_CONTEXT('APPLICATIONTENANT')",
    '$at.from': "TO_TIMESTAMP(SESSION_CONTEXT('VALID-FROM'))",
    '$at.to': "TO_TIMESTAMP(SESSION_CONTEXT('VALID-TO'))",
    '$valid.from': "TO_TIMESTAMP(SESSION_CONTEXT('VALID-FROM'))",
    '$valid.to': "TO_TIMESTAMP(SESSION_CONTEXT('VALID-TO'))",
    $now: 'CURRENT_TIMESTAMP', // TODO: always replace with 'SESSION_CONTEXT(\'$now\')' in v6
  },
  postgres: {
    '$user.id': "current_setting('cap.applicationuser')",
    '$user.locale': "current_setting('cap.locale')",
    $tenant: "current_setting('cap.tenant')",
    '$at.from': "current_setting('cap.valid_from')::timestamp",
    '$at.to': "current_setting('cap.valid_to')::timestamp",
    '$valid.from': "current_setting('cap.valid_from')::timestamp",
    '$valid.to': "current_setting('cap.valid_to')::timestamp",
    $now: 'current_timestamp',
  },
  sqlite: {
    '$user.id': "session_context( '$user.id' )",
    '$user.locale': "session_context( '$user.locale' )",
    $tenant: "session_context( '$tenant' )",
    '$at.from': "session_context( '$valid.from' )",
    '$at.to': "session_context( '$valid.to' )",
    '$valid.from': "session_context( '$valid.from' )",
    '$valid.to': "session_context( '$valid.to' )",
    $now: 'CURRENT_TIMESTAMP',
  },
  'old-sqlite': {
    // For sqlite, we render the string-format-time (strftime) function.
    // Because the format of `current_timestamp` is like that: '2021-05-14 09:17:19' whereas
    // the format for timestamps (at least in Node.js) is like that: '2021-01-01T00:00:00.000Z'
    // --> Therefore the comparison in the temporal where clause doesn't work properly.
    '$at.from': "strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')",
    // + 1ms compared to $at.from
    '$at.to': "strftime('%Y-%m-%dT%H:%M:%S.001Z', 'now')",
    '$valid.from': "strftime('%Y-%m-%dT%H:%M:%S.000Z', 'now')",
    '$valid.to': "strftime('%Y-%m-%dT%H:%M:%S.001Z', 'now')",
    $now: 'CURRENT_TIMESTAMP',
  },
  plain: { // better-sqlite defaults
    '$user.id': "session_context( '$user.id' )",
    '$user.locale': "session_context( '$user.locale' )",
    $tenant: "session_context( '$tenant' )",
    '$at.from': "session_context( '$valid.from' )",
    '$at.to': "session_context( '$valid.to' )",
    '$valid.from': "session_context( '$valid.from' )",
    '$valid.to': "session_context( '$valid.to' )",
    $now: 'CURRENT_TIMESTAMP',
  },
  h2: {
    '$user.id': '@applicationuser',
    '$user.locale': '@locale',
    $tenant: '@tenant',
    '$at.from': '@valid_from',
    '$at.to': '@valid_to',
    '$valid.from': '@valid_from',
    '$valid.to': '@valid_to',
    $now: 'current_timestamp',
  },
};

/**
 * Get a renderable string for given variable for the given options.sqlDialect.
 * Note that this function does not handle `variableReplacements`.  Callers should
 * first check if the user has specified them and use them instead.
 *
 * @param {SqlOptions} options Used for `sqlDialect` and better-sqlite option.
 * @param {string} variable Variable to render, e.g. `$user.id`.
 * @return {string|null} `null` if the variable could not be found for the given dialect and in the fallback values.
 */
function variableForDialect( options, variable ) {
  const dialect = options.sqlDialect === 'sqlite' && options.betterSqliteSessionVariables === false
    ? 'old-sqlite'
    : options.sqlDialect;

  if (options.v6$now && options.sqlDialect === 'hana' && variable === '$now')
    return 'SESSION_CONTEXT(\'$now\')';

  return variablesToSql[dialect]?.[variable] || variablesToSql.fallback[variable] || null;
}

/**
 * Whether a replacement is required for the given variable (e.g. '$user.id').
 * Some variables such as `$user.id` are not required to have replacement values, even if
 * there is no proper fallback via `variableForDialect(…)` (for example in sqlDialect 'plain').
 *
 * @param {string} name
 * @return {boolean}
 */
function isVariableReplacementRequired( name ) {
  const notRequired = [ '$user.id', '$user.locale', '$tenant' ];
  return !notRequired.includes(name);
}

/**
 * Get the element matching the column
 *
 * @param {CSN.Elements} elements Elements of a query
 * @param {CSN.Column} column Column from the same query
 * @returns {CSN.Element}
 */
function findElement( elements, column ) {
  if (!elements)
    return undefined;
  if (column.as)
    return elements[column.as];
  else if (column.ref)
    return elements[implicitAs(column.ref)];
  else if (column.func)
    return elements[column.func];

  return undefined;
}

/**
  * If there is a context A and a context A.B.C without a definition A.B, create an
  * intermediate context A.B to keep the context hierarchy intact.
  *
  * @param {Function[]} killList Array to add cleanup functions to
  */
function addIntermediateContexts( csn, killList ) {
  for (const artifactName in csn.definitions) {
    const artifact = csn.definitions[artifactName];
    if ((artifact.kind === 'context') && !artifact.$ignore) {
      // If context A.B.C and entity A exist, we still need generate context A_B.
      // But if no entity A exists, A.B is just a namespace.
      // For case 1 and 2, getParentContextName returns undefined - we then use the namespace as our "off-limits"
      // starting point for finding the intermediates.
      const parentContextName = getParentContextName(csn, artifactName) || getNamespace(csn, artifactName) || '';

      getIntermediateContextNames(csn, parentContextName, artifactName).forEach((name) => {
        if (!csn.definitions[name]) {
          csn.definitions[name] = {
            kind: 'context',
          };
          killList.push(() => delete csn.definitions[name]);
        }
      });

      addMissingChildContexts(csn, artifactName, killList);
    }
  }
}

/**
 * Check whether the given artifact or element has a comment that needs to be rendered.
 * Things annotated with @cds.persistence.journal (for HANA SQL), should not get a comment.
 *
 * @param {CSN.Artifact} obj
 * @param {CSN.Options} options To check for `disableHanaComments`
 * @returns {boolean}
 */
function hasHanaComment( obj, options ) {
  return !options.disableHanaComments && typeof obj.doc === 'string';
}
/**
 * Return the comment of the given artifact or element.
 * Uses the first block (everything up to the first empty line (double \n)).
 * Remove leading/trailing whitespace.
 * Does not escape any characters, use e.g. `getEscapedHanaComment()` for HDBCDS.
 *
 * @param {CSN.Artifact|CSN.Element} obj
 * @returns {string}
 */
function getHanaComment( obj ) {
  return obj.doc.split('\n\n')[0].trim();
}

/**
 * Get the @sql.prepend/append if set - already add a space after/before.
 * If no value is set, use '';
 *
 * @param {CSN.Options} options
 * @param {object} obj
 * @returns {object} object with .front and .back
 */
function getSqlSnippets( options, obj ) {
  const front = obj['@sql.prepend'] ? `${ obj['@sql.prepend'] } ` : '';
  const back = obj['@sql.append'] ? ` ${ obj['@sql.append'] }` : '';

  return { front, back };
}

/**
 * A function used to render a certain part of an expression object
 *
 * @callback renderPart
 * @param {object|array} expression
 * @this {ExpressionRenderer}
 * @returns {string}
 */

/**
 * The object containing the concrete rendering functions for the different parts
 * of an expression
 *
 * @typedef {object} ExpressionConfiguration
 * @property {(x: any) => string} finalize The final function to call on the expression(-string) before returning
 * @property {renderPart} typeCast
 * @property {renderPart} val
 * @property {renderPart} enum
 * @property {renderPart} ref
 * @property {renderPart} windowFunction
 * @property {renderPart} func
 * @property {renderPart} xpr
 * @property {renderPart} SELECT
 * @property {renderPart} SET
 * @property {Function} [visitExpr]
 * @property {Function} [renderExpr]
 * @property {Function} [renderSubExpr]
 * @property {boolean} [isNestedXpr]
 * @property {object} [env]
 */

/**
 * @typedef {object} ExpressionRenderer
 * @property {(x: any) => string} finalize The final function to call on the expression(-string) before returning
 * @property {renderPart} typeCast
 * @property {renderPart} val
 * @property {renderPart} enum
 * @property {renderPart} ref
 * @property {renderPart} windowFunction
 * @property {renderPart} func
 * @property {renderPart} xpr
 * @property {renderPart} SELECT
 * @property {renderPart} SET
 * @property {Function} visitExpr
 * @property {Function} renderExpr
 * @property {Function} renderSubExpr
 * @property {boolean} isNestedXpr
 * @property {object} env
 */

/**
 * If `xpr` has a `cast` property, return a copy without it, otherwise return `xpr`.
 * Useful for removing e.g. top-level CDL-style casts that should not be rendered as CAST().
 *
 * @param xpr
 */
function withoutCast( xpr ) {
  return !xpr.cast ? xpr : { ...xpr, cast: undefined };
}

/**
 * Render an expression (including paths and values) or condition 'x'.
 * (no trailing LF, don't indent if inline)
 *
 * @param {ExpressionConfiguration} rendererBase
 * @returns {ExpressionRenderer} Expression rendering utility
 */
function createExpressionRenderer( rendererBase ) {
  const renderer = Object.create(rendererBase);
  renderer.visitExpr = visitExpr;
  /**
   * @param {any} x
   * @param {object} env
   */
  renderer.renderExpr = function renderExpr(x, env) {
    /** @type {ExpressionRenderer} */
    const renderObj = Object.create(renderer);
    renderObj.env = env || this?.env;
    // The outermost expression is not nested. All `.xpr` inside `expr`
    // are nested.  This information is used for adding parentheses around
    // expressions (see `this.xpr()`).
    renderObj.isNestedXpr = false;
    return renderObj.visitExpr(x);
  };
  /**
   * @param {any} x
   * @param {object} env
   */
  renderer.renderSubExpr = function renderSubExpr(x, env) {
    /** @type {ExpressionRenderer} */
    const renderObj = Object.create(renderer);
    renderObj.env = env || this?.env;
    renderObj.isNestedXpr = true;
    return renderObj.visitExpr(x);
  };

  return renderer;
}


/**
 * Render an expression (including paths and values) or condition 'x'.
 * (no trailing LF, don't indent if inline)
 *
 * `this` must refer to an object of type `ExpressionRenderer`, see
 * `createExpressionRenderer()`
 *
 * @param {any} x (Sub-)Expression to render
 *
 * @this ExpressionRenderer
 * @returns {string} Rendered expression
 */
function visitExpr( x ) {
  if (Array.isArray(x)) {
    // Compound expression, e.g. for on- or where-conditions.
    // If xpr is part of an array, it's always a nested xpr,
    // e.g. CSN for `(1=1 or 2=2) and 3=3`.
    const tokens = x.map((item, i) => {
      this.env.path.push( i );
      const result = this.renderSubExpr(item, this.env);
      this.env.path.length -= 1;
      return result;
    });
    return beautifyExprArray(tokens);
  }
  else if (typeof x !== 'object' || x === null) {
    // Not a literal value but part of an operator, function etc - just leave as it is
    return this.finalize(x);
  }
  else if (x.cast?.type && !x.cast.target) {
    return this.typeCast(x);
  }
  else if (x.list) {
    // Render as non-nested expr.
    return `(${ x.list.map((item, i) => {
      this.env.path.push('list', i);
      const result = this.renderExpr(item, this.env);
      this.env.path.length -= 2;
      return result;
    }).join(', ') })`;
  }
  else if (x['#']) {
    // Enum symbol
    return this.enum(x);
  }
  else if (x.val !== undefined) {
    return this.val(x);
  }
  else if (x.ref) {
    // Reference: Array of path steps, possibly preceded by ':'
    return this.ref(x);
  }
  else if (x.func) {
    // Function call, possibly with args (use '=>' for named args)
    if (x.xpr)
      return this.windowFunction(x);
    return this.func(x);
  }
  else if (x.xpr) {
    return this.xpr(x);
  }
  else if (x.SELECT) {
    return this.SELECT(x);
  }
  else if (x.SET) {
    return this.SET(x);
  }
  else if (x.as) {
    return '';
  }

  throw new ModelError(`renderExpr(): Unknown expression: ${ JSON.stringify(x) }`);
}

module.exports = {
  renderFunc,
  createExpressionRenderer,
  getNamespace,
  getRealName,
  addIntermediateContexts,
  addContextMarkers,
  cdsToSqlTypes,
  cdsToHdbcdsTypes,
  variableForDialect,
  isVariableReplacementRequired,
  hasHanaComment,
  getHanaComment,
  findElement,
  funcWithoutParen,
  getSqlSnippets,
  withoutCast,
  getDefaultTypeLengths,
};
