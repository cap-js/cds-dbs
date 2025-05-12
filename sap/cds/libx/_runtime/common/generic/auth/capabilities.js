const RESTRICTIONS = {
  CREATE: 'InsertRestrictions.Insertable',
  READ: 'ReadRestrictions.Readable',
  READABLE_BY_KEY: 'ReadRestrictions.ReadByKeyRestrictions.Readable',
  UPDATE: 'UpdateRestrictions.Updatable',
  DELETE: 'DeleteRestrictions.Deletable'
}

const _getRestriction = (req, capability, capabilityReadByKey) =>
  capabilityReadByKey !== undefined && req.query.SELECT?.one ? capabilityReadByKey : capability

const _getNavigationRestriction = (target, path, annotation, req) => {
  if (!Array.isArray(target['@Capabilities.NavigationRestrictions.RestrictedProperties'])) return

  const [restriction, operation] = annotation.split('.')
  for (const r of target['@Capabilities.NavigationRestrictions.RestrictedProperties']) {
    // prefix check to support both notations: { InsertRestrictions: { Insertable: false } } and { InsertRestrictions.Insertable: false }
    // however, { InsertRestrictions.Insertable: false } is actually not supported bc compiler does not expand shorthands inside an annotation
    if (r.NavigationProperty['='] === path && Object.keys(r).some(k => k.startsWith(restriction))) {
      const capability = r[annotation] ?? r[restriction]?.[operation]
      const capabilityReadByKey =
        r.ReadRestrictions?.['ReadByKeyRestrictions.Readable'] ?? r.ReadRestrictions?.ReadByKeyRestrictions?.Readable
      return _getRestriction(req, capability, capabilityReadByKey)
    }
  }
}

const _localName = entity => entity.name.replace(entity._service.name + '.', '')

const _getNav = from => {
  if (from?.SELECT) return _getNav(from.SELECT.from)
  if (from?.ref) return from.ref.map(el => el.id || el)
  return []
}

function check_odata_constraints(req) {
  // TODO: Determine auth-relevant entity
  const annotation = RESTRICTIONS[req.event]
  if (!annotation) return
  if (!req.target) return

  const from = req.subject
  if (!from) return //> exit fast

  const nav = _getNav(from)

  let navRestriction
  if (nav.length > 1) {
    const navs = nav.slice(1)
    let lastTarget, target, element, navigation, path
    target = this.model.definitions[nav[0]]
    for (let i = 0; i < navs.length && target; i++) {
      element = !element || element.isAssociation ? target.elements[navs[i]] : element.elements[navs[i]]
      if (element.isAssociation) {
        navigation = path ? `${path}.${navs[i]}` : navs[i]
        path = undefined
        lastTarget = target
        target = this.model.definitions[element.target]
      } else {
        path = path ? `${path}.${navs[i]}` : navs[i]
      }
    }
    if (lastTarget && navigation) {
      navRestriction = _getNavigationRestriction(lastTarget, navigation, annotation, req)
      if (navRestriction === false) {
        // REVISIT: rework exception with using target
        const trgt = `${_localName(lastTarget)}.${navs.join('.')}`
        const action = annotation.split('.').pop().toLowerCase() // REVISIT: .split.pop is an anti pattern !!
        req.reject(405, 'ENTITY_IS_NOT_CRUD_VIA_NAVIGATION', [_localName(req.target), action, trgt])
      }
    }
  }

  if (
    !navRestriction &&
    _getRestriction(
      req,
      req.target['@Capabilities.' + annotation],
      req.target['@Capabilities.' + RESTRICTIONS.READABLE_BY_KEY]
    ) === false
  ) {
    const action = annotation.split('.').pop().toLowerCase() // REVISIT: .split.pop is an anti pattern !!
    req.reject(405, 'ENTITY_IS_NOT_CRUD', [_localName(req.target), action])
  }
}

check_odata_constraints._initial = true

module.exports = check_odata_constraints
