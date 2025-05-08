const cds = require('../..')
const DEBUG = cds.debug('alpha|_localized')
const _been_here = Symbol('is _localized')



/**
 * In case of old SQLite service, for each localized_<view> we get from the
 * compiler, create additional views localized_<locale>_<views>
 */
function unfold_ddl (ddl) {
	return ddl
}



/**
 * Add localized. entries and localized.<locale> entries (as in compiler v1) to reflect what
 * For each localized.<view> we get from the compiler, ensure there's a
 * corresponding localized.<locale>. entry in the model to support reflection.
 * In addition
 */
function unfold_csn (m) {

	// only do that once per model
	if (!m || m[_been_here]) return m
	DEBUG && DEBUG ('unfolding csn...')
	const pass2 = []

	// Pass 1 - add localized.<locale> entities and views
	for (const each in cds.linked(m).definitions) {
		const d = m.definitions [each]
		// Add localized.<entry> for all entities having localized views in db
		if (_is_localized(d)) {
			_add_proxy4 (d,`localized.${each}`, x => pass2.push([x]))
			// if running on sqlite add additional localized.<locale>. views
		}
	}

	// Pass 2 - redirect associations/compositions in elements to localized.<locale> targets
	for (const [x,locale] of pass2) {
		let overlayed = null
		for (const each in x.elements) {
			const e = x.elements [each]
			if (e._target && _is_localized(e._target)) {
				const elements = overlayed ??= x.elements = {__proto__:x.elements}
				const target = locale ? `localized.${locale}.${e.target}` : `localized.${e.target}`
				const _target = m.definitions[target]
				if (_target) {
					elements[each] = Object.defineProperty ({__proto__:e,target},'_target',{value:_target})
					DEBUG && DEBUG ('overriding:', each, ':', elements[each], 'in', { entity: x.name })
				}
				else DEBUG && DEBUG ('NOT!! overriding:', each, ':', elements[each], 'in', { entity: x.name })
			}
		}
	}

	// done
	DEBUG && pass2.length && DEBUG ('Added localized views for sqlite to csn for', m.$sources)
	return Object.defineProperty (m, _been_here, {value:true})

	function _add_proxy4 (d, name, callback) {
		if (name in m.definitions) return DEBUG && DEBUG ('NOT overriding existing:', name)
		const x = {__proto__:d, name };   DEBUG && DEBUG ('adding proxy:', x)
		if (d['@cds.persistence.name']) x['@cds.persistence.name'] = `localized.${d['@cds.persistence.name']}`
		Object.defineProperty (m.definitions, name, {value:x,writable:true,configurable:true})
		if (callback) callback(x)
	}
}


const _is_localized = d => d.own('$localized') // as set by compiler in compile.for.odata

// feature-toggled exports
module.exports = { unfold_csn, unfold_ddl }
