"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJmaForecast = exports.getWeather = exports.getHaiku = exports.getEntries = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = require("cheerio");
const lodash_1 = require("lodash");
const scrape_it_1 = __importDefault(require("scrape-it"));
const zod_1 = require("zod");
const logger_1 = __importDefault(require("../lib/logger"));
const log = logger_1.default.child({ module: 'sunrise/fetch' });
const openWeatherOneCallSchema = zod_1.z.object({
    lat: zod_1.z.number(),
    lon: zod_1.z.number(),
    timezone: zod_1.z.string(),
    timezone_offset: zod_1.z.number(),
    current: zod_1.z.object({
        dt: zod_1.z.number(),
        sunrise: zod_1.z.number(),
        sunset: zod_1.z.number(),
        temp: zod_1.z.number(),
        feels_like: zod_1.z.number(),
        pressure: zod_1.z.number(),
        humidity: zod_1.z.number(),
        dew_point: zod_1.z.number(),
        uvi: zod_1.z.number(),
        clouds: zod_1.z.number(),
        visibility: zod_1.z.number(),
        wind_speed: zod_1.z.number(),
        wind_deg: zod_1.z.number(),
        weather: zod_1.z.array(zod_1.z.object({
            id: zod_1.z.number(),
            main: zod_1.z.string(),
            description: zod_1.z.string(),
            icon: zod_1.z.string(),
        })),
        rain: zod_1.z.object({
            '1h': zod_1.z.number(),
        }).optional(),
        snow: zod_1.z.object({
            '1h': zod_1.z.number(),
        }).optional(),
    }),
    minutely: zod_1.z.array(zod_1.z.object({
        dt: zod_1.z.number(),
        precipitation: zod_1.z.number(),
    })),
    daily: zod_1.z.array(zod_1.z.object({
        dt: zod_1.z.number(),
        sunrise: zod_1.z.number(),
        sunset: zod_1.z.number(),
        moonrise: zod_1.z.number(),
        moonset: zod_1.z.number(),
        moon_phase: zod_1.z.number(),
        summary: zod_1.z.string(),
        temp: zod_1.z.object({
            day: zod_1.z.number(),
            min: zod_1.z.number(),
            max: zod_1.z.number(),
            night: zod_1.z.number(),
            eve: zod_1.z.number(),
            morn: zod_1.z.number(),
        }),
        feels_like: zod_1.z.object({
            day: zod_1.z.number(),
            night: zod_1.z.number(),
            eve: zod_1.z.number(),
            morn: zod_1.z.number(),
        }),
        pressure: zod_1.z.number(),
        humidity: zod_1.z.number(),
        dew_point: zod_1.z.number(),
        wind_speed: zod_1.z.number(),
        wind_deg: zod_1.z.number(),
        wind_gust: zod_1.z.number().optional(),
        weather: zod_1.z.array(zod_1.z.object({
            id: zod_1.z.number(),
            main: zod_1.z.string(),
            description: zod_1.z.string(),
            icon: zod_1.z.string(),
        })),
        clouds: zod_1.z.number(),
        pop: zod_1.z.number(),
        rain: zod_1.z.number().optional(),
        snow: zod_1.z.number().optional(),
        uvi: zod_1.z.number(),
    })),
    alerts: zod_1.z.array(zod_1.z.object({
        sender_name: zod_1.z.string(),
        event: zod_1.z.string(),
        start: zod_1.z.number(),
        end: zod_1.z.number(),
        description: zod_1.z.string(),
        tags: zod_1.z.array(zod_1.z.string()),
    })).optional(),
});
const jmaForecastSchema = zod_1.z.object({
    publicTime: zod_1.z.string(),
    publicTimeFormatted: zod_1.z.string(),
    publishingOffice: zod_1.z.string(),
    title: zod_1.z.string(),
    link: zod_1.z.string(),
    description: zod_1.z.object({
        publicTime: zod_1.z.string(),
        publicTimeFormatted: zod_1.z.string(),
        headlineText: zod_1.z.string(),
        bodyText: zod_1.z.string(),
        text: zod_1.z.string(),
    }),
});
const getTayoriEntries = async () => {
    const { data } = await (0, scrape_it_1.default)('http://www.i-nekko.jp/hibinotayori/', {
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
    const { data } = await (0, scrape_it_1.default)('http://www.i-nekko.jp/category.html', {
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
    return (0, lodash_1.sortBy)((0, lodash_1.flatten)(data.archives.map(({ category, articles }) => (articles.map((article) => ({ category, ...article }))))), [({ date }) => {
            const [year, month, day, time] = date.split(/[年月日]/).map((token) => token.trim());
            return new Date(`${year}-${month}-${day} ${time}`);
        }]).reverse();
};
const getTenkijpEntries = async () => {
    const { data } = await (0, scrape_it_1.default)('https://tenki.jp/suppl/entries/1/', {
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
    return data.articles.map(({ title, link }) => ({
        title,
        link: new URL(link, 'https://tenki.jp/').href,
    }));
};
const getEntries = () => (Promise.all([
    getTayoriEntries(),
    getSaijikiEntries(),
    getTenkijpEntries(),
]));
exports.getEntries = getEntries;
const getHaiku = async () => {
    const { data } = await axios_1.default.get('https://www.haijinkyokai.jp/');
    const $ = (0, cheerio_1.load)(data);
    $('rt').each((i, element) => {
        $(element).remove(); // Remove ruby
    });
    const text = $('#poem1').text();
    const author = $('#author').text();
    const note = $('#notes > p').text();
    return { text, author, note };
};
exports.getHaiku = getHaiku;
const getWeather = async (location) => {
    log.info(`Fetching weather for location: ${location[0]}, ${location[1]}`);
    const { data } = await axios_1.default.get('https://api.openweathermap.org/data/3.0/onecall', {
        params: {
            lat: location[0],
            lon: location[1],
            appid: process.env.OPENWEATHER_API_KEY,
            exclude: 'hourly',
            units: 'metric',
            lang: 'en',
        },
    });
    return openWeatherOneCallSchema.parse(data);
};
exports.getWeather = getWeather;
const getJmaForecast = async (firstAreaCode) => {
    const { data: forecastData } = await axios_1.default.get('https://weather.tsukumijima.net/api/forecast', {
        params: {
            city: firstAreaCode,
        },
    });
    return { data: jmaForecastSchema.parse(forecastData) };
};
exports.getJmaForecast = getJmaForecast;
