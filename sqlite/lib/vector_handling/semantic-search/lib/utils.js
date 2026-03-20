const os = require('os')
const path = require('path')

/**
 * Get the platform-specific data directory for the application
 * @param {string} appName - The application name (defaults to 'semantic-search')
 * @returns {string} The full path to the data directory
 */
function getDataDir(appName = 'semantic-search') {
  const home = os.homedir()
  const platform = os.platform()

  let dir

  if (platform === 'win32') {
    dir = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(home, 'AppData', 'Local')
  } else {
    dir = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  }

  return path.join(dir, appName)
}

module.exports = {
  getDataDir
}
