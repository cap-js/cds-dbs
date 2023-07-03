const cds = require('@sap/cds')

Object.defineProperties(module.exports, {
  hdb: { get: () => require('./hdb') },
  'hana-client': { get: () => require('./hana-client') },
  default: {
    get() {
      const projectPackage = require(cds.root + '/package.json')
      const dependencies = {
        ...projectPackage.dependencies,
        ...(process.env.NODE_ENV !== 'production' && projectPackage.devDependencies),
      }

      // Have a bias to hdb as the default driver
      if (dependencies.hdb) {
        return module.exports.hdb
      }
      if (dependencies['@sap/hana-client']) {
        return module.exports['hana-client']
      }

      // When no driver is installed still try to load any of the drivers
      try {
        return module.exports.hdb
      } catch (e) {
        return module.exports['hana-client']
      }
    },
  },
})
