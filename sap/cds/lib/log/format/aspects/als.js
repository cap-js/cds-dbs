const cds = require('../../..')

function als_aspect(module, level, args, toLog) {
  this._ALS_CUSTOM_FIELDS ??= { ...cds.env.log.als_custom_fields }
  this._ALS_HAS_CUSTOM_FIELDS ??= Object.keys(this._ALS_CUSTOM_FIELDS).length > 0

  // ALS custom fields
  if (this._ALS_HAS_CUSTOM_FIELDS) {
    const cf = []
    for (const k in this._ALS_CUSTOM_FIELDS) {
      if (toLog[k]) {
        const i = cf.findIndex(e => e.i === this._ALS_CUSTOM_FIELDS[k])
        if (i > -1) cf[i] = { k, v: toLog[k], i: this._ALS_CUSTOM_FIELDS[k] }
        else cf.push({ k, v: toLog[k], i: this._ALS_CUSTOM_FIELDS[k] })
      }
    }
    if (cf.length) toLog['#cf'] = { string: cf }
  }
}

als_aspect.cf = () => Object.keys({ ...cds.env.log.als_custom_fields })

module.exports = process.env.VCAP_SERVICES?.match(/"label":\s*"application-logs"/) ? als_aspect : () => {}
