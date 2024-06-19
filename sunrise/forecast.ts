import type {MessageAttachment, WebClient} from '@slack/web-api';
import {Attachment} from '@slack/web-api/dist/response/ChatPostMessageResponse';
import {FeatureCollection, MultiPolygon, points as Points, pointsWithinPolygon} from '@turf/turf';
import {Loader} from '../lib/utils';
import {AccuweatherMultiUnit, getCurrentWeather, getJmaForecast, getMinuteCast, getWeather} from './fetch';
import type {Point} from './index';

const firstAreaGeojsonLoader = new Loader<FeatureCollection<MultiPolygon>>(() => {
	const url = 'https://raw.githubusercontent.com/tmiyachi/jma-gis/master/geojson/firstarea.geojson';
	return fetch(url).then((res) => res.json());
});

export const postRainMinuteCast = async (point: Point, slack: WebClient, threadTimestamp?: string) => {
	const weatherData = await getMinuteCast([point.latitude, point.longitude]);

	const text = `${point.name}では、${weatherData.Summary.Phrase}。`;
	const link = `<${weatherData.Link}|[詳細]>`;

	await slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		username: 'sunrise',
		icon_emoji: ':sunrise:',
		text,
		...(threadTimestamp ? {thread_ts: threadTimestamp} : {}),
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
};

const getPercipitationText = (percipitationType: string, precipitation: AccuweatherMultiUnit) => {
	const amount = `${precipitation.Metric.Value}${precipitation.Metric.Unit}`;
	if (percipitationType === 'Rain') {
		return `${amount}の雨が降っています。`;
	}
	if (percipitationType === 'Snow') {
		return `${amount}の雪が降っています。`;
	}
	if (percipitationType === 'Ice') {
		return `${amount}の雹が降っています。`;
	}
	if (percipitationType === 'Mixed') {
		return `${amount}の霙が降っています。`;
	}
	return '';
};

const getBeaufortWindScale = (speedMph: number) => {
	const speedKnot = speedMph * 0.868976;
	if (speedKnot < 1) {
		return 0;
	}
	if (speedKnot < 4) {
		return 1;
	}
	if (speedKnot < 7) {
		return 2;
	}
	if (speedKnot < 11) {
		return 3;
	}
	if (speedKnot < 17) {
		return 4;
	}
	if (speedKnot < 22) {
		return 5;
	}
	if (speedKnot < 28) {
		return 6;
	}
	if (speedKnot < 34) {
		return 7;
	}
	if (speedKnot < 41) {
		return 8;
	}
	if (speedKnot < 48) {
		return 9;
	}
	if (speedKnot < 56) {
		return 10;
	}
	if (speedKnot < 34) {
		return 11;
	}
	return 12;
};

export const postWeatherCast = async (point: Point, slack: WebClient, threadTimestamp?: string) => {
	const weatherResponse = await getCurrentWeather([point.latitude, point.longitude]);

	if (weatherResponse.data.length === 0) {
		throw new Error('No weather data');
	}

	const weatherData = weatherResponse.data[0];

	const {data: forecastData} = await getWeather([point.latitude, point.longitude]);

	const headlineText = `${point.name}は、＊${weatherData.WeatherText}です＊。`;
	const percipitationText = getPercipitationText(
		weatherData.PrecipitationType,
		weatherData.PrecipitationSummary.PastHour,
	);
	const beaufortScale = getBeaufortWindScale(weatherData.Wind.Speed.Imperial.Value);
	const windText = `${weatherData.Wind.Direction.Localized}の風、風力は${beaufortScale}です。`;
	const forecastText = forecastData.Headline.Text ? `${forecastData.Headline.Text}。` : '';
	const link = `<${weatherData.Link}|[詳細]>`;

	const text = [headlineText, percipitationText, windText, '\n', forecastText].join('');

	const firstAreaGeojson = await firstAreaGeojsonLoader.load();
	const points = Points([[point.longitude, point.latitude]]);
	const featureContainingPoints = firstAreaGeojson.features.find((feature) => (
		pointsWithinPolygon(points, feature)?.features?.length > 0
	));

	const attachments: MessageAttachment[] = [];
	if (featureContainingPoints !== undefined) {
		const firstAreaCode = featureContainingPoints.properties.firstareacode;
		const jmaForecast = await getJmaForecast(firstAreaCode);
		const text = jmaForecast.data.description.text.split('【')[0]?.replace(/\s+/g, '');
		attachments.push({
			title: `${jmaForecast.data.publishingOffice}発表: ${jmaForecast.data.title}`,
			title_link: jmaForecast.data.link,
			text,
			color: '#36a64f',
		});
	}

	await slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		username: 'sunrise',
		icon_emoji: ':sunrise:',
		text,
		attachments,
		...(threadTimestamp ? {thread_ts: threadTimestamp} : {}),
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
};

const getForecastPhraseText = (forecastPhrase: string) => {
	if (forecastPhrase.endsWith('い')) {
		return `${forecastPhrase}一日になる見込みです。`;
	}
	if (forecastPhrase.endsWith('寒さ') || forecastPhrase.endsWith('暑さ')) {
		return `${forecastPhrase}になる見込みです。`;
	}
	return `${forecastPhrase}でしょう。`;
};

export const postTemperatureReport = async (point: Point, slack: WebClient, threadTimestamp?: string) => {
	const weatherResponse = await getCurrentWeather([point.latitude, point.longitude]);

	if (weatherResponse.data.length === 0) {
		throw new Error('No weather data');
	}

	const weatherData = weatherResponse.data[0];

	const {data: forecastData} = await getWeather([point.latitude, point.longitude]);
	const dailyForecast = forecastData.DailyForecasts[0];

	const headlineText = `${point.name}の現在の気温は ＊${weatherData.Temperature.Metric.Value}°C＊ で、`;
	const temperatureDeparture = weatherData.Past24HourTemperatureDeparture.Metric.Value;
	const temperatureDepartureText = `昨日より${Math.abs(temperatureDeparture)}°C${temperatureDeparture > 0 ? '高い' : '低い'}です。`;
	const realFeelShadeText = `日陰での体感温度は ＊${weatherData.RealFeelTemperatureShade.Metric.Value}°C＊ で、`;
	const realFeelShadePhraseText = `${weatherData.RealFeelTemperatureShade.Metric.Phrase}でしょう。`;
	const minMaxForecastText = `本日の最高気温は ＊${dailyForecast.Temperature.Maximum.Value}°C＊ 、最低気温は ＊${dailyForecast.Temperature.Minimum.Value}°C＊ で、`;
	const forecastPhraseText = getForecastPhraseText(dailyForecast.RealFeelTemperature.Maximum.Phrase);
	const link = `<${weatherData.Link}|[詳細]>`;

	const text = [
		headlineText, temperatureDepartureText, '\n',
		realFeelShadeText, realFeelShadePhraseText, '\n',
		minMaxForecastText, forecastPhraseText,
	].join('');

	await slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		username: 'sunrise',
		icon_emoji: ':sunrise:',
		text,
		...(threadTimestamp ? {thread_ts: threadTimestamp} : {}),
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
};
