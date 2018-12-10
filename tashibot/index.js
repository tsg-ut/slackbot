const {promisify} = require('util');
const {tokenize} = require('kuromojin');
const {katakanize} = require('japanese');
const fs = require('fs');
const path = require('path');
const qs = require('querystring');
const storage = require('node-persist');
const download = require('download');
const cloudinary = require('cloudinary');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const citiesData = await promisify(fs.readFile)(path.resolve(__dirname, 'cities.csv'));
	const cities = citiesData
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([prefecture, name, reading, year]) => ({prefecture, name, reading, year: year === '' ? null : parseInt(year)}))
		.sort((a, b) => b.reading.length - a.reading.length);

	const yearSortedCities = cities.slice().sort((a, b) => (a.year || 10000) - (b.year || 10000));

	const citiesRegex = new RegExp(`(${cities.map(({name}) => name).join('|')}|${cities.map(({reading}) => reading).join('|')})$`);
	const citiesMap = new Map([...yearSortedCities.map((city) => [city.reading, city]), ...yearSortedCities.map((city) => [city.name, city])]);

	await storage.init({
		dir: path.resolve(__dirname, '__cache__'),
	});

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (
			message.text.length > 100 ||
			!message.text.match(
				/(し|シ|市|死|氏|師|歯|区|ク|く|町|まち|マチ|ちょう|チョウ|村|むら|ムラ|そん|ソン|都|道|府|県|と|ト|どう|ドウ|ふ|フ|けん|ケン)$/
			)
		) {
			return;
		}

		if (message.username === 'tashibot') {
			return;
		}

		const {text} = message;
		const tokens = await tokenize(text);
		const reading = katakanize(tokens.map(({reading, surface_form}) => reading || surface_form || '').join(''));

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

		let cloudinaryData = await storage.getItem(imageUrl);

		if (!cloudinaryData) {
			const imageData = await download(imageUrl);
			cloudinaryData = await new Promise((resolve, reject) => {
				cloudinary.v2.uploader.upload_stream({resource_type: 'image'}, (error, data) => {
					if (error) {
						reject(error);
					} else {
						resolve(data);
					}
				}).end(imageData);
			});
			await storage.setItem(imageUrl, cloudinaryData);
		}

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: `${city.prefecture}${city.name} ${city.year === null ? '' : `(${city.year}年消滅)`}`,
			username: 'tashibot',
			icon_emoji: ':japan:',
			attachments: [
				{
					image_url: cloudinaryData.secure_url,
					fallback: `${city.prefecture}${city.name}`,
				},
			],
		});
	});
};
