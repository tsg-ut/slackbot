/* eslint-env node, jest */

const {PassThrough} = require('stream');

const tinyreq = (...args) => (
	tinyreq.impl(...args)
);

tinyreq.impl = jest.fn(() => {
	return Promise.resolve(tinyreq.response);
});

tinyreq.response = '';

module.exports = tinyreq;
