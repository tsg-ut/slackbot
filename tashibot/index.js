const {promisify} = require('util');
const {tokenize} = require('kuromojin');
const {katakanize} = require('japanese');
const fs = require('fs');
const path = require('path');
const qs = require('querystring');
const storage = require('node-persist');
const download = require('download');
const cloudinary = require('cloudinary');
const {escapeRegExp} = require('lodash');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const cities = (await promisify(fs.readFile)(path.resolve(__dirname, 'cities.csv')))
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([prefecture, name, reading, year]) => ({type: 'city', prefecture, name, reading, year: year === '' ? null : parseInt(year)}));

	const stations = (await promisify(fs.readFile)(path.resolve(__dirname, 'stations.csv')))
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([name, reading, description]) => ({type: 'station', name, reading, description}));

	const readings = [
		...cities.map(({reading}) => reading),
		...stations.map(({reading}) => reading).filter((reading) => reading.length >= 4),
	].sort((a, b) => b.length - a.length);

	const names = [
		...cities.map(({name}) => name),
		...stations.map(({name}) => name).filter((reading) => reading.length >= 3),
	].sort((a, b) => b.length - a.length);

	const yearSortedCities = cities.slice().sort((a, b) => (a.year || 10000) - (b.year || 10000));

	const citiesRegex = new RegExp(`(${
		names.map((name) => escapeRegExp(name)).join('|')
	}|${
		readings.map((reading) => escapeRegExp(reading)).join('|')
	})$`);

	const citiesMap = new Map([
		...stations.map((station) => [station.reading, station]),
		...stations.map((station) => [station.name, station]),
		...yearSortedCities.map((city) => [city.reading, city]),
		...yearSortedCities.map((city) => [city.name, city]),
	]);

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

		if (message.text.slice(-20).match(/^[\x00-\x7F]+$/)) {
			return;
		}

		if (message.username === 'tashibot') {
			return;
		}

		const text = message.text.slice(-20);
		const tokens = await tokenize(text);
		const reading = Array.from(katakanize(tokens.map(({reading, surface_form}) => reading || surface_form || '').join(''))).filter((c) => c.match(/^\p{Script_Extensions=Katakana}+$/u)).join('');

		const matches = katakanize(text).match(citiesRegex) || reading.match(citiesRegex);

		if (matches === null) {
			return;
		}

		const city = citiesMap.get(matches[1]);
		const placeText = city.type === 'city' ? `${city.name},${city.prefecture}` : `${city.name},${city.description}`;
		const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?${qs.encode({
			center: placeText,
			zoom: city.type === 'city' ? 9 : 15,
			scale: 1,
			size: '600x300',
			maptype: 'roadmap',
			key: process.env.GOOGLEMAP_TOKEN,
			format: 'png',
			visual_refresh: true,
			markers: `size:mid|color:0xfb724a|label:|${placeText}`,
		})}`;

		let cloudinaryData = await storage.getItem(imageUrl);

		if (!cloudinaryData) {
			const imageData = await download(imageUrl);
			cloudinaryData = await new Promise((resolve, reject) => {
				cloudinary.v2.uploader
					.upload_stream({resource_type: 'image'}, (error, data) => {
						if (error) {
							reject(error);
						} else {
							resolve(data);
						}
					})
					.end(imageData);
			});
			await storage.setItem(imageUrl, cloudinaryData);
		}

		const response = (() => {
			if (city.type === 'city') {
				const yearText = city.year === null ? '' : `(${city.year}年消滅)`;
				return `${city.prefecture}${city.name} ${yearText}`;
			}

			const descriptionText = city.description ? `(${city.description})` : '';
			return `${city.name} ${descriptionText}`;
		})();

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: response,
			username: 'tashibot',
			icon_emoji: ':japan:',
			attachments: [
				{
					image_url: cloudinaryData.secure_url,
					fallback: response,
				},
			],
		});
	});
};
