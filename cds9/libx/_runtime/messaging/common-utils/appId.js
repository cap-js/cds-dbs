const optionsApp = require('../../common/utils/vcap')
const appId = () => {
  const appName = optionsApp.appName || 'CAP'
  const appID = optionsApp.appID || '00000000'
  const shrunkAppID = appID.substring(0, 4)
  return `${appName}/${shrunkAppID}`
}

module.exports = appId
