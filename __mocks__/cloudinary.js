/* eslint-env node, jest */

const {PassThrough} = require('stream');
const noop = require('lodash/noop');

const cloudinary = jest.genMockFromModule('cloudinary');

cloudinary.v2.uploader.upload_stream = (options, callback) => {
	const stream = new PassThrough();
	stream.on('end', () => {
		callback(null, {
			url: cloudinary.url,
			secure_url: cloudinary.url,
		});
	});
	stream.on('data', noop);
	return stream;
};

cloudinary.url = '';

module.exports = cloudinary;
