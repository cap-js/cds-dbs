const cds = require('@sap/cds');
const { embedding } = require('./semantic-search');

const hasAIOrchestration = () => {
	try {
		require('@sap-ai-sdk/orchestration');
		return true;
	} catch {
		return false;
	}
};

const generateVector = async (text, text_type, model_and_version) => {
	if (model_and_version.startsWith('SAP_GXY') || model_and_version.startsWith('SAP_NEB') || !cds.env.requires.AICore.credentials) {
		if (text) {
			const res = await embedding(text);
			return Array.from(res.embedding);
		}
		return getEmptyVector(384);
	} else if (hasAIOrchestration()) {
		const { OrchestrationEmbeddingClient } = require('@sap-ai-sdk/orchestration');
		model_and_version = model_and_version.split('"');
		let splitModel = model_and_version[0].split('.');
		model_and_version.splice(0, 1);
		model_and_version = [...splitModel, ...model_and_version].filter((ele) => ele.length);
		const embeddingClient = new OrchestrationEmbeddingClient(
			{
				embeddings: {
					model: {
						name: model_and_version[0],
						version: model_and_version[1] ?? 'latest'
					}
				}
			},
			{ resourceGroup: 'default' }
		);
		const response = await embeddingClient.embed({
			input: text,
			type: text_type.toLowerCase()
		});
		const data = response.getEmbeddings();
		return data[0]?.embedding;
	} else {
		// Random number when hugging face nor AI SDK is available - to have mock data
		const result = [];
		for (let i = 0; i < 768; i++) {
			result.push(Math.random());
		}
		return result;
	}
};

function getEmptyVector(dimensions) {
	const result = [];
	for (let i = 0; i < dimensions; i++) {
		result.push(0);
	}
	return result;
}


const { workerData, parentPort } = require("node:worker_threads");
if (parentPort) {
	const { workerPort, sharedBufferView } = workerData;
	parentPort.on("message", ({ id, args }) => {
		(async () => {
			let isAborted = false;
			workerPort.on("message", (msg) => {
				if (msg.id === id && msg.cmd === "abort") isAborted = true;
			});
			let msg;
			try {
				msg = {
					id,
					result: await generateVector(...args)
				};
			} catch (error) {
				msg = { id, error };
			}
			workerPort.off("message", (msg) => {
				if (msg.id === id && msg.cmd === "abort") isAborted = true;
			});
			if (isAborted) return;
			workerPort.postMessage(msg);
			Atomics.add(sharedBufferView, 0, 1);
			Atomics.notify(sharedBufferView, 0);
		})();
	});
}