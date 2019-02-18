const path = require('path');
const qs = require('querystring');
const assert = require('assert');
const suncalc = require('suncalc');
const nodePersist = require('node-persist');
const Queue = require('p-queue');
const moment = require('moment');
const {stripIndent} = require('common-tags');
const cloudinary = require('cloudinary');
const axios = require('axios');
const {get, maxBy, flatten, sortBy, range, map} = require('lodash');
const scrapeIt = require('scrape-it');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

const render = require('./render.js');
const weathers = require('./weathers.js');

const queue = new Queue({concurrency: 1});

// https://eco.mtk.nao.ac.jp/koyomi/wiki/C7F6CCC02FCCEBCCC0A4C8C6FCCAEB.html
suncalc.addTime(-(7 + 21 / 60 + 40 / 3600), '夜明', '日暮');

// eslint-disable-next-line array-plural/array-plural
const location = [35.659, 139.685]; // 駒場東大前駅

const moonEmojis = [
	':new_moon:',
	':waxing_crescent_moon:',
	':first_quarter_moon:',
	':waxing_gibbous_moon:',
	':full_moon:',
	':waning_gibbous_moon:',
	':last_quarter_moon:',
	':waning_crescent_moon:',
];

// https://developer.accuweather.com/weather-icons
const conditionIds = {
	clear: [1, 2],
	sunny: [1, 2, 3, 4, 30, 31, 32],
	haze: [5],
	cloud: [6, 7, 8],
	mist: [11],
	sunshower: [14, 17, 21],
	thunderstorm: [15, 16],
	rain: [18, 26],
	shower: [12, 13],
	changing: [19, 20],
	snow: [22, 23, 24],
	sleet: [25, 29],
	drizzle: [],
	dust: [],
};
const weatherEmojis = {
	1: ':sunny:',
	2: ':sunny:',
	3: ':mostly_sunny:',
	4: ':partly_sunny:',
	5: ':fog:',
	6: ':barely_sunny:',
	7: ':cloud:',
	8: ':cloud:',
	11: ':fog:',
	12: ':umbrella_with_rain_drops:',
	13: ':umbrella_with_rain_drops:',
	14: ':partly_sunny_rain:',
	15: ':thunder_cloud_and_rain:',
	16: ':thunder_cloud_and_rain:',
	17: ':thunder_cloud_and_rain:',
	18: ':umbrella_with_rain_drops:',
	19: ':cloud:',
	20: ':barely_sunny:',
	21: ':barely_sunny:',
	22: ':snowman:',
	23: ':snowman:',
	24: ':ice_skate:',
	25: ':umbrella_with_rain_drops:',
	26: ':umbrella_with_rain_drops:',
	29: ':umbrella_with_rain_drops:',
	30: ':sunny:',
	31: ':sunny:',
	32: ':sunny:',
};

const 漢数字s = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const FtoC = (F) => (F - 32) * 5 / 9;
const miphToMps = (miph) => miph * 0.447;
const inchToMm = (inch) => inch * 25.4;

const getTayoriEntries = async () => {
	const {data} = await scrapeIt('http://www.i-nekko.jp/hibinotayori/', {
		articles: {
			listItem: 'section.blog-panel',
			data: {
				date: {
					selector: '.blog-date',
				},
				title: {
					selector: '.blog-title',
				},
				link: {
					selector: '.blog-title > a',
					attr: 'href',
				},
			},
		},
	});

	return data.articles;
};

const getSaijikiEntries = async () => {
	const {data} = await scrapeIt('http://www.i-nekko.jp/category.html', {
		archives: {
			listItem: '.archive-list',
			data: {
				category: {
					selector: '.archive-list-title > img',
					attr: 'alt',
				},
				articles: {
					listItem: '.archive-list-box',
					data: {
						date: {
							selector: '.date',
						},
						title: {
							selector: '.date + p',
						},
						link: {
							selector: 'a',
							attr: 'href',
						},
					},
				},
			},
		},
	});

	return sortBy(flatten(
		data.archives.map(({category, articles}) => (
			articles.map((article) => ({category, ...article}))
		))
	), [({date}) => {
		const [year, month, day, time] = date.split(/[年月日]/).map((token) => token.trim());
		return new Date(`${year}-${month}-${day} ${time}`);
	}]).reverse();
};

const getTenkijpEntries = async () => {
	const {data} = await scrapeIt('https://tenki.jp/suppl/entries/1/', {
		articles: {
			listItem: '.recent-entries > ul > li',
			data: {
				title: {
					selector: '.recent-entries-title',
				},
				link: {
					selector: 'a',
					attr: 'href',
				},
			},
		},
	});

	return data.articles.map(({title, link}) => ({
		title,
		link: new URL(link, 'https://tenki.jp/').href,
	}));
};

const getEntries = () => (
	Promise.all([
		getTayoriEntries(),
		getSaijikiEntries(),
		getTenkijpEntries(),
	])
);

const getHaiku = async () => {
	const {data} = await axios.get('http://sendan.kaisya.co.jp/index3.html', {
		responseType: 'arraybuffer',
	});
	const $ = cheerio.load(iconv.decode(data, 'sjis'));
	const text = $('td[rowspan=7][width=590] center font').text();
	const author = $('td[rowspan=7][width=590] center b').text();

	return {text, author};
};

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
	const storage = nodePersist.create({
		dir: path.resolve(__dirname, '__state__'),
	});
	await storage.init();

	if (await storage.getItem('lastSunrise') === undefined) {
		await storage.setItem('lastSunrise', Date.now());
	}

	if (await storage.getItem('lastSunset') === undefined) {
		await storage.setItem('lastSunset', Date.now());
	}

	const tick = async () => {
		const now = new Date();

		const times = range(-5, 5).map((days) => suncalc.getTimes(moment().add(days, 'day').toDate(), ...location));
		const sunrises = map(times, 'sunrise');
		const lastSunrise = await storage.getItem('lastSunrise');
		const nextSunrise = sunrises.find((sunrise) => sunrise > lastSunrise);

		if (now >= nextSunrise) {
			const noon = moment().utcOffset(9).startOf('day').add(12, 'hour').toDate();
			const {sunrise, sunset} = suncalc.getTimes(noon, ...location);

			await storage.setItem('lastSunrise', now.getTime());
			const {rise: moonrise, set: moonset} = suncalc.getMoonTimes(noon, ...location);
			const {phase: moonphase} = suncalc.getMoonIllumination(now, ...location);
			const moonEmoji = moonEmojis[Math.round(moonphase * 8) % 8];

			// Fetch location id of target location
			const {data: locationData} = await axios.get(`http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?${qs.encode({
				apikey: process.env.ACCUWEATHER_KEY,
				q: location.join(','),
				details: 'true',
			})}`);
			const locationId = locationData.Key;

			const {data: weatherData} = await axios.get(`http://dataservice.accuweather.com/forecasts/v1/daily/5day/${locationId}?${qs.encode({
				apikey: process.env.ACCUWEATHER_KEY,
				details: 'true',
			})}`);
			const today = moment().utcOffset(9).startOf('day').toDate();
			const forecast = weatherData.DailyForecasts.find((cast) => new Date(cast.Date) >= today);

			const lastWeather = await storage.getItem('lastWeather') || null;
			const weatherHistories = await storage.getItem('weatherHistories') || [];

			const month = moment().utcOffset(9).month() + 1;
			const date = moment().utcOffset(9).date();

			const weatherId = get(forecast, ['Day', 'Icon']);

			const temperature = FtoC(get(forecast, ['Temperature', 'Maximum', 'Value']));
			let temperatureLevel = null;
			if (temperature < 5) {
				temperatureLevel = 0;
			} else if (temperature < 12) {
				temperatureLevel = 1;
			} else if (temperature < 18) {
				temperatureLevel = 2;
			} else if (temperature < 28) {
				temperatureLevel = 3;
			} else if (temperature < 32) {
				temperatureLevel = 4;
			} else {
				temperatureLevel = 5;
			}

			const totalLiquid = inchToMm(get(forecast, ['Day', 'TotalLiquid', 'Value']));
			let rainLevel = null;
			if (totalLiquid < 0.01) {
				rainLevel = 0;
			} else if (totalLiquid < 3) {
				rainLevel = 1;
			} else if (totalLiquid < 10) {
				rainLevel = 2;
			} else if (totalLiquid < 20) {
				rainLevel = 3;
			} else {
				rainLevel = 4;
			}

			const wind = miphToMps(get(forecast, ['Day', 'Wind', 'Speed', 'Value']));
			const winddeg = get(forecast, ['Day', 'Wind', 'Direction', 'Degrees']);
			let windLevel = null;
			if (wind < 3) {
				windLevel = 0;
			} else if (wind < 8) {
				windLevel = 1;
			} else if (wind < 15) {
				windLevel = 2;
			} else if (wind < 25) {
				windLevel = 3;
			} else {
				windLevel = 4;
			}

			const normalizedWeathers = Object.entries(weathers).map(([name, conditions]) => ({name, conditions}));

			const matchingWeathers = normalizedWeathers.filter(({conditions}) => {
				const condition = Object.assign({}, ...conditions);

				if (condition.temperature !== undefined && condition.temperature !== temperatureLevel) {
					return false;
				}

				if (condition.rain !== undefined && condition.rain !== rainLevel) {
					return false;
				}

				if (condition.wind !== undefined && condition.wind !== windLevel) {
					return false;
				}

				if (condition.winddeg !== undefined) {
					if (condition.winddeg === 0) {
						if (!(windLevel >= 1 && (winddeg <= 45 || 315 <= winddeg))) {
							return false;
						}
					} else {
						if (!(windLevel >= 1 && condition.winddeg - 45 <= winddeg && winddeg <= condition.winddeg + 45)) {
							return false;
						}
					}
				}

				// TODO: fix
				if (condition.humidity !== undefined) {
					return false;
				}

				if (condition.continuingCondition !== undefined) {
					assert(Array.isArray(conditionIds[condition.continuingCondition]));
					if (
						!lastWeather ||
						!conditionIds[condition.continuingCondition].includes(lastWeather.weatherId) ||
						!conditionIds[condition.continuingCondition].includes(weatherId)
					) {
						return false;
					}
				}

				if (condition.temperatureChange !== undefined) {
					if (!lastWeather) {
						return false;
					}

					if (condition.temperatureChange === 1 && !(lastWeather.temperature - temperature >= 5)) {
						return false;
					}

					if (condition.temperatureChange === -1 && !(lastWeather.temperature - temperature <= -5)) {
						return false;
					}
				}

				if (condition.condition !== undefined) {
					assert(Array.isArray(conditionIds[condition.condition]));
					if (!conditionIds[condition.condition].includes(weatherId)) {
						return false;
					}
				}

				if (condition.month !== undefined && !condition.month.includes(month)) {
					return false;
				}

				if (condition.date !== undefined && !condition.date.some(([m, d]) => m === month && d === date)) {
					return false;
				}

				return true;
			});

			assert(matchingWeathers.length > 0);

			const matchingWeather = maxBy(matchingWeathers, ({name, conditions}) => {
				const condition = Object.assign({}, ...conditions);
				let score = 0;

				if (condition.temperature !== undefined) {
					score += 2;
				}

				if (condition.rain !== undefined) {
					score += 3;
				}

				if (condition.wind !== undefined) {
					score += 2;
				}

				if (condition.winddeg !== undefined) {
					score += 4;
				}

				if (condition.continuingCondition !== undefined) {
					score += 4;
				}

				if (condition.temperatureChange !== undefined) {
					score += 3;
				}

				if (condition.condition !== undefined) {
					score += 3;
				}

				if (condition.month !== undefined) {
					score += 6 / condition.month.length;
				}

				if (condition.date !== undefined) {
					score += 30;
				}

				const latestAnnounce = weatherHistories.findIndex(({weather}) => weather.name === name);
				if (latestAnnounce !== -1) {
					score -= 30 / (latestAnnounce + 1);
				}

				return score;
			});

			await storage.setItem('lastWeather', {weatherId, temperature});
			await storage.setItem('weatherHistories', [
				{date: Date.now(), weather: matchingWeather},
				...weatherHistories,
			]);

			const imageData = await render(matchingWeather.name);
			const cloudinaryData = await new Promise((resolve, reject) => {
				cloudinary.v2.uploader
					.upload_stream({resource_type: 'image'}, (error, response) => {
						if (error) {
							reject(error);
						} else {
							resolve(response);
						}
					})
					.end(imageData);
			});

			const lastEntryUrl = await storage.getItem('lastEntryUrl');
			const [tayori, saijiki, tenkijp] = await getEntries();

			let entry = null;
			if (!lastEntryUrl || lastEntryUrl.tayori !== tayori[0].link) {
				entry = {
					title: tayori[0].title,
					link: tayori[0].link,
				};
			} else if (lastEntryUrl.saijiki !== saijiki[0].link) {
				entry = {
					title: `${saijiki[0].category}「${saijiki[0].title}」`,
					link: saijiki[0].link,
				};
			} else if (lastEntryUrl.tenkijp !== tenkijp[0].link) {
				entry = {
					title: tenkijp[0].title,
					link: tenkijp[0].link,
				};
			}

			const haiku = await getHaiku();

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: ':ahokusa-top-right::ahokusa-bottom-left::heavy_exclamation_mark:',
				username: 'sunrise',
				icon_emoji: ':sunrise:',
				attachments: [{
					color: '#FFA726',
					title: `本日の天気${weatherEmojis[weatherId]}「${matchingWeather.name}」`,
					title_link: `https://www.accuweather.com/ja/jp/tokyo/${locationId}/daily-weather-forecast/${locationId}`,
					image_url: cloudinaryData.secure_url,
					fallback: matchingWeather.name,
				}, {
					color: '#1976D2',
					title: '本日のこよみ',
					text: stripIndent`
						:sunrise_over_mountains: *日の出* ${moment(sunrise).format('HH:mm')} ～ *日の入* ${moment(sunset).format('HH:mm')}
						${moonEmoji} *月の出* ${moment(moonrise).format('HH:mm')} ～ *月の入* ${moment(moonset).format('HH:mm')}
					`,
				}, ...(entry ? [{
					color: '#4DB6AC',
					title: entry.title,
					title_link: entry.link,
				}] : []), {
					color: '#6D4C41',
					title: '本日の一句',
					title_link: 'http://sendan.kaisya.co.jp/',
					text: haiku.text,
					footer: haiku.author,
				}],
			});

			await storage.setItem('lastEntryUrl', {
				tayori: tayori[0].link,
				saijiki: saijiki[0].link,
				tenkijp: tenkijp[0].link,
			});
		}

		const sunsets = map(times, 'sunset');
		const lastSunset = await storage.getItem('lastSunset');
		const nextSunset = sunsets.find((sunset) => sunset > lastSunset);

		if (now >= nextSunset) {
			await storage.setItem('lastSunset', now.getTime());
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: ':wave:',
				username: 'sunset',
				icon_emoji: ':city_sunset:',
			});
		}
	};

	queue.add(tick);
	setInterval(() => {
		queue.add(tick);
	}, 10 * 1000);

	rtm.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (message.text && message.text.match(/(いま|今)(なんじ|なんどき|何時)/)) {
			const now = Date.now();
			const times = range(-5, 5).map((days) => suncalc.getTimes(moment().add(days, 'day').toDate(), ...location));
			const 夜明s = map(times, '夜明');
			const 日暮s = map(times, '日暮');

			const 夜明and日暮 = [
				...夜明s.map((time) => ({time: time.getTime(), type: '夜明'})),
				...日暮s.map((time) => ({time: time.getTime(), type: '日暮'})),
			];
			const previousTime = 夜明and日暮.slice().reverse().find(({time}) => time < now);
			const nextTime = 夜明and日暮.find(({time}) => time > now);

			const totalMinutes = Math.round((now - previousTime.time) / (nextTime.time - previousTime.time) * 60);
			const hour = Math.floor(totalMinutes / 10);
			const minute = totalMinutes % 10;

			const prefixes = previousTime.type === '夜明' ? [
				'明', '朝', '朝', '昼', '昼', '夕', '暮',
			] : [
				'暮', '夜', '夜', '暁', '暁', '暁', '明',
			];
			const prefixText = prefixes[hour];

			const hourNumber = 漢数字s[[6, 5, 4, 9, 8, 7, 6][hour]];
			const hourText = (minute === 0 || minute === 5) ? `${hourNumber}ツ` : `${hourNumber}時`;

			const minuteText =
			// eslint-disable-next-line no-nested-ternary
				minute === 0 ? ''
					: minute === 5 ? '半'
						: `${漢数字s[minute]}分`;

			const timeText = `${prefixText}${hourText}${minuteText}`;

			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: timeText,
				username: 'sunrise',
				icon_emoji: ':sunrise:',
			});
		}
	});
};
