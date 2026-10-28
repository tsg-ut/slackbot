import {vi, describe, it, expect, beforeEach} from 'vitest';
import {Voice, speechConfig, getSpeech, getDefaultVoiceMeta} from './index';
import openai from '../../lib/openai';

vi.mock('../../lib/openai', () => ({
	__esModule: true,
	default: {
		realtime: {
			speech: {
				create: vi.fn(),
			},
		},
		audio: {
			speech: {
				create: vi.fn(),
			},
		},
		chat: {
			completions: {
				create: vi.fn(),
			},
		},
	},
}));

describe('discord/speeches', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('defines new Realtime API voices BL through BS with gpt-realtime-2.1-mini', () => {
		const newVoices = [
			{voice: Voice.BL, name: 'alloy'},
			{voice: Voice.BM, name: 'ash'},
			{voice: Voice.BN, name: 'ballad'},
			{voice: Voice.BO, name: 'coral'},
			{voice: Voice.BP, name: 'echo'},
			{voice: Voice.BQ, name: 'sage'},
			{voice: Voice.BR, name: 'shimmer'},
			{voice: Voice.BS, name: 'verse'},
		];

		for (const {voice, name} of newVoices) {
			const config = speechConfig.get(voice);
			expect(config).toBeDefined();
			expect(config?.provider).toBe('openai');
			expect(config?.model).toBe('gpt-realtime-2.1-mini');
			expect(config?.name).toBe(name);
			expect(config?.deprecated).toBeFalsy();
		}
	});

	it('marks deprecated OpenAI voices as deprecated', () => {
		const deprecatedVoices = [
			Voice.AL, Voice.AM, Voice.AN, Voice.AO, Voice.AP, Voice.AQ,
			Voice.AY, Voice.AZ, Voice.BA,
			Voice.BB, Voice.BC, Voice.BD, Voice.BE, Voice.BF, Voice.BG, Voice.BH, Voice.BI, Voice.BJ, Voice.BK,
		];

		for (const voice of deprecatedVoices) {
			const config = speechConfig.get(voice);
			expect(config).toBeDefined();
			expect(config?.deprecated).toBe(true);
		}
	});

	it('throws an error when a deprecated voice is passed to getSpeech', () => {
		const meta = getDefaultVoiceMeta();
		expect(() => getSpeech('テストです', Voice.AL, meta)).toThrow(
			/ボイス AL は廃止されました/,
		);
		expect(() => getSpeech('テストです', Voice.BB, meta)).toThrow(
			/ボイス BB は廃止されました/,
		);
	});

	it('calls realtime.speech.create when a valid new OpenAI voice is used', async () => {
		const dummyBuffer = Buffer.from('test-audio-data');
		vi.mocked(openai.realtime.speech.create).mockResolvedValue({
			data: dummyBuffer,
		});

		const meta = getDefaultVoiceMeta();
		const result = await getSpeech('テストです', Voice.BL, meta);

		expect(openai.realtime.speech.create).toHaveBeenCalledWith({
			model: 'gpt-realtime-2.1-mini',
			voice: 'alloy',
			input: 'テストです',
			instructions: expect.any(String),
		});
		expect(result.data).toEqual(dummyBuffer);
	});
});
