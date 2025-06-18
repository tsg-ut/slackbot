/* eslint-env node, jest */

import type {ChatPostMessageArguments, ReactionsAddArguments, WebClient} from '@slack/web-api';
import {EventEmitter} from 'events';
import {last} from 'lodash';
import type {SlackInterface} from './slack';
import {createMessageAdapter} from '@slack/interactive-messages';
import {TeamEventClient} from './slackEventClient';

// https://jestjs.io/docs/mock-function-api
const mockMethodCalls = [
	'mockImplementation',
	'mockImplementationOnce',
	'mockReturnThis',
	'mockReturnValue',
	'mockReturnValueOnce',
	'mockResolvedValue',
	'mockResolvedValueOnce',
	'mockRejectedValue',
	'mockRejectedValueOnce',
	'mockRestore',
	'mockClear',
	'mockReset',
	'mockName',
] as const;

const isMockMethodCall = (name: string): name is (typeof mockMethodCalls)[number] => (
	(mockMethodCalls as readonly string[]).includes(name)
);

interface MockWebClient extends Record<string, MockWebClient> {
	(...args: any[]): any;
}

const createWebClient = (
	fallbackFn: (stack: string[], ...args: any[]) => Promise<any>,
	registeredMocks: Map<string, jest.Mock>,
) => {
	const handler = (stack: string[]): MockWebClient => {
		return new Proxy(
			(...args: any[]) => {
				const path = stack.join('.');
				const methodName = last(stack);
				if (registeredMocks.has(path)) {
					return registeredMocks.get(path)(...args);
				}
				if (isMockMethodCall(methodName)) {
					const mock = jest.fn();
					registeredMocks.set(stack.slice(0, -1).join('.'), mock);
					return mock[methodName](
						// @ts-expect-error: Spread operator is not supported.
						...args,
					);
				}
				return fallbackFn(stack, ...args)
			},
			{
				get: (name, property, receiver) => {
					const path = [...stack, property].join('.');
					const parentPath = stack.join('.');
					if (registeredMocks.has(path)) {
						return registeredMocks.get(path);
					}
					if (typeof property === 'string' && isMockMethodCall(property)) {
						const mock = jest.fn();
						registeredMocks.set(parentPath, mock);
						return mock[property];
					}
					if (typeof property === 'string' && property !== 'then') {
						return handler([...stack, property])
					}
					return Reflect.get(name, property, receiver);
				},
			}
		) as MockWebClient;
	};

	return handler([]);
};

class MockTeamEventClient extends TeamEventClient {
	private mockEventEmitter: any;

	constructor() {
		const {EventEmitter} = require('node:events');
		const emitter = new EventEmitter();
		super(emitter, 'T00000000');
		this.mockEventEmitter = emitter;
	}

	on(event: string, listener: (...args: any[]) => void): any {
		return this.mockEventEmitter.on(event, listener);
	}

	onAllTeam(event: string, listener: (...args: any[]) => void): any {
		return this.mockEventEmitter.on(event, listener);
	}

	emit(event: string, ...args: any[]): boolean {
		return this.mockEventEmitter.emit(event, ...args);
	}

	removeListener(event: string, listener: (...args: any[]) => void): this {
		this.mockEventEmitter.removeListener(event, listener);
		return this;
	}
}

export default class SlackMock implements SlackInterface {
	fakeChannel = 'C00000000';
	fakeUser = 'U00000000';
	fakeTeam = 'T00000000';
	fakeTimestamp = '1234567890.123456';

	readonly eventClient: MockTeamEventClient;
	readonly registeredMocks: Map<string, jest.Mock>;
	readonly webClient: WebClient;
	readonly messageClient: ReturnType<typeof createMessageAdapter>;
	private mockEventEmitter: any;

	constructor() {
		const {EventEmitter} = require('node:events');
		this.mockEventEmitter = new EventEmitter();
		this.eventClient = new MockTeamEventClient();
		this.registeredMocks = new Map();
		this.webClient = createWebClient(
			(stack: string[], ...args: any[]) => this.handleWebcall(stack, ...args),
			this.registeredMocks,
		) as unknown as WebClient;
		this.messageClient = {
			action: jest.fn(),
			viewSubmission: jest.fn(),
		} as any;
	}

	// EventEmitter interface for SlackMock
	emit(event: string, ...args: any[]): boolean {
		return this.mockEventEmitter.emit(event, ...args);
	}

	on(event: string, listener: (...args: any[]) => void): this {
		this.mockEventEmitter.on(event, listener);
		return this;
	}

	removeListener(event: string, listener: (...args: any[]) => void): this {
		this.mockEventEmitter.removeListener(event, listener);
		return this;
	}

	removeAllListeners(event?: string): this {
		this.mockEventEmitter.removeAllListeners(event);
		return this;
	}

	handleWebcall(stack: string[], ...args: any[]) {
		this.emit('webcall', stack, ...args);
		this.emit(stack.join('.'), ...args);
		if (stack.join('.') === "emoji.list") {
			return Promise.resolve({ok: true, emoji: {"fakeemoji": "https://example.com"}});
		}
		if (stack.join('.') === "users.list") {
			return Promise.resolve({ok: true, members: []});
		}
		if (stack.join('.') === "conversations.list") {
			return Promise.resolve({ok: true, channels: [
				{id: 'CGENERAL', is_general: true},
			]});
		}
		if (stack.join('.') === "chat.postMessage") {
			return Promise.resolve({ok: true, ts: this.fakeTimestamp});
		}
		if (stack.join('.') === "chat.unfurl") {
			return Promise.resolve({ok: true});
		}
		// TODO: make returned value customizable
		return Promise.resolve([]);
	}

	postMessage(message: string, options = {}) {
		const data = {
			channel: this.fakeChannel,
			text: message,
			user: this.fakeUser,
			ts: this.fakeTimestamp,
			type: 'message',
			...options
		};
		this.eventClient.emit('message', data);
	}

	waitForEvent(eventName: string) {
		return new Promise((resolve) => {
			const handleResponse = (options: {channel: string} & Record<string, any>) => {
				if (options.channel === this.fakeChannel) {
					this.removeListener(eventName, handleResponse);
					resolve(options);
				}
			};

			this.on(eventName, handleResponse);
		});
	}

	waitForResponse() {
		return this.waitForEvent('chat.postMessage') as Promise<ChatPostMessageArguments>;
	}

	waitForReaction() {
		return this.waitForEvent('reactions.add') as Promise<ReactionsAddArguments>;
	}

	getResponseTo(message: string, options = {}) {
		const res = this.waitForResponse();
		this.postMessage(message, options);
		return res;
	}

	// Not recommended. Instanciate a new SlackMock instead.
	reset() {
		this.removeAllListeners();
		this.registeredMocks.clear();
	}
};
