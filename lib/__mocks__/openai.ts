const openai = {
	chat: {
		completions: {
			create: jest.fn(),
		},
	},
	audio: {
		speech: {
			create: jest.fn(),
		},
	},
};

export default openai;

export const systemOpenAIClient = {
	chat: {
		completions: {
			create: jest.fn(),
		},
	},
	batches: {
		create: jest.fn(),
		retrieve: jest.fn(),
	},
};
