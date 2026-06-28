const {vi} = require('vitest');

const getReading = vi.fn((text) => (
	Promise.resolve(Object.prototype.hasOwnProperty.call(getReading.virtualReadings, text) ? getReading.virtualReadings[text] : '')
));

getReading.virtualReadings = {};

module.exports = getReading;
