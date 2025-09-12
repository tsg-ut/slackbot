import qs from 'querystring';
import axios from 'axios';
import cheerio from 'cheerio';
import {flatten, sortBy} from 'lodash';
import scrapeIt from 'scrape-it';
import {z} from 'zod';

interface Article {
	date?: string,
	title: string,
	link: string,
}

interface Archive {
	category: string,
	articles: Article[],
}


const openWeatherOneCallSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	timezone: z.string(),
	timezone_offset: z.number(),
	current: z.object({
		dt: z.number(),
		sunrise: z.number(),
		sunset: z.number(),
		temp: z.number(),
		feels_like: z.number(),
		pressure: z.number(),
		humidity: z.number(),
		dew_point: z.number(),
		uvi: z.number(),
		clouds: z.number(),
		visibility: z.number(),
		wind_speed: z.number(),
		wind_deg: z.number(),
		weather: z.array(z.object({
			id: z.number(),
			main: z.string(),
			description: z.string(),
			icon: z.string(),
		})),
		rain: z.object({
			'1h': z.number(),
		}).optional(),
		snow: z.object({
			'1h': z.number(),
		}).optional(),
	}),
	minutely: z.array(z.object({
		dt: z.number(),
		precipitation: z.number(),
	})).optional(),
	hourly: z.array(z.object({
		dt: z.number(),
		temp: z.number(),
		feels_like: z.number(),
		pressure: z.number(),
		humidity: z.number(),
		dew_point: z.number(),
		uvi: z.number(),
		clouds: z.number(),
		visibility: z.number(),
		wind_speed: z.number(),
		wind_deg: z.number(),
		weather: z.array(z.object({
			id: z.number(),
			main: z.string(),
			description: z.string(),
			icon: z.string(),
		})),
		pop: z.number(),
	})),
	daily: z.array(z.object({
		dt: z.number(),
		sunrise: z.number(),
		sunset: z.number(),
		moonrise: z.number(),
		moonset: z.number(),
		moon_phase: z.number(),
		summary: z.string(),
		temp: z.object({
			day: z.number(),
			min: z.number(),
			max: z.number(),
			night: z.number(),
			eve: z.number(),
			morn: z.number(),
		}),
		feels_like: z.object({
			day: z.number(),
			night: z.number(),
			eve: z.number(),
			morn: z.number(),
		}),
		pressure: z.number(),
		humidity: z.number(),
		dew_point: z.number(),
		wind_speed: z.number(),
		wind_deg: z.number(),
		wind_gust: z.number().optional(),
		weather: z.array(z.object({
			id: z.number(),
			main: z.string(),
			description: z.string(),
			icon: z.string(),
		})),
		clouds: z.number(),
		pop: z.number(),
		rain: z.number().optional(),
		uvi: z.number(),
	})),
	alerts: z.array(z.object({
		sender_name: z.string(),
		event: z.string(),
		start: z.number(),
		end: z.number(),
		description: z.string(),
		tags: z.array(z.string()),
	})).optional(),
});

export type OpenWeatherOneCallResponse = z.infer<typeof openWeatherOneCallSchema>;

const jmaForecastSchema = z.object({
	publicTime: z.string(),
	publicTimeFormatted: z.string(),
	publishingOffice: z.string(),
	title: z.string(),
	link: z.string(),
	description: z.object({
		publicTime: z.string(),
		publicTimeFormatted: z.string(),
		headlineText: z.string(),
		bodyText: z.string(),
		text: z.string(),
	}),
});

export type JmaForecast = z.infer<typeof jmaForecastSchema>;

const getTayoriEntries = async () => {
	const {data} = await scrapeIt<{articles: Article[]}>('http://www.i-nekko.jp/hibinotayori/', {
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
	const {data} = await scrapeIt<{archives: Archive[]}>('http://www.i-nekko.jp/category.html', {
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
		)),
	), [({date}) => {
		const [year, month, day, time] = date.split(/[年月日]/).map((token) => token.trim());
		return new Date(`${year}-${month}-${day} ${time}`);
	}]).reverse();
};

const getTenkijpEntries = async () => {
	const {data} = await scrapeIt<{articles: Article[]}>('https://tenki.jp/suppl/entries/1/', {
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

export const getEntries = () => (
	Promise.all([
		getTayoriEntries(),
		getSaijikiEntries(),
		getTenkijpEntries(),
	])
);

export const getHaiku = async () => {
	const {data} = await axios.get('https://www.haijinkyokai.jp/');
	const $ = cheerio.load(data);
	$('rt').each((i, element) => {
		$(element).remove(); // Remove ruby
	});
	const text = $('#poem1').text();
	const author = $('#author').text();
	const note = $('#notes > p').text();

	return {text, author, note};
};


export const getWeather = async (location: [number, number]) => {
	const {data} = await axios.get('https://api.openweathermap.org/data/3.0/onecall', {
		params: {
			lat: location[0],
			lon: location[1],
			appid: process.env.OPENWEATHER_API_KEY,
			exclude: 'minutely',
			units: 'metric',
			lang: 'ja',
		},
	});

	return openWeatherOneCallSchema.parse(data);
};

export const getJmaForecast = async (firstAreaCode: string) => {
	const {data: forecastData} = await axios.get('https://weather.tsukumijima.net/api/forecast', {
		params: {
			city: firstAreaCode,
		},
	});

	return {data: jmaForecastSchema.parse(forecastData)};
};
