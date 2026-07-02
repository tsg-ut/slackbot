const {vi} = require('vitest');

const getReading = vi.fn((text) => (
	Promise.resolve(getReading.virtualReadings.hasOwnProperty(text) ? getReading.virtualReadings[text] : '')
));

getReading.virtualReadings = {};

module.exports = getReading;
