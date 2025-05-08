try {
  const xssec = require('@sap/xssec')
  module.exports = xssec // use v3 compat api // REVISIT: why ???
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') e.message = `Cannot find '@sap/xssec'. Make sure to install it with 'npm i @sap/xssec'\n` + e.message
  throw e
}
