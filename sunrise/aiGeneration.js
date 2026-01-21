"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRainMinuteCast = exports.getWeatherCastForecast = exports.getWeatherCastHeadline = void 0;
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const fs_extra_1 = require("fs-extra");
const openai_1 = __importDefault(require("../lib/openai"));
const utils_1 = require("../lib/utils");
const replaceParams = (template, params) => template.replace(/\{(?<key>\w+)\}/g, (_, key) => params[key] || `{${key}}`);
const weatherCastHeadlineLoader = new utils_1.Loader(async () => {
    const promptText = await (0, fs_extra_1.readFile)(path_1.default.join(__dirname, 'prompts', 'weather_cast_headline.md'));
    return promptText.toString();
});
// eslint-disable-next-line import/prefer-default-export
const getWeatherCastHeadline = async (weatherData) => {
    const current = weatherData.current;
    const todaysForecast = weatherData.daily[0].summary;
    const timeZone = weatherData.timezone;
    const currentTime = new Date(current.dt * 1000).toLocaleString('en-US', { timeZone });
    const sunriseTime = new Date(current.sunrise * 1000).toLocaleTimeString('ja-JP', { timeZone, hour: '2-digit', minute: '2-digit' });
    const sunsetTime = new Date(current.sunset * 1000).toLocaleTimeString('ja-JP', { timeZone, hour: '2-digit', minute: '2-digit' });
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
    const response = await openai_1.default.chat.completions.create({
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
exports.getWeatherCastHeadline = getWeatherCastHeadline;
const weatherCastForecastLoader = new utils_1.Loader(async () => {
    const promptText = await (0, fs_extra_1.readFile)(path_1.default.join(__dirname, 'prompts', 'weather_cast_forecast.md'));
    return promptText.toString();
});
// eslint-disable-next-line import/prefer-default-export
const getWeatherCastForecast = async (weatherData) => {
    const dailyForecasts = weatherData.daily.slice(0, 3);
    if (dailyForecasts.length < 3) {
        throw new Error('Not enough daily forecast data');
    }
    const prompt = await weatherCastForecastLoader.load();
    const replacedPrompt = replaceParams(prompt, Object.assign({}, ...dailyForecasts.map((day, index) => ({
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
    }))));
    const response = await openai_1.default.chat.completions.create({
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
exports.getWeatherCastForecast = getWeatherCastForecast;
const generateRainCastDescription = (currentTime, minutely) => {
    const aggregatedMinuteCast = [];
    for (const minuteCast of minutely) {
        const minute = Math.ceil((minuteCast.dt - currentTime) / 60);
        if (aggregatedMinuteCast.length === 0) {
            aggregatedMinuteCast.push({
                startMinute: minute,
                endMinute: minute,
                precipitation: minuteCast.precipitation,
            });
        }
        else {
            const last = aggregatedMinuteCast[aggregatedMinuteCast.length - 1];
            if (last.precipitation === minuteCast.precipitation && last.endMinute === minute - 1) {
                last.endMinute = minute;
            }
            else {
                aggregatedMinuteCast.push({
                    startMinute: minute,
                    endMinute: minute,
                    precipitation: minuteCast.precipitation,
                });
            }
        }
    }
    const descriptions = aggregatedMinuteCast.map((cast) => (`* precipitation between ${cast.startMinute} and ${cast.endMinute} minutes from now: ${cast.precipitation} mm`));
    return descriptions.join('\n');
};
const rainMinuteCastLoader = new utils_1.Loader(async () => {
    const promptText = await (0, fs_extra_1.readFile)(path_1.default.join(__dirname, 'prompts', 'rain_minute_cast.md'));
    return promptText.toString();
});
// eslint-disable-next-line import/prefer-default-export
const getRainMinuteCast = async (weatherData) => {
    const minutely = weatherData.minutely;
    if (!minutely || minutely.length === 0) {
        return '[PLACE]では、エラーにより現在の降水情報を提供できません。';
    }
    const prompt = await rainMinuteCastLoader.load();
    const replacedPrompt = replaceParams(prompt, {
        description: generateRainCastDescription(weatherData.current.dt, minutely),
    });
    const response = await openai_1.default.chat.completions.create({
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
exports.getRainMinuteCast = getRainMinuteCast;
if (require.main === module) {
    (async () => {
        const weatherData = await (0, fs_extra_1.readJson)(path_1.default.join(__dirname, '__mocks__/assets/weather.json'));
        console.log(await (0, exports.getWeatherCastForecast)(weatherData));
        console.log(await (0, exports.getWeatherCastHeadline)(weatherData));
        console.log(await (0, exports.getRainMinuteCast)(weatherData));
    })();
}
