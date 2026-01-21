"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_tags_1 = require("common-tags");
const _1 = __importDefault(require("./"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
jest.mock('../lib/slackUtils', () => ({
    isPlayground: () => true,
}));
let slack;
beforeEach(() => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    process.env.CHANNEL_GAMES = slack.fakeChannel;
    (0, _1.default)(slack);
});
describe('response to /^hitandblow( \\d+)?$/', () => {
    it('starts game by "hitandblow"', async () => {
        const response = await slack.getResponseTo('hitandblow');
        expect('username' in response && response.username).toBe('Hit & Blow');
        expect(response.text).toContain('Hit & Blow (4桁) を開始します。');
    });
    it('starts game by "hitandblow 5"', async () => {
        const response = await slack.getResponseTo('hitandblow 5');
        expect('username' in response && response.username).toBe('Hit & Blow');
        expect(response.text).toContain('Hit & Blow (5桁) を開始します。');
    });
    it('does not start game by "hitandblow 100"', async () => {
        const response = await slack.getResponseTo('hitandblow 100');
        expect('username' in response && response.username).toBe('Hit & Blow');
        expect(response.text).toContain('桁数は1以上10以下で指定してね:thinking_face:');
    });
});
describe('response to /^hbdiff \\d+ \\d+$/', () => {
    it('replys diff to "hbdiff 0169237 9587234"', async () => {
        const response = await slack.getResponseTo('hbdiff 0169237 9587234');
        expect('username' in response && response.username).toBe('Hit & Blow');
        expect(response.text).toBe((0, common_tags_1.stripIndent) `
    >>>~0~ ~1~ ~6~ _9_ *2* *3* _7_
    _9_ ~5~ ~8~ _7_ *2* *3* ~4~`);
    });
    it('replys error to "hbdiff 0138569237 9501687234"', async () => {
        const response = await slack.getResponseTo('hbdiff 0138569237 9501687234');
        expect('username' in response && response.username).toBe('Hit & Blow');
        expect(response.text).toBe('どちらかのコール中に同じ数字が含まれているよ:cry:');
    });
    it('replys error to "hbdiff 012 0123"', async () => {
        const response = await slack.getResponseTo('hbdiff 012 0123');
        expect('username' in response && response.username).toBe('Hit & Blow');
        expect(response.text).toBe('桁数が違うので比較できないよ:cry:');
    });
});
