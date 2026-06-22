/* eslint-env node, jest */

const {PassThrough} = require('stream');

const axios = jest.fn((options = {}) => {
	if (options.responseType === 'stream') {
		const stream = new PassThrough();
		process.nextTick(() => {
			stream.end(axios.response);
		});
		return Promise.resolve({data: stream});
	}

	return Promise.resolve(axios.response);
});
axios.get = axios;
axios.post = axios;

axios.response = '';

axios.default = {
	defaults: {},
};

module.exports = axios;
