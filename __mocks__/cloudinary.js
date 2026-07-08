const {PassThrough} = require('stream');
const noop = require('lodash/noop');

const cloudinary = {
	v2: {uploader: {}, config: () => {}, url: vi.fn(() => '')},
	url: '',
};

cloudinary.v2.uploader.upload_stream = vi.fn((options, callback) => {
	const stream = new PassThrough();
	stream.on('end', () => {
		callback(null, {
			url: cloudinary.url,
			secure_url: cloudinary.url,
		});
	});
	stream.on('data', noop);
	return stream;
});

module.exports = cloudinary;
