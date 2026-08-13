import type {ChatCompletion} from 'openai/resources/chat';
import {vi} from 'vitest';
import openai from '../lib/openai.js';
import {getArbitraryAIAnswer} from './arbitraryAibot.js';

process.env.OPENAI_API_KEY = 'test-api-key';

vi.mock('../lib/openai');

const mockContent = (content: string) => ({
	choices: [{
		message: {content},
	}],
	model: 'gpt-4.1-mini',
} as ChatCompletion);

describe('tahoiya/arbitraryAibot', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('generates decoy answer candidates and returns the first one judged as incorrect', async () => {
		vi.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"candidateAnswers": ["さよならプラスティックワールド", "コンピューターシティ"]}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": false}'));

		const result = await getArbitraryAIAnswer('実在するPerfumeのシングルは?', 'ポリリズム');

		expect(result).toBe('さよならプラスティックワールド');
		expect(openai.chat.completions.create).toHaveBeenCalledTimes(2);
	});

	it('does not reveal the correct answer in the generation prompt, but instructs the model to avoid answers it believes are correct', async () => {
		vi.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"candidateAnswers": ["誤答"]}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": false}'));

		await getArbitraryAIAnswer('質問', 'SECRET_ANSWER_VALUE');

		const [[generationCall]] = vi.mocked(openai.chat.completions.create).mock.calls;
		const prompt = generationCall.messages[0].content as string;
		expect(prompt).not.toContain('SECRET_ANSWER_VALUE');
		expect(prompt).toContain('質問');
		expect(prompt).toContain('あなた自身が質問に対して正しいと考える内容を候補に含めてはいけません');
	});

	it('instructs the judge to also treat alternative correct answers as correct', async () => {
		vi.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"candidateAnswers": ["誤答"]}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": false}'));

		await getArbitraryAIAnswer('質問', '正解');

		const [, [judgeCall]] = vi.mocked(openai.chat.completions.create).mock.calls;
		const prompt = judgeCall.messages[0].content as string;
		expect(prompt).toContain('別解');
	});

	it('judges candidates in order and skips ones judged as correct within the same attempt', async () => {
		vi.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"candidateAnswers": ["候補1", "候補2", "候補3"]}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": true}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": false}'));

		const result = await getArbitraryAIAnswer('質問', '正解');

		expect(result).toBe('候補2');
		expect(openai.chat.completions.create).toHaveBeenCalledTimes(3);
	});

	it('gives up and returns null (without regenerating) when every candidate in the single attempt is judged as correct', async () => {
		vi.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"candidateAnswers": ["誤答1", "誤答2"]}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": true}'))
			.mockResolvedValueOnce(mockContent('{"isCorrect": true}'));

		const result = await getArbitraryAIAnswer('質問', '正解');

		expect(result).toBeNull();
		expect(openai.chat.completions.create).toHaveBeenCalledTimes(3);
	});

	it('returns null and does not throw when the generation call fails', async () => {
		vi.mocked(openai.chat.completions.create).mockRejectedValueOnce(new Error('API error'));

		const result = await getArbitraryAIAnswer('質問', '正解');

		expect(result).toBeNull();
	});

	it('returns null and does not throw when the judge call fails', async () => {
		vi.mocked(openai.chat.completions.create)
			.mockResolvedValueOnce(mockContent('{"candidateAnswers": ["誤答"]}'))
			.mockRejectedValueOnce(new Error('API error'));

		const result = await getArbitraryAIAnswer('質問', '正解');

		expect(result).toBeNull();
	});

	it('returns null when the response does not contain valid JSON', async () => {
		vi.mocked(openai.chat.completions.create).mockResolvedValueOnce(mockContent('申し訳ありませんが回答できません'));

		const result = await getArbitraryAIAnswer('質問', '正解');

		expect(result).toBeNull();
	});
});
