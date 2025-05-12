'use strict';

const { ModelError } = require('../../base/error');

/**
 * Replace (formerly) managed association in a GROUP BY/ORDER BY with its foreign keys.
 *
 * This is not possible/allowed with HDBCDS with hdbcds naming - an error is raised there.
 *
 * @param {CSN.Query} inputQuery
 * @param {CSN.Options} options
 * @param {Function} inspectRef
 * @param {Function} error
 * @param {CSN.Path} path
 */
function replaceAssociationsInGroupByOrderBy( inputQuery, options, inspectRef, error, path ) {
  const query = inputQuery.SET || inputQuery.SELECT;

  if (query.groupBy) {
    const newGroupBy = [];
    for (let i = 0; i < query.groupBy.length; i++) {
      const groupByPath = path.concat([ 'groupBy', i ]);
      if (query.groupBy[i].ref) {
        const { art } = inspectRef(groupByPath);
        if (art && art.target) {
          if (art.keys) {
            // This is (or used to be before transformation) a managed assoc
            // (230 c) If we keep associations as they are (hdbcds naming convention), we can't have associations in GROUP BY
            if (options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds') {
              error(null, groupByPath,
                    { $reviewed: true, keyword: 'GROUP BY', value: 'hdbcds' },
                    'Unexpected managed association in $(KEYWORD) for naming mode $(VALUE)');
              continue;
            }
            const pathPrefix = query.groupBy[i].ref.slice(0, -1);
            getForeignKeyRefs(art)
              .map(fk => ({ ref: pathPrefix.concat(fk.ref) }))
              .forEach(fk => newGroupBy.push(fk));
          }
        }
        else {
          newGroupBy.push(query.groupBy[i]);
        }
      }
      else {
        newGroupBy.push(query.groupBy[i]);
      }
    }
    query.groupBy = newGroupBy;
  }

  if (query.orderBy) {
    const newOrderBy = [];
    for (let i = 0; i < query.orderBy.length; i++) {
      const orderByPath = path.concat([ 'orderBy', i ]);
      if (query.orderBy[i].ref) {
        const { art } = inspectRef(orderByPath);
        if (art && art.target) {
          if (art.keys) {
            // This is (or used to be before transformation) a managed assoc
            // (230 d) If we keep associations as they are (hdbcds naming convention), we can't have associations in ORDER BY
            if (options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds') {
              error(null, orderByPath,
                    { $reviewed: true, keyword: 'ORDER BY', value: 'hdbcds' },
                    'Unexpected managed association in $(KEYWORD) for naming mode $(VALUE)');
              continue;
            }
            const pathPrefix = query.orderBy[i].ref.slice(0, -1);
            getForeignKeyRefs(art)
              .map(fk => ({ ref: pathPrefix.concat(fk.ref) }))
              .forEach(fk => newOrderBy.push(fk));
          }
        }
        else {
          newOrderBy.push(query.orderBy[i]);
        }
      }
      else {
        newOrderBy.push(query.orderBy[i]);
      }
    }
    query.orderBy = newOrderBy;
  }
}
/**
 * Return refs pointing to the generated foreign key elements.
 *
 * @param {CSN.Element} assoc
 * @returns {object[]}
 */
function getForeignKeyRefs( assoc ) {
  return assoc.keys.map((fk) => {
    if (!fk.$generatedFieldName)
      throw new ModelError(`Expecting generated field name for foreign key: ${ JSON.stringify(fk) }`);

    return { ref: [ fk.$generatedFieldName ] };
  });
}

module.exports = replaceAssociationsInGroupByOrderBy;
