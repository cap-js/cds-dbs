'use strict';

const {
  forEachGeneric,
  forEachMemberRecursively,
  isPersistedOnDatabase,
  hasPersistenceSkipAnnotation,
} = require('../../model/csnUtils');
const transformUtils = require('../transformUtils');

/**
 * Return a callback function for forEachDefinition that marks artifacts that are abstract or @cds.persistence.exists/skip
 * with $ignore.
 *
 * @returns {(artifact: CSN.Artifact, artifactName: string) => void} Callback function for forEachDefinition
 */
function getAnnoProcessor() {
  return handleCdsPersistence;
  /**
   * @param {CSN.Artifact} artifact
   */
  function handleCdsPersistence( artifact ) {
    const ignoreArtifact = (artifact.kind === 'entity') &&
                           (artifact.abstract ||
                            hasPersistenceSkipAnnotation(artifact) ||
                            artifact['@cds.persistence.exists']);
    if (ignoreArtifact)
      artifact.$ignore = true;
  }
}

/**
 * Return a callback function for forEachDefinition that marks associations with $ignore
 * if their target does not reach the database, i.e. marked with @cds.persistence.skip or is abstract
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions
 * @param {Function} messageFunctions.info
 * @param {object} csnUtils
 * @returns {(artifact: CSN.Artifact, artifactName: string, prop: string, path: CSN.Path) => void} Callback function for forEachDefinition
 */
function getAssocToSkippedIgnorer( csn, options, messageFunctions, csnUtils ) {
  const { info } = messageFunctions;
  const doA2J = !(options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds');

  const { isAssocOrComposition } = csnUtils;

  return ignoreAssociationToSkippedTarget;
  /**
   * Associations that target a @cds.persistence.skip artifact must be removed
   * from the persistence model
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   * @param {string} prop
   * @param {CSN.Path} path
   */
  function ignoreAssociationToSkippedTarget( artifact, artifactName, prop, path ) {
    if (isPersistedOnDatabase(artifact)) {
      // TODO: structure in CSN is artifact.query.[SELECT/SET].mixin
      if (artifact.query) {
        // If we do A2J, we don't need to check the mixin. Either it is used -> a join
        // or published -> handled via elements/members. Unused mixins are removed anyway.
        if (!doA2J && artifact.query.SELECT && artifact.query.SELECT.mixin)
          forEachGeneric(artifact.query.SELECT, 'mixin', ignore, path.concat([ 'query', 'SELECT' ]));

        else if (!doA2J && artifact.query.SET && artifact.query.SET.mixin)
          forEachGeneric(artifact.query.SET, 'mixin', ignore, path.concat([ 'query', 'SET' ]));
      }
      forEachMemberRecursively(artifact, ignore, [ 'definitions', artifactName ]);
    }
  }

  /**
   * Mark the given member with $ignore if it is an association/composition and its target is unreachable.
   *
   * @param {CSN.Element} member
   * @param {string} memberName
   * @param {string} prop
   * @param {CSN.Path} path
   */
  function ignore( member, memberName, prop, path ) {
    if (options.sqlDialect === 'hana' &&
       !member.$ignore && member.target &&
       isAssocOrComposition(member) &&
       !isPersistedOnDatabase(csn.definitions[member.target])) {
      info(null, path,
           { target: member.target, anno: '@cds.persistence.skip' },
           'Association has been removed, as its target $(TARGET) is annotated with $(ANNO) and can\'t be rendered in SAP HANA SQL');
      member.$ignore = true;
    }
  }
}

/**
 * Return a callback function for forEachDefinition that handles artifacts marked with @cds.persistence.table.
 * If a .query artifact has this annotation, the .query will be deleted and it will be treated like a table.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions
 * @param {Function} messageFunctions.error
 * @returns {(artifact: CSN.Artifact, artifactName) => void} Callback function for forEachDefinition
 */
function getPersistenceTableProcessor( csn, options, messageFunctions ) {
  const { error } = messageFunctions;
  const {
    recurseElements,
  } = transformUtils.getTransformers(csn, options, messageFunctions, '_');

  return handleQueryish;


  /**
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function handleQueryish( artifact, artifactName ) {
    const stripQueryish = artifact.query && artifact['@cds.persistence.table'];

    if (stripQueryish) {
      artifact.kind = 'entity';
      delete artifact.query;

      recurseElements(artifact, [ 'definitions', artifactName ], (member, path) => {
        // All elements must have a type for this to work
        if (!member.$ignore && !member.kind && !member.type) {
          error(null, path, { anno: '@cds.persistence.table' },
                'Expecting element to have a type if view is annotated with $(ANNO)');
        }
      });
    }
  }
}


module.exports = {
  getAnnoProcessor,
  getAssocToSkippedIgnorer,
  getPersistenceTableProcessor,
};
