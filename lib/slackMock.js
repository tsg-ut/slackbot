"use strict";
/* eslint-env node, jest */
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const lodash_1 = require("lodash");
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
];
const isMockMethodCall = (name) => (mockMethodCalls.includes(name));
const createWebClient = (fallbackFn, registeredMocks) => {
    const handler = (stack) => {
        return new Proxy((...args) => {
            const path = stack.join('.');
            const methodName = (0, lodash_1.last)(stack);
            if (registeredMocks.has(path)) {
                return registeredMocks.get(path)(...args);
            }
            if (isMockMethodCall(methodName)) {
                const mock = jest.fn();
                registeredMocks.set(stack.slice(0, -1).join('.'), mock);
                return mock[methodName](
                // @ts-expect-error: Spread operator is not supported.
                ...args);
            }
            return fallbackFn(stack, ...args);
        }, {
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
                    return handler([...stack, property]);
                }
                return Reflect.get(name, property, receiver);
            },
        });
    };
    return handler([]);
};
class MockTeamEventClient extends events_1.EventEmitter {
    onAllTeam(event, listener) {
        return this.on(event, listener);
    }
}
class MockMessageClient {
    action = jest.fn();
    viewSubmission = jest.fn();
    async sendAction(payload, callbackId, respondFn) {
        const actionHandlers = this.action.mock.calls;
        const action = payload.actions[0];
        if (!action) {
            return null;
        }
        const handlerEntry = actionHandlers.find(([pattern]) => {
            if (typeof pattern === 'string') {
                return pattern === callbackId;
            }
            if (pattern instanceof RegExp) {
                return callbackId && pattern.test(callbackId);
            }
            return (matchPattern(pattern.actionId, action.action_id) &&
                matchPattern(pattern.callbackId, callbackId) &&
                matchPattern(pattern.blockId, action.block_id) &&
                matchPattern(pattern.type, action.type));
        });
        if (handlerEntry) {
            const handler = handlerEntry[1];
            return handler(payload, respondFn ?? jest.fn());
        }
    }
}
const matchPattern = (pattern, test) => {
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
};
class SlackMock extends events_1.EventEmitter {
    fakeChannel = 'C00000000';
    fakeUser = 'U00000000';
    fakeTeam = 'T00000000';
    fakeTimestamp = '1234567890.123456';
    eventClient;
    registeredMocks;
    webClient;
    messageClient;
    constructor() {
        super();
        this.eventClient = new MockTeamEventClient();
        this.registeredMocks = new Map();
        this.webClient = createWebClient((stack, ...args) => this.handleWebcall(stack, ...args), this.registeredMocks);
        this.messageClient = new MockMessageClient();
    }
    handleWebcall(stack, ...args) {
        this.emit('webcall', stack, ...args);
        this.emit(stack.join('.'), ...args);
        if (stack.join('.') === "emoji.list") {
            return Promise.resolve({ ok: true, emoji: { "fakeemoji": "https://example.com" } });
        }
        if (stack.join('.') === "users.list") {
            return Promise.resolve({ ok: true, members: [] });
        }
        if (stack.join('.') === "conversations.list") {
            return Promise.resolve({ ok: true, channels: [
                    { id: 'CGENERAL', is_general: true },
                ] });
        }
        if (stack.join('.') === "chat.postMessage") {
            return Promise.resolve({ ok: true, ts: this.fakeTimestamp });
        }
        if (stack.join('.') === "chat.unfurl") {
            return Promise.resolve({ ok: true });
        }
        if (stack.join('.') === "chat.getPermalink") {
            const [options] = args;
            return Promise.resolve({
                ok: true,
                permalink: `https://example.slack.com/archives/${options.channel}/p${options.message_ts.replace('.', '')}`,
            });
        }
        if (stack.join('.') === "chat.delete") {
            return Promise.resolve({ ok: true });
        }
        if (stack.join('.') === "chat.postEphemeral") {
            return Promise.resolve({ ok: true, message_ts: this.fakeTimestamp });
        }
        // TODO: make returned value customizable
        return Promise.resolve([]);
    }
    postMessage(message, options = {}) {
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
    waitForEvent(eventName) {
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
    getResponseTo(message, options = {}) {
        const res = this.waitForResponse();
        this.postMessage(message, options);
        return res;
    }
    // Not recommended. Instanciate a new SlackMock instead.
    reset() {
        this.removeAllListeners();
        this.registeredMocks.clear();
    }
}
exports.default = SlackMock;
;
