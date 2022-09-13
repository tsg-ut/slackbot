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
		if (stack.join('.') === "users.list") {
			return {members: []}
		}
		if (stack.join('.') === "conversations.list") {
			return Promise.resolve({ok: true, channels: [
				{id: 'CGENERAL', is_general: true},
			]});
		}
		if (stack.join('.') ===  "chat.postMessage") {
			return Promise.resolve({ok: true, ts: this.fakeTimestamp});
		}
		if (stack.join('.') ===  "chat.unfurl") {
			return Promise.resolve({ok: true});
		}
		// TODO: make returned value customizable
		return Promise.resolve([]);
	}

	postMessage(message, options={}) {
		const data = {
			channel: this.fakeChannel,
			text: message,
			user: this.fakeUser,
			ts: this.fakeTimestamp,
			type: "message",
			...options
		};
		this.eventClient.emit('message', data);
	}

	waitForEvent(eventName){
		return new Promise((resolve) => {
			const handleResponse = (options) => {
				if (options.channel === this.fakeChannel) {
					this.removeListener(eventName, handleResponse);
					resolve(options);
				}
			};

			this.on(eventName, handleResponse);
		});
	}

	waitForResponse() {
		return this.waitForEvent('chat.postMessage');
	}

	waitForReaction() {
		return this.waitForEvent('reactions.add');
	}

	getResponseTo(message, options={}) {
		const res = this.waitForResponse();
		this.postMessage(message, options);
		return res;
	}
};
