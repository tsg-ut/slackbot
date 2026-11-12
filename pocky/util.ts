import axios from 'axios';

export async function fetchGoogleSuggestions(text: string): Promise<string[]> {
	const response = await axios({
		url: 'https://www.google.com/complete/search',
		params: {
			client: 'firefox',
			hl: 'ja',
			q: text,
		},
		headers: {
			'User-Agent': 'Mozilla/5.0',
		},
		method: 'GET',
		timeout: 5000,
	});
	const suggestions: unknown = response.data?.[1];
	if (!Array.isArray(suggestions)) {
		return [];
	}
	return suggestions.filter((suggestion): suggestion is string => typeof suggestion === 'string');
}

export function normalize(text: string): string {
	return text
		.normalize('NFKC')
		.replaceAll('️', '')
		.replaceAll('‍', ' ')
		.replaceAll('〜', '~')
		.toLowerCase()
		.trim();
}
