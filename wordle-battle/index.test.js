"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __importDefault(require("./index"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
let slack = null;
beforeEach(async () => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await (0, index_1.default)(slack);
});
describe('wordle battle', () => {
    it('respond to wordle battle', async () => {
        const { channel, text } = await slack.getResponseTo('wordle battle');
        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Wordle Battle を開始します！');
    });
    it('respond to wordle battle 10', async () => {
        const { channel, text } = await slack.getResponseTo('wordle battle 10');
        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Wordle Battle を開始します！');
    });
    it('respond to wordle battle 100', async () => {
        const { channel, text } = await slack.getResponseTo('wordle battle 100');
        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('単語のみに対応しています。');
    });
    it('respond to wordle reset', async () => {
        const { channel, text } = await slack.getResponseTo('wordle reset');
        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Wordle Battle をリセットしました。');
    });
});
