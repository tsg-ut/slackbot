/* eslint-env node, jest */

const tokenize = jest.fn((text) => (
	// eslint-disable-next-line no-prototype-builtins
	Promise.resolve(tokenize.virtualTokens.hasOwnProperty(text) ? tokenize.virtualTokens[text] : [])
));

tokenize.virtualTokens = {};

module.exports = tokenize;
