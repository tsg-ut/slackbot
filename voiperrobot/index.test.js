"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('../achievements');
const index_1 = __importDefault(require("./index"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
let slack = null;
beforeEach(() => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    (0, index_1.default)(slack);
});
describe('voiperrobot', () => {
    it('responds to ボイパーロボット', async () => {
        const response = await slack.getResponseTo('ボイパーロボット');
        expect('username' in response && response.username).toBe('voiperrobot');
        expect(response.text).toMatch(/(はっ|ひっ|くっ|むか|つく|パン|ツか){8}/);
    });
    it('responds to ボイパーロボットバトル', async () => {
        const response = await slack.getResponseTo('ボイパーロボットバトル');
        expect('username' in response && response.username).toBe('voiperrobot');
        expect(response.text).toContain('ボイパーロボットバトルをはじめるよ〜');
    });
});
