import {vi, describe, it, expect, beforeEach} from 'vitest';

vi.hoisted(() => {
	process.env.OPENAI_API_KEY = 'test-key';
});

import openai, {systemOpenAIClient} from './openai';
import OpenAI from 'openai';
import {OpenAIRealtimeWS} from 'openai/realtime/ws';

vi.mock('openai/realtime/ws', async () => {
	const {EventEmitter} = await import('node:events');
	class FakeRealtimeWS extends EventEmitter {
		sent: unknown[] = [];
		send = vi.fn((event: unknown) => {
			this.sent.push(event);
		});
		close = vi.fn();
	}
	return {
		OpenAIRealtimeWS: {
			create: vi.fn(async () => new FakeRealtimeWS()),
		},
	};
});

vi.mock('./firestore', () => ({
	__esModule: true,
	default: null,
}));

vi.mock('./slack', () => ({
	webClient: {
		chat: {
			postMessage: vi.fn(),
		},
	},
}));

vi.mock('./discord', () => ({
	__esModule: true,
	default: {
		channels: {
			cache: {
				get: vi.fn(),
			},
		},
	},
}));

describe('lib/openai', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('chat.completions.create', () => {
		it('throws an error for deprecated models', async () => {
			const deprecatedModels = [
				'gpt-4o-mini',
				'gpt-4.1-mini',
				'gpt-5-mini',
				'gpt-5.4-nano',
				'o4-mini',
			];

			for (const model of deprecatedModels) {
				await expect(
					openai.chat.completions.create({
						model: model as any,
						messages: [{role: 'user', content: 'hello'}],
					}),
				).rejects.toThrow(/Unsupported model for chat\.completions\.create/);
			}
		});

		it('succeeds for supported model gpt-6-luna', async () => {
			vi.spyOn(systemOpenAIClient.chat.completions, 'create').mockResolvedValueOnce({
				id: 'chatcmpl-1',
				created: 12345,
				model: 'gpt-6-luna',
				object: 'chat.completion',
				choices: [{
					finish_reason: 'stop',
					index: 0,
					logprobs: null,
					message: {
						role: 'assistant',
						content: 'response',
						refusal: null,
					},
				}],
				usage: {
					prompt_tokens: 1000,
					completion_tokens: 500,
					total_tokens: 1500,
				},
			});

			const response = await openai.chat.completions.create({
				model: 'gpt-6-luna',
				messages: [{role: 'user', content: 'hello'}],
			});

			expect(response.choices[0].message.content).toBe('response');
		});

		it('succeeds for supported model gpt-6.1-terra', async () => {
			vi.spyOn(systemOpenAIClient.chat.completions, 'create').mockResolvedValueOnce({
				id: 'chatcmpl-2',
				created: 12345,
				model: 'gpt-6.1-terra',
				object: 'chat.completion',
				choices: [{
					finish_reason: 'stop',
					index: 0,
					logprobs: null,
					message: {
						role: 'assistant',
						content: 'terra response',
						refusal: null,
					},
				}],
				usage: {
					prompt_tokens: 2000,
					completion_tokens: 1000,
					total_tokens: 3000,
					completion_tokens_details: {
						reasoning_tokens: 500,
					},
				},
			});

			const response = await openai.chat.completions.create({
				model: 'gpt-6.1-terra',
				messages: [{role: 'user', content: 'hello'}],
			});

			expect(response.choices[0].message.content).toBe('terra response');
		});
	});

	describe('audio.speech.create', () => {
		it('throws deprecation error when called', async () => {
			await expect(
				openai.audio.speech.create({
					model: 'tts-1',
					voice: 'alloy',
					input: 'hello',
				}),
			).rejects.toThrow(/deprecated for audio\.speech\.create/);
		});
	});

	describe('realtime.speech.create', () => {
		it('throws error for unsupported realtime models', async () => {
			await expect(
				openai.realtime.speech.create({
					model: 'invalid-model',
					voice: 'alloy',
					input: 'hello',
				}),
			).rejects.toThrow(/Unsupported model for realtime\.speech\.create/);
		});

		it('requests verbatim reading instead of a conversational reply', async () => {
			const promise = openai.realtime.speech.create({
				voice: 'alloy',
				input: 'こんにちは',
				instructions: 'Tone: calm',
			});

			await vi.waitFor(() => {
				expect(OpenAIRealtimeWS.create).toHaveBeenCalled();
			});
			const rt = await vi.mocked(OpenAIRealtimeWS.create).mock.results.at(-1)!.value;
			rt.emit('session.created', {type: 'session.created'});
			rt.emit('response.output_audio.delta', {delta: Buffer.from([1, 2, 3, 4]).toString('base64')});
			rt.emit('response.done', {response: {status: 'completed', usage: {}}});

			const {data} = await promise;
			expect(data.subarray(0, 4).toString()).toBe('RIFF');
			expect(data.length).toBe(44 + 4);

			const [sessionUpdate, responseCreate] = rt.sent;
			expect(sessionUpdate.session.instructions).toMatch(/text-to-speech engine/);
			expect(sessionUpdate.session.instructions).toContain('Tone: calm');
			expect(responseCreate.type).toBe('response.create');
			expect(responseCreate.response.conversation).toBe('none');
			expect(responseCreate.response.input[0].content[0].text).toBe('<text>こんにちは</text>');
		});
	});
});
