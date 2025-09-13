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

const getWeather = () => Promise.resolve({
	lat: 35.659,
	lon: 139.685,
	timezone: 'Asia/Tokyo',
	timezone_offset: 32400,
	current: {
		dt: 1622998800,
		sunrise: 1622998800,
		sunset: 1623050400,
		temp: 25.4,
		feels_like: 25.4,
		pressure: 1012,
		humidity: 83,
		dew_point: 22.4,
		uvi: 9.9,
		clouds: 75,
		visibility: 10000,
		wind_speed: 4.63,
		wind_deg: 180,
		weather: [
			{
				id: 803,
				main: 'Clouds',
				description: 'broken clouds',
				icon: '04d',
			},
		],
	},
	daily: [
		{
			dt: 1623034800,
			sunrise: 1622998800,
			sunset: 1623050400,
			moonrise: 1623001200,
			moonset: 1623054000,
			moon_phase: 0.95,
			summary: 'Expect a day of partly cloudy with rain',
			temp: {
				day: 25.4,
				min: 20.4,
				max: 26.4,
				night: 22.4,
				eve: 24.4,
				morn: 21.4,
			},
			feels_like: {
				day: 25.4,
				night: 22.4,
				eve: 24.4,
				morn: 21.4,
			},
			pressure: 1012,
			humidity: 83,
			dew_point: 22.4,
			wind_speed: 4.63,
			wind_deg: 180,
			weather: [
				{
					id: 500,
					main: 'Rain',
					description: 'light rain',
					icon: '10d',
				},
			],
			clouds: 75,
			pop: 0.6,
			rain: 1.2,
			uvi: 9.9,
		},
	],
});

export {getEntries, getHaiku, getWeather};
