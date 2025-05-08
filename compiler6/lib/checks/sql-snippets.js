'use strict';

// Only to be used with validator.js - a correct this value needs to be provided!

/**
 * Check that @sql.prepend annotation is not used on any elements and @sql.append is not used on elements in views.
 *
 * @param {CSN.Element} member
 * @param {string} memberName
 * @param {string} prop
 * @param {CSN.Path} path
 * @returns {void}
 */
function checkSqlAnnotationOnElement( member, memberName, prop, path ) {
  if (member['@sql.replace'])
    this.error(null, path, { anno: 'sql.replace' }, 'Annotation $(ANNO) is reserved and must not be used');
  if (member['@sql.prepend'])
    this.message('anno-invalid-sql-element', path, { anno: 'sql.prepend' }, 'Annotation $(ANNO) can\'t be used on elements' );

  if (member['@sql.append']) {
    if (this.artifact.query || this.artifact.projection) {
      this.message('anno-invalid-sql-view-element', path, { anno: 'sql.append' }, 'Annotation $(ANNO) can\'t be used on elements in views' );
    }
    else if (this.csnUtils.isStructured(member)) {
      this.message('anno-invalid-sql-struct', path, { anno: 'sql.append' }, 'Annotation $(ANNO) can\'t be used on structured elements' );
    }
    else if (this.csnUtils.isManagedAssociation(member)) {
      this.message('anno-invalid-sql-assoc', path, { anno: 'sql.append', '#': member.type }, {
        std: 'Annotation $(ANNO) can\'t be used here',
        'cds.Association': 'Annotation $(ANNO) can\'t be used on association elements',
        'cds.Composition': 'Annotation $(ANNO) can\'t be used on composition elements',
      } );
    }
    else if (member.value && !member.value.stored) {
      this.message('anno-invalid-sql-calc', path, { anno: 'sql.append' }, 'Annotation $(ANNO) can\'t be used on calculated elements on read' );
    }
    else {
      checkValidAnnoValue(member, '@sql.append', path, this.error, this.options);
    }
  }
}

/**
 * @param {object} carrier element which has the annotation
 * @param {string} annotation
 * @param {CSN.Path} path
 * @param {Function} error
 * @param {CSN.Options} options
 */
function checkValidAnnoValue( carrier, annotation, path, error, options ) {
  if (carrier[annotation] !== undefined && carrier[annotation] !== null) {
    if (typeof carrier[annotation] !== 'string')
      error(null, path, { anno: annotation.slice(1), type: typeof carrier[annotation] }, 'Annotation $(ANNO) must be a string, found $(TYPE)' );
    else if (options.transformation === 'sql') // HDI and HDBCDS do their own checks
      guardAgainstInjection(annotation, carrier[annotation], path, error);
  }
}

/**
 * Check that @sql.prepend is not used on views - only supported for entities (tables)
 *
 * @param {CSN.Artifact} artifact
 * @param {string} artifactName
 */
function checkSqlAnnotationOnArtifact( artifact, artifactName ) {
  if (artifact.kind !== 'entity') {
    if (artifact['@sql.prepend'])
      this.message('anno-invalid-sql-kind', [ 'definitions', artifactName ], { name: '@sql.prepend', kind: artifact.kind }, 'Annotation $(NAME) can\'t be used on an artifact of kind $(KIND)' );
    if (artifact['@sql.append'])
      this.message('anno-invalid-sql-kind', [ 'definitions', artifactName ], { name: '@sql.append', kind: artifact.kind }, 'Annotation $(NAME) can\'t be used on an artifact of kind $(KIND)' );
  }
  else if (artifact['@sql.prepend']) {
    if (artifact.query || artifact.projection)
      this.message('anno-invalid-sql-view', [ 'definitions', artifactName ], { name: '@sql.prepend' }, 'Annotation $(NAME) can\'t be used on views' );
    else
      checkValidAnnoValue(artifact, '@sql.prepend', [ 'definitions', artifactName ], this.error, this.options);
  }


  if (artifact['@sql.replace']) {
    this.error(null, [ 'definitions', artifactName ], { anno: 'sql.replace' },
               'Annotation $(ANNO) is reserved and must not be used');
  }

  checkValidAnnoValue(artifact, '@sql.append', [ 'definitions', artifactName ], this.error, this.options);
}

// Anything that could terminate the "old" statement and start a new one basically.
const invalidInSnippet = [ ';', '--', '/*', '*/' ];

/**
 * Check that the common characters used to terminate the current statement and start a fresh one are not used.
 *
 * @param {string} annoName
 * @param {string} annoValue
 * @param {CSN.Path} path
 * @param {Function} error
 */
function guardAgainstInjection( annoName, annoValue, path, error ) {
  for (const invalid of invalidInSnippet) {
    if (annoValue.indexOf(invalid) !== -1) // These should probably not be configurable, right?
      error(null, path, { name: annoName, prop: invalid }, 'Annotation $(NAME) must not contain $(PROP)');
  }
}

module.exports = {
  checkSqlAnnotationOnArtifact,
  checkSqlAnnotationOnElement,
};
