const cds = require('../../index')

module.exports = {
  _version: cds.version,

  // base schema file for package.json
  // includes cdsRoot schema from cds-rc.js to enforce cds configuration only in cds section
  // and not in the root of the package.json

  title: 'JSON schema for CDS configuration in package.json',
  $schema: 'https://json-schema.org/draft-07/schema',
  description: 'This is a JSON schema representation of the CDS project configuration inside a project root level package.json',
  type: 'object',
  properties: {
    extends: {
      description: 'Name of the application that shall be extended',
      type: 'string'
    },
    cds: {
      type: 'object',
      additionalProperties: true,
      $ref: 'cdsjsonschema://schemas/cds-rc.json#/$defs/cdsRoot',
      description: 'CDS configuration root',
      default: {}
    }
  }
}
