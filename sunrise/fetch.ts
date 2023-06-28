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

const accuweatherDailyForecastResponseSchema = z.object({
	Headline: z.object({
		Text: z.string(),
		EffectiveDate: z.string(),
		EffectiveEpochDate: z.number(),
		Severity: z.number(),
		Category: z.string(),
	}),
	DailyForecasts: z.array(
		z.object({
			Date: z.string(),
			Temperature: z.object({
				Minimum: z.object({
					Value: z.number(),
				}),
				Maximum: z.object({
					Value: z.number(),
				}),
			}),
			RealFeelTemperature: z.object({
				Minimum: z.object({
					Value: z.number(),
					Phrase: z.string(),
				}),
				Maximum: z.object({
					Value: z.number(),
					Phrase: z.string(),
				}),
			}),
			Day: z.object({
				Icon: z.number(),
				IconPhrase: z.string(),
				TotalLiquid: z.object({
					Value: z.number(),
				}),
				Wind: z.object({
					Speed: z.object({
						Value: z.number(),
					}),
					Direction: z.object({
						Degrees: z.number(),
					}),
				}),
			}),
			Night: z.object({
				Icon: z.number(),
				IconPhrase: z.string(),
				TotalLiquid: z.object({
					Value: z.number(),
				}),
				Wind: z.object({
					Speed: z.object({
						Value: z.number(),
					}),
					Direction: z.object({
						Degrees: z.number(),
					}),
				}),
			}),
		}),
	),
});

export type AccuweatherDailyForecastResponse = z.infer<typeof accuweatherDailyForecastResponseSchema>;

const accuweatherMinuteCastResponseSchema = z.object({
	Summary: z.object({
		Phrase: z.string(),
		Type: z.string().nullable(),
		TypeId: z.number(),
	}),
	Summaries: z.array(
		z.object({
			StartMinute: z.number(),
			EndMinute: z.number(),
			CountMinute: z.number(),
			MinuteText: z.string(),
			Type: z.string().nullable(),
			TypeId: z.number(),
		}),
	),
	Link: z.string(),
	MobileLink: z.string(),
});

export type AccuweatherMinuteCastResponse = z.infer<typeof accuweatherMinuteCastResponseSchema>;

const accuweatherUnitSchema = z.object({
	Value: z.number(),
	Unit: z.string(),
	UnitType: z.number(),
});

const accuweatherMultiUnitSchema = z.object({
	Metric: accuweatherUnitSchema,
	Imperial: accuweatherUnitSchema,
});

const accuweatherMultiUnitSchemaWithPhrase = z.object({
	Metric: accuweatherUnitSchema.extend({
		Phrase: z.string(),
	}),
	Imperial: accuweatherUnitSchema.extend({
		Phrase: z.string(),
	}),
});

export type AccuweatherMultiUnit = z.infer<typeof accuweatherMultiUnitSchema>;

const accuweatherWindSchema = z.object({
	Direction: z.object({
		Degrees: z.number(),
		Localized: z.string(),
		English: z.string(),
	}),
	Speed: accuweatherMultiUnitSchema,
});

export type AccuweatherWind = z.infer<typeof accuweatherWindSchema>;

const accuweatherCurrentConditionsResponseSchema = z.array(
	z.object({
		LocalObservationDateTime: z.string(),
		EpochTime: z.number(),
		WeatherText: z.string(),
		WeatherIcon: z.number(),
		HasPrecipitation: z.boolean(),
		PrecipitationType: z.string().nullable(),
		Temperature: accuweatherMultiUnitSchema,
		RealFeelTemperature: accuweatherMultiUnitSchemaWithPhrase,
		RealFeelTemperatureShade: accuweatherMultiUnitSchemaWithPhrase,
		PrecipitationSummary: z.object({
			Precipitation: accuweatherMultiUnitSchema,
			PastHour: accuweatherMultiUnitSchema,
			Past3Hours: accuweatherMultiUnitSchema,
			Past6Hours: accuweatherMultiUnitSchema,
			Past9Hours: accuweatherMultiUnitSchema,
			Past12Hours: accuweatherMultiUnitSchema,
			Past18Hours: accuweatherMultiUnitSchema,
			Past24Hours: accuweatherMultiUnitSchema,
		}),
		Past24HourTemperatureDeparture: accuweatherMultiUnitSchema,
		RelativeHumidity: z.number(),
		DewPoint: accuweatherMultiUnitSchema,
		Wind: accuweatherWindSchema,
		UVIndex: z.number(),
		UVIndexText: z.string(),
		MobileLink: z.string(),
		Link: z.string(),
	}),
);

export type AccuweatherCurrentConditionsResponse = z.infer<typeof accuweatherCurrentConditionsResponseSchema>;

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

const getLocationId = async (location: [number, number]) => {
	interface GeopositionResponse {
		Key: string,
	}

	// Fetch location id of target location
	const {data: locationData} = await axios.get<GeopositionResponse>(`http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?${qs.encode({
		apikey: process.env.ACCUWEATHER_KEY,
		q: location.join(','),
		details: 'true',
	})}`);
	const locationId = locationData.Key;

	return locationId;
};

export const getWeather = async (location: [number, number]) => {
	const locationId = await getLocationId(location);

	const {data} = await axios.get(`http://dataservice.accuweather.com/forecasts/v1/daily/5day/${locationId}?${qs.encode({
		apikey: process.env.ACCUWEATHER_KEY,
		language: 'ja-JP',
		details: 'true',
		metric: 'true',
	})}`);

	return {data: accuweatherDailyForecastResponseSchema.parse(data), locationId};
};

export const getCurrentWeather = async (location: [number, number]) => {
	const locationId = await getLocationId(location);

	const {data} = await axios.get(`http://dataservice.accuweather.com/currentconditions/v1/${locationId}?${qs.encode({
		apikey: process.env.ACCUWEATHER_KEY,
		language: 'ja-JP',
		details: 'true',
	})}`);

	return {data: accuweatherCurrentConditionsResponseSchema.parse(data), locationId};
};

export const getMinuteCast = async (location: [number, number]) => {
	const {data} = await axios.get(`http://dataservice.accuweather.com/forecasts/v1/minute?${qs.encode({
		q: `${location[0]},${location[1]}`,
		apikey: process.env.ACCUWEATHER_MINUTECAST_KEY,
		language: 'ja-JP',
	})}`);

	return accuweatherMinuteCastResponseSchema.parse(data);
};
