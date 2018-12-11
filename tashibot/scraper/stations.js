const axios = require('axios');
const {katakanize} = require('japanese');
const {sampleSize} = require('lodash');

(async () => {
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
})();