/* eslint-env node, jest */

const getReading = jest.fn((text) => (
	Promise.resolve(getReading.virtualReadings.hasOwnProperty(text) ? getReading.virtualReadings[text] : '')
));

getReading.virtualReadings = {};

module.exports = getReading;
