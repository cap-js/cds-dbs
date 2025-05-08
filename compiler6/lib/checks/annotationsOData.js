'use strict';


// ------------------------------------------------------------------------------
// Only to be used with validator.js - a correct this value needs to be provided!
// ------------------------------------------------------------------------------

// This set of checks are candidates to be moved to a linter

/**
 * `@Core.MediaType` must be assigned to elements of certain types
 *
 * @param {CSN.Element} member Member to be checked
 */
function checkCoreMediaTypeAllowance( member ) {
  const allowedCoreMediaTypes = {
    'cds.String': 1,
    'cds.LargeString': 1,
    'cds.hana.VARCHAR': 1,
    'cds.hana.CHAR': 1,
    'cds.Binary': 1,
    'cds.LargeBinary': 1,
    'cds.hana.CLOB': 1,
    'cds.hana.BINARY': 1,
  };
  if (member['@Core.MediaType'] && member.type && !(this.csnUtils.getFinalTypeInfo(member.type)?.type in allowedCoreMediaTypes)) {
    this.warning(null, member.$path, { anno: '@Core.MediaType', names: [ 'Edm.String', 'Edm.Binary' ] },
                 'Element annotated with $(ANNO) should be of a type mapped to $(NAMES)');
  }
}

/**
 * Check if `@Aggregation.default` is assigned together with `@Analytics.Measure`
 *
 * @param {CSN.Element} member Member to be checked
 */
function checkAnalytics( member ) {
  if (member['@Analytics.Measure'] && !member['@Aggregation.default']) {
    this.info(null, member.$path, {},
              // eslint-disable-next-line cds-compiler/message-no-quotes
              'Annotation “@Analytics.Measure” expects “@Aggregation.default” to be assigned for the same element as well');
  }
}

/**
 * `@sap..` annotations should be of type boolean or string
 *
 * @param {(CSN.Artifact|CSN.Element)} node Member or artifact to be checked
 */
function checkAtSapAnnotations( node ) {
  Object.keys(node).forEach((prop) => {
    if (prop.startsWith('@sap.') && typeof node[prop] !== 'boolean' && typeof node[prop] !== 'string')
      this.warning(null, node.$path, { name: prop }, 'Annotation $(NAME) must have a string or boolean value');
  });
}

/**
 * Annotations `@readonly` and `@insertonly` can't be assigned together
 *
 * @param {CSN.Artifact} artifact Artifact to be checked
 * @param {string} artifactName The name of the artifact
 */
function checkReadOnlyAndInsertOnly( artifact, artifactName ) {
  if (!this.csnUtils.getServiceName(artifactName))
    return;
  if (artifact.kind === 'entity' && artifact['@readonly'] && artifact['@insertonly'])
    // eslint-disable-next-line cds-compiler/message-no-quotes
    this.warning(null, artifact.$path, {}, 'Annotations “@readonly” and “@insertonly” can\'t be assigned in combination');
}

/**
 * Check temporal annotations @cds.valid.from, @cds.valid.to, @cds.valid.key
 * assignment for the given artifact. This consists of the following:
 * - @cds.valid.from/to/key annotation is assigned only once in the scope of the definition
 * - annotation is assigned only to allowed element types. Not allowed on association/composition,
 *   structured elements, leaf element of a structure
 * - when @cds.valid.key is used, it requires also @cds.valid.from and @cds.valid.to to be defined
 * @param {CSN.Artifact} artifact
 * @param {string} artifactName
 */
function checkTemporalAnnotationsAssignment( artifact, artifactName ) {
  const valid = { from: [], to: [], key: [] };

  // collect annotation assignments throughout the elements of the definition
  this.recurseElements( artifact, artifact.$path || [ 'definitions', artifactName ], (member, path) => {
    checkForAnnoAssignmentAndApplicability.bind(this)('from', member, path);
    checkForAnnoAssignmentAndApplicability.bind(this)('to', member, path);
    checkForAnnoAssignmentAndApplicability.bind(this)('key', member, path);
  });

  // check if the annotations are assigned more than once in the scope of the current artifact
  this.checkMultipleAssignments(valid.from, '@cds.valid.from', artifact, artifactName);
  this.checkMultipleAssignments(valid.to, '@cds.valid.to', artifact, artifactName);
  this.checkMultipleAssignments(valid.key, '@cds.valid.key', artifact, artifactName);

  // if @cds.valid.key is defined, check whether @cds.valid.from and @cds.valid.to are also there
  if (valid.key.length && !(valid.from.length && valid.to.length))
    // eslint-disable-next-line cds-compiler/message-no-quotes
    this.error(null, [ 'definitions', artifactName ], 'Annotation “@cds.valid.key” was used but “@cds.valid.from” and “@cds.valid.to” are missing');

  /**
   * Check if the given annotation is assigned to the current member and collect the path if so.
   * Also determine whether the annotation is applicable for the member type. @cds.valid.from/to.key annotations
   * are NOT allowed for elements which are: association/composition, structured or leaf element of a structure
   *
   * @param {string} annoIdentifier
   * @param {CSN.Element} member
   * @param {CSN.Path} path
   */
  function checkForAnnoAssignmentAndApplicability( annoIdentifier, member, path ) {
    if (member[`@cds.valid.${ annoIdentifier }`]) {
      valid[annoIdentifier].push(path);
      // check whether annotation is not assigned to not allowed element type, these are: association, structured elements, leaf element of a structure
      if (this.csnUtils.isAssocOrComposition(member) || this.csnUtils.isStructured(member) || path.length > 5)
        this.error(null, member.$path, { anno: `@cds.valid.${ annoIdentifier }` }, 'Element can\'t be annotated with $(ANNO)');
    }
  }
}

module.exports = {
  checkCoreMediaTypeAllowance,
  checkAnalytics,
  checkAtSapAnnotations,
  checkReadOnlyAndInsertOnly,
  checkTemporalAnnotationsAssignment,
};
