/* eslint-env node, jest */

const {PassThrough} = require('stream');

class Modem {
	demuxStream(stream, stdout, stderr) {
		stdout.end(Docker.stdout);
		stderr.end(Docker.stderr);
	}
}

class Container {
	constructor() {
		this.modem = new Modem();
	}

	attach(options) {
		const stream = new PassThrough();
		process.nextTick(() => {
			stream.end();
		});
		return Promise.resolve(stream);
	}

	start() {
		return Promise.resolve();
	}

	stop() {
		return Promise.resolve();
	}

	remove() {
		return Promise.resolve();
	}

	wait() {
		return Promise.resolve();
	}
}

class Docker {
	createContainer(options) {
		return Promise.resolve(new Container(options));
	}
}

Docker.stdout = Buffer.from('');
Docker.stderr = Buffer.from('');

module.exports = Docker;
