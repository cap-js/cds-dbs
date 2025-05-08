const _flattenProps = (element, structProperties, asRef, withKey, prefix) => {
  if (element.elements) {
    return _resolveStructured(
      {
        element,
        structProperties: structProperties.slice(1)
      },
      asRef,
      withKey,
      prefix
    )
  } else if (element.isAssociation) {
    if (structProperties.length && element.is2one && !element.on) {
      const resolved = [...prefix, ...structProperties]
      if (withKey) {
        // TODO: should be "element._alias || element.name", but how to get alias from edm?
        //       cf. removed alias2ref (https://github.tools.sap/cap/cds/pull/3583)
        return [{ key: element.name, resolved }]
      }
      const flattenedName = resolved.join('_')
      return asRef ? [{ ref: [flattenedName] }] : [flattenedName]
    }
    return []
  }

  const resolved = [...prefix, element.name]
  if (withKey) {
    // TODO: should be "element._alias || element.name", but how to get alias from edm?
    //       cf. removed alias2ref (https://github.tools.sap/cap/cds/pull/3583)
    return [{ key: element.name, resolved }]
  }
  const flattenedName = resolved.join('_')
  return asRef ? [{ ref: [flattenedName] }] : [flattenedName]
}

const _resolveStructured = ({ element, structProperties }, asRef = true, withKey = false, prefix = []) => {
  if (!element.elements) {
    return []
  }

  prefix.push(element.name)

  // only add from structProperties
  if (structProperties && structProperties.length) {
    return _flattenProps(element.elements[structProperties[0]], structProperties, asRef, withKey, prefix)
  }

  const flattenedElements = []
  for (const structElement in element.elements) {
    flattenedElements.push(
      ..._flattenProps(element.elements[structElement], structProperties || [], asRef, withKey, prefix)
    )
  }
  prefix.pop()
  return flattenedElements
}

module.exports = _resolveStructured
