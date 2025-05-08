/**
 * Usage: Create an instance to process artifacts which should be checked for collision.
 * First call addArtifact to specify the current artifact,
 * then call addElement to register the elements of the current artifact.
 * Finally, call the "done" function to check for duplicates.
 * In addition, the internal structures will be reinitialized to enable reuse of the instance.
 */

'use strict';

const { forEach } = require('../utils/objectUtils');

/**
 * database name - uppercase if not quoted
 *
 * @param {string} name Artifact name
 *
 * @returns {string} Name as it is present on the database
 */
function asDBName( name ) {
  return (name[0] === '"')
    ? name
    : name.toUpperCase();
}

/**
 * Check for duplicate artifacts or elements
 *
 * @class DuplicateChecker
 */
class DuplicateChecker {
  constructor(names) {
    this.init(names);
  }

  /**
   * Initialize the state of the checker.
   */
  init(names) {
    this.seenArtifacts = {};
    this.currentArtifact = {};
    this.names = names;
  }

  /**
   * Add an artifact to the "seen"-list
   *
   * @param {string} name Persistence name of the artifact
   * @param {CSN.Location|CSN.Path} location CSN location of the artifact
   * @param {string} modelName CSN artifact name
   */
  addArtifact( name, location, modelName ) {
    const dbName = this.names === 'plain' ? asDBName(name) : name; // uppercase for plain names
    this.currentArtifact = {
      name, location, elements: {}, modelName,
    };
    if (!this.seenArtifacts[dbName])
      this.seenArtifacts[dbName] = [ this.currentArtifact ];
    else
      this.seenArtifacts[dbName].push(this.currentArtifact);
  }

  /**
   * Add an element to the "seen"-list
   *
   * @param {string} name Rendered element name
   * @param {CSN.Location|CSN.Path} location
   * @param {string} modelName CSN element name
   *
   */
  addElement(name, location, modelName) {
    if (!this.currentArtifact.elements)
      return;
    const dbName = asDBName(name);
    const currentElements = this.currentArtifact.elements;
    const element = { name, location, modelName };
    if (!currentElements[dbName])
      currentElements[dbName] = [ element ];
    else
      currentElements[dbName].push(element);
  }

  /**
   * No more artifacts need to be processed, check for duplicates and re-init the object.
   *
   * @param {Function} error Function of makeMessageFunction()
   * @param {CSN.Options} options Options used for the compilation
   */
  check(error, options = null) {
    forEach(this.seenArtifacts, (artifactName, artifacts) => {
      if (artifacts.length > 1) {
        artifacts.slice(1).forEach((artifact) => { // report all colliding artifacts, except the first one
          const collidesWith = this.seenArtifacts[artifactName].find( art => art !== artifact );
          let namingMode;
          if (options)
            namingMode = options.sqlMapping;
          else
            namingMode = 'plain';

          error(null, [ 'definitions', artifact.modelName ], {
            name: collidesWith.modelName, prop: namingMode, '#': artifact.modelName.includes('.') ? 'dots' : 'std',
          }, {
            std: 'Artifact name can\'t be mapped to a SQL compliant identifier in naming mode $(PROP) because it conflicts with existing definition $(NAME)',
            dots: 'Artifact name containing dots can\'t be mapped to a SQL compliant identifier in naming mode $(PROP) because it conflicts with existing definition $(NAME)',
          });
        });
      }
      artifacts.forEach((artifact) => {
        forEach(artifact.elements, (elementName, elements) => {
          if (elements.length > 1) {
            elements.forEach((element) => { // report all colliding elements
              error(null,
                    [ 'definitions', artifact.modelName, 'elements', element.modelName ],
                    { name: element.name, id: artifact.modelName },
                    'Duplicated element $(NAME) in artifact $(ID)');
            });
          }
        });
      });
    });
    // clean internal structures
    this.init();
  }
}

module.exports = DuplicateChecker;
