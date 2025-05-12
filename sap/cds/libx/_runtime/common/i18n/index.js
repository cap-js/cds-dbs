//
// REVISIT: Not used any longer -> move to @sap/cds-attic ...
//
const fs = require('fs')
const path = require('path')

const cds = require('../../cds')

const dirs = (cds.env.i18n && cds.env.i18n.folders) || []

const i18ns = {}

function exists(args, locale) {
  const file = path.join(cds.root, ...args, locale ? `messages_${locale}.properties` : 'messages.properties')
  return fs.existsSync(file) ? file : undefined
}

function findFile(locale) {
  // lookup all paths to model files
  const prefixes = new Set()
  if (cds.env.folders && cds.env.folders.srv) prefixes.add(cds.env.folders.srv.replace(/\/$/, ''))
  if (cds.services) {
    for (const outer in cds.services) {
      if (cds.services[outer].definition && cds.services[outer].definition['@source']) {
        prefixes.add(path.dirname(cds.services[outer].definition['@source']))
      }
    }
  }

  let file
  // find first messages_${locale}.properties file in cds.env.i18n.folders
  for (const dir of dirs) {
    // w/o prefix
    file = exists([dir], locale)
    if (file) break

    // w/ prefix
    for (const prefix of prefixes.keys()) {
      file = exists([prefix, dir], locale)
      if (file) break
    }

    if (file) break
  }

  return file
}

function init(locale, file) {
  if (!i18ns[locale]) i18ns[locale] = {}

  if (!file) file = findFile(locale)
  if (!file) return

  const props = cds.load.properties(file)
  i18ns[locale] = props
}

init('default', path.resolve(__dirname, '../../../../_i18n/messages.properties'))
init('')

module.exports = (key, locale = '', args = {}) => {
  if (typeof locale !== 'string') {
    args = locale
    locale = ''
  }

  // initialize locale if not yet done
  if (!i18ns[locale]) {
    init(locale)
  }

  // for locale OR app default OR cds default
  let text = i18ns[locale][key] || i18ns[''][key] || i18ns.default[key]
  return text?.replace(/{(\w+)}/g, (_, k) => {
    let x = args[k]
    return i18ns[locale][x] || i18ns[''][x] || i18ns.default[x] || (x ?? 'NULL') // REVISIT: i'm afraid this twofold localization is a rather bad idea
  })
}
