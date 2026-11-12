import axios from 'axios';
import {fetchGoogleSuggestions, normalize} from './util';

vi.mock('axios');

const mockedAxios = axios as unknown as {response: unknown};

describe('pocky/util', () => {
	describe('normalize', () => {
		it('normalizes NFKC, lowercases and trims', () => {
			expect(normalize(' ｉＰｈｏｎｅ　')).toBe('iphone');
		});

		it('converts wave dash to tilde', () => {
			expect(normalize('ポッキー〜')).toBe('ポッキー~');
		});
	});

	describe('fetchGoogleSuggestions', () => {
		it('returns suggestions from the response', async () => {
			mockedAxios.response = {data: ['ほげ', ['ほげ ふが', 'ほげ ぴよ']]};
			await expect(fetchGoogleSuggestions('ほげ')).resolves.toEqual(['ほげ ふが', 'ほげ ぴよ']);
		});

		it('returns an empty array for a malformed response', async () => {
			mockedAxios.response = {data: null};
			await expect(fetchGoogleSuggestions('ほげ')).resolves.toEqual([]);
		});
	});
});
