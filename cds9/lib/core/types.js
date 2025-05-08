
const classes = exports.classes = Object.assign (
	require('./classes'),
	require('./entities'),
)

const protos = { $self: new classes.any } //> to support polymorphic self links like in: action foo( self: [many] $self, ...)
const types = exports.types = {__proto__:protos}
for (let k in classes) if (k !== 'LinkedDefinitions' && k !== 'mixins') {
	const t = protos[k] = classes[k].prototype, k2 = 'cds.'+k
	if (k < 'a') Object.defineProperty (t, 'name', {value:k})
	if (k < 'a') Object.defineProperty (types[k2] = t, '_type', {value:k2})
}


Object.assign (protos, types.deprecated = {
	'cds.DecimalFloat': Object.defineProperty (new classes.Decimal, '_type', { value:'cds.DecimalFloat' }),
	'cds.Float':        Object.defineProperty (new classes.number,  '_type', { value:'cds.Float' }),
	'cds.Integer16': 		new classes.Int16,
	'cds.Integer32': 		new classes.Int32,
	'cds.Integer64': 		new classes.Int64,
})

Object.assign (protos, types.hana = {
	'cds.hana.SMALLDECIMAL': new classes.Decimal,
	'cds.hana.SMALLINT': new classes.Int16,
	'cds.hana.TINYINT': new classes.UInt8,
	'cds.hana.REAL': new classes.Double,
	'cds.hana.CHAR': new classes.String,
	'cds.hana.CLOB': new classes.LargeString,
	'cds.hana.NCHAR': new classes.String,
	'cds.hana.BINARY': new classes.Binary,
	'cds.hana.ST_POINT': new classes.type,
	'cds.hana.ST_GEOMETRY': new classes.type,
})

protos.service.set('is_service',true)
protos.struct.set('is_struct',true)
protos.entity.set('is_entity',true)
protos.Association.set('isAssociation',true)
protos.Composition.set('isComposition',true)
protos.UUID.set('isUUID',true)
protos.UUID.set('length',36)


/**
 * Adds convenience functions which can be used like that:
 * ```js
 * var { Date, Time, DateTime } = cds.builtin.types
 * DateTime.now()   //> 2023-02-10T14:41:36.218Z
 * Date.now()       //> 2023-02-10T14:41:36.218Z
 * Time.now()       //> 14:43:18
 * Date.today()     //> 2023-02-10
 * ```
 */
function _add_convenience_functions(){
	Object.defineProperties (types.Date, {
		today: { value: ()=> (new Date).toISOString().slice(0,10) },
		now: { value: ()=> (new Date).toISOString() },
	})
	Object.defineProperties (types.Time, {
		now: { value: ()=> (new Date).toISOString().slice(11,19) },
	})
	Object.defineProperties (types.DateTime, {
		now: { value: ()=> (new Date).toISOString() },
	})
}; _add_convenience_functions()
