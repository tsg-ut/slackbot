const {katakanize, hiraganize} = require('japanese');
const {promises: fs, constants: {F_OK}} = require('fs');
const path = require('path');
const qs = require('querystring');
const nodePersist = require('node-persist');
const download = require('download');
const cloudinary = require('cloudinary');
const {escapeRegExp, uniq} = require('lodash');
const {default: Queue} = require('p-queue');
const {spawn} = require('child_process');
const concat = require('concat-stream');
const getReading = require('../lib/getReading.js');
const {unlock, increment} = require('../achievements/index.ts');
const prices = require('./prices.js');

const histories = [];
const queue = new Queue({concurrency: 1});
const transaction = (func) => queue.add(func);

const getPrice = (distance) => {
	let previousPrice = 0;
	for (const [km, price] of prices) {
		if (distance < km * 1000) {
			return previousPrice;
		}
		previousPrice = price;
	}
	return Infinity;
};

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const statePath = path.join(__dirname, 'state.json');

	const exists = await fs.access(statePath, F_OK).then(() => true).catch(() => false);

	// eslint-disable-next-line no-async-promise-executor
	const users = await new Promise(async (resolve) => {
		if (exists) {
			const data = await fs.readFile(statePath);
			resolve(new Map(JSON.parse(data)));
		} else {
			resolve(new Map());
		}
	});

	const cities = (await fs.readFile(path.resolve(__dirname, 'cities.csv')))
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

	const stations = (await fs.readFile(path.resolve(__dirname, 'stations.csv')))
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

	const nodes = (await fs.readFile(path.resolve(__dirname, 'nodes.csv')))
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([id, name]) => ({
			id: parseInt(id),
			name,
		}));
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));

	const edges = (await fs.readFile(path.resolve(__dirname, 'edges.csv')))
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([station1, station2, distance, line]) => ({
			station1: parseInt(station1),
			station2: parseInt(station2),
			distance: parseInt(distance),
			line: parseInt(line),
		}));

	const lines = (await fs.readFile(path.resolve(__dirname, 'lines.csv')))
		.toString()
		.split('\n')
		.filter((line) => line)
		.map((line) => line.split(','))
		.map(([id, name]) => ({
			id: parseInt(id),
			name,
		}));
	const lineMap = new Map(lines.map((line) => [line.id, line.name]));

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

		const attachments = isNew ? cloudinaryData.map((datum) => ({
			image_url: datum.secure_url,
			fallback: response,
		})) : [];

		if (city.type === 'station') {
			const stationName = city.name.replace(/(?:駅|乗降場|停車場|信号場|停留場|電停|乗降所|停留所)$/, '');
			const station = nodes.find(({name}) => name === stationName);
			if (station) {
				if (!users.has(message.user)) {
					users.set(message.user, {
						position: 1188,
						history: [1188],
						distance: 0,
						price: 0,
					});
				}
				const {position, history, distance, price} = users.get(message.user);
				const generator = spawn('../target/release/dijkstra', [position, station.id], {cwd: __dirname});
				const data = await new Promise((resolve) => {
					generator.stdout.pipe(concat({encoding: 'buffer'}, resolve));
				});
				const output = data.toString().trim();
				if (output !== 'null') {
					const routes = output.split(',').map((c) => parseInt(c));
					let newDistance = 0;
					let line = null;
					let firstLineString = '';
					const routeString = routes.map((id, index) => {
						let lineString = '';
						if (index !== routes.length - 1) {
							const station1 = routes[index];
							const station2 = routes[index + 1];
							const filteredEdges = edges.filter((e) => (
								(e.station1 === station1 && e.station2 === station2) ||
								(e.station2 === station1 && e.station1 === station2)
							));
							if (filteredEdges.length > 0) {
								const edge = filteredEdges.find((e) => e.line === line) || filteredEdges[0];
								newDistance += edge.distance;
								if (line === null) {
									// eslint-disable-next-line prefer-destructuring
									line = edge.line;
									firstLineString = `【${lineMap.get(edge.line)}】`;
								} else if (line !== edge.line) {
									// eslint-disable-next-line prefer-destructuring
									line = edge.line;
									lineString = `\n【${lineMap.get(edge.line)}】`;
								}
							}
						}
						return `${lineString}${nodeMap.get(id).name}駅`;
					}).join(' → ');
					const from = nodeMap.get(routes[0]).name;
					const to = nodeMap.get(routes[routes.length - 1]).name;
					const newPrice = getPrice(newDistance);
					users.set(message.user, {
						position: station.id,
						history: history.slice(0, -1).concat(routes),
						distance: distance + newDistance,
						price: price + newPrice,
					});
					await fs.writeFile(statePath, JSON.stringify(Array.from(users.entries())));
					attachments.push({
						title: `乗換案内 (${from}駅 → ${to}駅, ${(newDistance / 1000).toFixed(1)}km, ${newPrice}円)`,
						text: firstLineString + routeString,
					});
					increment(message.user, 'tashibotDistance', Math.floor(newDistance / 1000));
				}
			}
		}

		await slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			text: response,
			username: 'tashibot',
			icon_emoji: ':japan:',
			attachments,
			...(message.thread_ts ? {
				thread_ts: message.thread_ts,
			} : {}),
		});

		await unlock(message.user, 'place');

		if (city.type === 'city' && isNew) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `:new:新市町村発見！ ${achievementsCount}/${uniqueCitiesCount}市町村達成:tada:`,
				username: 'tashibot',
				icon_emoji: ':japan:',
				...(message.thread_ts ? {
					thread_ts: message.thread_ts,
				} : {}),
			});
			await unlock(message.user, 'new-place');
		}

		if (city.type === 'station' && isNew) {
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `:new:新駅発見！ ${achievementsCount}/${uniqueStationsCount}駅達成:tada:`,
				username: 'tashibot',
				icon_emoji: ':japan:',
				...(message.thread_ts ? {
					thread_ts: message.thread_ts,
				} : {}),
			});
			await unlock(message.user, 'new-place');
		}
	});
};
