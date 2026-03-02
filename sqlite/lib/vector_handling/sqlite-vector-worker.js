const { runAsWorker } = require('synckit');
const cds = require('@sap/cds');
const { embeddings } = require('./semantic-search');

const hasAIOrchestration = () => {
	try {
		require('@sap-ai-sdk/orchestration');
		return true;
	} catch {
		return false;
	}
};

runAsWorker(async (text, text_type, model_and_version) => {
	if (model_and_version.startsWith('SAP_GXY') || model_and_version.startsWith('SAP_NEB') || !cds.env.requires.AICore.credentials) {
		if (text) {
			const res = await embeddings([text]);
			return Array.from(res.embeddings[0].embedding);
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
});

function getEmptyVector(dimensions) {
	const result = [];
	for (let i = 0; i < dimensions; i++) {
		result.push(0);
	}
	return result;
}
