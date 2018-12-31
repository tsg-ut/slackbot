const axios = require('axios');
const {katakanize} = require('japanese');
const {last, unzip} = require('lodash');
const assert = require('assert');
const cheerio = require('cheerio');
const cheerioTableparser = require('cheerio-tableparser');
const iconv = require('iconv-lite');

(async () => {
	if (process.argv.includes('駅')) {
		const {data} = await axios.get('https://kujirahand.com/web-tools/resource/eki.tsv');
		const entries = data.toString().split('\r\n');

		const stations = entries.map((entry) => {
			const [name, ruby, description] = entry.split('\t');

			if (!ruby) {
				return null;
			}

			const prefecture = name.match(/\((.+?)\)/);

			return {
				name: name.replace(/\(.+?\)/g, '').trim(),
				ruby: katakanize(ruby.replace(/(えき|ていりゅうじょう)$/g, '')),
				description: prefecture ? `${description} ${prefecture[1]}` : description,
			};
		}).filter((station) => station);

		console.log(stations.map(({name, ruby, description}) => (
			[name, ruby, description].join(',')
		)).join('\n'));
	}

	if (process.argv.includes('廃駅')) {
		const {data} = await axios.get(
			'https://enpedia.rxy.jp/w/api.php',
			{
				params: {
					action: 'parse',
					page: '廃駅の一覧',
					prop: 'wikitext',
					format: 'json',
					formatversion: 2,
				},
				responseType: 'json',
			},
		);
		const text = data.parse.wikitext;

		let matches = null;
		const results = [];

		const tableRegex = /\|-\n\|\s*(.+?)\n\|\s*(.+?)\n\|\s*(.+?)\n/mg;
		while ((matches = tableRegex.exec(text))) {
			const [, name, reading, description] = matches;
			const normalizedReading = katakanize(reading).replace(/\P{Script_Extensions=Katakana}/gu, '');
			assert(normalizedReading.match(/(エキ|ジョウコウジョウ|テイシャジョウ|シンゴウジョウ|テイリュウジョウ|デンテイ)$/), normalizedReading);
			results.push({
				name: last(name.replace(/[[\]]/g, '').split('|')),
				reading: normalizedReading.replace(/(エキ|ジョウコウジョウ|テイシャジョウ|シンゴウジョウ|テイリュウジョウ|デンテイ)$/, ''),
				description: description
					.replace(/〈.+?〉/g, '')
					.replace(/\[\[.+?\|(.+?)\]\]/g, '$1')
					.replace(/[[\]]/g, '')
					.replace(/(-|<br).+$/, '')
					.trim(),
			});
		}

		const listRegex = /^\*\s*(.+?)（(.+?)(?:[・、](.+?))?）$/gm;
		while ((matches = listRegex.exec(text))) {
			const [, name, reading, description = ''] = matches;
			if (description.includes('新岐阜駅前駅')) {
				continue;
			}
			if (name.includes('ときめき駅')) {
				continue;
			}
			const normalizedReading = katakanize(reading.replace(/[〔〕]/g, '')).replace(/\P{Script_Extensions=Katakana}/gu, '');
			assert([
				'カミビホロ',
				'チュウオウノウシマエ',
				'ホッカイコウキマエ',
				'シミンカイカンマエ',
				'ヒガシカガシマ',
			].includes(normalizedReading) || normalizedReading.match(/(エキ|ジョウコウジョウ|テイシャジョウ|シンゴウジョウ|テイリュウジョウ|デンテイ|ジョウコウショ|テイリュウジョ)$/), matches);
			results.push({
				name: last(name.replace(/[[\]]/g, '').split('|')),
				reading: normalizedReading.replace(/(エキ|ジョウコウジョウ|テイシャジョウ|シンゴウジョウ|テイリュウジョウ|デンテイ|ジョウコウショ|テイリュウジョ)$/, ''),
				description: description
					.replace(/〈.+?〉/g, '')
					.replace(/\[\[.+?\|(.+?)\]\]/g, '$1')
					.replace(/[[\]]/g, '')
					.replace(/(-|<br).+$/, '')
					.trim(),
			});
		}
		console.log(results.map(({name, reading, description}) => ([name, reading, description, '廃駅'].join(','))).join('\n'));
	}

	if (process.argv.includes('改称')) {
		const {data} = await axios.get('http://www.desktoptetsu.com/ekimeikaisholist.htm', {responseType: 'arraybuffer'});
		const $ = cheerio.load(iconv.decode(data, 'sjis'));
		cheerioTableparser($);
		const table = unzip($('table').parsetable(true, true, true));
		for (const [date, descripton1, description2, name, reading] of table.slice(1)) {
			const year = date.split('/')[0];
			console.log([
				`${name.replace(/\(.+?\)/g, '')}駅`,
				katakanize(reading).replace(/\P{Script_Extensions=Katakana}/gu, ''),
				`${descripton1}${description2}`,
				`${year}年改称`,
			].join(','));
		}
	}
})();
