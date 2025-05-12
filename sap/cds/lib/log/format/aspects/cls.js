const cds = require('../../..')

function cls_aspect(/* module, level, args, toLog */) {
  // actually nothing to do
}

cls_aspect.cf = () => [...cds.env.log.cls_custom_fields]

const VCAP_SERVICES = process.env.VCAP_SERVICES ? JSON.parse(process.env.VCAP_SERVICES) : {}

module.exports =
  VCAP_SERVICES['cloud-logging'] ||
  VCAP_SERVICES['user-provided']?.find(e => e.tags.includes('cloud-logging') || e.tags.includes('Cloud Logging'))
    ? cls_aspect
    : () => {}
