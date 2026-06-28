import {vi} from 'vitest';

const openai = {
	chat: {
		completions: {
			create: vi.fn(),
		},
	},
	audio: {
		speech: {
			create: vi.fn(),
		},
	},
};

export default openai;

export const systemOpenAIClient = {
	chat: {
		completions: {
			create: vi.fn(),
		},
	},
	batches: {
		create: vi.fn(),
		retrieve: vi.fn(),
	},
};
