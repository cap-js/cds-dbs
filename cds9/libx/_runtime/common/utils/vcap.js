const cds = require('../../../../libx/_runtime/cds')

const getAppMetadata = () => {
  const appMetadata = cds.env.app

  if (appMetadata) {
    return {
      appID: appMetadata.id,
      appName: appMetadata.name,
      appURL: appMetadata.url
    }
  }

  // fallback: if the app metadata is undefined, then extract the metadata from the underlying environment (CF/Kyma/...)
  const vcapApplication = process.env.VCAP_APPLICATION && JSON.parse(process.env.VCAP_APPLICATION)

  return {
    appID: vcapApplication && vcapApplication.application_id,
    appName: vcapApplication && vcapApplication.application_name,
    appURL:
      vcapApplication &&
      vcapApplication.application_uris &&
      vcapApplication.application_uris[0] &&
      `https://${vcapApplication.application_uris[0].replace(/^https?:\/\//, '')}`
  }
}

module.exports = getAppMetadata()
