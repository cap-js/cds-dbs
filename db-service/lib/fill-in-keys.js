const cds = require('@sap/cds')
const { hasDeep } = require('../lib/deep-queries')

// REVISIT: very deep & fragile dependencies to internal modules -> copy these into here
const propagateForeignKeys = require('@sap/cds/libx/_runtime/common/utils/propagateForeignKeys')
const { enrichDataWithKeysFromWhere } = require('@sap/cds/libx/_runtime/common/utils/keys')

const assoc4 = (e) => e.own('$fk4', ()=> {
  const old = e['@odata.foreignKey4']; if (old) return old
  if (!e.parent || !e.name || !e.name.includes('_')) return
  if (e.name === 'ID_texts') return
  if (e.name === 'DraftAdministrativeData_DraftUUID') return 'DraftAdministrativeData'
  if (e.name.startsWith('up__')) return 'up_' // assumes up_ is a reserved name
  const {elements} = e.parent, path = e.name.split('_')
  for (let [p]=path, a, i=1; i < path.length; p += '_'+path[i++]) {
    if ((a = elements[p])) {
      if (a.keys) {
        const tail = path.slice(i)
        if (a.keys.some (k => k.ref.every((r,i) => r === tail[i]))) {
          // process.stdout.write('> resolved assoc: ' + a.name + ' for: ' + this.name + '\n')
          return a.name
        }
      }
      return // not an assoc, or not the one we're looking for
    }
  }
})

const fkeys4 = (e) => {
  let fkeys = e._foreignKeys
  return typeof fkeys === 'function' ? fkeys.call(e) : fkeys
}

const generateUUIDandPropagateKeys = (entity, data, event) => {
  if (event === 'CREATE') {
    const keys = entity.keys
    for (const k in keys)
      if (keys[k].isUUID && !data[k] && !assoc4(keys[k])) //> skip key assocs, and foreign keys thereof
        data[k] = cds.utils.uuid()
  }
  for (const each in entity.elements) {
    const e = entity.elements[each]
    // if assoc keys are structured, do not ignore them, as they need to be flattened in propagateForeignKeys
    if (!e.isAssociation || e.key && (e.isComposition || e.is2many || !(each in data))) continue
    // propagate own foreign keys to propagate further to sub data
    propagateForeignKeys (each, data, fkeys4(e), e.isComposition, { deleteAssocs: true, })

    let subData = data[each]; if (!subData) continue
    if (!Array.isArray(subData)) subData = [subData]
    for (const sub of subData) {
      // For subData the event is set to 'CREATE' as require UUID generation
      generateUUIDandPropagateKeys (e._target, sub, 'CREATE')
    }
  }
}


module.exports = async function fill_in_keys(req, next) {
  // REVISIT dummy handler until we have input processing
  if (!req.target || !this.model || req.target._unresolved) return next()
  // only for deep update
  if (req.event === 'UPDATE' && hasDeep(req.query, req.target)) {
    // REVISIT for deep update we need to inject the keys first
    enrichDataWithKeysFromWhere(req.data, req, this)
  }

  // REVISIT no input processing for INPUT with rows/values
  if (!(req.query.INSERT?.rows || req.query.INSERT?.values)) {
    let {data} = req; if (!Array.isArray(data)) data = [data]
    for (const d of data) {
      generateUUIDandPropagateKeys (req.target, d, req.event)
    }
  }
  return next()
}
