const cds = require('../../cds')

const { prefixForStruct } = require('../../common/utils/csn')

const _autoGenerate = e => e && e.isUUID && e.key

const _set = (row, value, element) => {
  if (value === undefined) return // only if properly propagated/generated
  if (!element.parent.elements[element.name]) return // only when in model
  row[element.name] = value
}

const _generateParentField = ({ parentElement }, row) => {
  if (_autoGenerate(parentElement) && !row[parentElement.name]) {
    _set(row, cds.utils.uuid(), parentElement)
  }
}

const _generateChildField = ({ deep, childElement }, childRow) => {
  if (deep) {
    _generateChildField(deep.propagation, childRow[deep.targetName])
  } else if (_autoGenerate(childElement) && childRow && !childRow[childElement.name]) {
    _set(childRow, cds.utils.uuid(), childElement)
  }
}

const _getNestedVal = (row, prefix) => {
  let val = row
  const splitted = prefix.split('_')
  splitted.pop() // remove last `_`
  let k = ''

  while (splitted.length > 0) {
    k += splitted.shift()
    if (k in val) {
      val = val[k]
      k = ''
    } else {
      k += '_'
    }
  }

  return val
}

const _propagateToChild = ({ parentElement, childElement, parentFieldValue }, row, childRow) => {
  if (!childElement || !childElement.parent.elements[childElement.name]) return
  if (parentElement) {
    const prefix = prefixForStruct(parentElement)
    if (prefix) {
      const nested = _getNestedVal(row, prefix)
      _set(childRow, nested[parentElement.name], childElement)
    } else {
      _set(childRow, row[parentElement.name], childElement)
    }
  } else if (parentFieldValue !== undefined) {
    _set(childRow, parentFieldValue, childElement)
  }
}

const _propagateToParent = ({ parentElement, childElement, deep }, childRow, row) => {
  if (deep) {
    _propagateToParent(deep.propagation, childRow[deep.targetName], childRow)
  }
  if (parentElement && childElement && childRow && childElement.name in childRow) {
    _set(row, childRow[childElement.name], parentElement)
  }
}

module.exports = (
  tKey,
  row,
  foreignKeyPropagations,
  isCompositionEffective,
  { deleteAssocs = false, generateKeys = true } = {}
) => {
  if (!row || !(tKey in row)) return
  if (row[tKey] === null) {
    for (const foreignKeyPropagation of foreignKeyPropagations) {
      if (!foreignKeyPropagation.fillChild) {
        _set(row, null, foreignKeyPropagation.parentElement)
      }
    }
    if (deleteAssocs && !isCompositionEffective) delete row[tKey]
    return
  }

  const childRows = Array.isArray(row[tKey]) ? row[tKey] : [row[tKey]]

  for (const childRow of childRows) {
    if (!childRow) return

    for (const foreignKeyPropagation of foreignKeyPropagations) {
      if (foreignKeyPropagation.fillChild) {
        // propagate or generate in parent
        const pk = foreignKeyPropagation.parentElement && foreignKeyPropagation.parentElement.name
        if (pk && !(pk in row)) _propagateToParent(foreignKeyPropagation, childRow, row)
        if (!(pk in row) && generateKeys) _generateParentField(foreignKeyPropagation, row)

        if (isCompositionEffective) _propagateToChild(foreignKeyPropagation, row, childRow)
      } else {
        if (isCompositionEffective && generateKeys) _generateChildField(foreignKeyPropagation, childRow)
        _propagateToParent(foreignKeyPropagation, childRow, row)
      }
    }
  }
  if (deleteAssocs && !isCompositionEffective) delete row[tKey]
}
