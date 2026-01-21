"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env jest */
jest.mock('../lib/slackUtils');
jest.mock('../lib/state');
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const _1 = require(".");
let slack = null;
let rememberEnglish = null;
const postMessage = jest.fn();
const updateMessage = jest.fn();
const viewsOpen = jest.fn();
const now = new Date('2021-01-01').getTime();
class MockedRememberEnglish extends _1.RememberEnglish {
    // eslint-disable-next-line camelcase
    postMessage(message) {
        postMessage(message);
        return Promise.resolve({});
    }
    updateMessage(message) {
        updateMessage(message);
        return Promise.resolve({});
    }
    viewsOpen(data) {
        viewsOpen(data);
        return Promise.resolve({});
    }
}
beforeEach(async () => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    postMessage.mockClear();
    updateMessage.mockClear();
    viewsOpen.mockClear();
    jest
        .useFakeTimers()
        .setSystemTime(now);
    rememberEnglish = new MockedRememberEnglish({ slack: slack.webClient });
    await rememberEnglish.initialize();
});
describe('RememberEnglish', () => {
    it('can add word', async () => {
        const word = { ja: 'テスト', en: 'test', user: 'UHOGEHOGE' };
        await rememberEnglish.addWord(word);
        expect(postMessage).toBeCalledWith({
            username: 'Dummy User',
            icon_url: 'https://example.com/dummy.png',
            text: 'Today\'s English: test (テスト)',
        });
        expect(rememberEnglish.dictionary.words).toContainEqual(['test', { en: 'test', ja: 'テスト', createdAt: now }]);
        expect(rememberEnglish.state.words).toContainEqual({ en: 'test', ja: 'テスト', createdAt: now });
    });
});
