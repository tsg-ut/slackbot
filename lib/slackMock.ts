/* eslint-env node, jest */

import type {ChatPostMessageArguments, ReactionsAddArguments, WebClient} from '@slack/web-api';
import {EventEmitter} from 'events';
import {last} from 'lodash';
import type {SlackInterface} from './slack';
import {createMessageAdapter} from '@slack/interactive-messages';
import type {BlockAction} from '@slack/bolt';

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

class MockTeamEventClient extends EventEmitter {
	onAllTeam(event: string, listener: (...args: any[]) => void): any {
		return this.on(event, listener);
	}
}

class MockMessageClient {
	action = jest.fn();
	viewSubmission = jest.fn();
	async sendAction(
		payload: BlockAction,
		callbackId?: string,
		respondFn?: (response: any) => Promise<void>,
	): Promise<any> {
		const actionHandlers = this.action.mock.calls;
		const action = payload.actions[0];
		if (!action) {
			return null;
		}
		const handlerEntry = actionHandlers.find(
			([pattern]) => {
				if (typeof pattern === 'string') {
					return pattern === callbackId;
				}
				if (pattern instanceof RegExp) {
					return callbackId && pattern.test(callbackId);
				}
				return (
					matchPattern(pattern.actionId, action.action_id) &&
					matchPattern(pattern.callbackId, callbackId) &&
					matchPattern(pattern.blockId, action.block_id) &&
					matchPattern(pattern.type, action.type)
				);
			}
		);
		if (handlerEntry) {
			const handler = handlerEntry[1];
			return handler(payload, respondFn ?? jest.fn());
		}
	}
}

const matchPattern = (pattern: undefined | string | RegExp, test: undefined | string) => {
	if (pattern === undefined) {
		return true;
	}
	if (test === undefined) {
		return false;
	}
	if (typeof pattern === 'string') {
		return pattern === test;
	}
	return pattern.test(test);
}

export default class SlackMock extends EventEmitter implements SlackInterface {
	fakeChannel = 'C00000000';
	fakeUser = 'U00000000';
	fakeTeam = 'T00000000';
	fakeTimestamp = '1234567890.123456';

	readonly eventClient: MockTeamEventClient;
	readonly registeredMocks: Map<string, jest.Mock>;
	readonly webClient: WebClient;
	readonly messageClient: ReturnType<typeof createMessageAdapter> & MockMessageClient;

	constructor() {
		super();
		this.eventClient = new MockTeamEventClient();
		this.registeredMocks = new Map();
		this.webClient = createWebClient(
			(stack: string[], ...args: any[]) => this.handleWebcall(stack, ...args),
			this.registeredMocks,
		) as unknown as WebClient;
		this.messageClient = new MockMessageClient() as any;
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
		if (stack.join('.') === "chat.getPermalink") {
			const [options] = args;
			return Promise.resolve({
				ok: true,
				permalink: `https://example.slack.com/archives/${options.channel}/p${options.message_ts.replace('.', '')}`,
			});
		}
		if (stack.join('.') === "chat.delete") {
			return Promise.resolve({ok: true});
		}
		if (stack.join('.') === "chat.postEphemeral") {
			return Promise.resolve({ok: true, message_ts: this.fakeTimestamp});
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
