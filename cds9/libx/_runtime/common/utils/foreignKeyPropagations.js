const _normalizedRef = o => (o && o.ref && o.ref.length > 1 && o.ref[0] === '$self' ? { ref: o.ref.slice(1) } : o)

const _sub = (newOn, subOns = []) => {
  let currArr = []

  for (let i = 0; i < newOn.length; i++) {
    const onEl = newOn[i]

    if (onEl === 'or') {
      // abort condition for or
      subOns.push([])
      return subOns
    }

    if (onEl.xpr) {
      _sub(onEl.xpr, subOns)
      continue
    }
    if (currArr.length === 0 && onEl !== 'and') {
      subOns.push(currArr)
    }
    if (onEl !== 'and') {
      currArr.push(onEl)
    } else {
      currArr = []
    }
  }

  return subOns
}

const _getSubOns = element => {
  // this only works for on conds with `and`, once we support `or` this needs to be adjusted

  // TODO : check that no 'or' is in on

  const newOn = element.on || []
  const subOns = _sub(newOn)

  for (const subOn of subOns) {
    // We don't support anything else than
    // A = B AND C = D AND ...
    if (subOn.length !== 3) return []
  }

  return subOns.map(subOn => subOn.map(ref => _normalizedRef(ref)))
}

const _parentFieldsFromSimpleOnCond = (element, subOn) => {
  const idxChildField = subOn.findIndex(o => o.ref && o.ref[0] === element.name)
  if (idxChildField === -1 || subOn[1] !== '=') return

  const childFieldName = subOn[idxChildField].ref && subOn[idxChildField].ref.slice(1).join('_')
  const childElement = element._target.elements[childFieldName]
  const idxParentField = idxChildField === 2 ? 0 : 2
  let parentRef = Array.isArray(subOn[idxParentField].ref) && [...subOn[idxParentField].ref]

  if (parentRef && parentRef.length > 1) {
    const idxChildInParent = parentRef.findIndex(e => e === element.name)
    if (idxChildInParent > -1) parentRef.splice(idxChildInParent, 1)
    parentRef = [parentRef.join('_')]
  }
  const parentElement = parentRef && element.parent.elements[parentRef[0]]

  if (!childElement) {
    // update on view with key in parent
    return [{ fillChild: false, parentElement, childElement }]
  }

  if (!childElement.on) {
    const propagations = []
    if ('val' in subOn[idxParentField])
      propagations.push({ fillChild: true, parentFieldValue: subOn[idxParentField].val, childElement })
    if (element._isSelfManaged)
      return [...propagations, ..._foreignKeyPropagationsFromToManyOn(element, childFieldName)]
    if (parentElement) return [...propagations, { fillChild: true, parentElement, childElement }]
  }

  if ('val' in subOn[idxParentField]) {
    return [{ fillChild: true, parentFieldValue: subOn[idxParentField].val, childElement }]
  }

  if (childElement._isAssociationStrict && childElement.on) {
    return _foreignKeyPropagationsFromCustomBacklink(element, childElement)
  }
}

const _foreignKeyPropagationsFromToManyOn = (element, childFieldName) => {
  const foreignKeys = _foreignKeysForTarget(element, childFieldName)
  // REVISIT foreignKeys is empty if we have deep operations where a sub element is annotated with persistence skip
  if (foreignKeys && foreignKeys.length) {
    return _resolvedKeys(foreignKeys, true)
  }
  return []
}

const _foreignKeyPropagationsFromCustomBacklink = (element, childElement) => {
  const foreignKeyPropagations = []
  const subOns = _getSubOns(childElement)

  for (const subOn of subOns) {
    if (subOn[1] === '=') {
      const parentFieldIdx = subOn.findIndex(o => o.ref && o.ref[0] === childElement.name)
      const otherFieldIdx = parentFieldIdx === 0 ? 2 : 0
      const otherField = subOn[otherFieldIdx]

      if (parentFieldIdx === -1 && subOn[otherFieldIdx === 0 ? 2 : 0].val !== undefined) {
        const parentField = subOn[otherFieldIdx === 0 ? 2 : 0]
        foreignKeyPropagations.push({
          fillChild: false,
          parentFieldValue: parentField.val,
          childElement: element._target.elements[otherField.ref[0]]
        })
      } else if (otherField.ref && otherField.ref.length === 1) {
        const parentFieldName = subOn[parentFieldIdx].ref[1]
        foreignKeyPropagations.push({
          fillChild: true,
          parentElement: element.parent.elements[parentFieldName],
          childElement: element._target.elements[otherField.ref[0]]
        })
      } else if (otherField.val !== undefined) {
        const parentFieldName = subOn[parentFieldIdx] && subOn[parentFieldIdx].ref[1]
        const parentField = subOn[otherFieldIdx === 2 ? 0 : 2]
        foreignKeyPropagations.push({
          fillChild: true,
          parentElement: element.parent.elements[parentFieldName],
          parentFieldValue: parentField.val,
          childFieldValue: otherField.val
        })
      }
    }
  }

  return foreignKeyPropagations
}

const _foreignKeyPropagationsFromOn = element => {
  const subOns = _getSubOns(element)
  const foreignKeyPropagations = []

  for (const subOn of subOns) {
    const subParentFields = _parentFieldsFromSimpleOnCond(element, subOn)
    if (subParentFields) foreignKeyPropagations.push(...subParentFields)
  }

  return foreignKeyPropagations
}

const _resolveTargetForeignKey = targetKey => {
  const targetName = targetKey._foreignKey4
  if (!targetName) return
  const parentElements = targetKey.parent.elements
  const _foreignKeyProps = foreignKeyPropagations(parentElements[targetName])
  const propagation = _foreignKeyProps.find(_fkp => _fkp.parentElement && targetKey.name === _fkp.parentElement.name)
  return { targetName, propagation }
}

const _resolveColumnsFromQuery = query => {
  if (query && query.SET) return _resolveColumnsFromQuery(query.SET.args[0])
  if (query && query.SELECT && query.SELECT.columns) return query.SELECT.columns
  return []
}

const _resolvedKeys = (keys, fillChild) => {
  const foreignKeys = fillChild ? keys.map(fk => Object.getPrototypeOf(fk)) : keys
  const targetKeys = fillChild ? keys : keys.map(fk => Object.getPrototypeOf(fk))

  const foreignKeyPropagations = []
  for (let i = 0; i < foreignKeys.length; i++) {
    const fk = foreignKeys[i]
    const tk = targetKeys[i]
    const propagation = {
      fillChild,
      parentElement: fk,
      childElement: tk,
      // needed only for child -> parent propagation since template loops in other direction
      deep: !fillChild && _resolveTargetForeignKey(tk)
    }
    foreignKeyPropagations.push(propagation)
  }

  return foreignKeyPropagations
}

const foreignKeyPropagations = element => {
  if (element.is2many && element.on) {
    return _foreignKeyPropagationsFromOn(element)
  }

  if (element.is2one) {
    if (element.on) {
      // It's a link through a backlink
      return _foreignKeyPropagationsFromOn(element)
    }

    const foreignKeys = _foreignKeys(element)
    if (foreignKeys) return _resolvedKeys(foreignKeys, false)
  }

  return []
}

// REVISIT: Flattening shouldn't be necessary in the future.
//          It's better to deal with structures instead, but
//          that would require changing a lot of code.
const _foreignKeys = element => {
  const foreignKeys = element.foreignKeys
  const path = [element.name]
  const parent = element.parent
  const result = []
  _addToForeignKeysRec(foreignKeys, path, parent, result)
  return result
}

/*
 * REVISIT: poor man's look-up of target key
 * Look at elements, then try to find it in query and resolve recursively until you have the full path.
 * Once you have the full path, you can find it in the target entity.
 * NOTE: There can be projections upon projections and renamings in every projection. -> not yet covered!!!
 */
const _poorMansLookup = (el, name, foreignKeySource) => {
  // REVISIT: Dirty hack
  const tkCol = _resolveColumnsFromQuery(el.parent.query).find(
    c => c.ref && `${foreignKeySource}_${c.ref.join('_')}` === name
  )
  return tkCol && Object.values(el.parent.elements).find(tk => tk.name === (tkCol.as ? tkCol.as : tkCol.ref.join('_')))
}

const _createForeignKey = (name, el, parent, foreignKeySource) => {
  const tk = _poorMansLookup(el, name, foreignKeySource)
  const navigationCsn = parent.elements[foreignKeySource]
  const key = navigationCsn.key

  // IMPORTANT: Object.create is used to override inherited non-enumerable properties. Object.assign would not work.
  const foreignKeyCsn = Object.create(tk || el, {
    parent: { value: parent },
    name: { value: name },
    key: { value: key },
    foreignKeySource: { value: foreignKeySource }
  })
  // REVISIT: Overwrite previously defined annotations, maybe there's a better way.
  //          We might need to be careful with cached information (__xxx)
  for (const prop in tk || el) {
    if (prop.startsWith('@')) foreignKeyCsn[prop] = undefined
  }
  for (const key in navigationCsn) {
    if (!key.startsWith('@')) continue
    foreignKeyCsn[key] = navigationCsn[key]
  }
  if ('notNull' in navigationCsn) foreignKeyCsn.notNull = navigationCsn.notNull
  return foreignKeyCsn
}

const _addToForeignKeysRec = (elements, path, parent, result) => {
  for (const elName in elements) {
    const el = elements[elName]
    const foreignKeySource = path[0]
    const newPath = [...path, elName]
    if (el.isAssociation) {
      const foreignKeysOftarget = _foreignKeys(el)
      for (const fk of foreignKeysOftarget) {
        const name = [...path, fk.name].join('_')
        if (result.some(x => x.name === name)) return
        const foreignKeyCsn = _createForeignKey(name, fk, parent, foreignKeySource)
        result.push(foreignKeyCsn)
      }
    } else if (!el.elements) {
      const name = newPath.join('_')
      if (result.some(x => x.name === name)) return
      const foreignKeyCsn = _createForeignKey(name, el, parent, foreignKeySource)
      result.push(foreignKeyCsn)
    } else _addToForeignKeysRec(el.elements, newPath, parent, result)
  }
}

const _foreignKeysForTarget = (csnElement, name) => {
  const target = csnElement._target.elements[name || csnElement.name]
  return _foreignKeys(target)
}

const foreignKey4 = element => {
  if (!element || !element.parent) return
  const parentElements = element.parent.elements
  for (const assoc of Object.keys(parentElements)
    .map(n => parentElements[n])
    .filter(e => e.isAssociation)) {
    const foreignKeys = _foreignKeys(assoc)
    if (!foreignKeys.length) continue
    const target = foreignKeys.find(fk => fk.name === element.name)
    if (target) {
      return target && target.foreignKeySource
    }
  }
}

module.exports = {
  foreignKeyPropagations,
  foreignKey4
}
