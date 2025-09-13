import type {MessageAttachment, WebClient} from '@slack/web-api';
import {FeatureCollection, MultiPolygon, points as Points, pointsWithinPolygon} from '@turf/turf';
import {Loader} from '../lib/utils';
import {getRainMinuteCast, getWeatherCastForecast, getWeatherCastHeadline} from './aiGeneration';
import {getJmaForecast, getWeather} from './fetch';
import type {OpenWeatherOneCallResponse} from './fetch';
import type {Point} from './index';

const firstAreaGeojsonLoader = new Loader<FeatureCollection<MultiPolygon>>(() => {
	const url = 'https://raw.githubusercontent.com/tmiyachi/jma-gis/master/geojson/firstarea.geojson';
	return fetch(url).then((res) => res.json()) as Promise<FeatureCollection<MultiPolygon>>;
});

export const postRainMinuteCast = async (point: Point, slack: WebClient, threadTimestamp?: string) => {
	const weatherData = await getWeather([point.latitude, point.longitude]);

	const rawRainMinuteCast = await getRainMinuteCast(weatherData);
	const rainMinuteCast = rawRainMinuteCast.replaceAll('[PLACE]', point.name);
	const link = `<https://openweathermap.org/weathermap/?basemap=map&cities=true&layer=temperature&lat=${point.latitude}&lon=${point.longitude}&zoom=10|[詳細]>`;

	await slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		username: 'sunrise',
		icon_emoji: ':sunrise:',
		text: rainMinuteCast,
		...(threadTimestamp ? {thread_ts: threadTimestamp} : {}),
		blocks: [
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `${rainMinuteCast} ${link}`,
				},
			},
		],
		unfurl_links: false,
		unfurl_media: false,
	});
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

const getPrecipitationText = (current: OpenWeatherOneCallResponse['current']) => {
	const rain = current.rain?.['1h'];
	if (rain) {
		return `${rain}mmの雨が降っています。`;
	}
	const snow = current.snow?.['1h'];
	if (snow) {
		return `${snow}mmの雪が降っています。`;
	}
	return '';
};

export const postWeatherCast = async (point: Point, slack: WebClient, threadTimestamp?: string) => {
	const weatherData = await getWeather([point.latitude, point.longitude]);

	const current = weatherData.current;
	const daily = weatherData.daily[0];

	if (!current || !daily) {
		throw new Error('No weather data');
	}

	const beaufortScale = getBeaufortWindScale(current.wind_speed * 2.23694);
	const windText = `風力${beaufortScale}、${current.wind_deg}°方向の風が吹いています。`;

	const rawHeadlineText = await getWeatherCastHeadline(weatherData);
	const headlineText = rawHeadlineText.replaceAll('[PLACE]', point.name);
	const percipitationText = getPrecipitationText(current);
	const forecastText = await getWeatherCastForecast(weatherData);
	const link = `<https://openweathermap.org/weathermap/?basemap=map&cities=true&layer=temperature&lat=${point.latitude}&lon=${point.longitude}&zoom=10|[詳細]>`;

	const text = [`＊${headlineText}＊`, percipitationText, windText, '\n', forecastText].join('');

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
		text: `＊${headlineText}＊${percipitationText}`,
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

export const postTemperatureReport = async (point: Point, slack: WebClient, threadTimestamp?: string) => {
	const weatherData = await getWeather([point.latitude, point.longitude]);

	const current = weatherData.current;
	const daily = weatherData.daily[0];

	if (!current || !daily) {
		throw new Error('No weather data');
	}

	const headlineText = `${point.name}の現在の気温は ＊${current.temp.toFixed(1)}°C＊ です。`;
	const realFeelText = `体感温度は ＊${current.feels_like.toFixed(1)}°C＊ です。`;
	const minMaxForecastText = `本日の最高気温は ＊${daily.temp.max.toFixed(1)}°C＊ 、最低気温は ＊${daily.temp.min.toFixed(1)}°C＊ の見込みです。`;
	const link = `<https://openweathermap.org/weathermap/?basemap=map&cities=true&layer=temperature&lat=${point.latitude}&lon=${point.longitude}&zoom=10|[詳細]>`;

	const text = [
		headlineText, realFeelText, '\n',
		minMaxForecastText,
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
