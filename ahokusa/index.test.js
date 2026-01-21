"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __importDefault(require("./index"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
jest.mock('../achievements');
jest.mock('../lib/slackUtils');
let slack;
beforeEach(() => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    process.env.CHANNEL_GAMES = slack.fakeChannel;
    (0, index_1.default)(slack);
});
describe('ahokusa', () => {
    it('responds to あほくさスライドパズル', async () => {
        const response = await slack.getResponseTo('あほくさスライドパズル');
        expect('username' in response && response.username).toBe('ahokusa');
        expect(response.text).toContain(':void:');
        expect(response.text).toMatch(/^(:[a-z-]+:\n?){6}$/);
    });
    it('accepts valid board initialization by emojis', async () => {
        const board = [
            ':void::ahokusa-bottom-center::ahokusa-top-center:',
            ':ahokusa-bottom-left::ahokusa-top-left::ahokusa-top-right:',
        ].join('\n');
        const response = await slack.getResponseTo(`@ahokusa ${board}`);
        expect('username' in response && response.username).toBe('ahokusa');
        expect(response.text).toBe(board);
    });
    it('accepts valid board initialization by letters', async () => {
        const response = await slack.getResponseTo('@ahokusa .#_さくあ');
        expect('username' in response && response.username).toBe('ahokusa');
        expect(response.text).toBe([
            ':void::ahokusa-bottom-center::ahokusa-top-center:',
            ':ahokusa-bottom-left::ahokusa-top-left::ahokusa-top-right:',
        ].join('\n'));
    });
    it('rejects invalid board initialization', async () => {
        const response = await slack.getResponseTo('@ahokusa ああああああ');
        expect('username' in response && response.username).toBe('ahokusa');
        expect(response.text).toBe(':ha:');
    });
    it('rejects board initialization with too many characters', async () => {
        const response = await slack.getResponseTo('@ahokusa .#_さくああああああああああああああああああああ');
        expect('username' in response && response.username).toBe('ahokusa');
        expect(response.text).toBe(':ha:');
    });
    it('responds to 寿司スライドパズル', async () => {
        const response = await slack.getResponseTo('寿司スライドパズル');
        expect('username' in response && response.username).toBe('sushi-puzzle');
        expect(response.text).toContain(':void:');
        expect(response.text).toContain('sushi');
        expect(response.text).toMatch(/^(:[a-z_\d-]+:\n?)+$/);
    });
    it('responds to 千矢スライドパズル', async () => {
        const response = await slack.getResponseTo('千矢スライドパズル');
        expect('username' in response && response.username).toBe('chiya');
        expect(response.text).toContain(':void:');
        expect(response.text).toContain('chiya');
    });
});
