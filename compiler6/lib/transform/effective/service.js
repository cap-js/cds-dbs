'use strict';

const { forEach } = require('../../utils/objectUtils');

/**
 * Creates a filter function for a specific service that processes and strips artifacts.
 *
 * @param {string} serviceName - The name of the service to filter for.
 * @param {Object} collector - An object to collect the service and its contained artifacts.
 * @param {Object} collector.service - The main service artifact.
 * @param {Object} collector.containedArtifacts - The contained artifacts of the service.
 * @returns {Function} A filter function that processes definitions and artifacts.
 */
function getServiceFilterFunction(serviceName, collector) {
  return function filterAndStripForService(definitions, artifactName, artifact) {
    if (artifactName === serviceName && artifact.kind === 'service') {
      collector.service = artifact;
    }
    else if (definitions[serviceName]?.kind === 'service' && artifactName.startsWith(`${ serviceName }.`)) {
      collector.containedArtifacts[artifactName] = artifact;
      delete artifact.query;
      delete artifact.projection;
      if (artifact.elements) {
        forEach(artifact.elements, (elementName, element) => {
          if (element.target && !element.target.startsWith(`${ serviceName }.`))
            delete artifact.elements[elementName];
        });
      }
    }
  };
}


module.exports = getServiceFilterFunction;
