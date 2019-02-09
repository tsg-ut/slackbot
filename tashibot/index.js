const {promisify} = require('util');
const {katakanize, hiraganize} = require('japanese');
const fs = require('fs');
const path = require('path');
const qs = require('querystring');
const nodePersist = require('node-persist');
const download = require('download');
const cloudinary = require('cloudinary');
const {escapeRegExp, uniq} = require('lodash');
const Queue = require('p-queue');
const getReading = require('../lib/getReading.js');

const histories = [];
const queue = new Queue({concurrency: 1});
const transaction = (func) => queue.add(func);

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const cities = (await promisify(fs.readFile)(path.resolve(__dirname, 'cities.csv')))
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

	const stations = (await promisify(fs.readFile)(path.resolve(__dirname, 'stations.csv')))
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
		...stations.map(({reading}) => reading).filter((reading) => reading.length >= 4),
	]).sort((a, b) => b.length - a.length);

	const uniqueCitiesCount = new Set(cities.map(({reading}) => reading)).size;
	const uniqueStationsCount = new Set(stations.map(({reading}) => reading).filter((reading) => reading.length >= 4)).size;

	const names = uniq([...cities.map(({name}) => name), ...stations.map(({name}) => name).filter((reading) => reading.length >= 3)]).sort(
		(a, b) => b.length - a.length
	);

	const yearSortedCities = cities.slice().sort((a, b) => (a.year || 10000) - (b.year || 10000));

	const yearSortedStations = stations.slice().sort((a, b) => (a.year ? 0 : 1) - (b.year ? 0 : 1));

	const citiesRegex = new RegExp(
		`(${[...names.map((name) => escapeRegExp(name)), ...readings.map((reading) => escapeRegExp(reading))].join('|')})$`
	);

	const citiesMap = new Map([
		...yearSortedStations.map((station) => [station.reading, station]),
		...yearSortedStations.map((station) => [station.name, station]),
		...yearSortedCities.map((city) => [city.reading, city]),
		...yearSortedCities.map((city) => [city.name, city]),
	]);

	const storage = nodePersist.create({
		dir: path.resolve(__dirname, '__cache__'),
	});
	await storage.init();

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (!message.text) {
			return;
		}

		if (message.text && message.text.startsWith('@tashibot')) {
			const reading = hiraganize(
				await getReading(message.text.replace(/^@tashibot/, ''))
			);
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

		const reading = await getReading(message.text.slice(-20));

		const matches = katakanize(message.text).match(citiesRegex) || reading.match(citiesRegex);

		if (matches === null) {
			return;
		}

		const city = citiesMap.get(matches[1]);

		if (histories.filter((history) => history.cityName === city.name && history.date >= Date.now() - 10 * 1000).length >= 3) {
			await slack.reactions.add({name: 'bomb', channel: message.channel, timestamp: message.ts});
			return;
		}

		const isRepetitive = histories.find((history) => history.cityName === city.name && history.date >= Date.now() - 10 * 6000 * 1000) !== undefined;

		histories.push({cityName: city.name, date: Date.now()});
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

		// append area image if station
		const imageUrls =
			city.type === 'city'
				? [imageUrl]
				: [
					imageUrl,
					`https://maps.googleapis.com/maps/api/staticmap?${qs.encode({
						center: '38.5,137.0',
						zoom: 4,
						scale: 1,
						size: '250x250',
						maptype: 'roadmap',
						key: process.env.GOOGLEMAP_TOKEN,
						format: 'png',
						visual_refresh: true,
						markers: `size:tiny|color:0xfb724a|label:|${placeText}`,
					})}`,
				  ];

		const cloudinaryData = await Promise.all(
			imageUrls.map(async (url) => {
				const cacheData = await storage.getItem(url);
				if (cacheData) {
					return cacheData;
				}

				const imageData = await download(url);
				const cloudinaryDatum = await new Promise((resolve, reject) => {
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
				await storage.setItem(url, cloudinaryDatum);
				return cloudinaryDatum;
			})
		);

		const response = (() => {
			if (city.type === 'city') {
				const yearText = city.year === null ? '' : `(${city.year}年消滅)`;
				return `${city.prefecture}${city.name} ${yearText}`;
			}

			const descriptionText =
				city.description || city.year
					? `(${[...(city.description ? [city.description] : []), ...(city.year ? [city.year] : [])].join('、')})`
					: '';
			return `${city.name} ${descriptionText}`;
		})().trim();

		let isNew = false;
		let achievementsCount = 0;

		await transaction(async () => {
			if (!matches[1].match(/^[\p{Script=Katakana}ー]+$/u)) {
				return;
			}
			const achievements = (await storage.getItem('achievements')) || {stations: [], cities: []};
			if (city.type === 'city') {
				if (!achievements.cities.includes(matches[1])) {
					isNew = true;
					achievements.cities.push(matches[1]);
				}
				achievementsCount = achievements.cities.length;
			}
			if (city.type === 'station') {
				if (!achievements.stations.includes(matches[1])) {
					isNew = true;
					achievements.stations.push(matches[1]);
				}
				achievementsCount = achievements.stations.length;
			}
			await storage.setItem('achievements', achievements);
		});

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: response,
			username: 'tashibot',
			icon_emoji: ':japan:',
			attachments: isRepetitive ? [] : cloudinaryData.map((datum) => ({
				image_url: datum.secure_url,
				fallback: response,
			})),
		});

		if (city.type === 'city' && isNew) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `:new:新市町村発見！ ${achievementsCount}/${uniqueCitiesCount}市町村達成:tada:`,
				username: 'tashibot',
				icon_emoji: ':japan:',
			});
		}

		if (city.type === 'station' && isNew) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `:new:新駅発見！ ${achievementsCount}/${uniqueStationsCount}駅達成:tada:`,
				username: 'tashibot',
				icon_emoji: ':japan:',
			});
		}
	});
};
