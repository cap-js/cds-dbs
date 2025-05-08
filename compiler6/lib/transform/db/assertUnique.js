'use strict';

const { forEachDefinition } = require('../../model/csnUtils');
const { getTransformers } = require('../transformUtils');
const { pathName } = require('../../compiler/utils');


/**
 * For each definition, process the unique constraint paths
 *
 * Check unique constraint paths
 * Render secondary indexes in technical configuration for hdbcds
 * Path flattening is done in TC index code: Must expand foreign keys
 * Must run before items are retyped to cds.LargeString, otherwise
 * items error detection becomes impossible
 *
 * @param {CSN.Model} csn Overall CSN model
 * @param {CSN.Options} options Options
 * @param {object} messageFunctions Message functions (error(), info(), …)
 * @returns {Function} forEachDefinition callback
 */
function processAssertUnique( csn, options, messageFunctions ) {
  const { resolvePath, flattenPath } = getTransformers(csn, options, messageFunctions);
  const { error, info } = messageFunctions;

  return handleAssertUnique;
  /**
   * The detailed processing - see comment above for what is going on here
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function handleAssertUnique( artifact, artifactName ) {
    // operate only on real entities that are not abstract
    if (artifact.abstract || (artifact.kind !== 'entity' || (artifact.query || artifact.projection) && !artifact['@cds.persistence.table']))
      return;
    const constraintXrefs = Object.create(null);
    const constraintDict = Object.create(null);
    // filter unique constraints from annotations
    for (const propName in artifact) {
      const anno = propName;
      if (propName === '@assert.unique')
        error(null, [ 'definitions', artifactName ], { anno }, '$(ANNO): Table constraint can\'t be anonymous');

      if (propName.startsWith('@assert.unique.') && artifact[propName] !== null) {
        // Constraint Name check
        const constraintName = propName.split('.').splice(2);
        if (constraintName.length > 1)
        // Neither HANA CDS nor HANA SQL allow dots in index names
          error(null, [ 'definitions', artifactName ], { anno }, '$(ANNO): Illegal character \'.\' in constraint name');

        const propValue = artifact[propName];
        // Constraint value check, returns array of path values
        const pathValues = checkVal(propValue, propName);

        // 1) Convert each path string into a path object with ref array.
        // 2) Resolve path ref array and store resolved artifact in refs and path object
        // 3) Flatten all paths that end on a structured type
        // 4) Collect all path object in paths array
        let pathObjects = pathValues.map(v => resolvePath(toRef(v), artifact));
        // 5) Check each path step of each unflattened path,
        //    This avoids duplicate errors on same path step
        pathObjects.forEach(p => check(p, propName));
        // 6) Remove paths without final _art from further processing including
        //    path rewriting in rewriteUniqueConstraints
        pathObjects = pathObjects.filter(p => p._art);
        // 7) Flatten correct paths, check and clean again
        let flattenedPathObjects = [];
        pathObjects.forEach(p => flattenedPathObjects.push(...flattenPath(p, true)));
        flattenedPathObjects.forEach(p => check(p, propName));
        flattenedPathObjects = flattenedPathObjects.filter(p => p._art);
        // 8) Duplicate path check on final flattened paths to detect structural overlaps
        const pathxrefs = Object.create(null);
        // constraintKey is the concatenation of all flattened paths (order is important)
        let constraintKey = '';
        flattenedPathObjects.forEach((p) => {
          const pstr = p.ref.map(path => path.id).join('.');
          constraintKey += pstr;
          if (!pathxrefs[pstr])
            pathxrefs[pstr] = 1;
          else
            pathxrefs[pstr]++;
        });
        Object.keys(pathxrefs).forEach((k) => {
          if (pathxrefs[k] > 1) {
            error(null, [ 'definitions', artifactName ], { anno, id: k },
                  '$(ANNO): Final path $(ID) can only be specified once');
          }
        });
        // 9) Add into constraint cross-reference
        if (constraintKey.length) {
          if (constraintXrefs[constraintKey])
            constraintXrefs[constraintKey].push(propName);
          else
            constraintXrefs[constraintKey] = [ propName ];
        }
        // 10) Store remaining paths (if any) in constraint dictionary
        if (flattenedPathObjects.length)
          constraintDict[constraintName.join('.')] = { paths: flattenedPathObjects, parentTable: artifactName };
      }
    }

    // 11) Duplicate constraint check
    for (const key in constraintXrefs) {
      const val = constraintXrefs[key];
      if (val.length > 1)
        error(null, [ 'definitions', artifactName ], { annos: val }, '$(ANNOS): Constraint can only be specified once');
    }
    // preserve dictionary in '$tableConstraints' on the artifact for path rewriting and rendering
    if (Object.keys(constraintDict).length) {
      if (!('$tableConstraints' in artifact))
        artifact.$tableConstraints = Object.create(null);

      artifact.$tableConstraints.unique = constraintDict;
    }

    /**
     * Check strictly that annotation value is an array
     * and that the individual array entries are references
     *
     * @param {any} val Annotation value
     * @param {string} propName
     * @returns {Array} Array of paths
     */
    function checkVal( val, propName ) {
      const paths = [];
      const loc = [ 'definitions', artifactName ];
      if (!Array.isArray(val)) {
        error(null, loc, { anno: propName, value: JSON.stringify(unref(val)) }, '$(ANNO): Value $(VALUE) is not an array');
      }
      else {
        if (val.length === 0)
          info(null, loc, { anno: propName }, '$(ANNO): Empty annotation is ignored');

        val.forEach((v) => {
          const p = v['='];
          if (!p)
            error(null, loc, { anno: propName, value: JSON.stringify(unref(v)) }, '$(ANNO): Value $(VALUE) is not a path');
          else
            paths.push(p);
        });
      }
      return paths;

      /**
       * Convert a ref object to a path string
       *
       * @param {any} v
       * @returns {string|string[]|any}
       */
      function unref( v ) {
        if (Array.isArray(v))
          return v.map(unref);
        return (v['='] || v);
      }
    }

    /**
     * convert a path string to a ref object and pop $self/$projection
     *
     * @param {string} val
     * @returns {object}
     */
    function toRef( val ) {
      let ref = val.split('.');
      const [ head, ...tail ] = ref;
      if (head === '$self' || head === '$projection')
        ref = tail;
      return {
        ref: ref.map((ps) => {
          const o = Object.create(null);
          o.id = ps;
          return o;
        }),
      };
    }

    /**
     * Check resolved path
     * - no array of/many path step allowed
     * - must not end on unmanaged association/composition
     * - foreign key access is not allowed (hard to rewrite)
     * - type check for final type
     * - path steps with no _art link are 'not found'
     *
     * @param {object} path
     * @param {string} constraintName
     */
    function check( path, constraintName ) {
      if (path.isChecked)
        return;
      path.isChecked = true;
      let foundErr = false;
      const name = pathName(path.ref);
      const loc = [ 'definitions', artifactName ];
      for (let i = 0; i < path.ref.length && !foundErr; i++) {
        const art = path.ref[i]._art;
        const elemref = path.ref[i].id;
        if (art) {
          if (art.items) {
            error(null, loc, { elemref, name, anno: constraintName },
                  '$(ANNO): \'Array of/many\' element $(ELEMREF) is not allowed in $(NAME)');
            delete path._art;
            foundErr = true;
          }
          if (art.target) {
            if (art.on) {
              error(null, loc, { elemref, name, anno: constraintName },
                    '$(ANNO): Unmanaged association $(ELEMREF) is not allowed in $(NAME)');
              delete path._art;
              foundErr = true;
            }
            if (art.keys && i < path.ref.length - 1) {
              error(null, loc, { elemref, name, anno: constraintName },
                    '$(ANNO): Element access via managed association $(ELEMREF) is not allowed in $(NAME)');
              delete path._art;
              foundErr = true;
            }
          }
        }
        else {
          error(null, loc, { elemref, anno: constraintName }, '$(ANNO): $(ELEMREF) has not been found');
          foundErr = true;
        }
      }

      if (!foundErr && path._art && [ 'cds.LargeBinary', 'cds.LargeString',
        'cds.hana.CLOB', 'cds.hana.ST_POINT', 'cds.hana.ST_GEOMETRY' ].includes(path._art.type)) {
        error(null, loc, { type: path._art.type, name, anno: constraintName },
              '$(ANNO): Type $(TYPE) not allowed in $(NAME)');
      }
    }
  }
}


/**
 * rewriteUniqueConstraints adjusts the constraint paths
 * to the final output format.
 *
 * All paths in $tableConstraints.unique are supposed to be fully
 * resolved and correct constraint candidates.
 *
 * Paths that terminate on an association are replaced with the
 * foreign key paths that belong to this association.
 *
 * If the output format is HANA CDS, a technical configuration is
 * added and unique secondary indexes are created.
 *
 * If the output format is SQL, the toSql renderer is responsible
 * to render the table constraints from the constraint dictionary.
 *
 * If options.transformation === 'hdbcds', no path flattening is done and  association
 * paths are replaced with the foreign key paths by simply
 * concatenating the foreign key paths (available in element.keys).
 *
 * If options.toSql, all paths are flattened depending on the naming
 * mode either with '_' or '.' as delimiter.
 * Each association is replaced by the respective foreign key elements
 * that are annotated with an appropriate '@odata.foreignKey4'.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {string} pathDelimiter
 */
function rewriteUniqueConstraints( csn, options, pathDelimiter ) {
  forEachDefinition(csn, rewrite);
  /**
   * @param {CSN.Artifact} artifact
   */
  function rewrite( artifact ) {
    if (artifact.$tableConstraints && artifact.$tableConstraints.unique) {
      const uniqueConstraints = artifact.$tableConstraints.unique;
      // it's safe to add the tc here
      if (options.transformation === 'hdbcds') {
        if (!artifact.technicalConfig)
          artifact.technicalConfig = Object.create(null);

        if (!artifact.technicalConfig.hana) {
          artifact.technicalConfig.hana = Object.create(null);
          artifact.technicalConfig.hana.calculated = true;
        }
        if (!artifact.technicalConfig.hana.indexes)
          artifact.technicalConfig.hana.indexes = Object.create(null);
      }
      for (const uniqueConstraint in artifact.$tableConstraints.unique) {
        // iterate over each constraint
        const c = uniqueConstraints[uniqueConstraint].paths;
        const rewrittenPaths = [];
        // and inspect each path of the constraint
        c.forEach((cpath) => {
          // If 'toSql' or 'toHana' and naming !== 'hdbcds'
          // concatenate path refs with appropriate delimiter
          if (options.transformation !== 'hdbcds' || (options.transformation === 'hdbcds' && options.sqlMapping !== 'hdbcds'))
            cpath.ref = [ cpath.ref.map(p => p.id).join( pathDelimiter ) ];

          // Foreign key substitution
          if (cpath._art.target) {
            if (options.transformation !== 'hdbcds' || (options.transformation === 'hdbcds' && options.sqlMapping !== 'hdbcds')) {
              // read out new association and use $generatedFieldName
              // cpath._art still refers to the assoc definition
              // before the A2J transformation. This assoc
              // doesn't contain the correct $generatedFieldName(s)
              const assoc = artifact.elements[cpath.ref[0]];
              rewrittenPaths.push(...assoc.keys.map(k => ({ ref: [ k.$generatedFieldName ] })));
            }
            else {
              // This is Classic HANA CDS toHana/hdbcds
              // add foreign key ref path to association path
              // ... for hanacds, the 'real' ref paths are used, and
              // these have not changed before and after A2J transformation,
              // so it's safe to use the original paths.
              rewrittenPaths.push(...cpath._art.keys.map(k => ({ ref: cpath.ref.concat(k.ref) })));
            }
          }
          else {
            rewrittenPaths.push(cpath);
          }
        });
        // preserve the rewritten and filtered paths for toSql
        uniqueConstraints[uniqueConstraint] = { paths: rewrittenPaths, parentTable: uniqueConstraints[uniqueConstraint].parentTable };

        // now add the index for HANA CDS
        if (options.transformation === 'hdbcds') {
          const cond = [];
          let i = 0;
          for (const constraint of rewrittenPaths) {
            if (i > 0)
              cond.push(',');
            cond.push(constraint);
            i++;
          }
          artifact.technicalConfig.hana.indexes[uniqueConstraint] = [
            'unique', 'index', { ref: [ uniqueConstraint ] }, 'on', { xpr: cond },
          ];
        }
      }
      artifact.$tableConstraints.unique = uniqueConstraints;
    }
  }
}

module.exports = {
  prepare: processAssertUnique,
  rewrite: rewriteUniqueConstraints,
};
