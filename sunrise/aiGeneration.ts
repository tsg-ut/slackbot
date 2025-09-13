import 'dotenv/config';
import path from 'path';
import {readFile, readJson} from 'fs-extra';
import openai from '../lib/openai';
import {Loader} from '../lib/utils';
import {OpenWeatherOneCallResponse} from './fetch';

const replaceParams = (template: string, params: Record<string, string>) => template.replace(/\{(?<key>\w+)\}/g, (_, key) => params[key] || `{${key}}`);

const weatherCastHeadlineLoader = new Loader<string>(async () => {
	const promptText = await readFile(path.join(__dirname, 'prompts', 'weather_cast_headline.md'));
	return promptText.toString();
});

// eslint-disable-next-line import/prefer-default-export
export const getWeatherCastHeadline = async (weatherData: OpenWeatherOneCallResponse) => {
	const current = weatherData.current;
	const todaysForecast = weatherData.daily[0].summary;
	const timeZone = weatherData.timezone;
	const currentTime = new Date(current.dt * 1000).toLocaleString('en-US', {timeZone});
	const sunriseTime = new Date(current.sunrise * 1000).toLocaleTimeString('ja-JP', {timeZone, hour: '2-digit', minute: '2-digit'});
	const sunsetTime = new Date(current.sunset * 1000).toLocaleTimeString('ja-JP', {timeZone, hour: '2-digit', minute: '2-digit'});

	const prompt = await weatherCastHeadlineLoader.load();
	const replacedPrompt = replaceParams(prompt, {
		lat: weatherData.lat.toString(),
		lon: weatherData.lon.toString(),
		current_time: currentTime,
		sunrise: sunriseTime,
		sunset: sunsetTime,
		temperature: current.temp.toFixed(1),
		feels_like: current.feels_like.toFixed(1),
		pressure: current.pressure.toString(),
		humidity: current.humidity.toString(),
		clouds: current.clouds.toString(),
		visibility: current.visibility.toString(),
		wind_speed: current.wind_speed.toFixed(1),
		wind_deg: current.wind_deg.toString(),
		weathers: current.weather.map((w) => w.description).join(', '),
		todays_forecast: todaysForecast,
	});

	const response = await openai.chat.completions.create({
		model: 'gpt-5-mini',
		messages: [
			{
				role: 'user',
				content: replacedPrompt,
			},
		],
		max_completion_tokens: 100,
		reasoning_effort: 'minimal',
	});

	const result = response.choices[0]?.message?.content.trim();

	if (!result || !result.startsWith('[PLACE]')) {
		return '[PLACE]では、エラーにより現在の天気情報を提供できません。';
	}

	return result;
};

const weatherCastForecastLoader = new Loader<string>(async () => {
	const promptText = await readFile(path.join(__dirname, 'prompts', 'weather_cast_forecast.md'));
	return promptText.toString();
});

// eslint-disable-next-line import/prefer-default-export
export const getWeatherCastForecast = async (weatherData: OpenWeatherOneCallResponse) => {
	const dailyForecasts = weatherData.daily.slice(0, 3);
	if (dailyForecasts.length < 3) {
		throw new Error('Not enough daily forecast data');
	}

	const prompt = await weatherCastForecastLoader.load();
	const replacedPrompt = replaceParams(prompt, Object.assign(
		{},
		...dailyForecasts.map((day, index) => ({
			[`day${index}_summary`]: day.summary,
			[`day${index}_min_temp`]: day.temp.min.toFixed(1),
			[`day${index}_max_temp`]: day.temp.max.toFixed(1),
			[`day${index}_night_temp`]: day.temp.night.toFixed(1),
			[`day${index}_pressure`]: day.pressure.toString(),
			[`day${index}_wind_speed`]: day.wind_speed.toFixed(1),
			[`day${index}_clouds`]: day.clouds.toString(),
			[`day${index}_uvi`]: day.uvi.toString(),
			[`day${index}_pop`]: (day.pop * 100).toString(),
			[`day${index}_rain`]: (day.rain ?? 0).toFixed(1),
			[`day${index}_snow`]: (day.snow ?? 0).toFixed(1),
			[`day${index}_weathers`]: day.weather.map((w) => w.description).join(', '),
			[`day${index}_humidity`]: day.humidity.toString(),
		})),
	));

	const response = await openai.chat.completions.create({
		model: 'gpt-5-mini',
		messages: [
			{
				role: 'user',
				content: replacedPrompt,
			},
		],
		max_completion_tokens: 100,
		reasoning_effort: 'minimal',
	});

	const result = response.choices[0]?.message?.content.trim();

	if (!result) {
		return '';
	}

	return result;
};

interface AggregatedMinuteCast {
  startMinute: number;
  endMinute: number;
  precipitation: number;
}

const generateRainCastDescription = (currentTime: number, minutely: OpenWeatherOneCallResponse['minutely']) => {
	const aggregatedMinuteCast: AggregatedMinuteCast[] = [];

	for (const minuteCast of minutely) {
		const minute = Math.ceil((minuteCast.dt - currentTime) / 60);
		if (aggregatedMinuteCast.length === 0) {
			aggregatedMinuteCast.push({
				startMinute: minute,
				endMinute: minute,
				precipitation: minuteCast.precipitation,
			});
		} else {
			const last = aggregatedMinuteCast[aggregatedMinuteCast.length - 1];
			if (last.precipitation === minuteCast.precipitation && last.endMinute === minute - 1) {
				last.endMinute = minute;
			} else {
				aggregatedMinuteCast.push({
					startMinute: minute,
					endMinute: minute,
					precipitation: minuteCast.precipitation,
				});
			}
		}
	}

	const descriptions = aggregatedMinuteCast.map((cast) => (
		`* precipitation between ${cast.startMinute} and ${cast.endMinute} minutes from now: ${cast.precipitation} mm`
	));
	return descriptions.join('\n');
};

const rainMinuteCastLoader = new Loader<string>(async () => {
	const promptText = await readFile(path.join(__dirname, 'prompts', 'rain_minute_cast.md'));
	return promptText.toString();
});

// eslint-disable-next-line import/prefer-default-export
export const getRainMinuteCast = async (weatherData: OpenWeatherOneCallResponse) => {
	const minutely = weatherData.minutely;
	if (!minutely || minutely.length === 0) {
		return '[PLACE]では、エラーにより現在の降水情報を提供できません。';
	}

	const prompt = await rainMinuteCastLoader.load();
	const replacedPrompt = replaceParams(prompt, {
		description: generateRainCastDescription(weatherData.current.dt, minutely),
	});

	const response = await openai.chat.completions.create({
		model: 'gpt-5-mini',
		messages: [
			{
				role: 'user',
				content: replacedPrompt,
			},
		],
		max_completion_tokens: 100,
		reasoning_effort: 'minimal',
	});

	const result = response.choices[0]?.message?.content.trim();

	if (!result || !result.startsWith('[PLACE]')) {
		return '[PLACE]では、エラーにより現在の降水情報を提供できません。';
	}

	return result;
};

if (require.main === module) {
	(async () => {
		const weatherData = await readJson(path.join(__dirname, '__mocks__/assets/weather.json')) as OpenWeatherOneCallResponse;
		console.log(await getWeatherCastForecast(weatherData));
		console.log(await getWeatherCastHeadline(weatherData));
		console.log(await getRainMinuteCast(weatherData));
	})();
}
