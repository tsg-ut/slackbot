const EventEmitter = require('events');
const noop = require('lodash/noop');

const createWebClient = (callback) => {
	const handler = (stack) => {
		return new Proxy(
			(...args) => callback(stack, ...args),
			{
				get: (name, property, receiver) => {
					if (typeof property === 'string' && property !== 'then') {
						return handler([...stack, property])
					}
					return Reflect.get(name, property, receiver);
				},
			}
		);
	};

	return handler([]);
};

module.exports = class SlackMock extends EventEmitter {
	constructor(...args) {
		super(...args);
		this.fakeChannel = 'C00000000';
		this.fakeUser = 'U00000000';
		this.fakeTimestamp = '1234567890.123456';
		this.rtmClient = new EventEmitter();
		this.eventClient = new EventEmitter();
		this.webClient = createWebClient((...args) => this.handleWebcall(...args));
		this.messageClient = {
			action: noop,
		};
	}

	handleWebcall(stack, ...args) {
		this.emit('webcall', stack, ...args);
		this.emit(stack.join('.'), ...args);
		if (stack.join('.') === "emoji.list") {
			return Promise.resolve({ok: true, emoji: {"fakeemoji": "https://example.com"}});
		}
		// TODO: make returned value customizable
		return Promise.resolve([]);
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
				type: "message",
			});
		});
	}
};
