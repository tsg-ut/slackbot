const path = require('path');
const qs = require('querystring');
const suncalc = require('suncalc');
const storage = require('node-persist');
const Queue = require('p-queue');
const moment = require('moment');
const {stripIndent} = require('common-tags');
const cloudinary = require('cloudinary');
const axios = require('axios');
const {get, sample} = require('lodash');

const render = require('./render.js');
const weathers = require('./weathers.js');

const queue = new Queue({concurrency: 1});

// eslint-disable-next-line array-plural/array-plural
const position = [35.659, 139.685]; // 駒場東大前駅

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

const FtoC = (F) => (F - 32) * 5 / 9;
const miphToMps = (miph) => miph * 0.447;

module.exports = async ({webClient: slack}) => {
	await storage.init({
		dir: path.resolve(__dirname, '__state__'),
	});

	const tick = async () => {
		const lastSunrise = await storage.getItem('lastSunrise') || moment().subtract(1, 'day');
		const now = new Date();
		const tomorrow = moment(lastSunrise).utcOffset(9).endOf('day').add(12, 'hour').toDate();
		const {sunrise, sunset} = suncalc.getTimes(tomorrow, ...position);

		if (sunrise <= now) {
			await storage.setItem('lastSunrise', sunrise.getTime());
			const {rise: moonrise, set: moonset} = suncalc.getMoonTimes(tomorrow, ...position);
			const {phase: moonphase} = suncalc.getMoonIllumination(now, ...position);
			const moonEmoji = moonEmojis[Math.round(moonphase * 8) % 8];

			const {data} = await axios.get(`http://dataservice.accuweather.com/forecasts/v1/daily/1day/226396?${qs.encode({
				apikey: process.env.ACCUWEATHER_KEY,
				details: 'true',
			})}`);

			const month = moment().utcOffset(9).month() + 1;
			const date = moment().utcOffset(9).date();

			const weatherId = get(data, ['DailyForecasts', 0, 'Day', 'Icon']);

			const temperature = FtoC(get(data, ['DailyForecasts', 0, 'Temperature', 'Maximum', 'Value']));
			let temperatureLevel = null;
			if (temperature < 5) {
				temperatureLevel = 0;
			} else if (temperature < 12) {
				temperatureLevel = 1;
			} else if (temperature < 18) {
				temperatureLevel = 2;
			} else if (temperature < 24) {
				temperatureLevel = 3;
			} else if (temperature < 30) {
				temperatureLevel = 4;
			} else {
				temperatureLevel = 5;
			}

			const rain = get(data, ['DailyForecasts', 0, 'Day', 'Rain', 'Value']);
			const snow = get(data, ['DailyForecasts', 0, 'Day', 'Snow', 'Value']);
			const ice = get(data, ['DailyForecasts', 0, 'Day', 'Ice', 'Value']);
			const totalRain = rain + snow + ice;
			let rainLevel = null;
			if (totalRain < 0.01) {
				rainLevel = 0;
			} else if (totalRain < 2) {
				rainLevel = 1;
			} else if (totalRain < 5) {
				rainLevel = 2;
			} else if (totalRain < 10) {
				rainLevel = 3;
			} else {
				rainLevel = 4;
			}

			const wind = miphToMps(get(data, ['DailyForecasts', 0, 'Day', 'Wind', 'Speed', 'Value']));
			const winddeg = get(data, ['DailyForecasts', 0, 'Day', 'Wind', 'Direction', 'Degrees']);
			let windLevel = null;
			if (wind < 3) {
				windLevel = 0;
			} else if (wind < 8) {
				windLevel = 1;
			} else if (wind < 20) {
				windLevel = 2;
			} else {
				windLevel = 3;
			}

			const matchingWeathers = Object.entries(weathers).filter(([, conditions]) => {
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

				if (condition.winddeg !== undefined && !(windLevel >= 1 && condition.winddeg - 45 <= winddeg && winddeg <= condition.winddeg + 45)) {
					return false;
				}

				if (condition.humidity !== undefined) {
					return false;
				}

				if (condition.continuingCondition !== undefined) {
					return false;
				}

				if (condition.temperatureChange !== undefined) {
					return false;
				}

				if (condition.condition === 'clear' && ![1, 2].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'sunny' && ![1, 2, 3, 4, 30, 31, 32].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'haze' && ![5].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'cloud' && ![6, 7, 8].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'mist' && ![11].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'sunshower' && ![14, 17, 21].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'thunderstorm' && ![15, 16].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'rain' && ![18, 26].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'shower' && ![12, 13].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'changing' && ![19, 20].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'snow' && ![22, 23, 24].includes(weatherId)) {
					return false;
				}

				if (condition.condition === 'sleet' && ![25, 29].includes(weatherId)) {
					return false;
				}

				if (condition.month !== undefined && !condition.month.includes(month)) {
					return false;
				}

				if (condition.date !== undefined && !condition.date.some(([m, d]) => m === month && d === date)) {
					return false;
				}

				return true;
			});
			const weatherName = sample(matchingWeathers)[0];

			const imageData = await render(weatherName);
			const cloudinaryData = await new Promise((resolve, reject) => {
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

			slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: ':ahokusa-top-right::ahokusa-bottom-left::heavy_exclamation_mark:',
				username: 'sunrise',
				icon_emoji: ':sunrise:',
				attachments: [{
					color: '#FFA726',
					title: `本日の天気: ${weatherName}`,
					image_url: cloudinaryData.secure_url,
					fallback: weatherName,
				}, {
					color: '#1976D2',
					title: '本日のこよみ',
					text: stripIndent`
						:sun_with_face: *日の出* ${moment(sunrise).format('HH:mm')} ～ *日の入* ${moment(sunset).format('HH:mm')}
						:new_moon_with_face: *月の出* ${moment(moonrise).format('HH:mm')} ～ *月の入* ${moment(moonset).format('HH:mm')}
						${moonEmoji} *月齢* ${(moonphase * 30).toFixed(1)}
					`,
				}],
			});
		}
	};

	queue.add(tick);
	setInterval(() => {
		queue.add(tick);
	}, 10 * 1000);
};
