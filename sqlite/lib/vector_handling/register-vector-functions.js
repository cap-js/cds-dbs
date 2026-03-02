const { createSyncFn } = require('synckit');
const sqliteVec = require('sqlite-vec');

module.exports = function addSQLiteVectorSupport(dbc) {
	sqliteVec.load(dbc);
	dbc.function('TO_REAL_VECTOR', { deterministic: true }, (vector_representation) => {
		if (typeof vector_representation === 'string' && vector_representation.startsWith('[')) {
			return vector_representation;
		} else {
			return null;
		}
	});
	dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version) => {
		if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') {
			throw Error(`VECOTR_EMBEDDING called but text_type is ${text_type} and not DOCUMENT or QUERY`);
		}

		const syncFn = createSyncFn(require.resolve('./sqlite-vector-worker'), {
			tsRunner: 'node'
		});
		const result = syncFn(text, text_type, model_and_version);
		return JSON.stringify(result);
	});
	dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version, remote_source) => {
		if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') {
			throw Error(`VECOTR_EMBEDDING called for ${remote_source} but text_type is ${text_type} and not DOCUMENT or QUERY`);
		}
		const syncFn = createSyncFn(require.resolve('./sqlite-vector-worker'), {
			tsRunner: 'node'
		});
		const result = syncFn(text, text_type, model_and_version);
		return JSON.stringify(result);
	});
	dbc.function('CARDINALITY', { deterministic: true }, (vector) => {
		if (vector instanceof Uint8Array) {
			return vector.length / 4;
		} else if (vector instanceof Float32Array) {
			return vector.length;
		} else if (typeof vector === 'string' && vector.startsWith('[') && vector.endsWith(']')) {
			return vector.split(',')?.length;
		}
	});
}