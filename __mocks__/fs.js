/* eslint-env node, jest */

jest.unmock('fs');
const fs = require('fs');
const Path = require('path');
const {PassThrough} = require('stream');

fs.virtualFiles = {};

fs._readFile = fs.readFile;
fs.readFile = jest.fn((...args) => {
	const [path, callback] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		callback(null, fs.virtualFiles[fullPath]);
		return null;
	} else {
		return fs._readFile(...args);
	}
});

fs._readFileSync = fs.readFileSync;
fs.readFileSync = jest.fn((...args) => {
	const [path] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		return fs.virtualFiles[fullPath];
	} else {
		return fs._readFileSync(...args);
	}
});

fs._access = fs.access;
fs.access = jest.fn((...args) => {
	const [path, , callback] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		callback(null);
		return null;
	} else {
		return fs._access(...args);
	}
});

fs._accessSync = fs.accessSync;
fs.accessSync = jest.fn((...args) => {
	const [path] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		return null;
	} else {
		return fs._accessSync(...args);
	}
});

fs._createReadStream = fs.createReadStream;
fs.createReadStream = jest.fn((...args) => {
	const [path, options] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		const stream = new PassThrough();
		process.nextTick(() => {
			stream.end(Buffer.from(fs.virtualFiles[fullPath]));
		})
		return stream;
	} else {
		return fs._createReadStream(...args);
	}
});

module.exports = fs;
