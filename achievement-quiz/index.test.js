"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __importDefault(require("./index"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
jest.mock('../lib/slackUtils');
let slack;
beforeEach(() => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    process.env.CHANNEL_GAMES = slack.fakeChannel;
    (0, index_1.default)(slack);
});
describe('response to /^実績当てクイズ$/', () => {
    it('starts game by "実績当てクイズ"', async () => {
        const response = await slack.getResponseTo('実績当てクイズ');
        expect('username' in response && response.username).toBe('実績当てクイズ');
        expect(response.text).toContain('この実績なーんだ');
    });
});
