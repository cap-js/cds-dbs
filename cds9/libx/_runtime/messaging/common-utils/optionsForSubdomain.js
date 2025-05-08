// Example: "https://" + subdomain + ".authentication.sap.hana.ondemand.com/oauth/token"
// Points are not allowed in subdomain.
const modifiedEndpoint = (endpoint, subdomain) =>
  endpoint.replace(/(^https:\/\/)([^.]+)(\..+$)/, '$1' + subdomain + '$3')

const oa2ForSubdomain = (obj, subdomain) => {
  const endpointForSubdomain = modifiedEndpoint(obj.oa2.endpoint, subdomain)
  return { ...obj, oa2: { ...obj.oa2, endpoint: endpointForSubdomain } }
}

module.exports = {
  oa2ForSubdomain,
  modifiedEndpoint
}
