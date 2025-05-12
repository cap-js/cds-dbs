const cds = new class { get compile(){ return super.compile = require ('./cds-compile') }}
const extend = require ('../utils/extend')

/** @type <T> (target:T) => ({
  with <X,Y,Z> (x:X, y:Y, z:Z): ( T & X & Y & Z )
  with <X,Y> (x:X, y:Y): ( T & X & Y )
  with <X> (x:X): ( T & X )
}) */
module.exports = o => o.definitions ? { with(...csns) {

    // merge all extension csns
    const csn=o, merged = { definitions: {}, extensions: [] }
    for (const { definitions, extensions } of csns) {
      if (definitions) Object.assign(merged.definitions, definitions)
      if (extensions) merged.extensions.push(...extensions)
    }

    // extend given base csn with merged extensions
    const extended = cds.compile({
      'base.csn': cds.compile.to.json(csn),
      'ext.csn': cds.compile.to.json(merged)
    })

    // handle localized extension elements
    for (let ext of merged.extensions) {
      for (let name in ext.elements) {
        const e = ext.elements[name]
        if (e.localized) {
          // add localized element also to respective .texts entity
          const texts = extended.definitions[ext.extend+'.texts']
          texts.elements[name] ??= { ...e, localized:null }
        }
      }
    }

    extended.$sources = csn.$sources // required to load resources like i18n later on
    return extended

}} : extend(o)
