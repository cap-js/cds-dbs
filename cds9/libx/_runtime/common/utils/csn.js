const cds = require('../../cds')

const getComp2oneParents = (entity, model) => {
  if (!entity) return []
  return _getUps(entity, model).filter(element => element.is2one && element.isComposition)
}

const setEntityContained = (entity, model, isContained) => {
  if (!entity || entity.kind !== 'entity') return entity
  if ('_isContained' in entity && !isContained) return entity
  if ('_isContained' in entity) delete entity._isContained
  return Object.defineProperty(entity, '_isContained', {
    get() {
      return (
        isContained ||
        !!_getUps(entity, model).find(element => element._isContained && element.parent.name !== entity.name)
      )
    },
    configurable: true
  })
}

const _getUps = (entity, model) => {
  if (entity.own('__parents')) return entity.__parents
  const ups = []
  for (const def of Object.values(model.definitions)) {
    if (def.kind !== 'entity' || !def.associations) continue
    for (const element of Object.values(def.associations)) {
      if (element.target !== entity.name || element._isBacklink) continue
      if (element.name === 'SiblingEntity') continue
      ups.push(element)
    }
  }
  return entity.set('__parents', ups)
}

const _resolve = (edmName, model, namespace) => {
  const resolved = model._edmToCSNNameMap[namespace][edmName.replace(/\./g, '_')]
  // the edm name has an additional suffix 'Parameters' in case of views with parameters
  if (!resolved && edmName.endsWith('Parameters')) {
    const viewWithParam = model._edmToCSNNameMap[namespace][edmName.replace(/Parameters$/, '').replace(/\./g, '_')]
    if (!viewWithParam || !viewWithParam.params) return
    return viewWithParam
  }
  return resolved
}

const _findCsnTarget = (edmName, model, namespace) => {
  let target = _resolve(edmName, model, namespace)
  if (target) return target

  if (!cds.env.effective.odata.structs) return

  // navigation to structured like `StructuredTypes_structured_nested_` (edmx)
  const parts = edmName.split('_')
  let i = parts.length
  let name = edmName
  while (!target && i > 1) {
    // Traverse to find the longest entity name.
    // All weird namings with `.` and `_` are already covered by cache.
    name = name.replace(/_[^_]*$/, '')
    target = _resolve(name, model, namespace)
    i--
  }
  // something left in navigation path => resolving within found entity
  if (i > 0 && target) {
    const left = parts.slice(i - parts.length)
    while (target && left.length) {
      let elm = left.shift()
      while (!target.elements[elm]) elm = `${elm}_${left.shift()}`
      target = target.elements[elm]
    }
  }
  return target
}

const _initializeCache = (model, namespace) => {
  const cache = {}
  for (const name in model.definitions) {
    // do no cache entities within different namespace
    if (!name.startsWith(`${namespace}.`)) continue
    // cut off namespace and underscoreify entity name (OData does not allow dots)
    cache[name.replace(new RegExp(`^${namespace}\\.`), '').replace(/\./g, '_')] = model.definitions[name]
  }
  return cache
}

const findCsnTargetFor = (edmName, model, namespace) => {
  const cache =
    model._edmToCSNNameMap || Object.defineProperty(model, '_edmToCSNNameMap', { value: {} })._edmToCSNNameMap
  const edm2csnMap = cache[namespace] || (cache[namespace] = _initializeCache(model, namespace))

  if (edm2csnMap[edmName]) return edm2csnMap[edmName]

  const target = _findCsnTarget(edmName, model, namespace)

  // remember edm <-> csn
  if (target && !edm2csnMap[edmName]) {
    edm2csnMap[edmName] = target
  }

  return edm2csnMap[edmName]
}

const prefixForStruct = element => {
  const prefixes = []
  let parent = element.parent
  while (parent && parent.kind !== 'entity') {
    prefixes.push(parent.name)
    parent = parent.parent
  }
  return prefixes.length ? prefixes.reverse().join('_') + '_' : ''
}

function getDraftTreeRoot(entity, model) {
  if (entity.own('__draftTreeRoot')) return entity.__draftTreeRoot

  const previous = new Set() // track visited entities to identify hierarchies
  let parent
  let current = entity
  while (current && !current['@Common.DraftRoot.ActivationAction']) {
    previous.add(current.name)
    const parents = []
    for (const k in model.definitions) {
      if (previous.has(k)) continue
      const e = model.definitions[k]
      if (e.kind !== 'entity' || !e.compositions) continue
      for (const c in e.compositions)
        if (
          e.compositions[c].target === current.name ||
          e.compositions[c].target === current.name.replace(/\.drafts/, '')
        ) {
          parents.push(e)
        }
    }
    if (parents.length > 1 && parents.some(p => p !== parents[0])) {
      // > unable to determine single parent
      parent = undefined
      break
    }
    current = parent = parents[0]
  }

  return entity.set('__draftTreeRoot', parent)
}

module.exports = {
  findCsnTargetFor,
  getComp2oneParents,
  prefixForStruct,
  getDraftTreeRoot,
  setEntityContained
}
