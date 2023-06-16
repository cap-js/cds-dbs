// REVISIT: determine default driver based upon project dependencies
Object.defineProperties(module.exports, {
  hdb: { get: () => require('./hdb') },
  'hana-client': { get: () => require('./hana-client') },
  default: {
    get: () => {
      try {
        return module.exports['hana-client']
      } catch (e) {
        // hdb does not release its event loop on disconnect
        return module.exports.hdb
      }
    },
  },
})
