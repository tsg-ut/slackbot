const {promisify} = require('util');
const {tokenize} = require('kuromojin');
const fs = require('fs');
const path = require('path');
const qs = require('querystring');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const citiesData = await promisify(fs.readFile)(path.resolve(__dirname, 'cities.csv'));
	const cities = citiesData
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([prefecture, name, reading]) => ({prefecture, name, reading}))
		.sort((a, b) => b.reading.length - a.reading.length);

	const citiesRegex = new RegExp(`(${cities.map(({name}) => name).join('|')}|${cities.map(({reading}) => reading).join('|')})$`);
	const citiesMap = new Map([...cities.map((city) => [city.reading, city]), ...cities.map((city) => [city.name, city])]);

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.text.length > 100 || !message.text.match(/(し|市|死|氏|町|まち|ちょう|村|むら|そん|都|道|府|県|と|どう|ふ|けん)$/)) {
			return;
		}

		if (message.username === 'tashibot') {
			return;
		}

		const {text} = message;
		const tokens = await tokenize(text);
		const reading = tokens.map(({reading}) => reading).join('');

		const matches = text.match(citiesRegex) || reading.match(citiesRegex);

		if (matches === null) {
			return;
		}

		const city = citiesMap.get(matches[1]);
		const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?${qs.encode({
			center: `${city.name},${city.prefecture}`,
			zoom: 9,
			scale: 1,
			size: '600x300',
			maptype: 'roadmap',
			key: process.env.GOOGLEMAP_TOKEN,
			format: 'png',
			visual_refresh: true,
			markers: `size:mid|color:0xfb724a|label:|${city.name},${city.prefecture}`,
		})}`;

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: `${city.prefecture}${city.name}`,
			username: 'tashibot',
			icon_emoji: ':japan:',
			attachments: [
				{
					image_url: imageUrl,
					fallback: `${city.prefecture}${city.name}`,
				},
			],
		});
	});
};
