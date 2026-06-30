/* eslint-env jest */

import type {ChatCompletion} from 'openai/resources/chat';
import openai from '../lib/openai';
import {getArbitraryAIAnswer} from './arbitraryAibot';

process.env.OPENAI_API_KEY = 'test-api-key';

jest.mock('../lib/openai', () => ({
	__esModule: true,
	default: {
		chat: {
			completions: {
				create: jest.fn(),
			},
		},
	},
}));

const mockContent = (content: string) => ({
	choices: [{
		message: {content},
	}],
	model: 'gpt-4.1-mini',
} as ChatCompletion);

describe('tahoiya/arbitraryAibot', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('generates a decoy answer and returns it when judged as incorrect', async () => {
		jest.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "さよならプラスティックワールド"}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": false}'));

		const result = await getArbitraryAIAnswer('実在するPerfumeのシングルは?', 'ポリリズム', false);

		expect(result).toBe('さよならプラスティックワールド');
		expect(openai.chat.completions.create).toHaveBeenCalledTimes(2);
	});

	it('always instructs the model not to answer correctly, regardless of isMimicryAllowed', async () => {
		jest.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "誤答"}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": false}'));

		await getArbitraryAIAnswer('質問', '正解', true);

		const [[generationCall]] = jest.mocked(openai.chat.completions.create).mock.calls;
		const prompt = generationCall.messages[0].content as string;
		expect(prompt).toContain('質問に対して正解となるような回答をしてはいけません');
	});

	it('regenerates up to 2 times when judged as correct, and returns the answer once judged incorrect', async () => {
		jest.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "誤答1"}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": true}'))
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "誤答2"}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": false}'));

		const result = await getArbitraryAIAnswer('質問', '正解', false);

		expect(result).toBe('誤答2');
		expect(openai.chat.completions.create).toHaveBeenCalledTimes(4);
	});

	it('gives up and returns null after being judged correct 3 times in a row', async () => {
		jest.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "誤答1"}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": true}'))
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "誤答2"}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": true}'))
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "誤答3"}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": true}'));

		const result = await getArbitraryAIAnswer('質問', '正解', false);

		expect(result).toBeNull();
		expect(openai.chat.completions.create).toHaveBeenCalledTimes(6);
	});

	it('returns null and does not throw when the generation call fails', async () => {
		jest.mocked(openai.chat.completions.create).mockRejectedValueOnce(new Error('API error'));

		const result = await getArbitraryAIAnswer('質問', '正解', false);

		expect(result).toBeNull();
	});

	it('returns null and does not throw when the judge call fails', async () => {
		jest.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"decoyAnswer": "誤答"}'))
			.mockRejectedValueOnce(new Error('API error'));

		const result = await getArbitraryAIAnswer('質問', '正解', false);

		expect(result).toBeNull();
	});

	it('returns null when the response does not contain valid JSON', async () => {
		jest.mocked(openai.chat.completions.create).mockResolvedValueOnce(mockContent('申し訳ありませんが回答できません'));

		const result = await getArbitraryAIAnswer('質問', '正解', false);

		expect(result).toBeNull();
	});
});
