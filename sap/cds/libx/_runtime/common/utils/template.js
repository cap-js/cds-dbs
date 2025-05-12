const DELIMITER = require('./templateDelimiter')

const templateProcessor = require('./templateProcessor')

const _addSubTemplate = (templateElements, elementName, subTemplate) => {
  if (subTemplate.elements.size > 0) {
    const t = templateElements.get(elementName)
    if (t) t.template = subTemplate
    else templateElements.set(elementName, { template: subTemplate })
  }
}

const _addToTemplateElements = (templateElements, elementName, picked) => {
  const tEl = templateElements.get(elementName)
  if (tEl) Object.assign(tEl, { picked })
  else templateElements.set(elementName, { picked })
}

const _addCacheToTemplateElements = (templateElements, elementName, cached) => {
  const tEl = templateElements.get(elementName)
  if (tEl) tEl.template = cached.template
  else templateElements.set(elementName, cached)
}

const _pick = (pick, element, target, templateElements, elementName) => {
  const _picked = pick(element, target)
  if (_picked) _addToTemplateElements(templateElements, elementName, { plain: _picked })
}

const _isInlineStructured = element => {
  return (
    (element._isStructured && !element.type) || (element.items && element.items._isStructured && !element.items.type)
  )
}

const _isNextTargetCacheable = element => {
  return (
    element.isAssociation ||
    (element._isStructured && element.type) ||
    (element.items && element.items._isStructured && element.items.type)
  )
}

const _getNextTarget = (model, element, currentPath = []) => {
  // _typed_ targets have names whereas inlines are targets themselves
  // For inlines names should be resolved up to the entity to avoid struct name clashings in entityMap
  if (_isNextTargetCacheable(element)) {
    const nextTargetName = element.target || element.type || (element.items && element.items.type)
    return {
      nextTargetName,
      nextTarget: model.definitions[nextTargetName]
    }
  }

  if (_isInlineStructured(element)) {
    return {
      nextTargetName: [...currentPath, element.name].join(DELIMITER),
      nextTarget: element.items || element
    }
  }

  return {}
}

/**
 *
 * @param {import('@sap/cds-compiler/lib/api/main').CSN} model Model
 * @param {Map} cache Internal - do not use
 * @param {object} targetEntity The target entity which needs to be traversed
 * @param {object} callbacks
 * @param {function} callbacks.pick Callback function to pick elements. If it returns a truthy value, the element will be picked. The returned value is part of the template.
 * @param {function} callbacks.ignore Callback function to ignore the target of an element. If it returns a truthy value, the element's target will be ignored.
 * @param {Map} [_entityMap] This parameter is an implementation side-effect — don't use it
 * @param {array} [targetPath=[]]
 */
function _getTemplate(model, cache, targetEntity, callbacks, _entityMap = new Map(), targetPath = []) {
  const { pick, ignore, flatAccess } = callbacks
  const templateElements = new Map()
  const template = {
    target: targetEntity,
    elements: templateElements,
    process(data, fn, pathOptions) {
      templateProcessor({
        processFn: fn,
        data,
        template,
        pathOptions,
        isRoot: true
      })
    }
  }
  const currentPath = [...targetPath, targetEntity.name]
  _entityMap.set(currentPath.join(DELIMITER), { template })
  const elements = targetEntity.elements || targetEntity.params
  if (!elements) return template

  if (flatAccess) {
    if (targetEntity._flat2struct) {
      for (const elementName in targetEntity._flat2struct) {
        const element = targetEntity._flat2struct[elementName]
        _pick(pick, element, targetEntity, templateElements, elementName)
      }
    }
  }

  for (const elementName in elements) {
    const element = elements[elementName]
    _pick(pick, element, targetEntity, templateElements, elementName)

    if (element.items) {
      _pick(pick, element.items, targetEntity, templateElements, ['_itemsOf', elementName].join(DELIMITER))
    }

    const { nextTargetName, nextTarget } = _getNextTarget(model, element, currentPath)
    if (ignore && ignore(element)) continue
    const nextTargetCached = _entityMap.get(nextTargetName)

    if (nextTargetCached) {
      _addCacheToTemplateElements(templateElements, elementName, nextTargetCached)
    } else if (nextTarget) {
      // For associations and _typed_ structured elements, there's a (cacheable) target,
      // inline structures must be handled separately.
      let subTemplate
      if (_isInlineStructured(element))
        subTemplate = _getTemplate(model, cache, nextTarget, callbacks, _entityMap, currentPath)
      else if (cache.has(nextTarget)) subTemplate = cache.get(nextTarget)
      else {
        subTemplate = _getTemplate(model, cache, nextTarget, callbacks, _entityMap)
        cache.set(nextTarget, subTemplate)
      }
      _addSubTemplate(templateElements, elementName, subTemplate)
    }
  }

  return template
}

module.exports = (usecase, tx, target, ...args) => {
  if (!target) return

  // REVISIT: tx.model === cds.context.model, but keep for usage stability
  const model = tx.model
  if (!model) return

  if (!model._templateCache) Object.defineProperty(model, '_templateCache', { value: new Map() })
  if (!model._templateCache.get(usecase)) model._templateCache.set(usecase, new WeakMap())

  let tmplt = model._templateCache.get(usecase).get(target)
  if (!tmplt) {
    tmplt = _getTemplate(model, model._templateCache.get(usecase), target, ...args)
    model._templateCache.get(usecase).set(target, tmplt)
  }
  return tmplt
}
