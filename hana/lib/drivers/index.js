const cds = require('@sap/cds')

Object.defineProperties(module.exports, {
  hdb: { get: () => require('./hdb') },
  'hana-client': { get: () => require('./hana-client') },
  default: {
    get() {
      try {
        const projectPackage = require(cds.root + '/package.json')
        const dependencies = {
          ...projectPackage.dependencies,
          ...(process.env.NODE_ENV !== 'production' && projectPackage.devDependencies),
        }
        // Have a bias to hdb as the default driver
        if (dependencies.hdb) return module.exports.hdb
        if (dependencies['@sap/hana-client']) return module.exports['hana-client']
      } catch {
        console.trace(`WARNING! Unable to require the project's package.json at "${cds.root + '/package.json'}". Please check your project setup.`) // eslint-disable-line no-console
      }

      // When no driver is installed still try to load any of the drivers
      try {
        return module.exports.hdb
      } catch {
        return module.exports['hana-client']
      }
    },
  },
})
