const DEBUG = /plugins/.test(process.env.DEBUG) ? console : undefined // eslint-disable-line no-console
const cds = require('.')
const prio_plugins = {
  '@sap/cds-mtxs': true,    // plugins may register handlers for mtxs services
  '@cap-js/telemetry': true // to allow better instrumentation
}

/**
 * Fetch cds-plugins from project's package dependencies.
 * Used in and made available through cds.env.plugins.
 */
exports.fetch = function (DEV = process.env.NODE_ENV !== 'production') {
  DEBUG?.time ('[cds.plugins] - fetched plugins in')
  const plugins = {}
  fetch_plugins_in (cds.home, false)
  fetch_plugins_in (cds.root, DEV)
  function fetch_plugins_in (root, dev) {
    let pkg; try { pkg = require(root + '/package.json') } catch { return }
    let deps = { ...pkg.dependencies, ...dev && pkg.devDependencies }
    for (let each in deps) try {
      let impl = require.resolve(each + '/cds-plugin', { paths: [root] })
      plugins[each] = { impl }
    } catch { /* no cds-plugin.js */ }
  }
  DEBUG?.timeEnd ('[cds.plugins] - fetched plugins in')
  return plugins
}

/**
 * Load and activate cds-plugins from project's package dependencies.
 * Used in and made available through cds.plugins.
 */
exports.activate = async function () {
  DEBUG?.time ('[cds.plugins] - loaded plugins in')
  const { plugins } = cds.env, { local } = cds.utils
  const loadPlugin = async ([plugin, conf]) => {
    DEBUG?.log(`[cds.plugins] - loading ${plugin}:`, { impl: local(conf.impl) })
    const p = cds.utils._import (conf.impl)
    if (p.activate) {
      cds.log('plugins').warn(`WARNING: \n
  The @sap/cds plugin ${conf.impl} contains an 'activate' function, which is deprecated and won't be
  supported in future releases. Please rewrite the plugin to return a Promise within 'module.exports'.
  `)
      await p.activate(conf)
    }
    return p
  }
  const all = Object.entries(plugins)
  await Promise.all (all .filter(([name]) =>  prio_plugins[name]) .map (loadPlugin))
  await Promise.all (all .filter(([name]) => !prio_plugins[name]) .map (loadPlugin))
  DEBUG?.timeEnd ('[cds.plugins] - loaded plugins in')
  return plugins
}
