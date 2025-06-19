import { prefectures } from '../room-gacha/prefectures';
import qs from 'querystring';
import fs from 'fs/promises';
import path from 'path';

interface City {
	pref: string,
	city: string,
}

const fetchChakuwiki = async (title: string) => {
	const url = `https://chakuwiki.org/w/api.php?${qs.encode({
		format: 'json',
		action: 'query',
		prop: 'revisions',
		rvprop: 'content',
		titles: title,
	})}`;

	await new Promise((resolve) => setTimeout(resolve, 5000));
	const res = await fetch(url);
	const json = await res.json();

	const page: any = Object.values(json?.query?.pages)?.[0];
	const content = page?.revisions?.[0]?.['*'];
	if (!content) {
		console.error(`Failed to fetch ${title}`);
		return null;
	}

	return content;
};

(async () => {
	console.log('Fetching cities...');

	await new Promise((resolve) => setTimeout(resolve, 5000));
	const citiesRes = await fetch('https://code4fukui.github.io/localgovjp/localgovjp.json');
	const cities: City[] = await citiesRes.json();

	console.log('Scraping chakuwiki...');
	const cityTitleMap = new Map<string, string | null>();

	for (const prefecture of Object.keys(prefectures)) {
		const prefectureCities = cities.filter((city) => city.pref === prefecture);
		console.log(`${prefecture}: ${prefectureCities.length} cities`);

		const prefectureCitiesRegex = new RegExp(prefectureCities.map((city) => city.city).join('|'), 'g');

		const prefectureTitle = prefecture.replace(/[都府県]$/, '');
		const areas: string[] = [];
		console.log(`Fetching ${prefectureTitle}...`);
		const prefectureContent = await fetchChakuwiki(prefectureTitle);

		if (!prefectureContent) {
			continue;
		}

		let isArea = false;
		for (const line of prefectureContent.split('\n')) {
			if (line.startsWith('=') && line.includes('地域')) {
				isArea = true;
			} else if (isArea && line.startsWith('=')) {
				break;
			}

			if (isArea) {
				const links = line.matchAll(/\[\[([^|\]]+)(\|[^|\]]+)?\]\]/g);
				for (const link of links) {
					const area = link[1].replace(/#.+$/, '');
					console.log(`Found ${area}`);
					areas.push(area);
				}
			}
		}

		for (const area of areas) {
			console.log(`Fetching ${area}...`);
			await new Promise((resolve) => setTimeout(resolve, 5000));
			const areaContent = await fetchChakuwiki(area);
			if (!areaContent) {
				continue;
			}

			let cityName: string | null = null;
			let cityRumors: string[] = [];
			for (const line of areaContent.split('\n')) {
				if (line.startsWith('=')) {
					if (cityName !== null) {
						// console.log(`${cityName} rumors: ${cityRumors.join(' / ')}`);
					}

					if (line.includes('の噂')) {
						const cityNameMatches = line.match(prefectureCitiesRegex);
						if (cityNameMatches) {
							cityName = cityNameMatches[0];
							if (!cityName?.includes('区') && line.includes('区')) {
								cityName = null;
							} else {
								console.log(`Found ${cityName}`);
							}
						} else {
							cityName = null;
							console.error(`Invalid city: ${line}`);
						}
					} else {
						cityName = null;
					}

					cityRumors = [];
				} else {
					if (cityName !== null && line.startsWith('#')) {
						const indentLevel = line.match(/^#\**/)[0].length - 1;
						if (indentLevel === 0) {
							const cityFullname = `${prefecture}${cityName}`;
							const overwrittenArea = cityTitleMap.get(cityFullname);
							if (overwrittenArea !== undefined && overwrittenArea !== area) {
								console.error(`Overwritten area: ${cityFullname} (${overwrittenArea} -> ${area})`);
							} else {
								// console.log(`Set ${cityFullname} to ${area}`);
							}
							cityTitleMap.set(cityFullname, area);
							cityRumors.push(line.replace(/^#\**/, '').trim());
						}
					}
				}
			}
		}

		for (const city of prefectureCities) {
			const cityFullname = `${prefecture}${city.city}`;
			if (!cityTitleMap.has(cityFullname) && !city.city.includes('区')) {
				console.error(`Missing city: ${cityFullname}`);

				await new Promise((resolve) => setTimeout(resolve, 5000));
				const cityContent = await fetchChakuwiki(city.city);
				if (cityContent) {
					cityTitleMap.set(cityFullname, city.city);
				} else {
					cityTitleMap.set(cityFullname, null);
					console.error(`No content: ${cityFullname}`);
				}
			}
		}

		console.log('Saving progress...');
		const cityTitleMapJson = JSON.stringify(Object.fromEntries(cityTitleMap.entries()), null, '  ');
		await fs.writeFile(path.join(__dirname, '..', 'city-symbol', 'chakuwiki-title-map.json'), cityTitleMapJson);
	}

	console.log('Done');
})();
