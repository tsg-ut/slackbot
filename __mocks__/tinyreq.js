
const {PassThrough} = require('stream');

const tinyreq = (...args) => (
	tinyreq.impl(...args)
);

tinyreq.impl = vi.fn(() => {
	return Promise.resolve(tinyreq.response);
});

tinyreq.response = '';

module.exports = tinyreq;
