import {PassThrough} from 'stream';
import {noop} from 'lodash-es';

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

export default cloudinary;
