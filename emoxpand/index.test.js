"use strict";
/* eslint-disable init-declarations, no-restricted-syntax */
/* eslint-env jest */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const index_1 = require("./index");
jest.mock('../lib/slackUtils');
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn().mockResolvedValue(JSON.stringify({
            'test-emoji': [['emoji1', 'emoji2'], ['emoji3', 'emoji4']],
            'another-emoji': [['smile']],
        })),
        writeFile: jest.fn().mockResolvedValue(undefined),
    },
}));
describe('emoxpand', () => {
    let slack;
    beforeEach(async () => {
        jest.clearAllMocks();
        slack = new slackMock_1.default();
        process.env.CHANNEL_SANDBOX = slack.fakeChannel;
        const fastify = (0, fastify_1.default)();
        await fastify.register((0, index_1.server)({
            webClient: slack.webClient,
            eventClient: slack.eventClient,
            messageClient: slack.messageClient,
        }));
    });
    describe('大絵文字一覧', () => {
        it('responds to "大絵文字一覧" with a list of registered big emojis', async () => {
            const result = await slack.getResponseTo('大絵文字一覧');
            expect('username' in result && result.username).toBe('BigEmojier');
            expect(result.icon_emoji).toBe(':chian-ga-aru:');
            expect(result.text).toContain('登録されている大絵文字一覧:');
            expect(result.text).toContain('`!test-emoji!`');
            expect(result.text).toContain('`!another-emoji!`');
        });
        it('responds to "大emoji一覧" with a list of registered big emojis', async () => {
            const result = await slack.getResponseTo('大emoji一覧');
            expect('username' in result && result.username).toBe('BigEmojier');
            expect(result.text).toContain('登録されている大絵文字一覧:');
        });
    });
});
