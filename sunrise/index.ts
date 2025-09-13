import assert from 'assert';
import path from 'path';
import type {ViewStateValue, ViewSubmitAction, BlockButtonAction, MessageEvent} from '@slack/bolt';
// eslint-disable-next-line import/default
import cloudinary from 'cloudinary';
import type {UploadApiResponse} from 'cloudinary';
import {stripIndent} from 'common-tags';
import {maxBy, range, map} from 'lodash';
import moment from 'moment';
import nodePersist from 'node-persist';
import Queue from 'p-queue';
import suncalc from 'suncalc';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {extractMessage} from '../lib/slackUtils';
import State from '../lib/state';
import {getWeather, getHaiku, getEntries} from './fetch';
import {postRainMinuteCast, postTemperatureReport, postWeatherCast} from './forecast';
import render from './render';
import {getGoogleMapsLink} from './util';
import footer from './views/footer';
import listPointsDialog from './views/listPointsDialog';
import registerPointDialog from './views/registerPointDialog';
import weathers from './weathers';
import type {WeatherCondition} from './weathers';

const log = logger.child({bot: 'sunrise'});

const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Weather {
	name: string,
	conditions: WeatherCondition[],
}

export interface Point {
	name: string,
	latitude: number,
	longitude: number,
}

interface StateObj {
	lastWeather?: {
		weatherId: number,
		temperature: number,
	},
	lastSunrise: number,
	lastSunset: number,
	weatherHistories: {
		date: number,
		weather: Weather,
	}[],
	lastEntryUrl: {
		tayori: string,
		saijiki: string,
		tenkijp: string,
	},
	weatherPoints: Point[],
}

const queue = new Queue({concurrency: 1});

// https://eco.mtk.nao.ac.jp/koyomi/wiki/C7F6CCC02FCCEBCCC0A4C8C6FCCAEB.html
suncalc.addTime(-(7 + 21 / 60 + 40 / 3600), '夜明', '日暮');

// eslint-disable-next-line array-plural/array-plural
const location: [number, number] = [35.659, 139.685]; // 駒場東大前駅

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

// https://openweathermap.org/weather-conditions
const conditionIds: {[weather: string]: number[]} = {
	clear: [800],
	sunny: [800],
	haze: [721],
	cloud: [801, 802, 803, 804],
	mist: [701],
	sunshower: [520, 521, 522, 531],
	thunderstorm: [200, 201, 202, 210, 211, 212, 221, 230, 231, 232],
	rain: [500, 501, 502, 503, 504],
	shower: [300, 301, 302, 310, 311, 312, 313, 314, 321],
	changing: [],
	snow: [600, 601, 602],
	sleet: [611, 612, 613, 615, 616],
	drizzle: [300, 301, 302, 310, 311, 312, 313, 314, 321],
	dust: [731, 751, 761],
};

const weatherEmojis: {[iconId: number]: string} = {
	200: ':thunder_cloud_and_rain:',
	201: ':thunder_cloud_and_rain:',
	202: ':thunder_cloud_and_rain:',
	210: ':thunder_cloud_and_rain:',
	211: ':thunder_cloud_and_rain:',
	212: ':thunder_cloud_and_rain:',
	221: ':thunder_cloud_and_rain:',
	230: ':thunder_cloud_and_rain:',
	231: ':thunder_cloud_and_rain:',
	232: ':thunder_cloud_and_rain:',
	300: ':umbrella_with_rain_drops:',
	301: ':umbrella_with_rain_drops:',
	302: ':umbrella_with_rain_drops:',
	310: ':umbrella_with_rain_drops:',
	311: ':umbrella_with_rain_drops:',
	312: ':umbrella_with_rain_drops:',
	313: ':umbrella_with_rain_drops:',
	314: ':umbrella_with_rain_drops:',
	321: ':umbrella_with_rain_drops:',
	500: ':umbrella_with_rain_drops:',
	501: ':umbrella_with_rain_drops:',
	502: ':umbrella_with_rain_drops:',
	503: ':umbrella_with_rain_drops:',
	504: ':umbrella_with_rain_drops:',
	511: ':snowman:',
	520: ':partly_sunny_rain:',
	521: ':partly_sunny_rain:',
	522: ':partly_sunny_rain:',
	531: ':partly_sunny_rain:',
	600: ':snowman:',
	601: ':snowman:',
	602: ':snowman:',
	611: ':snowman:',
	612: ':snowman:',
	613: ':snowman:',
	615: ':snowman:',
	616: ':snowman:',
	620: ':snowman:',
	621: ':snowman:',
	622: ':snowman:',
	701: ':fog:',
	711: ':fog:',
	721: ':fog:',
	731: ':fog:',
	741: ':fog:',
	751: ':fog:',
	761: ':fog:',
	762: ':fog:',
	771: ':fog:',
	781: ':fog:',
	800: ':sunny:',
	801: ':barely_sunny:',
	802: ':partly_sunny:',
	803: ':mostly_sunny:',
	804: ':cloud:',
};

const 漢数字s = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const getWeatherRegex = (pointNames: string[]) => {
	const pointNamesRegex = pointNames.map(escapeRegExp).join('|');
	return new RegExp(`(?<pointName>${pointNamesRegex})(?:の|\\s*)(?<weatherType>天気|雨|気温)`);
};

export default async ({eventClient, webClient: slack, messageClient}: SlackInterface) => {
	// TODO: Remove these codes after migration to State library
	const storage = nodePersist.create({
		dir: path.resolve(__dirname, '__state__'),
	});
	await storage.init();

	const state = await State.init<StateObj>('sunrise', {
		lastWeather: await storage.getItem('lastWeather'),
		lastSunrise: (await storage.getItem('lastSunrise')) ?? Date.now(),
		lastSunset: (await storage.getItem('lastSunset')) ?? Date.now(),
		weatherHistories: (await storage.getItem('weatherHistories')) ?? [],
		lastEntryUrl: await storage.getItem('lastEntryUrl'),
		weatherPoints: [
			{
				name: '駒場',
				latitude: 35.659,
				longitude: 139.685,
			},
			{
				name: '本郷',
				latitude: 35.713,
				longitude: 139.762,
			},
		],
	});

	let weatherRegex = getWeatherRegex(state.weatherPoints.map((point) => point.name));

	const tick = async () => {
		const now = new Date();

		const times = range(-5, 5).map((days) => suncalc.getTimes(moment().add(days, 'day').toDate(), ...location));
		const sunrises = map(times, 'sunrise');
		const nextSunrise = sunrises.find((sunrise) => sunrise.getTime() > state.lastSunrise);

		if (now >= nextSunrise) {
			state.lastSunrise = now.getTime();
			const {phase: moonphase} = suncalc.getMoonIllumination(now);
			const moonEmoji = moonEmojis[Math.round(moonphase * 8) % 8];

			const weatherData = await getWeather(location);
			const forecast = weatherData.daily[0];

			const lastWeather = state.lastWeather ?? null;

			const month = moment().utcOffset(9).month() + 1;
			const date = moment().utcOffset(9).date();

			const weatherId = forecast?.weather[0]?.id;

			const temperature = forecast?.temp?.max;
			let temperatureLevel: number = null;
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

			const totalLiquid = forecast?.rain ?? 0;
			let rainLevel: number = null;
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

			const wind = forecast?.wind_speed;
			const winddeg = forecast?.wind_deg;
			let windLevel: number = null;
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
				const condition: WeatherCondition = Object.assign({}, ...conditions);

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

				const latestAnnounce = state.weatherHistories.findIndex(({weather}) => weather.name === name);
				if (latestAnnounce !== -1) {
					score -= 30 / (latestAnnounce + 1);
				}

				return score;
			});

			state.lastWeather = {weatherId, temperature};
			state.weatherHistories.unshift({
				date: Date.now(),
				weather: matchingWeather,
			});

			const imageData = await render(matchingWeather.name);
			const cloudinaryData: UploadApiResponse = await new Promise((resolve, reject) => {
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

			const {lastEntryUrl} = state;
			const [tayori, saijiki, tenkijp] = await getEntries();

			let entry = null;
			if (tayori.length > 0 && (!lastEntryUrl || lastEntryUrl.tayori !== tayori[0].link)) {
				entry = {
					title: tayori[0].title,
					link: tayori[0].link,
				};
			} else if (saijiki.length > 0 && lastEntryUrl.saijiki !== saijiki[0].link) {
				entry = {
					title: `${saijiki[0].category}「${saijiki[0].title}」`,
					link: saijiki[0].link,
				};
			} else if (tenkijp.length > 0 && lastEntryUrl.tenkijp !== tenkijp[0].link) {
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
					title_link: 'https://openweathermap.org/',
					image_url: cloudinaryData.secure_url,
					fallback: matchingWeather.name,
				}, {
					color: '#1976D2',
					title: '本日のこよみ',
					text: stripIndent`
						:sunrise_over_mountains: *日の出* ${moment.unix(forecast.sunrise).format('HH:mm')} ～ *日の入* ${moment.unix(forecast.sunset).format('HH:mm')}
						${moonEmoji} *月の出* ${moment.unix(forecast.moonrise).format('HH:mm')} ～ *月の入* ${moment.unix(forecast.moonset).format('HH:mm')}
					`,
				}, ...(entry ? [{
					color: '#4DB6AC',
					title: entry.title,
					title_link: entry.link,
				}] : []), {
					color: '#6D4C41',
					title: '本日の一句',
					title_link: 'https://www.haijinkyokai.jp/',
					text: haiku.text,
					footer: `${haiku.note}\n${haiku.author}`,
				}],
			});

			state.lastEntryUrl = {
				tayori: tayori?.[0]?.link ?? '',
				saijiki: saijiki?.[0]?.link ?? '',
				tenkijp: tenkijp?.[0]?.link ?? '',
			};
		}

		const sunsets = map(times, 'sunset');
		const nextSunset = sunsets.find((sunset) => sunset.getTime() > state.lastSunset);

		if (now >= nextSunset) {
			state.lastSunset = now.getTime();
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

	const postWeatherMessage = (text: string) => (
		slack.chat.postMessage({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'sunrise',
			icon_emoji: ':sunrise:',
			text,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text,
					},
				},
				...footer,
			],
		})
	);

	eventClient.on('message', async (originalMessage: MessageEvent) => {
		const message = extractMessage(originalMessage);

		if (!message) {
			return;
		}

		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		if (message.text && message.text.match(/(?:いま|今)(?:なんじ|なんどき|何時)/)) {
			const now = Date.now();
			const times = range(-5, 5).map((days) => suncalc.getTimes(moment().add(days, 'day').toDate(), ...location));
			const 夜明s = map(times, '夜明');
			const 日暮s = map(times, '日暮');

			const 夜明and日暮 = [
				...夜明s.map((time) => ({time: time.getTime(), type: '夜明'})),
				...日暮s.map((time) => ({time: time.getTime(), type: '日暮'})),
			].sort((a, b) => a.time - b.time);
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

		if (message.bot_id === undefined) {
			const weatherMatchResult = message.text?.match?.(weatherRegex);
			if (weatherMatchResult) {
				const {groups: {pointName, weatherType}} = weatherMatchResult;
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				const weatherPoint = state.weatherPoints.find(({name}) => name === pointName)!;

				try {
					if (weatherType === '雨') {
						await postRainMinuteCast(weatherPoint, slack, message.thread_ts);
					}
					if (weatherType === '天気') {
						await postWeatherCast(weatherPoint, slack, message.thread_ts);
					}
					if (weatherType === '気温') {
						await postTemperatureReport(weatherPoint, slack, message.thread_ts);
					}
				} catch (error) {
					log.error(error);

					const headline = `${weatherPoint.name}の天気を取得できませんでした😢`;
					const errorMessage = error?.response?.data?.Message;

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						username: 'sunrise',
						icon_emoji: ':sunrise:',
						text: headline,
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: headline,
								},
							},
							...(
								errorMessage ? [{
									type: 'section' as const,
									text: {
										type: 'mrkdwn' as const,
										text: `*エラーメッセージ*:\n\`\`\`\n${errorMessage}\n\`\`\``,
									},
								}] : []
							),
							...footer,
						],
					});
				}
			}

			if (message.text === '地点登録') {
				await postWeatherMessage('地点登録ボタンを押してください');
			}
		}
	});

	const postEphemeral = (message: string, user: string) => {
		slack.chat.postEphemeral({
			channel: process.env.CHANNEL_SANDBOX,
			username: 'sunrise',
			icon_emoji: ':sunrise:',
			text: message,
			user,
		});
	};

	messageClient.action({
		type: 'button',
		actionId: 'sunrise_register_point_button',
	}, async (payload: BlockButtonAction) => {
		await slack.views.open({
			trigger_id: payload.trigger_id,
			view: registerPointDialog,
		});
	});

	messageClient.viewSubmission('sunrise_register_point_dialog', async (payload: ViewSubmitAction) => {
		const stateObjects = Object.values(payload.view.state.values ?? {});
		const dialogState: {[actionId: string]: ViewStateValue} = Object.assign({}, ...stateObjects);

		const latitude = parseFloat(dialogState.latitude?.value);
		const longitude = parseFloat(dialogState.longitude?.value);
		const name = dialogState?.name?.value;

		if (Number.isNaN(latitude)) {
			return postEphemeral('緯度が不正です', payload.user.id);
		}

		if (Number.isNaN(longitude)) {
			return postEphemeral('経度が不正です', payload.user.id);
		}

		if (name === '') {
			return postEphemeral('名前を入力してください', payload.user.id);
		}

		if (state.weatherPoints.some((point) => point.name === name)) {
			state.weatherPoints = state.weatherPoints.map((point) => {
				if (point.name === name) {
					return {name, latitude, longitude};
				}
				return point;
			});
		} else {
			state.weatherPoints.push({name, latitude, longitude});
		}

		weatherRegex = getWeatherRegex(state.weatherPoints.map((point) => point.name));

		await postWeatherMessage(`<@${payload.user.id}>が地点「${name} (${getGoogleMapsLink(latitude, longitude)})」を登録しました`);
	});

	messageClient.action({
		type: 'button',
		actionId: 'sunrise_list_points_button',
	}, async (payload: BlockButtonAction) => {
		await slack.views.open({
			trigger_id: payload.trigger_id,
			view: listPointsDialog(state.weatherPoints),
		});
	});

	messageClient.action({
		type: 'button',
		actionId: 'sunrise_delete_point_button',
	}, async (payload: BlockButtonAction) => {
		const action = (payload.actions ?? []).find((a) => (
			a.action_id === 'sunrise_delete_point_button'
		));

		const name = action.value;

		if (name === undefined) {
			return postEphemeral('地点名が不正です', payload.user.id);
		}

		if (!state.weatherPoints.some((point) => point.name === name)) {
			return postEphemeral('地点が見つかりません', payload.user.id);
		}

		const deletedPoint = state.weatherPoints.find((point) => point.name === name);

		state.weatherPoints = state.weatherPoints.filter((point) => point.name !== name);

		weatherRegex = getWeatherRegex(state.weatherPoints.map((point) => point.name));

		await slack.views.update({
			view_id: payload.view.id,
			view: listPointsDialog(state.weatherPoints),
		});

		await postWeatherMessage(`<@${payload.user.id}>が地点「${deletedPoint.name} (${getGoogleMapsLink(deletedPoint.latitude, deletedPoint.longitude)})」を削除しました`);
	});
};
