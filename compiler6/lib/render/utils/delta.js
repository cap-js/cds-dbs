'use strict';

/**
 * Encapsulate all the functions needed to render SQL ALTER/DROP/ADD statements.
 */
class DeltaRenderer {
  constructor(options, scopedFunctions) {
    this.options = options;
    this.scopedFunctions = scopedFunctions;
  }

  /**
   * Render column additions as SQL. Checks for duplicate elements.
   */
  addColumnsFromElementStrings(artifactName, eltStrings) {
    return eltStrings.map(eltString => `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ADD ${ eltString };`);
  }

  /**
   * Render column additions as SQL. Checks for duplicate elements.
   */
  addColumnsFromElementsObj(artifactName, elementsObj, env, duplicateChecker) {
    // Only extend with 'ADD' for elements/associations
    // TODO: May also include 'RENAME' at a later stage
    const alterEnv = this.scopedFunctions.activateAlterMode(env);
    const elements = Object.entries(elementsObj)
      .map(([ name, elt ]) => this.scopedFunctions.renderElement(name, elt, duplicateChecker, null, alterEnv))
      .filter(s => s !== '');

    if (elements.length)
      return this.addColumnsFromElementStrings(artifactName, elements);

    return [];
  }

  /**
   * By default, we don't support rendering association-alters - only for HANA
   */
  addAssociations(_artifactName, _extElements, _env) {
    return [];
  }

  /**
   * Render key addition as SQL.
   */
  addKey(artifactName, elementsObj) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ADD ${ this.primaryKey(elementsObj) };` ];
  }

  /**
   * Render column removals as SQL.
   */
  dropColumns(artifactName, sqlIds) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } DROP ${ sqlIds.join(', ') };` ];
  }

  /**
   * No associations by default - only for HANA.
   */
  dropAssociation(_artifactName, _sqlId) {
    return [];
  }

  /**
   * Render primary-key removals as SQL.
   */
  dropKey(artifactName) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } DROP PRIMARY KEY;` ];
  }

  /**
   * Render column modifications as SQL.
   */
  alterColumns(artifactName, columnName, delta, definitionsStr, _eltName, _env) {
    if (Array.isArray(definitionsStr)) {
      const prefix = `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER (`;
      const padding = ' '.repeat(prefix.length);
      const body = definitionsStr.map(s => padding + s).join(',\n').slice(padding.length); // no padding for first part
      const postfix = ');';
      return [ prefix + body + postfix ];
    }
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER (${ definitionsStr });` ];
  }

  /**
   * Render primary keys as SQL.
   */
  primaryKey(elementsObj) {
    const primaryKeys = Object.keys(elementsObj)
      .filter(name => elementsObj[name].key && !elementsObj[name].virtual)
      .map(name => this.scopedFunctions.quoteSqlId(name))
      .join(', ');
    return primaryKeys && `PRIMARY KEY(${ primaryKeys })`;
  }

  /**
   * Render entity-comment modifications as SQL.
   */
  alterEntityComment(artifactName, comment) {
    return [ `COMMENT ON TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } IS ${ this.comment(comment) };` ];
  }

  /**
   * Render column-comment modifications as SQL.
   */
  alterColumnComment(artifactName, columnName, comment) {
    return [ `COMMENT ON COLUMN ${ this.scopedFunctions.renderArtifactName(artifactName) }.${ columnName } IS ${ this.comment(comment) };` ];
  }

  /**
   * Render comment string.
   */
  comment(comment) {
    return comment && this.scopedFunctions.renderStringForSql(this.scopedFunctions.getHanaComment({ doc: comment }), this.options.sqlDialect) || 'NULL';
  }

  /**
   * Alter SQL snippet for entity.
   */
  alterEntitySqlSnippet(artifactName, snippet) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ${ snippet };` ];
  }

  /**
   * Concatenate multiple statements which are to be treated as one by the API caller.
   */
  concat(...statements) {
    return [ statements.join('\n') ];
  }
}

class DeltaRendererHana extends DeltaRenderer {
  #alters = [];
  #details = [];

  getConsolidatedAlterColumn(artifactName) {
    if (this.#alters.length === 0)
      return null;
    const result = [ ...this.#details, ...super.alterColumns(artifactName, null, null, this.#alters) ];
    this.#alters = [];
    this.#details = [];
    return result;
  }

  /**
   * Render column modifications as SQL.
   */
  alterColumns(artifactName, columnName, delta, definitionsStr, _eltName, _env) {
    if (delta.details)
      this.#details.push(`-- [WARNING] this statement could ${ delta.lossy ? 'be lossy' : 'fail' }: ${ delta.details }`);

    this.#alters.push(definitionsStr);
    return [];
  }

  /**
   * Render column additions as HANA SQL. Checks for duplicate elements.
   */
  addColumnsFromElementStrings(artifactName, eltStrings) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ADD (${ eltStrings.join(', ') });` ];
  }

  /**
   * Render association additions as HANA SQL.
   * TODO duplicity check
   */
  addAssociations(artifactName, elementsObj, env) {
    return Object.entries(elementsObj)
      .map(([ name, elt ]) => this.scopedFunctions.renderAssociationElement(name, elt, env))
      .filter(s => s !== '')
      .map(eltStr => `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ADD ASSOCIATION (${ eltStr });`);
  }

  /**
   * Render column removals as HANA SQL.
   */
  dropColumns(artifactName, sqlIds) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } DROP (${ sqlIds.join(', ') });` ];
  }

  /**
   * Render association removals as HANA SQL.
   */
  dropAssociation(artifactName, sqlId) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } DROP ASSOCIATION ${ sqlId };` ];
  }
}

class DeltaRendererPostgres extends DeltaRenderer {
  /**
   * Render primary-key removals as SQL.
   * @todo tableName is escaped - we cannot simply add _pkey
   */
  dropKey(artifactName) {
    const table = this.scopedFunctions.renderArtifactName(artifactName);
    const pkey = this.scopedFunctions.renderArtifactName(`${ artifactName }_pkey`);
    return [ `ALTER TABLE ${ table } DROP CONSTRAINT ${ pkey };` ];
  }

  /**
   * Render column removals as SQL.
   */
  dropColumns(artifactName, sqlIds) {
    return sqlIds.map(sqlId => `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } DROP ${ sqlId };`);
  }

  /**
   * Render column modifications as Postgres SQL - no ( ), special NOT NULL.
   */
  alterColumns(artifactName, columnName, delta, definitionsStr, eltName, env) {
    const sqls = [];

    definitionsStr = this.#removeNullabilityFromElementString(delta, definitionsStr);

    if (delta.old.default && !delta.old.value) // Drop old default if any exists
      sqls.push(`ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER COLUMN ${ columnName } DROP DEFAULT;`);

    if (delta.new.default && !delta.new.value ) { // Alter column with default
      const df = delta.new.default;
      delete delta.new.default;
      const eltStrNoDefault = this.#removeNullabilityFromElementString(delta, this.scopedFunctions.renderElement(eltName, delta.new, null, null, env));
      delta.new.default = df;
      sqls.push(`ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER ${ eltStrNoDefault };`);
      sqls.push(`ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER COLUMN ${ columnName } SET DEFAULT ${ this.scopedFunctions.renderExpr(delta.new.default, env.withSubPath('default')) };`);
    }
    else { // Alter column without default
      sqls.push(`ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER ${ definitionsStr };`);
    }

    if (delta.new.notNull && !delta.old.notNull)
      sqls.push(`ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER ${ columnName } SET NOT NULL;`);
    else if (delta.old.notNull && !delta.new.notNull)
      sqls.push(`ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER ${ columnName } DROP NOT NULL;`);

    return sqls;
  }

  /**
   * Postgres does not support changing a column AND doing [NOT] NULL things in one statement.
   * So we filter it from the SQL String and render the appropriate SET/DROP for the NOT NULL separately.
   *
   * @param {object} delta
   * @param {string} string
   * @returns {string}
   */
  #removeNullabilityFromElementString(delta, string) {
    if (delta.new.notNull === true || delta.new.key === true)
      string = string.replace(' NOT NULL', ''); // TODO: Is this robust enough?
    else if (delta.new.notNull === false || delta.new.$notNull === false)
      string = string.replace(' NULL', ''); // TODO: Is this robust enough?
    else if (delta.new.notNull === delta.old.notNull)
      string = string.replace( delta.new.notNull ? ' NOT NULL' : ' NULL', ''); // TODO: Is this robust enough?


    return string;
  }
}

class DeltaRendererH2 extends DeltaRenderer {
  /**
   * Render column modifications as H2 SQL - no ().
   */
  alterColumns(artifactName, columnName, delta, definitionsStr, _eltName, _env) {
    return [ `ALTER TABLE ${ this.scopedFunctions.renderArtifactName(artifactName) } ALTER ${ definitionsStr };` ];
  }
}

/**
 * Return an object encapsulating the render-functions for ALTER/DROP for a given db dialect.
 *
 * @param {CSN.Options} options
 * @param {object} scopedFunctions
 * @returns {DeltaRenderer}
 */
function getDeltaRenderer( options, scopedFunctions ) {
  switch (options.sqlDialect) {
    case 'hana':
      return new DeltaRendererHana(options, scopedFunctions);
    case 'h2':
      return new DeltaRendererH2(options, scopedFunctions);
    case 'postgres':
      return new DeltaRendererPostgres(options, scopedFunctions);
    default:
      return new DeltaRenderer(options, scopedFunctions);
  }
}


module.exports = {
  getDeltaRenderer,
};
