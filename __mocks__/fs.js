const fs = {};
const realFs = require('fs');
const Path = require('path');
const {PassThrough} = require('stream');

fs.constants = realFs.constants;
fs.virtualFiles = {};

fs.promises = {};

fs.readFile = vi.fn((...args) => {
	const [path, callback] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		callback(null, fs.virtualFiles[fullPath]);
		return null;
	} else {
		return realFs.readFile(...args);
	}
});

fs.readFileSync = vi.fn((...args) => {
	const [path] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		return fs.virtualFiles[fullPath];
	} else {
		return realFs.readFileSync(...args);
	}
});

fs.promises.readFile = vi.fn((...args) => {
	const [path] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		return new Promise((resolve) => resolve(fs.virtualFiles[fullPath]));
	} else {
		return realFs.promises.readFile(...args);
	}
});

fs.promises.readdir = vi.fn((...args) => {
	const [path] = args;
	const fullPath = Path.resolve(process.cwd(), path);
	const files = Object.keys(fs.virtualFiles).filter((file) => file.startsWith(fullPath));

	if (files.length > 0) {
		return new Promise((resolve) => resolve(files.map((file) => Path.basename(file))));
	} else {
		return realFs.promises.readdir(...args);
	}
});

fs.access = vi.fn((...args) => {
	const [path, , callback] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		callback(null);
		return null;
	} else {
		return realFs.access(...args);
	}
});

fs.accessSync = vi.fn((...args) => {
	const [path] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		return null;
	} else {
		return realFs.accessSync(...args);
	}
});

fs.createReadStream = vi.fn((...args) => {
	const [path, options] = args;
	const fullPath = Path.resolve(process.cwd(), path);

	if (fs.virtualFiles.hasOwnProperty(fullPath)) {
		const stream = new PassThrough();
		process.nextTick(() => {
			stream.end(Buffer.from(fs.virtualFiles[fullPath]));
		})
		return stream;
	} else {
		return realFs.createReadStream(...args);
	}
});

fs.writeFile = vi.fn((file, data, ...rest) => {
	let options, callback;
	if (rest.length === 1) {
		callback = rest[0];
	}
	else {
		[, callback] = rest;
	}
	const fullPath = Path.resolve(process.cwd(), file);
	fs.virtualFiles[fullPath] = data;
	callback(null);
});

fs.default = fs;
module.exports = fs;
