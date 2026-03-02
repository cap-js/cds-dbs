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
		const result = syncCreateVector(text, text_type, model_and_version);
		return JSON.stringify(result);
	});
	dbc.function('VECTOR_EMBEDDING', { deterministic: true }, (text, text_type, model_and_version, remote_source) => {
		if (text_type !== 'DOCUMENT' && text_type !== 'QUERY') {
			throw Error(`VECOTR_EMBEDDING called for ${remote_source} but text_type is ${text_type} and not DOCUMENT or QUERY`);
		}
		const result = syncCreateVector(text, text_type, model_and_version);
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

const {MessageChannel, Worker, receiveMessageOnPort} = require("node:worker_threads");
const {pathToFileURL} = require("url");
let sharedBuffer = new SharedArrayBuffer(4);
let sharedBufferView = new Int32Array(sharedBuffer, 0, 1);

const syncCreateVector = startWorker(require.resolve('./sqlite-vector-worker'));

function startWorker(workerPath) {
	const { port1: mainPort, port2: workerPort } = new MessageChannel();
	const workerPathUrl = pathToFileURL(workerPath);
	const worker = new Worker(workerPathUrl, {
		workerData: {
			sharedBufferView,
			workerPort,
		},
		transferList: [workerPort],
	});
	let nextID = 0;
	const receiveMessage = (port, expectedId, timeout) => {
		const start = Date.now()
		const status = Atomics.wait(sharedBufferView, 0, 0, timeout);
		Atomics.store(sharedBufferView, 0, 0);
		if (status === 'ok' || status === 'not-equal') {
			const abortMsg = {
				id: expectedId,
				cmd: "abort"
			};
			port.postMessage(abortMsg);
		}
		const result = receiveMessageOnPort(mainPort);
		const msg = result?.message
		if (msg?.id == null || msg.id < expectedId) {
			const waitingTime = Date.now() - start
			return receiveMessage(port, expectedId, timeout ? timeout - waitingTime : undefined);
		}
		return msg;
	};
	const syncFn = (...args) => {
		const id = nextID++;
		worker.postMessage({
			id,
			args
		});
		const { result, error } = receiveMessage(mainPort, id);
		if (error) throw error;
		return result;
	};
	worker.unref();
	return syncFn;
}