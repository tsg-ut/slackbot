/* eslint-env node, jest */

const getEntries = () => Promise.resolve([
	[{title: 'タイトル', link: 'http://google.com'}],
	[{title: 'タイトル', link: 'http://google.com', category: 'カテゴリ'}],
	[{title: 'タイトル', link: 'http://google.com'}],
]);

const getHaiku = () => Promise.resolve({
	text: '古池やそこのけそこのけほととぎす',
	author: '博多市',
});

const getWeather = () => {
	const now = new Date().toISOString();

	return Promise.resolve({
		data: {
			Headline: {
				EffectiveDate: now,
				EffectiveEpochDate: 1551564000,
				Severity: 3,
				Text: 'Expect rainy weather Sunday morning through late Monday night',
				Category: 'rain',
				EndDate: '2019-03-05T07:00:00+09:00',
				EndEpochDate: 1551736800,
				MobileLink: 'http://m.accuweather.com/en/jp/komaba/2410314/extended-weather-forecast/2410314?lang=en-us',
				Link: 'http://www.accuweather.com/en/jp/komaba/2410314/daily-weather-forecast/2410314?lang=en-us',
			},
			DailyForecasts: [
				{
					Date: now,
					Temperature: {
						Minimum: {
							Value: 44,
							Unit: 'F',
							UnitType: 18,
						},
						Maximum: {
							Value: 58,
							Unit: 'F',
							UnitType: 18,
						},
					},
					RealFeelTemperature: {
						Minimum: {
							Value: 41,
							Unit: 'F',
							UnitType: 18,
						},
						Maximum: {
							Value: 60,
							Unit: 'F',
							UnitType: 18,
						},
					},
					RealFeelTemperatureShade: {
						Minimum: {
							Value: 41,
							Unit: 'F',
							UnitType: 18,
						},
						Maximum: {
							Value: 58,
							Unit: 'F',
							UnitType: 18,
						},
					},
					HoursOfSun: 6.4,
					DegreeDaySummary: {
						Heating: {
							Value: 14,
							Unit: 'F',
							UnitType: 18,
						},
						Cooling: {
							Value: 0,
							Unit: 'F',
							UnitType: 18,
						},
					},
					AirAndPollen: [
						{
							Name: 'AirQuality',
							Value: 0,
							Category: 'Good',
							CategoryValue: 1,
							Type: 'Particle Pollution',
						},
						{
							Name: 'Grass',
							Value: 0,
							Category: 'Low',
							CategoryValue: 1,
						},
						{
							Name: 'Mold',
							Value: 0,
							Category: 'Low',
							CategoryValue: 1,
						},
						{
							Name: 'Tree',
							Value: 0,
							Category: 'Low',
							CategoryValue: 1,
						},
						{
							Name: 'Ragweed',
							Value: 0,
							Category: 'Low',
							CategoryValue: 1,
						},
						{
							Name: 'UVIndex',
							Value: 4,
							Category: 'Moderate',
							CategoryValue: 2,
						},
					],
					Day: {
						Icon: 4,
						IconPhrase: 'Intermittent clouds',
						ShortPhrase: 'Times of clouds and sun',
						LongPhrase: 'Times of clouds and sun',
						PrecipitationProbability: 12,
						ThunderstormProbability: 0,
						RainProbability: 12,
						SnowProbability: 0,
						IceProbability: 0,
						Wind: {
							Speed: {
								Value: 9.2,
								Unit: 'mi/h',
								UnitType: 9,
							},
							Direction: {
								Degrees: 38,
								Localized: 'NE',
								English: 'NE',
							},
						},
						WindGust: {
							Speed: {
								Value: 27.6,
								Unit: 'mi/h',
								UnitType: 9,
							},
							Direction: {
								Degrees: 356,
								Localized: 'N',
								English: 'N',
							},
						},
						TotalLiquid: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						Rain: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						Snow: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						Ice: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						HoursOfPrecipitation: 0,
						HoursOfRain: 0,
						HoursOfSnow: 0,
						HoursOfIce: 0,
						CloudCover: 49,
					},
					Night: {
						Icon: 38,
						IconPhrase: 'Mostly cloudy',
						ShortPhrase: 'Increasing clouds',
						LongPhrase: 'Increasing clouds',
						PrecipitationProbability: 8,
						ThunderstormProbability: 0,
						RainProbability: 8,
						SnowProbability: 0,
						IceProbability: 0,
						Wind: {
							Speed: {
								Value: 5.8,
								Unit: 'mi/h',
								UnitType: 9,
							},
							Direction: {
								Degrees: 103,
								Localized: 'ESE',
								English: 'ESE',
							},
						},
						WindGust: {
							Speed: {
								Value: 13.8,
								Unit: 'mi/h',
								UnitType: 9,
							},
							Direction: {
								Degrees: 140,
								Localized: 'SE',
								English: 'SE',
							},
						},
						TotalLiquid: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						Rain: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						Snow: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						Ice: {
							Value: 0,
							Unit: 'in',
							UnitType: 1,
						},
						HoursOfPrecipitation: 0,
						HoursOfRain: 0,
						HoursOfSnow: 0,
						HoursOfIce: 0,
						CloudCover: 71,
					},
					Sources: [
						'AccuWeather',
					],
					MobileLink: 'http://m.accuweather.com/en/jp/komaba/2410314/daily-weather-forecast/2410314?lang=en-us',
					Link: 'http://www.accuweather.com/en/jp/komaba/2410314/daily-weather-forecast/2410314?lang=en-us',
				},
			],
		},
		locationId: '10000',
	});
};

export {getEntries, getHaiku, getWeather};
