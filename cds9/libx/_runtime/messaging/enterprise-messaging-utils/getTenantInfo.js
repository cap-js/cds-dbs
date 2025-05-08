const cds = require('../../cds')
const _transform = o => ({ subdomain: o.subscribedSubdomain, tenant: o.subscribedTenantId })

// REVISIT: Looks ugly -> can we simplify that?
const getTenantInfo = async tenant => {
  const provisioning = await cds.connect.to('cds.xt.SaasProvisioningService')
  const tx = provisioning.tx({ user: cds.User.privileged })
  try {
    const result = tenant
      ? _transform(await tx.get('/tenant', { ['subscribedTenantId']: tenant }))
      : (await tx.read('tenant')).map(o => _transform(o))
    await tx.commit()
    return result
  } catch (e) {
    try {
      await tx.rollback()
      throw e
    } catch {
      throw e
    }
  }
}

module.exports = getTenantInfo
