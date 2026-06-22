/* eslint-env node, jest */

const {PassThrough} = require('stream');
const noop = require('lodash/noop');

const cloudinary = jest.genMockFromModule('cloudinary');

cloudinary.v2.uploader.upload_stream = jest.fn((options, callback) => {
	const stream = new PassThrough();
	stream.on('end', () => {
		callback(null, {
			url: cloudinary.url,
			secure_url: cloudinary.url,
			public_id: 'test-public-id',
		});
	});
	stream.on('data', noop);
	return stream;
});

cloudinary.v2.uploader.upload = jest.fn((imageUrl, callback) => {
	callback(null, {
		url: cloudinary.url,
		secure_url: cloudinary.url,
		public_id: 'test-public-id',
	});
});

cloudinary.url = '';
cloudinary.v2.url = jest.fn(() => cloudinary.url);

module.exports = cloudinary;
