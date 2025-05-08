const cds = require('../../..')

const _get_cf_fields = () => {
  const cf_fields = {
    layer: 'cds',
    component_type: 'application',
    container_id: process.env.CF_INSTANCE_IP
  }
  const VCAP_APPLICATION = process.env.VCAP_APPLICATION && JSON.parse(process.env.VCAP_APPLICATION)
  if (VCAP_APPLICATION) {
    Object.assign(cf_fields, {
      component_id: VCAP_APPLICATION.application_id,
      component_name: VCAP_APPLICATION.application_name,
      component_instance: VCAP_APPLICATION.instance_index,
      source_instance: VCAP_APPLICATION.instance_index,
      organization_name: VCAP_APPLICATION.organization_name,
      organization_id: VCAP_APPLICATION.organization_id,
      space_name: VCAP_APPLICATION.space_name,
      space_id: VCAP_APPLICATION.space_id
    })
  }
  return cf_fields
}

function cf_aspect(module, level, args, toLog) {
  this._CF_FIELDS ??= _get_cf_fields()

  // add static fields from environment
  Object.assign(toLog, this._CF_FIELDS)

  // add subdomain, if available (use cds.context._ instead of cds.context.http because of messaging)
  const tenant_subdomain = cds.context?._?.req?.authInfo?.getSubdomain?.()
  if (tenant_subdomain) toLog.tenant_subdomain = tenant_subdomain
}

module.exports = process.env.CF_INSTANCE_GUID ? cf_aspect : () => {}
