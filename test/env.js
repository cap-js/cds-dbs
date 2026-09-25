// Inject the provided plugins for cds.env resolving
const plugins = {}
try { plugins['@cap-js/sqlite'] = { impl: require.resolve('@cap-js/sqlite') } } catch {/* ignore */ }
try { plugins['@cap-js/hana'] = { impl: require.resolve('@cap-js/hana') } } catch {/* ignore */ }
try { plugins['@cap-js/postgres'] = { impl: require.resolve('@cap-js/postgres') } } catch {/* ignore */ }
process.env.CDS_PLUGINS = JSON.stringify(plugins)

try {
  const serviceDefinitionPath = `${process.cwd()}/test/service`

  // Overwrite default cds.requires.db with test config
  const config = require(serviceDefinitionPath)
  config.driver = process.env.CDS_REQUIRES_DB_DRIVER ?? config.driver
  process.env.CDS_REQUIRES_DB = JSON.stringify(config)
} catch {
  // Default to sqlite for packages without their own service
  process.env.CDS_REQUIRES_DB = JSON.stringify(require('@cap-js/sqlite/test/service'))
}

console.log(`export CDS_PLUGINS=${process.env.CDS_PLUGINS} export CDS_REQUIRES_DB=${process.env.CDS_REQUIRES_DB}`)
