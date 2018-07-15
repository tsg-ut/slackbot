const EventEmitter = require('events');

class WebClient {
	constructor(callback) {
		const handler = (stack) => {
			return new Proxy(
				(...args) => callback(stack, ...args),
				{
					get: (name, property) => handler([...stack, property]),
				}
			);
		};

		return handler([]);
	}
};

module.exports = class SlackMock extends EventEmitter {
	constructor(...args) {
		super(...args);
		this.fakeChannel = 'C00000000';
		this.fakeUser = 'U00000000';
		this.fakeTimestamp = '1234567890.123456';
		this.rtmClient = new EventEmitter();
		this.webClient = new WebClient((...args) => this.handleWebcall(...args));
	}

	handleWebcall(stack, ...args) {
		this.emit('webcall', stack, ...args);
		this.emit(stack.join('.'), ...args);
		return Promise.resolve();
	}

	getResponseTo(message) {
		return new Promise((resolve) => {
			const handleResponse = (options) => {
				if (options.channel === this.fakeChannel) {
					resolve(options);
					this.removeListener('chat.postMessage', handleResponse);
				}
			};

			this.on('chat.postMessage', handleResponse);
			this.rtmClient.emit('message', {
				channel: this.fakeChannel,
				text: message,
				user: this.fakeUser,
				ts: this.fakeTimestamp,
			});
		});
	}
};
