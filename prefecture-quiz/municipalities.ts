import logger from '../lib/logger';

const log = logger.child({bot: 'prefecture-quiz/municipalities'});

const CSV_URL = 'https://raw.githubusercontent.com/kebhr/localgovlistjp/refs/heads/master/localgov_utf8_lf.csv';

let municipalitiesCache: Record<string, string[]> | null = null;
let fetchPromise: Promise<Record<string, string[]>> | null = null;

export async function getMunicipalitiesMap(): Promise<Record<string, string[]>> {
	if (municipalitiesCache) return municipalitiesCache;
	if (fetchPromise) return fetchPromise;

	fetchPromise = (async () => {
		log.info('Fetching municipality list from CSV...');
		const response = await fetch(CSV_URL);
		const text = await response.text();
		const map: Record<string, string[]> = {};

		for (const line of text.split('\n')) {
			const cols = line.trim().split(',');
			if (cols.length < 3) continue;
			const pref = cols[0];
			const muni = cols[2];
			// Skip header rows or malformed rows
			if (!pref || !muni || !/[都道府県]$/.test(pref)) continue;
			if (!map[pref]) map[pref] = [];
			map[pref].push(muni);
		}

		log.info(`Loaded municipalities for ${Object.keys(map).length} prefectures`);
		municipalitiesCache = map;
		return map;
	})();

	return fetchPromise;
}
