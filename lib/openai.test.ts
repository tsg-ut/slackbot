import {vi, describe, it, expect, beforeEach} from 'vitest';

vi.hoisted(() => {
	process.env.OPENAI_API_KEY = 'test-key';
});

import openai, {systemOpenAIClient} from './openai';
import OpenAI from 'openai';
import {OpenAIRealtimeWS} from 'openai/realtime/ws';

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
	});
});
