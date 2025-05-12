'use strict';

/*
   OASIS: https://github.com/oasis-tcs/odata-vocabularies/tree/main/vocabularies
   Aggregation (published)
   Authorization (published)
   Capabilities (published)
   Core (published)
   JSON (published)
   Measures (published)
   Repeatability (published)
   Temporal (published)
   Validation (published)

   SAP: https://github.com/SAP/odata-vocabularies/tree/main/vocabularies
   Analytics (published)
   CodeList (published)
   Common (published)
   Communication (published)
   DataIntegration (published)
   EntityRelationship (experimental)
   Graph (published, experimental)
   Hierarchy (published, experimental)
   HTML5 (published, experimental)
   ODM (published, experimental)
   Offline (experimental)
   PDF (published)
   PersonalData (published)
   Session (published)
   UI (published)
*/

const vocabularyDefinitions = {
  Aggregation: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Aggregation.V1.xml' },
    inc: { Alias: 'Aggregation', Namespace: 'Org.OData.Aggregation.V1' },
    int: { filename: 'Aggregation.xml' },
  },
  Analytics: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/Analytics.xml' },
    inc: { Alias: 'Analytics', Namespace: 'com.sap.vocabularies.Analytics.v1' },
    int: { filename: 'Analytics.xml' },
  },
  Authorization: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Authorization.V1.xml' },
    inc: { Alias: 'Authorization', Namespace: 'Org.OData.Authorization.V1' },
    int: { filename: 'Authorization.xml' },
  },
  Capabilities: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Capabilities.V1.xml' },
    inc: { Alias: 'Capabilities', Namespace: 'Org.OData.Capabilities.V1' },
    int: { filename: 'Capabilities.xml' },
  },
  CodeList: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/CodeList.xml' },
    inc: { Alias: 'CodeList', Namespace: 'com.sap.vocabularies.CodeList.v1' },
    int: { filename: 'CodeList.xml' },
  },
  Common: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/Common.xml' },
    inc: { Alias: 'Common', Namespace: 'com.sap.vocabularies.Common.v1' },
    int: { filename: 'Common.xml' },
  },
  Communication: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/Communication.xml' },
    inc: { Alias: 'Communication', Namespace: 'com.sap.vocabularies.Communication.v1' },
    int: { filename: 'Communication.xml' },
  },
  Core: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.xml' },
    inc: { Alias: 'Core', Namespace: 'Org.OData.Core.V1' },
    int: { filename: 'Core.xml' },
  },
  DataIntegration: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/DataIntegration.xml' },
    inc: { Alias: 'DataIntegration', Namespace: 'com.sap.vocabularies.DataIntegration.v1' },
    int: { filename: 'DataIntegration.xml' },
  },
  EntityRelationship: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/EntityRelationship.xml' },
    inc: { Alias: 'EntityRelationship', Namespace: 'com.sap.vocabularies.EntityRelationship.v1' },
    int: { filename: 'EntityRelationship.xml' },
  },
  Graph: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/Graph.xml' },
    inc: { Alias: 'Graph', Namespace: 'com.sap.vocabularies.Graph.v1' },
    int: { filename: 'Graph.xml' },
  },
  Hierarchy: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/Hierarchy.xml' },
    inc: { Alias: 'Hierarchy', Namespace: 'com.sap.vocabularies.Hierarchy.v1' },
    int: { filename: 'Hierarchy.xml' },
  },
  HTML5: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/HTML5.xml' },
    inc: { Alias: 'HTML5', Namespace: 'com.sap.vocabularies.HTML5.v1' },
    int: { filename: 'HTML5.xml' },
  },
  JSON: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.JSON.V1.xml' },
    inc: { Alias: 'JSON', Namespace: 'Org.OData.JSON.V1' },
    int: { filename: 'JSON.xml' },
  },
  Measures: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Measures.V1.xml' },
    inc: { Alias: 'Measures', Namespace: 'Org.OData.Measures.V1' },
    int: { filename: 'Measures.xml' },
  },
  ODM: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/ODM.xml' },
    inc: { Alias: 'ODM', Namespace: 'com.sap.vocabularies.ODM.v1' },
    int: { filename: 'ODM.xml' },
  },
  Offline: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/Offline.xml' },
    inc: { Alias: 'Offline', Namespace: 'com.sap.vocabularies.Offline.v1' },
    int: { filename: 'Offline.xml' },
  },
  PDF: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/PDF.xml' },
    inc: { Alias: 'PDF', Namespace: 'com.sap.vocabularies.PDF.v1' },
    int: { filename: 'PDF.xml' },
  },
  PersonalData: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/PersonalData.xml' },
    inc: { Alias: 'PersonalData', Namespace: 'com.sap.vocabularies.PersonalData.v1' },
    int: { filename: 'PersonalData.xml' },
  },
  Repeatability: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Repeatability.V1.xml' },
    inc: { Alias: 'Repeatability', Namespace: 'Org.OData.Repeatability.V1' },
    int: { filename: 'Repeatability.xml' },
  },
  Session: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/Session.xml' },
    inc: { Alias: 'Session', Namespace: 'com.sap.vocabularies.Session.v1' },
    int: { filename: 'Session.xml' },
  },
  UI: {
    ref: { Uri: 'https://sap.github.io/odata-vocabularies/vocabularies/UI.xml' },
    inc: { Alias: 'UI', Namespace: 'com.sap.vocabularies.UI.v1' },
    int: { filename: 'UI.xml' },
  },
  Validation: {
    ref: { Uri: 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Validation.V1.xml' },
    inc: { Alias: 'Validation', Namespace: 'Org.OData.Validation.V1' },
    int: { filename: 'Validation.xml' },
  },
  /* unvalidated vocabularies below here:
     A vocabulary is unvalidated if it doesn't have an int.filename property as this indicates that
     the vocabulary is added to the validation dictionary
     Example:
  'Org.Snafu.V1': {
    'ref': { Uri: 'https://snafu.org/snafu.xml' },
    'inc': { Alias: 'Snafu', Namespace: 'Org.Snafu.V1' },
  },
  */
};

/* create inverted voc definitions list to allow addressing full qualified vocabularies
Object.entries(vocabularyDefinitions).forEach(([n, v]) => {
  if(!vocabularyDefinitions[v.inc.Namespace])
    vocabularyDefinitions[v.inc.Namespace] = vocabularyDefinitions[n];
});
*/
module.exports = { vocabularyDefinitions };
