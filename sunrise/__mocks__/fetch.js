"use strict";
/* eslint-env node, jest */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeather = exports.getHaiku = exports.getEntries = void 0;
const path_1 = __importDefault(require("path"));
const fs_extra_1 = require("fs-extra");
const getEntries = () => Promise.resolve([
    [{ title: 'タイトル', link: 'http://google.com' }],
    [{ title: 'タイトル', link: 'http://google.com', category: 'カテゴリ' }],
    [{ title: 'タイトル', link: 'http://google.com' }],
]);
exports.getEntries = getEntries;
const getHaiku = () => Promise.resolve({
    text: '古池やそこのけそこのけほととぎす',
    author: '博多市',
});
exports.getHaiku = getHaiku;
const getWeather = async () => {
    const weatherData = await (0, fs_extra_1.readJson)(path_1.default.join(__dirname, 'assets/weather.json'));
    return weatherData;
};
exports.getWeather = getWeather;
