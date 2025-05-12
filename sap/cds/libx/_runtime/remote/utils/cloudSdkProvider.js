let _cloudSdkConnectivity
const getCloudSdkConnectivity = () => {
  if (_cloudSdkConnectivity) return _cloudSdkConnectivity
  _cloudSdkConnectivity = require('@sap-cloud-sdk/connectivity')
  return _cloudSdkConnectivity
}

let _cloudSdkResilience
const getCloudSdkResilience = () => {
  if (_cloudSdkResilience) return _cloudSdkResilience
  _cloudSdkResilience = require('@sap-cloud-sdk/resilience')
  return _cloudSdkResilience
}

let _cloudSdk
const getCloudSdk = () => {
  if (_cloudSdk) return _cloudSdk

  _cloudSdk = require('@sap-cloud-sdk/http-client')
  return _cloudSdk
}

module.exports = {
  getCloudSdkConnectivity,
  getCloudSdkResilience,
  getCloudSdk
}
