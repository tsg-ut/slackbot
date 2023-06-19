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
import type {SlackInterface} from '../lib/slack';
import {extractMessage} from '../lib/slackUtils';
import State from '../lib/state';
import {getWeather, getHaiku, getEntries, getMinuteCast} from './fetch';
import render from './render';
import footer from './views/footer';
import listPointsDialog from './views/listPointsDialog';
import registerPointDialog from './views/registerPointDialog';
import weathers from './weathers';
import type {WeatherCondition} from './weathers';

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

// https://developer.accuweather.com/weather-icons
const conditionIds: {[weather: string]: number[]} = {
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

const weatherEmojis: {[iconId: number]: string} = {
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

const FtoC = (F: number) => (F - 32) * 5 / 9;
const miphToMps = (miph: number) => miph * 0.447;
const inchToMm = (inch: number) => inch * 25.4;

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
			const noon = moment(now).utcOffset(9).startOf('day').add(12, 'hour').toDate();
			const {sunrise, sunset} = suncalc.getTimes(noon, ...location);

			state.lastSunrise = now.getTime();
			const {rise: moonrise, set: moonset} = suncalc.getMoonTimes(noon, ...location);
			const {phase: moonphase} = suncalc.getMoonIllumination(noon);
			const moonEmoji = moonEmojis[Math.round(moonphase * 8) % 8];

			const {data: weatherData, locationId} = await getWeather(location);
			const today = moment().utcOffset(9).startOf('day').toDate();
			const forecast = weatherData.DailyForecasts.find((cast) => new Date(cast.Date) >= today);

			const lastWeather = state.lastWeather ?? null;

			const month = moment().utcOffset(9).month() + 1;
			const date = moment().utcOffset(9).date();

			const weatherId = forecast?.Day?.Icon;

			const temperature = FtoC(forecast?.Temperature?.Maximum?.Value);
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

			const totalLiquid = inchToMm(forecast?.Day?.TotalLiquid?.Value);
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

			const wind = miphToMps(forecast?.Day?.Wind?.Speed?.Value);
			const winddeg = forecast?.Day?.Wind?.Direction?.Degrees;
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

			const moonAge = moonphase * 29.5;

			// https://eco.mtk.nao.ac.jp/koyomi/wiki/B7EEA4CECBFEA4C1B7E7A4B12FB7EECEF0A4C8CBFEA4C1B7E7A4B1.html#t10ca351
			const moonStateText =
			// eslint-disable-next-line no-nested-ternary
				(moonAge <= 0.5 || moonAge >= 29.0) ? ':new_moon_with_face:新月:new_moon_with_face:'
					: Math.round(moonAge) === 14 ? ':full_moon_with_face:満月:full_moon_with_face:'
						: '';

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
						${moonStateText}
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
				const {groups: {pointName}} = weatherMatchResult;
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				const weatherPoint = state.weatherPoints.find(({name}) => name === pointName)!;

				try {
					const weatherData = await getMinuteCast([weatherPoint.latitude, weatherPoint.longitude]);

					const text = `${weatherPoint.name}では、${weatherData.Summary.Phrase}。`;
					const link = `<${weatherData.Link}|[詳細]>`;

					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						username: 'sunrise',
						icon_emoji: ':sunrise:',
						text,
						...(message.thread_ts ? {thread_ts: message.thread_ts} : {}),
						blocks: [
							{
								type: 'section',
								text: {
									type: 'mrkdwn',
									text: `${text} ${link}`,
								},
							},
						],
						unfurl_links: false,
						unfurl_media: false,
					});
				} catch (error) {
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

		await postWeatherMessage(`<@${payload.user.id}>が地点「${name} (${latitude}, ${longitude})」を登録しました`);
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

		await postWeatherMessage(`<@${payload.user.id}>が地点「${deletedPoint.name} (${deletedPoint.latitude}, ${deletedPoint.longitude})」を削除しました`);
	});
};
