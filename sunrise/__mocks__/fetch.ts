/* eslint-env node, jest */

import path from 'path';
import {readJson} from 'fs-extra';
import type {OpenWeatherOneCallResponse} from '../fetch';

const getEntries = () => Promise.resolve([
	[{title: 'タイトル', link: 'http://google.com'}],
	[{title: 'タイトル', link: 'http://google.com', category: 'カテゴリ'}],
	[{title: 'タイトル', link: 'http://google.com'}],
]);

const getHaiku = () => Promise.resolve({
	text: '古池やそこのけそこのけほととぎす',
	author: '博多市',
});

const getWeather = async () => {
	const weatherData = await readJson(path.join(__dirname, 'assets/weather.json')) as OpenWeatherOneCallResponse;
	return weatherData;
};

export {getEntries, getHaiku, getWeather};
