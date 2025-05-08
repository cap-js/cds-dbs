'use strict';

/**
 * Return the definition name, without the prefixed service name
 * @param {string} name
 * @param {string} srvOrCtx
 */
function defNameWithoutServiceOrContextName(name, srvOrCtx) {
  return name.replace(`${srvOrCtx}.`, '');
}

/**
 * By the given name of an artifact 'artName 'and an array 'services'
 * containing all the service names part of the model, return the service
 * name where the given artifact resides
 *
 * @todo: This function does not take nested services into account => longest match
 *
 * @param {string} artName
 * @param {string[]} services
 */
function getServiceOfArtifact(artName, services) {
  return services.find(serviceName => artName.startsWith(`${serviceName}.`));
}

/**
 * Check if an artifact with name 'artName' is part of a service named 'service'
 * @param {string} artName Name of the artifact
 * @param {string} service Name of the service
 */
function isArtifactInService(artName, service) {
  return typeof artName === 'string' ? artName.startsWith(`${service}.`) : false;
}

/**
 * By the given name of an artifact 'artName 'and an array 'services'
 * containing all the service names part of the model, return whether
 * the artifact is part of the service or not
 * @param {string} artName
 * @param {string[]} services
 */
function isArtifactInSomeService(artName, services) {
  return services.some(serviceName => artName.startsWith(`${serviceName}.`));
}

/**
 * By the given name of an artifact 'artName 'and an array 'services'
 * containing all the service names part of the model, return whether
 * the artifact is localized and part of the service
 * @param {string} artName
 * @param {string[]} services
 */
function isLocalizedArtifactInService(artName, services) {
  if (!artName.startsWith('localized.')) return false;
  return isArtifactInSomeService(artName.split('.').slice(1).join('.'), services);
}

module.exports = {
  defNameWithoutServiceOrContextName,
  getServiceOfArtifact,
  isArtifactInService,
  isArtifactInSomeService,
  isLocalizedArtifactInService,
}
