const {promisify} = require('util');
const {tokenize} = require('kuromojin');
const {katakanize, hiraganize} = require('japanese');
const fs = require('fs');
const path = require('path');
const qs = require('querystring');
const storage = require('node-persist');
const download = require('download');
const cloudinary = require('cloudinary');
const {escapeRegExp, uniq} = require('lodash');
const toJapanese = require('jp-num/toJapanese');

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const cities = (await promisify(fs.readFile)(
		path.resolve(__dirname, 'cities.csv')
	))
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([prefecture, name, reading, year]) => ({
			type: 'city',
			prefecture,
			name,
			reading,
			year: year === '' ? null : parseInt(year),
		}));

	const stations = (await promisify(fs.readFile)(
		path.resolve(__dirname, 'stations.csv')
	))
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([name, reading, description, year]) => ({
			type: 'station',
			name,
			reading,
			description,
			year,
		}));

	const readings = uniq([
		...cities.map(({reading}) => reading),
		...stations
			.map(({reading}) => reading)
			.filter((reading) => reading.length >= 4),
	]).sort((a, b) => b.length - a.length);

	const names = uniq([
		...cities.map(({name}) => name),
		...stations.map(({name}) => name).filter((reading) => reading.length >= 3),
	]).sort((a, b) => b.length - a.length);

	const yearSortedCities = cities
		.slice()
		.sort((a, b) => (a.year || 10000) - (b.year || 10000));

	const yearSortedStations = stations
		.slice()
		.sort((a, b) => (a.year ? 0 : 1) - (b.year ? 0 : 1));

	const citiesRegex = new RegExp(`(${[
		...names.map((name) => escapeRegExp(name)),
		...readings.map((reading) => escapeRegExp(reading)),
	].join('|')})$`);

	const citiesMap = new Map([
		...yearSortedStations.map((station) => [station.reading, station]),
		...yearSortedStations.map((station) => [station.name, station]),
		...yearSortedCities.map((city) => [city.reading, city]),
		...yearSortedCities.map((city) => [city.name, city]),
	]);

	await storage.init({
		dir: path.resolve(__dirname, '__cache__'),
	});

	const getReading = async (text) => {
		const tokens = await tokenize(text.replace(/[\d,]+/g, (number) => toJapanese(number.replace(/,/g, ''))));
		const reading = Array.from(
			katakanize(
				tokens
					.map(({reading: read, surface_form}) => read || surface_form || '')
					.join('')
			)
		)
			.join('')
			.replace(/\P{Script_Extensions=Katakana}/gu, '');
		return reading;
	};

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.text && message.text.startsWith('@tashibot')) {
			const reading = hiraganize(await getReading(message.text.replace(/^@tashibot/, '')));
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: reading,
				username: 'tashibot',
				icon_emoji: ':japan:',
			});
			return;
		}

		if (message.text.slice(-20).match(/^[\x00-\x7F]+$/)) {
			return;
		}

		if (message.username === 'tashibot') {
			return;
		}

		const text = message.text.slice(-20);
		const reading = await getReading(text);

		const matches =
			katakanize(text).match(citiesRegex) || reading.match(citiesRegex);

		if (matches === null) {
			return;
		}

		const city = citiesMap.get(matches[1]);
		const placeText =
			city.type === 'city'
				? `${city.name},${city.prefecture}`
				: `${city.name},${city.description}`;
		const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?${qs.encode(
			{
				center: placeText,
				zoom: city.type === 'city' ? 9 : 15,
				scale: 1,
				size: '600x300',
				maptype: 'roadmap',
				key: process.env.GOOGLEMAP_TOKEN,
				format: 'png',
				visual_refresh: true,
				markers: `size:mid|color:0xfb724a|label:|${placeText}`,
			}
		)}`;

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

			const descriptionText = (city.description || city.year) ? `(${[
				...city.description ? [city.description] : [],
				...city.year ? [city.year] : [],
			].join('、')})` : '';
			return `${city.name} ${descriptionText}`;
		})().trim();

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
